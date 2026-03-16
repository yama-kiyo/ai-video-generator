/**
 * 統合AIビデオコンポジション
 *
 * セクションごとに写真スライドショー / AI動画 / ナレーション を自動切替。
 * project.json から設定を読み込む。
 *
 * モード:
 *   textMode: "caption"（デフォルト）= 短いキャプション表示
 *             "subtitle" = ナレーション原稿を句読点区切りで字幕表示
 *   mediaMode: "photo"（デフォルト）= 全て写真スライドショー
 *              "i2v" = 一部写真をRunway gen4_turboで動画化（media配列使用）
 */
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

// ── メディア定義（写真 or 動画） ──
export interface MediaItem {
  type: "photo" | "video";
  src: string;
}

// ── 型定義 ──
export interface SectionDef {
  caption: string;
  photos?: string[];          // 写真モード
  video?: string;             // 動画モード（単一動画。photos/mediaより優先）
  media?: MediaItem[];        // 混在モード（写真+i2v動画）
  audio?: string;             // ナレーション音声（オプション）
  narration?: string;         // ナレーション原稿（字幕モード用）
  durSec: number;             // セクション尺（秒）
}

export interface ProjectDef {
  title: string;
  subtitle?: string;
  organization?: string;
  theme?: "dark" | "light";
  endingText?: string;
  textMode?: "caption" | "subtitle";  // デフォルト: "caption"
  mediaMode?: "photo" | "i2v";        // デフォルト: "photo"
  sections: SectionDef[];
}

// ── デフォルト設定 ──
const DEFAULT_PROJECT: ProjectDef = {
  title: "サンプル動画",
  subtitle: "",
  organization: "",
  theme: "dark",
  endingText: "つづく",
  textMode: "caption",
  mediaMode: "photo",
  sections: [],
};

const FPS = 30;
const CROSSFADE = 15;
const TITLE_DUR = 90;
const END_DUR = 75;
const NAR_PAD = 30; // 1秒 @30fps — ナレーション前後パディング

// ── テーマ ──
const THEMES = {
  dark: { bg: "#0A0A0A", text: "#fff", sub: "#aaa", muted: "#888", captionBg: "transparent" },
  light: { bg: "#F5F3EF", text: "#222", sub: "#888", muted: "#555", captionBg: "#F5F3EF" },
};

