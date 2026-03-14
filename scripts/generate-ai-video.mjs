#!/usr/bin/env node
/**
 * AI動画生成パイプライン
 * ナレーション原稿 → AI動画 + ElevenLabs 音声 → Remotionで合成
 *
 * 使い方:
 *   node scripts/generate-ai-video.mjs                          # Veo 3.1 で生成
 *   node scripts/generate-ai-video.mjs --engine runway           # Runway gen4.5 で生成
 *   node scripts/generate-ai-video.mjs --engine runway-aleph --v2v input.mp4  # Runway v2v
 *   node scripts/generate-ai-video.mjs --voice adeline --skip-video
 *   node scripts/generate-ai-video.mjs --config sections.json
 */
import dotenv from "dotenv";
dotenv.config({ override: true });

import { GoogleGenAI } from "@google/genai";
import RunwayML from "@runwayml/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "test-ai");

// ── CLI引数パース ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);

const VOICE_KEY = getArg("voice", "aria");
const SKIP_VIDEO = hasFlag("skip-video");
const SKIP_AUDIO = hasFlag("skip-audio");
const CONFIG_FILE = getArg("config", null);
const ENGINE = getArg("engine", "veo");           // veo | runway | runway-aleph
const V2V_INPUT = getArg("v2v", null);             // v2v用入力動画パス
const RUNWAY_DURATION = parseInt(getArg("duration", "5"), 10); // Runway動画秒数 (2-10)

// ── API設定 ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const RUNWAY_API_KEY = process.env.RUNWAY_API_KEY;

const isVeo = ENGINE === "veo";
const isRunway = ENGINE === "runway" || ENGINE === "runway-aleph";
const isV2V = ENGINE === "runway-aleph" && V2V_INPUT;

if (isVeo && !GEMINI_API_KEY && !SKIP_VIDEO) {
  console.error("❌ GEMINI_API_KEY が .env に設定されていません");
  process.exit(1);
}
if (isRunway && !RUNWAY_API_KEY && !SKIP_VIDEO) {
  console.error("❌ RUNWAY_API_KEY が .env に設定されていません");
  process.exit(1);
}
if (!ELEVENLABS_API_KEY && !SKIP_AUDIO) {
  console.error("❌ ELEVENLABS_API_KEY が .env に設定されていません");
  process.exit(1);
}

// ElevenLabs ボイスマップ
const VOICES = {
  aria: "9BWtsMINqrJLrRacOk9x",
  lily: "pFZP5JQG7iQjIQuC4Bku",
  charlotte: "XB0fDUnXU5powFXDhCwa",
  adeline: "5l5f8iK3YPeGga21rQIX",
  riley: "hA4zGnmTwX2NQiTRMt7o",
  grandpa: "NOpBlnGInO9m6vDvFkFC",
};

const VOICE_ID = VOICES[VOICE_KEY];
if (!VOICE_ID && !SKIP_AUDIO) {
  console.error(`❌ 不明なボイスキー: ${VOICE_KEY}`);
  console.error(`   利用可能: ${Object.keys(VOICES).join(", ")}`);
  process.exit(1);
}

// ── デフォルトセクション定義 ──
const DEFAULT_SECTIONS = [
  {
    narration:
      "セレコーポレーションのアパート建設、着工から組み立ての流れを紹介します。こちらが工事着手前の現場の様子です。",
    videoPrompt:
      "Aerial drone shot of an empty construction lot in a Japanese residential neighborhood, sunny day, 4K cinematic",
    caption: "工事着手前",
  },
  {
    narration:
      "まず、基礎工事に向けた整地作業から始まります。整地をしながら、余分な土、いわゆる残土を取り除いていきます。",
    videoPrompt:
      "Ground-level shot of a small excavator grading and leveling soil on a Japanese construction site, workers in helmets, 4K cinematic",
    caption: "整地作業",
  },
  {
    narration:
      "本体基礎工事の準備が整いました。これから本体基礎工事が始まります。",
    videoPrompt:
      "Close-up of rebar framework and wooden formwork being prepared for a concrete foundation pour at a Japanese apartment construction site, 4K cinematic",
    caption: "本体基礎工事の準備",
  },
];

