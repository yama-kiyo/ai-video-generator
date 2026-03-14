import { Composition } from "remotion";
import { TestAI, TEST_AI_TOTAL } from "./TestAI/TestAI";
import { AIVideo, calcTimeline } from "./AIVideo/AIVideo";
import type { ProjectDef } from "./AIVideo/AIVideo";

// ── サンプルプロジェクト定義 ──
const sampleProject: ProjectDef = {
  title: "アパート建設の流れ",
  subtitle: "着工〜組立編",
  organization: "CEL CORPORATION",
  theme: "dark",
  endingText: "つづく",
  sections: [
    { caption: "工事着手前", video: "test-ai/clip_01.mp4", audio: "test-ai/nar_01.mp3", durSec: 10.0 },
    { caption: "整地作業", video: "test-ai/clip_02.mp4", audio: "test-ai/nar_02.mp3", durSec: 10.4 },
    { caption: "本体基礎工事の準備", video: "test-ai/clip_03.mp4", audio: "test-ai/nar_03.mp3", durSec: 7.3 },
  ],
};
const sampleTimeline = calcTimeline(sampleProject.sections);

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* 統合AI動画コンポジション（写真/動画/ナレーション自動切替） */}
      <Composition
        id="AIVideo"
        component={AIVideo}
        durationInFrames={sampleTimeline.total}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ project: sampleProject }}
      />
      {/* AI動画テスト（旧: Veo 3.1 + ElevenLabs v3） */}
      <Composition
        id="TestAI"
        component={TestAI}
        durationInFrames={TEST_AI_TOTAL}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
