#!/usr/bin/env node
/**
 * AI動画生成パイプライン
 * ナレーション原稿 → Veo 3.1 動画 + ElevenLabs 音声 → Remotionで合成
 *
 * 使い方:
 *   node scripts/generate-ai-video.mjs
 *   node scripts/generate-ai-video.mjs --voice voice_5l5f --skip-video
 *   node scripts/generate-ai-video.mjs --config sections.json
 */
import dotenv from "dotenv";
dotenv.config({ override: true });

import { GoogleGenAI } from "@google/genai";
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

// ── API設定 ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY が .env に設定されていません");
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
  voice_5l5f: "5l5f8iK3YPeGga21rQIX",
  voice_hA4z: "hA4zGnmTwX2NQiTRMt7o",
  voice_NOp: "NOpBlnGInO9m6vDvFkFC",
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

// ── Veo 3.1 動画生成 ──
async function generateVideo(prompt, outputPath, index) {
  console.log(`\n🎬 [${index + 1}/${sections.length}] 動画生成中...`);
  console.log(`   プロンプト: ${prompt.substring(0, 80)}...`);

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  // 動画生成リクエスト
  const response = await ai.models.generateVideos({
    model: "veo-3.0-generate-preview",
    prompt,
    config: {
      aspectRatio: "16:9",
      numberOfVideos: 1,
    },
  });

  // ポーリング（最大5分）
  let operation = response;
  const maxWait = 300_000;
  const start = Date.now();

  while (!operation.done) {
    if (Date.now() - start > maxWait) {
      throw new Error("動画生成がタイムアウトしました（5分）");
    }
    console.log(
      `   ⏳ 生成中... (${Math.round((Date.now() - start) / 1000)}秒)`
    );
    await new Promise((r) => setTimeout(r, 10_000));
    operation = await ai.operations.get({
      operationName: operation.name,
      config: { httpOptions: { apiVersion: "" } },
    });
  }

  // 動画ダウンロード
  const video = operation.response?.generatedVideos?.[0];
  if (!video?.video?.uri) {
    throw new Error("動画URIが取得できませんでした");
  }

  const uri = video.video.uri;
  const downloadUrl = `${uri}${uri.includes("?") ? "&" : "?"}key=${GEMINI_API_KEY}`;

  const res = await fetch(downloadUrl);
  if (!res.ok) throw new Error(`ダウンロード失敗: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(
    `   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`
  );
}

// ── ElevenLabs TTS 生成 ──
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
    throw new Error(
      `ElevenLabs エラー: ${err.detail?.message || res.status}`
    );
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(
    `   ✅ 保存: ${path.basename(outputPath)} (${(buffer.length / 1024).toFixed(0)}KB)`
  );

  // 音声の長さを推定（MP3 128kbps → bytes / 16000 ≈ 秒）
  const estimatedDur = buffer.length / 16000;
  return estimatedDur;
}

// ── メイン実行 ──
async function main() {
  console.log("=== AI動画生成パイプライン ===\n");
  console.log(`ボイス: ${VOICE_KEY} (${VOICE_ID || "skip"})`);
  console.log(`動画生成: ${SKIP_VIDEO ? "スキップ" : "Veo 3.1"}`);
  console.log(`音声生成: ${SKIP_AUDIO ? "スキップ" : "ElevenLabs v3"}`);

  const durations = [];

  // 動画生成
  if (!SKIP_VIDEO) {
    for (let i = 0; i < sections.length; i++) {
      const outPath = path.join(OUT_DIR, `clip_${String(i + 1).padStart(2, "0")}.mp4`);
      try {
        await generateVideo(sections[i].videoPrompt, outPath, i);
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
    console.log(
      `    video: "test-ai/clip_${String(i + 1).padStart(2, "0")}.mp4",`
    );
    console.log(
      `    audio: "test-ai/nar_${String(i + 1).padStart(2, "0")}.mp3",`
    );
    console.log(`    durSec: ${dur},`);
    console.log(`    caption: "${sec.caption}",`);
    console.log(`  },`);
  });
  console.log("];");

  console.log("\n=== 完了 ===");
  console.log(`出力先: ${OUT_DIR}`);
  console.log(
    "次のステップ: TestAI.tsx のsections配列を更新 → npx remotion render TestAI out/video.mp4"
  );
}

main().catch((e) => {
  console.error("\n❌ 致命的エラー:", e.message);
  process.exit(1);
});
