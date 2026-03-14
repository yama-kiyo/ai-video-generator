import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const BG = "#0A0A0A";
const CROSSFADE = 15;

// セクション定義（ナレーション尺に合わせる）
const sections = [
  {
    video: "test-ai/clip_01.mp4",
    audio: "test-ai/nar_01.mp3",
    durSec: 10.0, // ナレーション尺
    caption: "工事着手前",
  },
  {
    video: "test-ai/clip_02.mp4",
    audio: "test-ai/nar_02.mp3",
    durSec: 10.4,
    caption: "整地作業",
  },
  {
    video: "test-ai/clip_03.mp4",
    audio: "test-ai/nar_03.mp3",
    durSec: 7.3,
    caption: "本体基礎工事の準備",
  },
];

const TITLE_DUR = 90;
const END_DUR = 75;

// 各セクションの開始フレームと尺
const sectionFrames = sections.map((s) => Math.ceil(s.durSec * FPS));
const sectionStarts: number[] = [];
let cursor = TITLE_DUR;
for (let i = 0; i < sectionFrames.length; i++) {
  sectionStarts.push(cursor);
  cursor += sectionFrames[i] - (i < sectionFrames.length - 1 ? CROSSFADE : 0);
}
export const TEST_AI_TOTAL = cursor + END_DUR;

// ── タイトル ──
const Title: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 25, TITLE_DUR - 20, TITLE_DUR], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            color: "#aaa",
            fontSize: 30,
            fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
            letterSpacing: 10,
            marginBottom: 24,
            fontWeight: 300,
          }}
        >
          CEL CORPORATION
        </div>
        <div
          style={{
            color: "#fff",
            fontSize: 84,
            fontWeight: 700,
            fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
            letterSpacing: 4,
          }}
        >
          アパート建設の流れ
        </div>
        <div
          style={{
            color: "#888",
            fontSize: 40,
            fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
            marginTop: 16,
            fontWeight: 400,
          }}
        >
          着工〜組立編
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── ビデオセクション ──
const VideoSection: React.FC<{
  videoSrc: string;
  caption: string;
  totalFrames: number;
}> = ({ videoSrc, caption, totalFrames }) => {
  const frame = useCurrentFrame();

  const sectionOpacity = interpolate(
    frame,
    [0, CROSSFADE, totalFrames - CROSSFADE, totalFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const captionOpacity = interpolate(
    frame,
    [CROSSFADE + 5, CROSSFADE + 20, totalFrames - CROSSFADE - 10, totalFrames - CROSSFADE],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ opacity: sectionOpacity }}>
      {/* AI生成動画（全画面） */}
      <OffthreadVideo
        src={staticFile(videoSrc)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
        muted
      />

      {/* 下部グラデーション */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 250,
          background:
            "linear-gradient(transparent, rgba(0,0,0,0.7))",
        }}
      />

      {/* キャプション */}
      <div
        style={{
          position: "absolute",
          bottom: 50,
          left: 80,
          right: 80,
          opacity: captionOpacity,
        }}
      >
        <div
          style={{
            color: "#fff",
            fontSize: 56,
            fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
            fontWeight: 600,
            letterSpacing: 3,
            textShadow: "0 2px 8px rgba(0,0,0,0.6)",
          }}
        >
          {caption}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ── エンディング ──
const Ending: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 20, END_DUR - 15, END_DUR], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
      }}
    >
      <div
        style={{
          color: "#888",
          fontSize: 42,
          fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif",
          fontWeight: 400,
          letterSpacing: 4,
        }}
      >
        つづく
      </div>
    </AbsoluteFill>
  );
};

// ── メインコンポジション ──
export const TestAI: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: BG }}>
      <Sequence from={0} durationInFrames={TITLE_DUR}>
        <Title />
      </Sequence>

      {sections.map((sec, i) => (
        <Sequence key={i} from={sectionStarts[i]} durationInFrames={sectionFrames[i]}>
          <VideoSection
            videoSrc={sec.video}
            caption={sec.caption}
            totalFrames={sectionFrames[i]}
          />
        </Sequence>
      ))}

      <Sequence from={cursor - END_DUR} durationInFrames={END_DUR}>
        <Ending />
      </Sequence>

      {/* ナレーション（頭尻に1秒パディングで重なり防止） */}
      {sections.map((sec, i) => (
        <Sequence
          key={`nar-${i}`}
          from={sectionStarts[i] + 30}
          durationInFrames={sectionFrames[i] - 30}
        >
          <Audio src={staticFile(sec.audio)} volume={1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
