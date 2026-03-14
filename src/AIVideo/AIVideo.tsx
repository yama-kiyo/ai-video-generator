/**
 * 統合AIビデオコンポジション
 *
 * セクションごとに写真スライドショー / AI動画 / ナレーション を自動切替。
 * project.json から設定を読み込む。
 *
 * セクション定義例:
 * {
 *   "caption": "工事着手前",
 *   "photos": ["photo/001.jpg", "photo/002.jpg"],  // 写真モード
 *   "video": "clips/clip_01.mp4",                   // 動画モード（photosより優先）
 *   "audio": "narration/nar_01.mp3",                // ナレーション（オプション）
 *   "durSec": 10.0                                  // 尺（audioがあればaudio尺を使用）
 * }
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

// ── 型定義 ──
export interface SectionDef {
  caption: string;
  photos?: string[];    // 写真モード
  video?: string;       // 動画モード（photosより優先）
  audio?: string;       // ナレーション音声（オプション）
  durSec: number;       // セクション尺（秒）
}

export interface ProjectDef {
  title: string;
  subtitle?: string;
  organization?: string;
  theme?: "dark" | "light";
  endingText?: string;
  sections: SectionDef[];
}

// ── デフォルト設定（上書き用） ──
const DEFAULT_PROJECT: ProjectDef = {
  title: "サンプル動画",
  subtitle: "",
  organization: "",
  theme: "dark",
  endingText: "つづく",
  sections: [],
};

const FPS = 30;
const CROSSFADE = 15;
const TITLE_DUR = 90;
const END_DUR = 75;

// ── テーマ ──
const THEMES = {
  dark: { bg: "#0A0A0A", text: "#fff", sub: "#aaa", muted: "#888", captionBg: "transparent" },
  light: { bg: "#F5F3EF", text: "#222", sub: "#888", muted: "#555", captionBg: "#F5F3EF" },
};

// ── タイムライン計算 ──
export function calcTimeline(sections: SectionDef[]) {
  const frames = sections.map((s) => Math.ceil(s.durSec * FPS));
  const starts: number[] = [];
  let cursor = TITLE_DUR;
  for (let i = 0; i < frames.length; i++) {
    starts.push(cursor);
    cursor += frames[i] - (i < frames.length - 1 ? CROSSFADE : 0);
  }
  return { frames, starts, total: cursor + END_DUR };
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

// ── 動画セクション ──
const VideoSection: React.FC<{
  videoSrc: string;
  caption: string;
  totalFrames: number;
  theme: typeof THEMES.dark;
}> = ({ videoSrc, caption, totalFrames, theme }) => {
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
      <div style={{ position: "absolute", bottom: 50, left: 80, right: 80, opacity: captionOpacity }}>
        <div style={{ color: "#fff", fontSize: 56, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", fontWeight: 600, letterSpacing: 3, textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>
          {caption}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── 写真セクション ──
const PhotoSection: React.FC<{
  photos: string[];
  caption: string;
  totalFrames: number;
  theme: typeof THEMES.dark;
}> = ({ photos, caption, totalFrames, theme }) => {
  const frame = useCurrentFrame();
  const perPhoto = Math.ceil(totalFrames / photos.length);

  const sectionOpacity = interpolate(frame, [0, CROSSFADE, totalFrames - CROSSFADE, totalFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });
  const textOpacity = interpolate(frame, [CROSSFADE, CROSSFADE + 15, totalFrames - CROSSFADE - 10, totalFrames - CROSSFADE], [0, 1, 1, 0], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: sectionOpacity }}>
      <AbsoluteFill style={{ backgroundColor: theme.bg }} />

      {photos.map((photo, i) => {
        const start = i * (perPhoto - CROSSFADE);
        const imgOpacity = photos.length === 1 ? 1 : interpolate(
          frame,
          [start, start + CROSSFADE, start + perPhoto - CROSSFADE, start + perPhoto],
          [0, 1, 1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        const scale = interpolate(frame, [start, start + perPhoto], [1.0, 1.05], {
          extrapolateLeft: "clamp", extrapolateRight: "clamp",
        });

        return (
          <div key={photo} style={{ position: "absolute", top: 40, left: 60, right: 60, bottom: 200, overflow: "hidden", borderRadius: 4, opacity: imgOpacity }}>
            <Img src={staticFile(photo)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: "center center" }} />
          </div>
        );
      })}

      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 80px", backgroundColor: theme.captionBg, opacity: textOpacity }}>
        <div style={{ color: theme.text, fontSize: 52, fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif", fontWeight: 600, letterSpacing: 2, textAlign: "center" }}>
          {caption}
        </div>
      </div>
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
  const { frames, starts, total } = calcTimeline(project.sections);

  return (
    <AbsoluteFill style={{ backgroundColor: theme.bg }}>
      {/* タイトル */}
      <Sequence from={0} durationInFrames={TITLE_DUR}>
        <Title title={project.title} subtitle={project.subtitle} organization={project.organization} theme={theme} />
      </Sequence>

      {/* セクション（写真 or 動画を自動切替） */}
      {project.sections.map((sec, i) => (
        <Sequence key={i} from={starts[i]} durationInFrames={frames[i]}>
          {sec.video ? (
            <VideoSection videoSrc={sec.video} caption={sec.caption} totalFrames={frames[i]} theme={theme} />
          ) : (
            <PhotoSection photos={sec.photos ?? []} caption={sec.caption} totalFrames={frames[i]} theme={theme} />
          )}
        </Sequence>
      ))}

      {/* エンディング */}
      <Sequence from={total - END_DUR} durationInFrames={END_DUR}>
        <Ending text={project.endingText ?? "つづく"} theme={theme} />
      </Sequence>

      {/* ナレーション（audioがあるセクションのみ） */}
      {project.sections.map((sec, i) =>
        sec.audio ? (
          <Sequence key={`nar-${i}`} from={starts[i]} durationInFrames={total - starts[i]}>
            <Audio src={staticFile(sec.audio)} volume={1} />
          </Sequence>
        ) : null,
      )}
    </AbsoluteFill>
  );
};

// ── 外部からTOTAL_FRAMESを参照できるように ──
export { TITLE_DUR, END_DUR, FPS, CROSSFADE };
