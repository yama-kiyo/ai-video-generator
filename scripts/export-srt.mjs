#!/usr/bin/env node
/**
 * SRT字幕書き出し — Remotionプロジェクトから汎用字幕ファイルを生成
 *
 * 使い方:
 *   node scripts/export-srt.mjs                     # project.json から生成
 *   node scripts/export-srt.mjs --config my.json    # 指定JSONから生成
 *   node scripts/export-srt.mjs --out out/video.srt
 *
 * 出力: out/<project名>.srt
 *
 * 字幕タイミング:
 *   - manualSubtitles がある場合: Whisper実測タイミングを使用
 *   - narration がある場合: buildSubtitles で文字数比率から自動算出
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "out");
fs.mkdirSync(OUT, { recursive: true });

// ── CLI引数 ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const CONFIG = getArg("config", "project.json");
const configPath = path.resolve(ROOT, CONFIG);
if (!fs.existsSync(configPath)) {
  console.error(`❌ ${configPath} が見つかりません`);
  process.exit(1);
}

const project = JSON.parse(fs.readFileSync(configPath, "utf-8"));
const sections = project.sections || [];

// ── 定数（AIVideo.tsxと同期） ──
const FPS = 30;
const CROSSFADE = 15;
const NAR_PAD = 30;
const TITLE_DUR = 90;
const END_DUR = 75;

// ── buildSubtitles（AIVideo.tsxと同じロジック） ──
function buildSubtitles(narration, durSec) {
  const segments = narration
    .split(/(?<=[。？！\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const totalChars = segments.reduce((sum, s) => sum + s.length, 0);
  let cursor = 0;
  return segments.map((text) => {
    const atSec = (cursor / totalChars) * durSec;
    cursor += text.length;
    return { text, atSec };
  });
}

// ── タイムライン計算 ──
const narFrames = sections.map((s) => Math.ceil(s.durSec * FPS));
const sectionFrames = narFrames.map((nf, i) =>
  sections[i].audio ? nf + NAR_PAD * 2 : nf,
);
const sectionStarts = [];
let cursor = TITLE_DUR;
for (let i = 0; i < sectionFrames.length; i++) {
  sectionStarts.push(cursor);
  cursor += sectionFrames[i] - (i < sectionFrames.length - 1 ? CROSSFADE : 0);
}

// ── SRTタイムコード ──
function toSrtTime(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.round((totalSec - Math.floor(totalSec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ── SRT生成 ──
console.log("📝 SRT字幕生成中...\n");

let srtIndex = 1;
let srt = "";

for (let i = 0; i < sections.length; i++) {
  const sec = sections[i];

  // manualSubtitles > narration (buildSubtitles) の優先順位
  let subs;
  if (sec.manualSubtitles && sec.manualSubtitles.length > 0) {
    subs = sec.manualSubtitles;
  } else if (sec.narration) {
    subs = buildSubtitles(sec.narration, sec.durSec);
  } else {
    continue;
  }

  const secStartSec = (sectionStarts[i] + NAR_PAD) / FPS;

  for (let j = 0; j < subs.length; j++) {
    const startSec = secStartSec + subs[j].atSec;
    const endSec = j < subs.length - 1
      ? secStartSec + subs[j + 1].atSec
      : secStartSec + sec.durSec;

    srt += `${srtIndex}\n`;
    srt += `${toSrtTime(startSec)} --> ${toSrtTime(endSec)}\n`;
    srt += `${subs[j].text}\n\n`;
    srtIndex++;
  }
}

const projectName = project.title || "ai_video";
const outFile = getArg("out", null) || path.join(OUT, `${projectName.replace(/[^\w]/g, "_")}.srt`);
fs.writeFileSync(outFile, srt, "utf-8");

console.log(`✅ ${outFile}`);
console.log(`   字幕数: ${srtIndex - 1}`);
console.log(`\n📌 Premiere Pro: ファイル → キャプション → SRT読み込み`);
console.log(`📌 YouTube: 動画管理 → 字幕 → ファイルをアップロード`);