// ── セクション読み込み ──
let sections;
if (CONFIG_FILE) {
  const raw = fs.readFileSync(path.resolve(CONFIG_FILE), "utf-8");
  sections = JSON.parse(raw);
  console.log(`📄 設定ファイルから ${sections.length} セクションを読み込み`);
} else {
  sections = DEFAULT_SECTIONS;
  console.log(`📄 デフォルト ${sections.length} セクションを使用`);
}

// 出力ディレクトリ作成
fs.mkdirSync(OUT_DIR, { recursive: true });

// ══════════════════════════════════════════════════════════
// Veo 3.1 動画生成
// ══════════════════════════════════════════════════════════
async function generateVideoVeo(prompt, outputPath, index) {
  console.log(`\n🎬 [${index + 1}/${sections.length}] Veo 3.1 動画生成中...`);
  console.log(`   プロンプト: ${prompt.substring(0, 80)}...`);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const response = await ai.models.generateVideos({
    model: "veo-3.0-generate-preview",
    prompt,
    config: { aspectRatio: "16:9", numberOfVideos: 1 },
  });

  // ポーリング（最大5分）
  let operation = response;
  const maxWait = 300_000;
  const start = Date.now();

  while (!operation.done) {
    if (Date.now() - start > maxWait) {
      throw new Error("動画生成がタイムアウトしました（5分）");
    }
    console.log(`   ⏳ 生成中... (${Math.round((Date.now() - start) / 1000)}秒)`);
    await new Promise((r) => setTimeout(r, 10_000));
    operation = await ai.operations.get({
      operationName: operation.name,
      config: { httpOptions: { apiVersion: "" } },
    });
  }

  const video = operation.response?.generatedVideos?.[0];
  if (!video?.video?.uri) throw new Error("動画URIが取得できませんでした");

  const uri = video.video.uri;
  const downloadUrl = `${uri}${uri.includes("?") ? "&" : "?"}key=${GEMINI_API_KEY}`;
  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

// ══════════════════════════════════════════════════════════
// Runway Text-to-Video (gen4.5)
// ══════════════════════════════════════════════════════════
async function generateVideoRunway(prompt, outputPath, index) {
  console.log(`\n🎬 [${index + 1}/${sections.length}] Runway gen4.5 動画生成中...`);
  console.log(`   プロンプト: ${prompt.substring(0, 80)}...`);

  const runway = new RunwayML({ apiKey: RUNWAY_API_KEY });

  const result = await runway.textToVideo
    .create({
      model: "gen4.5",
      promptText: prompt,
      duration: Math.min(Math.max(RUNWAY_DURATION, 2), 10),
      ratio: "1280:720",
    })
    .waitForTaskOutput({ timeout: 600_000 });

  if (!result.output || result.output.length === 0) {
    throw new Error("Runway: 出力URLが取得できませんでした");
  }

  const videoUrl = result.output[0];
  console.log(`   📥 ダウンロード中...`);
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

// ══════════════════════════════════════════════════════════
// Runway Video-to-Video (gen4_aleph)
// ══════════════════════════════════════════════════════════
async function generateVideoV2V(prompt, inputVideoPath, outputPath, index) {
  console.log(`\n🎬 [${index + 1}/${sections.length}] Runway Aleph V2V 生成中...`);
  console.log(`   入力: ${path.basename(inputVideoPath)}`);
  console.log(`   プロンプト: ${prompt.substring(0, 80)}...`);

  const runway = new RunwayML({ apiKey: RUNWAY_API_KEY });

  // ローカルファイルをアップロード
  let videoUri;
  if (inputVideoPath.startsWith("http")) {
    videoUri = inputVideoPath;
  } else {
    const absPath = path.resolve(inputVideoPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`入力動画が見つかりません: ${absPath}`);
    }
    console.log(`   📤 動画アップロード中...`);
    const upload = await runway.uploads.createEphemeral({
      file: fs.createReadStream(absPath),
    });
    videoUri = upload.uri;
    console.log(`   ✅ アップロード完了`);
  }

  // V2V 生成
  const result = await runway.videoToVideo
    .create({
      model: "gen4_aleph",
      promptText: prompt,
      videoUri,
    })
    .waitForTaskOutput({ timeout: 600_000 });

  if (!result.output || result.output.length === 0) {
    throw new Error("Runway V2V: 出力URLが取得できませんでした");
  }

  const videoUrl = result.output[0];
  console.log(`   📥 ダウンロード中...`);
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
}

// ══════════════════════════════════════════════════════════
// ElevenLabs TTS 生成
// ══════════════════════════════════════════════════════════
async function generateNarration(text, outputPath, index) {
  console.log(`\n🎙️ [${index + 1}/${sections.length}] ナレーション生成中...`);
  console.log(`   テキスト: ${text.substring(0, 60)}...`);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_v3",
        output_format: "mp3_44100_128",
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ElevenLabs エラー: ${err.detail?.message || res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)}KB)`);

  // 音声の長さを推定（MP3 128kbps → bytes / 16000 ≈ 秒）
  const estimatedDur = buffer.length / 16000;
  return estimatedDur;
}

// ══════════════════════════════════════════════════════════
// メイン実行
// ══════════════════════════════════════════════════════════
async function main() {
  const engineLabel = {
    veo: "Veo 3.1",
    runway: "Runway gen4.5",
    "runway-aleph": V2V_INPUT ? "Runway Aleph V2V" : "Runway gen4.5",
  }[ENGINE] || ENGINE;

  console.log("=== AI動画生成パイプライン ===\n");
  console.log(`エンジン: ${engineLabel}`);
  console.log(`ボイス: ${VOICE_KEY} (${VOICE_ID || "skip"})`);
  console.log(`動画生成: ${SKIP_VIDEO ? "スキップ" : engineLabel}`);
  console.log(`音声生成: ${SKIP_AUDIO ? "スキップ" : "ElevenLabs v3"}`);
  if (isV2V) console.log(`V2V入力: ${V2V_INPUT}`);
  if (isRunway) console.log(`Runway秒数: ${RUNWAY_DURATION}秒`);

  const durations = [];

  // 動画生成
  if (!SKIP_VIDEO) {
    for (let i = 0; i < sections.length; i++) {
      const outPath = path.join(OUT_DIR, `clip_${String(i + 1).padStart(2, "0")}.mp4`);
      try {
        if (isV2V) {
          await generateVideoV2V(sections[i].videoPrompt, V2V_INPUT, outPath, i);
        } else if (isRunway) {
          await generateVideoRunway(sections[i].videoPrompt, outPath, i);
        } else {
          await generateVideoVeo(sections[i].videoPrompt, outPath, i);
        }
      } catch (e) {
        console.error(`   ❌ 動画生成失敗: ${e.message}`);
      }
    }
  }

  // 音声生成
  if (!SKIP_AUDIO) {
    for (let i = 0; i < sections.length; i++) {
      const outPath = path.join(OUT_DIR, `nar_${String(i + 1).padStart(2, "0")}.mp3`);
      try {
        const dur = await generateNarration(sections[i].narration, outPath, i);
        durations.push(dur);
      } catch (e) {
        console.error(`   ❌ 音声生成失敗: ${e.message}`);
        durations.push(10);
      }
    }
  }

  // セクション定義を出力（TestAI.tsx に貼り付ける用）
  console.log("\n\n=== TestAI.tsx 用セクション定義 ===\n");
  console.log("const sections = [");
  sections.forEach((sec, i) => {
    const dur = durations[i] ? durations[i].toFixed(1) : "10.0";
    console.log(`  {`);
    console.log(`    video: "test-ai/clip_${String(i + 1).padStart(2, "0")}.mp4",`);
    console.log(`    audio: "test-ai/nar_${String(i + 1).padStart(2, "0")}.mp3",`);
    console.log(`    durSec: ${dur},`);
    console.log(`    caption: "${sec.caption}",`);
    console.log(`  },`);
  });
  console.log("];");

  console.log("\n=== 完了 ===");
  console.log(`出力先: ${OUT_DIR}`);
  console.log("次のステップ: TestAI.tsx のsections配列を更新 → npx remotion render TestAI out/video.mp4");
}

main().catch((e) => {
  console.error("\n❌ 致命的エラー:", e.message);
  process.exit(1);
});
