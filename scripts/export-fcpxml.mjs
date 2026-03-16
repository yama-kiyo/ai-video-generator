#!/usr/bin/env node
/**
 * FCPXML書き出し — Remotionプロジェクトから Premiere Pro / DaVinci Resolve 用XMLを生成
 *
 * 使い方:
 *   node scripts/export-fcpxml.mjs                     # project.json から生成
 *   node scripts/export-fcpxml.mjs --config my.json    # 指定JSONから生成
 *   node scripts/export-fcpxml.mjs --out out/video.fcpxml
 *
 * 出力: out/<project名>.fcpxml
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
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
const TOTAL = cursor + END_DUR;

// ── ユーティリティ ──
function rt(frames) {
  return `${frames}/${FPS}s`;
}

function getMediaDuration(filePath) {
  try {
    const dur = execSync(
      `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`,
    ).toString().trim();
    return Math.ceil(parseFloat(dur) * FPS);
  } catch {
    return 150;
  }
}

function escXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── メディアアイテム解決 ──
function resolveMedia(sec) {
  if (sec.video) return [{ type: "video", src: sec.video }];
  if (sec.media) return sec.media;
  if (sec.photos) return sec.photos.map((src) => ({ type: "photo", src }));
  return [];
}

// ── リソース収集 ──
const resources = [];
const resourceIds = new Map();
let resCounter = 0;

function addResource(src, type) {
  if (resourceIds.has(src)) return resourceIds.get(src);
  const id = `r${++resCounter}`;
  const absPath = path.join(PUBLIC, src);
  let duration = 150;
  if ((type === "video" || type === "audio") && fs.existsSync(absPath)) {
    duration = getMediaDuration(absPath);
  }
  resources.push({ id, src, absPath, type, duration });
  resourceIds.set(src, id);
  return id;
}

for (const sec of sections) {
  for (const m of resolveMedia(sec)) {
    addResource(m.src, m.type === "video" ? "video" : "image");
  }
  if (sec.audio) addResource(sec.audio, "audio");
}

// ── FCPXML生成 ──
console.log("📝 FCPXML生成中...\n");

const projectName = project.title || "ai_video";

let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.10">
  <resources>
    <format id="r0" name="FFVideoFormat1080p30" frameDuration="${rt(1)}" width="1920" height="1080"/>
`;

for (const res of resources) {
  const fileUrl = `file://${res.absPath}`;
  if (res.type === "video") {
    xml += `    <asset id="${res.id}" name="${escXml(path.basename(res.src))}" src="${escXml(fileUrl)}" start="0s" duration="${rt(res.duration)}" hasVideo="1" hasAudio="0" format="r0"/>\n`;
  } else if (res.type === "audio") {
    xml += `    <asset id="${res.id}" name="${escXml(path.basename(res.src))}" src="${escXml(fileUrl)}" start="0s" duration="${rt(res.duration)}" hasAudio="1"/>\n`;
  } else {
    xml += `    <asset id="${res.id}" name="${escXml(path.basename(res.src))}" src="${escXml(fileUrl)}" start="0s" duration="${rt(150)}" hasVideo="1" format="r0"/>\n`;
  }
}

xml += `  </resources>
  <library>
    <event name="${escXml(projectName)}">
      <project name="${escXml(projectName)}">
        <sequence format="r0" duration="${rt(TOTAL)}" tcStart="0s" tcFormat="NDF">
          <spine>
`;

// タイトル（黒ギャップ）
xml += `            <gap name="タイトル" offset="0s" start="0s" duration="${rt(TITLE_DUR)}"/>\n`;

// セクションごとの映像クリップ
for (let i = 0; i < sections.length; i++) {
  const media = resolveMedia(sections[i]);
  const secDur = sectionFrames[i];
  const perMedia = Math.ceil(secDur / Math.max(media.length, 1));

  for (let j = 0; j < media.length; j++) {
    const m = media[j];
    const clipStart = sectionStarts[i] + j * (perMedia - CROSSFADE);
    const clipDur = Math.min(perMedia, TOTAL - clipStart);
    const resId = resourceIds.get(m.src);
    if (!resId) continue;
    const clipName = `S${i + 1}_${path.basename(m.src)}`;
    xml += `            <asset-clip ref="${resId}" name="${escXml(clipName)}" offset="${rt(clipStart)}" start="0s" duration="${rt(clipDur)}"/>\n`;
  }
}

xml += `          </spine>\n`;

// ナレーショントラック
for (let i = 0; i < sections.length; i++) {
  const sec = sections[i];
  if (!sec.audio) continue;
  const narStart = sectionStarts[i] + NAR_PAD;
  const narDur = narFrames[i];
  const resId = resourceIds.get(sec.audio);
  xml += `          <asset-clip ref="${resId}" name="nar_${String(i + 1).padStart(2, "0")}" lane="1" offset="${rt(narStart)}" start="0s" duration="${rt(narDur)}"/>\n`;
}

xml += `        </sequence>
      </project>
    </event>
  </library>
</fcpxml>`;

const outFile = getArg("out", null) || path.join(OUT, `${projectName.replace(/[^\w]/g, "_")}.fcpxml`);
fs.writeFileSync(outFile, xml, "utf-8");

const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(1);
console.log(`✅ ${outFile} (${sizeKB}KB)`);
console.log(`   シーケンス尺: ${(TOTAL / FPS).toFixed(1)}s`);
console.log(`   リソース数: ${resources.length}`);
console.log(`   セクション: ${sections.length}`);
console.log(`\n📌 Premiere Pro: ファイル → 読み込み → .fcpxml`);
console.log(`📌 DaVinci Resolve: ファイル → タイムラインの読み込み → FCPXML`);
