import { Composition } from "remotion";
import { TestAI, TEST_AI_TOTAL } from "./TestAI/TestAI";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* AI動画テスト（Veo 3.1 + ElevenLabs v3） */}
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