// ── 字幕ユーティリティ ──
// ナレーション文をセグメントに分割し、文字数比率でタイミングを自動算出
export function buildSubtitles(narration: string, durSec: number): { text: string; atSec: number }[] {
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

// ── タイムライン計算（音声が先、映像は音声の尺に合わせる） ──
export function calcTimeline(sections: SectionDef[], narPad = NAR_PAD) {
  const narFrames = sections.map((s) => Math.ceil(s.durSec * FPS));
  const frames = narFrames.map((nf, i) =>
    sections[i].audio ? nf + narPad * 2 : nf,
  );
  const starts: number[] = [];
  let cursor = TITLE_DUR;
  for (let i = 0; i < frames.length; i++) {
    starts.push(cursor);
    cursor += frames[i] - (i < frames.length - 1 ? CROSSFADE : 0);
  }
  return { narFrames, frames, starts, total: cursor + END_DUR };
}

// ── タイトル ──
const Title: React.FC<{
  title: string;
  subtitle?: string;
  organization?: string;
  theme: typeof THEMES.dark;
}> = ({ title, subtitle, organization, theme }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 25, TITLE_DUR - 20, TITLE_DUR], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", opacity }}>
      <div style={{ textAlign: "center" }}>
        {organization && (
          <div style={{ color: theme.sub, fontSize: 30, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", letterSpacing: 10, marginBottom: 24, fontWeight: 300 }}>
            {organization}
          </div>
        )}
        <div style={{ color: theme.text, fontSize: 84, fontWeight: 700, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", letterSpacing: 4 }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ color: theme.muted, fontSize: 40, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", marginTop: 16, fontWeight: 400 }}>
            {subtitle}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

// ── 字幕表示コンポーネント ──
const SubtitleOverlay: React.FC<{
  subtitles: { text: string; atSec: number }[];
  totalFrames: number;
  narPad: number;
}> = ({ subtitles, totalFrames, narPad }) => {
  const frame = useCurrentFrame();
  const currentSec = (frame - narPad) / FPS;

  let currentSubtitle = "";
  let subtitleStartFrame = 0;
  for (let i = subtitles.length - 1; i >= 0; i--) {
    if (currentSec >= subtitles[i].atSec) {
      currentSubtitle = subtitles[i].text;
      subtitleStartFrame = Math.floor(subtitles[i].atSec * FPS) + narPad;
      break;
    }
  }

  if (!currentSubtitle || frame < narPad) return null;

  const fadeIn = interpolate(frame, [subtitleStartFrame, subtitleStartFrame + 6], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: 60,
        left: 80,
        right: 80,
        display: "flex",
        justifyContent: "center",
        opacity: fadeIn,
      }}
    >
      <div
        style={{
          color: "#fff",
          fontSize: 42,
          fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
          fontWeight: 600,
          textAlign: "center",
          textShadow: "0 2px 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.5)",
          lineHeight: 1.5,
          maxWidth: 1600,
          padding: "12px 24px",
          backgroundColor: "rgba(0,0,0,0.4)",
          borderRadius: 8,
        }}
      >
        {currentSubtitle}
      </div>
    </div>
  );
};

// ── メディアセクション（写真/動画混在対応） ──
const MediaSection: React.FC<{
  media: MediaItem[];
  caption: string;
  subtitles?: { text: string; atSec: number }[];
  totalFrames: number;
  narPad: number;
  theme: typeof THEMES.dark;
}> = ({ media, caption, subtitles, totalFrames, narPad, theme }) => {
  const frame = useCurrentFrame();
  const perItem = Math.ceil(totalFrames / media.length);

  const sectionOpacity = interpolate(frame, [0, CROSSFADE, totalFrames - CROSSFADE, totalFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const textOpacity = interpolate(frame, [CROSSFADE, CROSSFADE + 15, totalFrames - CROSSFADE - 10, totalFrames - CROSSFADE], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: sectionOpacity }}>
      <AbsoluteFill style={{ backgroundColor: theme.bg }} />

      {media.map((item, i) => {
        const start = i * (perItem - CROSSFADE);
        const itemOpacity = media.length === 1 ? 1 : interpolate(
          frame,
          [start, start + CROSSFADE, start + perItem - CROSSFADE, start + perItem],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const scale = interpolate(frame, [start, start + perItem], [1.0, 1.05], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        });

        return (
          <div key={item.src} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, overflow: "hidden", opacity: itemOpacity }}>
            {item.type === "video" ? (
              <OffthreadVideo
                src={staticFile(item.src)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                muted
              />
            ) : (
              <Img
                src={staticFile(item.src)}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: `scale(${scale})`,
                  transformOrigin: "center center",
                }}
              />
            )}
          </div>
        );
      })}

      {/* グラデーションオーバーレイ */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 250, background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }} />

      {/* 字幕モード or キャプションモード */}
      {subtitles ? (
        <SubtitleOverlay subtitles={subtitles} totalFrames={totalFrames} narPad={narPad} />
      ) : (
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 80px", backgroundColor: theme.captionBg, opacity: textOpacity }}>
          <div style={{ color: theme.text, fontSize: 52, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", fontWeight: 600, letterSpacing: 2, textAlign: "center" }}>
            {caption}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── 単一動画セクション ──
const VideoSection: React.FC<{
  videoSrc: string;
  caption: string;
  subtitles?: { text: string; atSec: number }[];
  totalFrames: number;
  narPad: number;
  theme: typeof THEMES.dark;
}> = ({ videoSrc, caption, subtitles, totalFrames, narPad, theme }) => {
  const frame = useCurrentFrame();
  const sectionOpacity = interpolate(frame, [0, CROSSFADE, totalFrames - CROSSFADE, totalFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const captionOpacity = interpolate(frame, [CROSSFADE + 5, CROSSFADE + 20, totalFrames - CROSSFADE - 10, totalFrames - CROSSFADE], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: sectionOpacity }}>
      <OffthreadVideo src={staticFile(videoSrc)} style={{ width: "100%", height: "100%", objectFit: "cover" }} muted />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 250, background: "linear-gradient(transparent, rgba(0,0,0,0.7))" }} />

      {subtitles ? (
        <SubtitleOverlay subtitles={subtitles} totalFrames={totalFrames} narPad={narPad} />
      ) : (
        <div style={{ position: "absolute", bottom: 50, left: 80, right: 80, opacity: captionOpacity }}>
          <div style={{ color: "#fff", fontSize: 56, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", fontWeight: 600, letterSpacing: 3, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
            {caption}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};

// ── エンディング ──
const Ending: React.FC<{ text: string; theme: typeof THEMES.dark }> = ({ text, theme }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20, END_DUR - 15, END_DUR], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg, display: "flex", alignItems: "center", justifyContent: "center", opacity }}>
      <div style={{ color: theme.muted, fontSize: 42, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", fontWeight: 400, letterSpacing: 4 }}>
        {text}
      </div>
    </AbsoluteFill>
  );
};

// ── メインコンポジション ──
export const AIVideo: React.FC<{ project: ProjectDef }> = ({ project: inputProject }) => {
  const project = { ...DEFAULT_PROJECT, ...inputProject };
  const theme = THEMES[project.theme ?? "dark"];
  const isSubtitle = project.textMode === "subtitle";
  const pad = NAR_PAD;
  const { narFrames, frames, starts, total } = calcTimeline(project.sections, pad);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* タイトル */}
      <Sequence from={0} durationInFrames={TITLE_DUR}>
        <Title title={project.title} subtitle={project.subtitle} organization={project.organization} theme={theme} />
      </Sequence>

      {/* セクション */}
      {project.sections.map((sec, i) => {
        // メディアアイテムを決定: video > media > photos
        const mediaItems: MediaItem[] | null =
          sec.video ? null :  // 単一動画はVideoSectionで処理
          sec.media ? sec.media :
          sec.photos ? sec.photos.map((src) => ({ type: "photo" as const, src })) :
          null;

        const subs = isSubtitle && sec.narration
          ? buildSubtitles(sec.narration, sec.durSec)
          : undefined;

        return (
          <Sequence key={i} from={starts[i]} durationInFrames={frames[i]}>
            {sec.video ? (
              <VideoSection
                videoSrc={sec.video}
                caption={sec.caption}
                subtitles={subs}
                totalFrames={frames[i]}
                narPad={pad}
                theme={theme}
              />
            ) : mediaItems ? (
              <MediaSection
                media={mediaItems}
                caption={sec.caption}
                subtitles={subs}
                totalFrames={frames[i]}
                narPad={pad}
                theme={theme}
              />
            ) : null}
          </Sequence>
        );
      })}

      {/* エンディング */}
      <Sequence from={total - END_DUR} durationInFrames={END_DUR}>
        <Ending text={project.endingText ?? "つづく"} theme={theme} />
      </Sequence>

      {/* ナレーション（セクション内で頭1秒後に開始、フル再生） */}
      {project.sections.map((sec, i) =>
        sec.audio ? (
          <Sequence key={`nar-${i}`} from={starts[i] + pad} durationInFrames={narFrames[i]}>
            <Audio src={staticFile(sec.audio)} volume={1} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};

// ── 外部からの参照用 ──
export { TITLE_DUR, END_DUR, FPS, CROSSFADE, NAR_PAD };
