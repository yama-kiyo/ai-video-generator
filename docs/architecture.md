# Architecture 분석 — script.md → final.mp4 자동화 시스템

> 작성일: 2026-08-26
> 대상 커밋: `fd12b1f` (main, clean)
> 목적: 기존 `ai-video-generator` 리포지터리를 **script.md 기반 완전 자동 영상 생성 파이프라인**으로 재구성하기 위한 사전 분석
> **상태: 분석 전용 문서. 이 문서 작성 시점에 기존 코드는 일절 수정하지 않았다.**

---

## 0. 결론 요약

**기존 리포는 "합성 계층(Remotion)"은 거의 그대로 재사용 가능하고, "생성 계층(scripts/)"은 사실상 새로 써야 한다.**

| 계층 | 판정 | 근거 |
|------|------|------|
| Remotion 합성 (`src/AIVideo/AIVideo.tsx`) | **재사용 (컴포넌트 분리만)** | 타이틀/자막/Ken Burns/크로스페이드/오디오 우선 타임라인이 이미 완성도 있음 |
| 타임라인 계산 (`calcTimeline`) | **재사용 + 위치 이동** | 로직은 정확하나 3개 파일에 복제되어 있음 |
| 생성 스크립트 (`generate-ai-video.mjs`) | **재작성** | T2V 전용 · 모델 ID 불일치 · 길이 추정 부정확 · 산출물이 콘솔 텍스트 |
| 설정 (`src/lib/api-config.ts`) | **폐기 후 이동** | 아무도 import 하지 않는 死코드 + 브라우저 번들에 키 노출 위험 |
| `src/TestAI/` | **삭제** | `AIVideo`의 구버전 중복 |
| 장면 분석 / 캐릭터 일관성 / i2v / 자막 정렬 / 오케스트레이션 | **신규 개발** | 현재 코드베이스에 전혀 없음 |

목표 파이프라인 8단계 중 **기존 코드가 커버하는 것은 3개(나레이션, 자막 렌더, Remotion 합성)뿐**이고, 그마저도 수동 개입(JSON 손수 작성, 콘솔 출력 복붙)을 전제로 한다. 핵심 신규 작업은 **"중간 산출물 기반 오케스트레이터"** 다.

---

## 1. 현재 프로젝트 전체 구조

### 1.1 파일 트리 (실제 존재하는 전부)

```
youtube-video-automation/
├── .env.example                  # GEMINI / RUNWAY / ELEVENLABS 키 3종
├── .gitignore                    # node_modules, .env, out/, public/**/*.mp4|mp3
├── README.md                     # 353줄, 문서화 수준 높음 (단, 일부 허구)
├── package.json                  # remotion 4.x, @google/genai, @runwayml/sdk, zod, dotenv
├── remotion.config.ts            # jpeg 이미지 포맷, overwrite 허용 (9줄)
├── tsconfig.json                 # strict, lib: es2015 (!), noUnusedLocals
├── project.example.json          # 프로젝트 정의 샘플 (섹션 3개)
├── sections.example.json         # AI 생성용 나레이션+프롬프트 샘플
├── public/
│   └── test-ai/.gitkeep          # 생성 에셋 저장소 (현재 비어 있음)
├── scripts/
│   ├── generate-ai-video.mjs     # 358줄 — Veo/Runway T2V + ElevenLabs TTS
│   ├── export-fcpxml.mjs         # 191줄 — Premiere/Resolve 타임라인 내보내기
│   ├── export-srt.mjs            # 126줄 — SRT 자막 내보내기
│   └── test-apis.mjs             #  64줄 — API 3종 연결 확인
└── src/
    ├── index.ts                  # registerRoot
    ├── Root.tsx                  # 45줄 — Composition 2개 등록 + 샘플 프로젝트 하드코딩
    ├── lib/api-config.ts         # 50줄 — 死코드 (import 0건)
    ├── AIVideo/AIVideo.tsx       # 409줄 — 통합 컴포지션 (핵심 자산)
    └── TestAI/TestAI.tsx         # 246줄 — AIVideo의 구버전 (중복)
```

**총 코드량: 약 1,500줄.** 소규모이며 의존성 그래프가 단순하다 (`src/`와 `scripts/`가 서로 import 하지 않고, 상수만 주석으로 "동기화" 되어 있음).

### 1.2 모듈 의존 관계 (현재)

```
src/index.ts
  └── src/Root.tsx
        ├── src/AIVideo/AIVideo.tsx   ← Composition "AIVideo"
        └── src/TestAI/TestAI.tsx     ← Composition "TestAI" (구버전)

src/lib/api-config.ts   ← ★ 아무도 import 하지 않음 (고아 모듈)

scripts/generate-ai-video.mjs   ← 독립 실행 (@google/genai, @runwayml/sdk, fetch)
scripts/export-srt.mjs          ← 독립 실행, AIVideo 상수를 "복사"해서 보유
scripts/export-fcpxml.mjs       ← 독립 실행, AIVideo 상수를 "복사"해서 보유
scripts/test-apis.mjs           ← 독립 실행
```

> **핵심 구조적 결함**: `FPS / CROSSFADE / NAR_PAD / TITLE_DUR / END_DUR` 5개 상수와 `calcTimeline` · `buildSubtitles` 로직이 **3개 파일에 물리적으로 복제**되어 있다. `export-srt.mjs:42`, `export-fcpxml.mjs:40` 에 `// 定数（AIVideo.tsxと同期）`라는 주석이 달려 있는데, 이는 "사람이 손으로 동기화한다"는 뜻이다. 신규 시스템에서 **가장 먼저 제거해야 할 부채**.

### 1.3 데이터 모델 (`AIVideo.tsx:25-56`)

```ts
interface MediaItem      { type: "photo" | "video"; src: string }
interface SubtitleEntry  { text: string; atSec: number }

interface SectionDef {
  caption: string
  photos?: string[]                 // 사진 슬라이드쇼
  video?: string                    // 단일 동영상 (최우선)
  media?: MediaItem[]               // 사진+동영상 혼합
  audio?: string                    // 나레이션 음성
  narration?: string                // 나레이션 원고 (자막 자동 생성용)
  manualSubtitles?: SubtitleEntry[] // Whisper 실측 타이밍 (최우선)
  durSec: number                    // 섹션 尺 = 나레이션 실측 길이
}

interface ProjectDef {
  title: string; subtitle?; organization?
  theme?: "dark" | "light"
  endingText?: string
  textMode?: "caption" | "subtitle"
  mediaMode?: "photo" | "i2v"
  sections: SectionDef[]
}
```

**이 스키마는 우리 목표와 방향이 거의 일치한다.** `manualSubtitles`(Whisper 실측), `durSec`(오디오 우선), `media[]`(사진+i2v 혼합)는 그대로 신규 `render-plan.json`의 뼈대로 쓸 수 있다. 단, **런타임 검증이 전혀 없다** (zod가 dependency에 있는데도 사용처 0건).

### 1.4 렌더링 상수 및 타임라인 규칙

| 상수 | 값 | 의미 |
|------|-----|------|
| `FPS` | 30 | 고정 |
| 해상도 | 1920×1080 | `Root.tsx`에 하드코딩 |
| `TITLE_DUR` | 90f (3.0s) | 오프닝 타이틀 |
| `END_DUR` | 75f (2.5s) | 엔딩 |
| `CROSSFADE` | 15f (0.5s) | 섹션 간 겹침 |
| `NAR_PAD` | 30f (1.0s) | 나레이션 앞뒤 무음 패딩 |

**설계 원칙 (커밋 `0aeec21`에서 확립): "음성 우선 (音声ファースト)".**
`섹션 길이 = 나레이션 실측 길이 + 앞 1초 + 뒤 1초`, 나레이션은 **절대 잘리지 않는다**. 영상이 음성에 맞춘다.
→ **이 원칙은 신규 시스템에서도 그대로 유지해야 한다.** 목표 파이프라인이 "ElevenLabs → 이미지 → Veo" 순서인 이유가 바로 이것이다.

---

## 2. 현재 영상 생성 workflow

### 2.1 실제 동작하는 경로

```
[1] 사람이 sections.json 작성
    { narration, videoPrompt, caption }[]
              │
              ▼
[2] node scripts/generate-ai-video.mjs --config sections.json
    ├── Veo (또는 Runway) T2V  → public/test-ai/clip_01..NN.mp4
    └── ElevenLabs TTS          → public/test-ai/nar_01..NN.mp3
              │                    └─ 길이를 bytes/16000 으로 "추정"
              ▼
[3] 스크립트가 콘솔에 TS 코드 조각을 출력  ← ★ 사람이 복사
    "const sections = [ { video: ..., audio: ..., durSec: 10.0 } ]"
              │
              ▼
[4] 사람이 src/Root.tsx 또는 project.json 을 손으로 수정
              │
              ▼
[5] npx remotion studio      (프리뷰)
    npx remotion render AIVideo out/video.mp4
              │
              ▼
[6] (선택) node scripts/export-srt.mjs      → out/*.srt
    (선택) node scripts/export-fcpxml.mjs   → out/*.fcpxml  (Premiere/Resolve)
```

### 2.2 각 단계 실행 주체

| 단계 | 자동/수동 | 비고 |
|------|-----------|------|
| 원고 → 섹션 분해 | **100% 수동** | 장면 분석 개념 자체가 없음 |
| 영상 프롬프트 작성 | **100% 수동** | `videoPrompt`를 사람이 영어로 씀 |
| 영상 생성 | 자동 | **T2V만.** i2v 경로 없음 |
| 이미지 생성 | **없음** | README에만 존재, 코드 부재 |
| 나레이션 생성 | 자동 | 길이 측정은 부정확한 추정 |
| 나레이션 길이 반영 | **수동 (복붙)** | 콘솔 출력 → 손으로 이식 |
| 자막 타이밍 | 반자동 | 문자수 비례 자동 or Whisper 수동 실행 후 손입력 |
| Remotion 합성 | 자동 | CLI |
| 캐릭터 일관성 | **없음** | 개념 부재 |

### 2.3 README와 실제 코드의 괴리 (중요)

README에 사용법이 문서화되어 있으나 **git 히스토리 전체를 확인한 결과 한 번도 존재한 적 없는 파일들**:

| README 기재 (`README.md:91-98`) | 실제 |
|------|------|
| `scripts/generate-images.mjs` | **존재하지 않음** |
| `scripts/generate-narration.mjs` | **존재하지 않음** |
| `scripts/generate-i2v.mjs` | **존재하지 않음** |
| Claude Code 스킬 `ai-video` (`README.md:233-243`) | 리포 내 `.claude/` 디렉터리 자체가 없음 |

또한 `project.json`(export 스크립트들의 기본 입력 파일)도 리포에 없다 — `project.example.json`만 있다. 즉 **`node scripts/export-srt.mjs`를 지금 그대로 실행하면 "project.json이 없습니다"로 즉시 종료된다.**

> 신규 설계 시 README를 사양서로 신뢰하면 안 된다. 코드가 유일한 사실이다.

---

## 3. 그대로 재사용할 수 있는 코드

### 3.1 최우선 재사용 자산 — 프레젠테이션 계층

| 대상 | 위치 | 재사용 방식 |
|------|------|-------------|
| `SubtitleOverlay` | `AIVideo.tsx:147-202` | **그대로.** `atSec` 기반 자막 표시, 6프레임 페이드인, 그림자/반투명 배경 처리 완성 |
| `Title` | `AIVideo.tsx:115-144` | **그대로.** organization/title/subtitle 3단 + 페이드 |
| `Ending` | `AIVideo.tsx:322-334` | **그대로.** |
| `VideoSection` | `AIVideo.tsx:287-319` | **그대로.** `OffthreadVideo` + 하단 그라데이션 + 자막/캡션 분기. 우리의 Veo i2v 결과물이 정확히 이 경로를 탄다 |
| `MediaSection` | `AIVideo.tsx:205-284` | **로직 1건 수정 후 재사용** (§4.3 참조). Ken Burns(scale 1.0→1.05) + 크로스페이드 |
| `THEMES` | `AIVideo.tsx:77-80` | **그대로.** dark/light 팔레트 |

**이 6개 컴포넌트가 이 리포의 실질적 가치다.** 약 250줄이며, Remotion의 까다로운 부분(`Sequence` 중첩, `interpolate` clamp, `OffthreadVideo` 사용법, `staticFile` 경로)이 이미 검증되어 있다.

### 3.2 로직 재사용 (위치만 이동)

| 함수 | 위치 | 비고 |
|------|------|------|
| `calcTimeline()` | `AIVideo.tsx:100-112` | 음성 우선 타임라인 계산. **`src/timeline/`로 추출하여 단일 진실 공급원(SSOT)화** |
| `buildSubtitles()` | `AIVideo.tsx:84-97` | 일본어 문말(`。？！\n`) lookbehind 분할 + 문자수 비례 타이밍. **Whisper 실패 시 폴백**으로 유지 |
| SRT 타임코드 변환 `toSrtTime()` | `export-srt.mjs:77-83` | 그대로 |
| SRT 조립 루프 | `export-srt.mjs:91-117` | `manualSubtitles > narration` 우선순위 포함, 그대로 |
| FCPXML 리소스 수집/스파인 생성 | `export-fcpxml.mjs:88-180` | 그대로 (단 §4.4 ffprobe 이슈) |
| ElevenLabs TTS 호출부 | `generate-ai-video.mjs:250-282` | HTTP 호출 형태(`xi-api-key` 헤더, `eleven_v3`, `mp3_44100_128`)는 **검증된 정답**. 길이 추정 부분만 교체 |
| Veo 폴링 루프 골격 | `generate-ai-video.mjs:135-163` | 타임아웃/진행률 로깅 패턴 재사용 (API 호출부는 교체) |

### 3.3 설정 파일 재사용

- `remotion.config.ts` — 그대로 (`publicDir` 지정만 추가 예정)
- `.gitignore` — 그대로 + `projects/*/assets/`, `projects/*/out/` 추가
- `.env.example` — 키 목록 확장하여 유지
- `package.json`의 Remotion 4.x / React 19 조합 — 그대로

### 3.4 지식 자산 (코드는 아니지만 재사용)

- ElevenLabs **일본어는 `eleven_v3` 필수** (v2 미지원) — `README.md:340`
- Runway `uploads.createEphemeral()`은 `url`이 아니라 **`uri`** 반환 — `README.md:343`
- Runway는 `tasks.waitForTaskOutput()` 대신 `tasks.retrieve()` 폴링 필요 — `README.md:344`
- 보이스 ID 6종 실측값 — `api-config.ts:13-20`
- 음성 우선 설계 원칙 — `README.md:189, 272`

---

## 4. 수정해야 할 코드

심각도: 🔴 치명 / 🟠 중요 / 🟡 개선

### 4.1 🔴 `Root.tsx:19` — Composition 길이 계산 불일치 (영상 잘림)

```ts
const sampleTimeline = calcTimeline(sampleProject.sections, 0);   // narPad = 0
```
그러나 `AIVideo` 내부는 `AIVideo.tsx:341-342`에서 `pad = NAR_PAD(=30)`로 계산한다.
→ **`durationInFrames`가 섹션당 60프레임씩 부족**하다. 샘플 3섹션 기준 180프레임(6초)이 잘린다.
→ 근본 해결: `Root.tsx`에서 직접 계산하지 말고 Remotion의 `calculateMetadata`로 props에서 길이를 도출.

### 4.2 🔴 `src/lib/api-config.ts` — API 키가 브라우저 번들에 들어갈 위험

`process.env.ELEVENLABS_API_KEY` 등을 `src/`(= Remotion 번들 대상)에서 읽는다. Remotion은 `REMOTION_` 접두사 환경변수만 클라이언트로 주입하므로 **현재는 항상 빈 문자열**이지만, 누군가 접두사를 붙이는 순간 **시크릿이 렌더 번들에 박힌다**. 게다가 이 파일은 **import 하는 곳이 0건인 死코드**이며, 보이스 맵이 `generate-ai-video.mjs:65-72`에 중복 정의되어 있다.
→ `pipeline/core/config.mjs`로 이동하고 `src/`에서는 API 키를 절대 참조하지 않는다.

### 4.3 🟠 `AIVideo.tsx:227-267` — 다중 미디어 섹션 말미에 검은 화면

```ts
const perItem = Math.ceil(totalFrames / media.length);
const start   = i * (perItem - CROSSFADE);
```
n개 아이템의 총 커버 범위는 `n*perItem - CROSSFADE*(n-1)` 이므로, n≥2일 때 섹션 끝에서 `15*(n-1)` 프레임이 비어 배경색만 노출된다 (예: 300f 섹션에 3장 → 마지막 30프레임 공백).
→ 크로스페이드 겹침을 고려한 `perItem = (totalFrames + CROSSFADE*(n-1)) / n` 로 보정 필요.

### 4.4 🟠 `export-fcpxml.mjs:65-74` — ffprobe 부재 시 조용한 오염

```js
} catch { return 150; }   // 모든 에셋 길이를 5초로 위조
```
**이 개발 머신에는 `ffprobe`/`ffmpeg`이 PATH에 없다** (확인 완료). 즉 현재 상태로 실행하면 모든 리소스 길이가 150프레임으로 기록된 FCPXML이 **에러 없이** 생성된다.
→ Remotion 동봉 바이너리(`npx remotion ffprobe`) 사용 또는 명시적 실패로 전환.

### 4.5 🟠 `generate-ai-video.mjs` — 4가지 수정

| 위치 | 문제 | 조치 |
|------|------|------|
| `:131` | 모델 ID가 `veo-3.0-generate-preview` 인데 `api-config.ts:32`는 `veo-3.1` — **불일치** | 단일 설정에서 주입 |
| `:146-149` | `ai.operations.get({operationName, config:{httpOptions:{apiVersion:""}}})` — apiVersion 빈 문자열 우회 | 공식 `ai.operations.getVideosOperation({operation})` 사용 |
| `:280` | `estimatedDur = buffer.length / 16000` — CBR 128kbps 가정. 헤더/VBR/무음 트림으로 오차 발생, **그 오차가 그대로 자막 타이밍 오차** | 실측(ffprobe 또는 `music-metadata`)으로 교체 |
| `:316-318` | `catch` 후 `console.error`만 하고 **계속 진행** → 클립 없는 상태로 "완료" 표시 | 실패를 manifest에 기록하고 최종 종료 코드에 반영 |

### 4.6 🟠 `AIVideo.tsx:153` — 오디오 없는 섹션의 자막 1초 밀림

`SubtitleOverlay`는 항상 `currentSec = (frame - narPad)/FPS`로 계산하지만, `calcTimeline`은 `audio`가 없는 섹션에 패딩을 주지 않는다(`AIVideo.tsx:102-104`). → 오디오 없이 자막만 있는 섹션은 자막이 1초 늦게, 그리고 마지막 자막이 1초 잘린다.

### 4.7 🟡 기타

| 대상 | 문제 |
|------|------|
| `tsconfig.json:8` | `"lib": ["es2015"]` 인데 코드는 lookbehind 정규식(ES2018)·`Array.flat` 등을 씀. `es2020` 이상으로 |
| `package.json:12` | `render` 스크립트가 폐기 예정인 `TestAI`를 가리킴 |
| `package.json` | `lint` 스크립트 없음 (eslint는 devDependency에 존재), 테스트 프레임워크 없음 |
| `zod@3.22.3` | 의존성만 있고 **사용처 0건** — 검증 계층 부재 |
| `README.md:91-98` | 존재하지 않는 스크립트 3종 문서화 |
| 상수 3중 복제 | `AIVideo.tsx` / `export-srt.mjs` / `export-fcpxml.mjs` |

---

## 5. 사용하지 않아도 되는 코드

| 대상 | 판정 | 사유 |
|------|------|------|
| `src/TestAI/TestAI.tsx` (246줄) | **삭제** | `AIVideo`의 구버전. 하드코딩된 섹션·"CEL CORPORATION"·"アパート建設の流れ" 등 특정 고객 문자열 포함. 기능은 100% `AIVideo`에 흡수됨 |
| `Root.tsx:34-42` (TestAI 등록) | **삭제** | 위와 동반 |
| `package.json` `render` 스크립트 | **교체** | TestAI 참조 |
| `src/lib/api-config.ts` | **이동 후 삭제** | §4.2. 死코드이자 보안 리스크 |
| `sections.example.json` | **폐기** | `script.md → scene-plan.json` 이 대체 |
| `project.example.json` | **대체** | `render-plan.example.json` 으로 재정의 |
| `@runwayml/sdk` + Runway 경로 전체 (`generate-ai-video.mjs:168-245`, 약 80줄) | **조건부 폐기** | 목표 스택은 Veo i2v. Runway T2V/V2V/i2v는 불필요. **단, Veo가 특정 프롬프트를 거부할 때의 백업 프로바이더로 남길 가치는 있음** → §6 프로바이더 추상화로 흡수하고, 미사용 시 dependency 제거 |
| `scripts/test-apis.mjs` | **재작성** | 개념은 유지(preflight). 현재 구현은 ElevenLabs 테스트가 **실제 과금되는 TTS 요청**을 날린다(`:42-53`) → `/v1/user` 같은 무과금 엔드포인트로 |
| `public/test-ai/` | **폐기** | 프로젝트별 디렉터리 구조로 대체 |
| `export-fcpxml.mjs` | **보류(유지)** | 목표 파이프라인엔 불필요하나, "NLE로 넘겨 수동 보정" 이라는 탈출구로서 가치 있음. 우선순위만 낮춤 |

---

## 6. 새로 만들어야 할 기능

목표 파이프라인의 8단계 중 **5단계가 신규**다.

### 6.1 장면 분석 (`script.md` → `scene-plan.json`) — ★ 최대 신규 작업

현재 완전 부재. 필요한 것:

- **`script.md` 입력 규약 정의**: 자유 산문인가, 헤딩 기반 구조인가, front-matter로 메타(제목/캐릭터/테마)를 받는가
- **LLM 장면 분해**: Gemini `gemini-2.5-flash`(또는 Claude)에 **structured output**으로 씬 배열 생성
  - 씬별: `narration`(원문 그대로 발췌 — 창작 금지), `caption`, `imagePrompt`, `motionPrompt`, `characters[]`, `shotType`, `mood`
  - **원칙: 나레이션 텍스트는 LLM이 재작성하지 않고 script.md에서 그대로 잘라낸다.** 재작성하면 원고 통제권을 잃는다
- **결정성 확보**: `temperature: 0` + 프롬프트 해시 캐싱. 같은 script.md는 같은 scene-plan을 낳아야 함
- **사람 개입 지점**: `scene-plan.json`은 **사람이 열어 고치는 것을 전제로 한 산출물**이어야 한다 (자동화의 탈출구)

### 6.2 scene-plan / render-plan 스키마 + 검증

- zod 스키마 2종 (`scene-plan`, `render-plan`) — 이미 dependency에 zod가 있으므로 즉시 도입 가능
- **역할 분리**:
  - `scene-plan.json` = 의도 (나레이션 텍스트, 프롬프트, 캐릭터 캐스팅) — LLM/사람이 만듦
  - `render-plan.json` = 사실 (파일 경로, 실측 durSec, 자막 타이밍) — 파이프라인이 만듦
- `render-plan.json`은 기존 `ProjectDef`와 호환되게 설계 → **Remotion 쪽 변경을 최소화**

### 6.3 캐릭터 레퍼런스 시스템 — ★ 신규, 난이도 최상

현재 개념 자체가 없음. 필요한 것:

- `characters.json`: `{ id, name, description, refImages[], negativePrompt, seed }`
- **레퍼런스 이미지 관리**: 캐릭터당 1~3장의 정면/측면/전신 시트
- **일관성 전략 (택1 또는 병용, 구현 시점에 실측 검증 필요)**:
  1. `ai.models.editImage()` + `SubjectReferenceImage` (Imagen capability 모델) — SDK에 타입 존재 확인됨. 단 **Vertex AI 전용일 가능성**이 있어 사용 중인 API 티어에서 검증 필요
  2. Gemini 이미지 모델(`generateContent`에 레퍼런스 이미지 여러 장 동봉) — 이른바 "캐릭터 시트 인컨텍스트" 방식
  3. `seed` 고정 + 프롬프트 내 상세 외형 서술 (가장 약하지만 가장 확실히 동작)
- **씬↔캐릭터 캐스팅 테이블**: 어떤 씬에 어떤 캐릭터가 등장하는지 → 해당 레퍼런스만 주입
- **일관성 검증 루프**: 생성 이미지 N장 중 선택, 실패 시 재생성 (사람 승인 게이트 권장)

### 6.4 Veo image-to-video

현재 T2V만 있음. SDK 조사 결과 필요한 형태는 다음과 같다 (context7 확인):

```js
const op = await ai.models.generateVideos({
  model: <veo-model-id>,
  source: { image: <생성된 이미지>, prompt: <motionPrompt> },   // ← i2v
  config: {
    aspectRatio: "16:9",
    resolution: "1080p",
    durationSeconds: <n>,
    generateAudio: false,        // ★ 나레이션과 충돌 방지
    negativePrompt: ...,
    seed: ...,
    // referenceImages: [...]    // 에셋/스타일 레퍼런스 (image와 배타)
    // lastFrame: <Image>        // 씬 연결용
  },
});
// 폴링: ai.operations.getVideosOperation({ operation })
```

주의점:
- `config.referenceImages`는 `source.image` / `lastFrame` 과 **배타적**이다 → 캐릭터 일관성을 이미지 단계에서 확정하고, 영상 단계는 순수 i2v로 가는 전략이 안전
- `generateAudio: false` 필수 — Veo 3.x는 오디오를 생성하므로 ElevenLabs 나레이션과 겹친다 (현재 코드는 `muted` prop으로 덮고 있어 낭비)
- **클립 길이 상한(수 초)이 나레이션 길이보다 짧다** → 신규 필수 기능: **클립 루프/역재생/속도조절/멀티클립 이어붙이기** 로 `durSec` 채우기. 현재 `VideoSection`은 이 처리를 하지 않아 클립이 끝나면 마지막 프레임에서 멈춘다

### 6.5 오디오 실측 + 자막 자동 정렬

- **오디오 길이 실측**: `music-metadata`(순수 JS, 외부 바이너리 불필요) 또는 Remotion 동봉 ffprobe. §4.5의 추정 로직 대체
- **Whisper 자동 정렬**: 현재는 README에 파이썬 원라이너가 있고 결과를 **사람이 손으로 JSON에 옮긴다**. 이것을 `faster-whisper` 서브프로세스 호출 → `manualSubtitles` 자동 주입으로 자동화
- **폴백**: Whisper 미설치 시 `buildSubtitles()`(문자수 비례)로 자동 강등 + 경고

### 6.6 오케스트레이터 (파이프라인 러너) — ★ 시스템의 심장

현재 "콘솔 출력 → 복붙"이 자동화의 단절점이다. 필요한 것:

- **단계별 실행 + 재개(resume)**: 각 단계가 산출물을 파일로 남기고, 이미 있으면 건너뜀
- **manifest / 캐시**: 입력 해시(프롬프트+모델+seed) → 산출 파일 매핑. 프롬프트가 안 바뀌면 **재생성하지 않는다** (Veo는 클립당 수십 초~수 분 + 과금)
- **비용 추정 & 상한**: 실행 전 "이미지 N장 + 영상 N클립 × 단가 = 예상 $X" 표시, `--dry-run`, `--max-cost` 가드
- **부분 실행**: `--only images`, `--from video`, `--scenes 3,5`
- **동시성 제어 + 재시도**: 지수 백오프, rate limit 대응
- **구조적 로깅**: 단계/씬/모델/소요시간/비용

### 6.7 렌더 자동화

- `@remotion/renderer`(`renderMedia`)로 Node에서 직접 렌더 → `Root.tsx` 수동 편집 제거
- 또는 `remotion render AIVideo out/final.mp4 --props=render-plan.json`
- `calculateMetadata`로 props에서 `durationInFrames` 자동 산출 (§4.1 해결)

### 6.8 사전 검증 (preflight) & 사후 검증

- 실행 전: API 키 존재, 참조 파일 존재, 캐릭터 ID 유효성, 씬 수/길이 상식성
- 실행 후: `render-plan`의 모든 `src` 파일 실재 확인, `durSec` vs 실제 오디오 길이 일치, 총 길이 검산
- **테스트 부재 해소**: `calcTimeline` / `buildSubtitles` / SRT 타임코드는 순수 함수라 단위 테스트 대상으로 최적

---

## 7. API 및 외부 서비스 의존성

### 7.1 외부 API

| 서비스 | 용도 | SDK / 호출 | 현재 상태 | 목표 상태 |
|--------|------|-----------|-----------|-----------|
| **Google Gemini (텍스트)** | 장면 분석 `script.md → scene-plan` | `@google/genai` `generateContent` | `test-apis.mjs`에서 연결 확인용으로만 사용 | **핵심 신규** (structured output) |
| **Google Imagen / Gemini Image** | 캐릭터 레퍼런스 기반 이미지 생성 | `generateImages()` / `editImage()` / `generateContent()` | **미사용** (`api-config.ts`에 `imagen-4-fast` 라는 **검증 안 된 모델 ID**만 적혀 있음) | **핵심 신규** |
| **Google Veo** | image-to-video | `generateVideos()` + `operations.getVideosOperation()` | T2V만, 모델 ID 불일치 | **i2v로 전환** |
| **ElevenLabs** | 일본어 나레이션 TTS | REST `POST /v1/text-to-speech/{voice_id}` | 동작 확인됨 (`eleven_v3`) | **거의 그대로** + 길이 실측 |
| **Runway** | T2V / V2V / I2V | `@runwayml/sdk` | 구현됨 | **선택적 백업 또는 제거** |

> ⚠️ **모델 ID는 전부 재검증 대상**이다. `veo-3.1` / `veo-3.0-generate-preview` / `imagen-4-fast` 세 개가 코드베이스 안에서 서로 다르게 적혀 있고, 그중 실제로 호출되는 것은 `veo-3.0-generate-preview` 하나뿐이다. 구현 시점에 사용 중인 API 티어에서 사용 가능 모델을 조회해 **단일 설정 파일에 확정**해야 한다.

### 7.2 로컬 도구 의존성

| 도구 | 용도 | 현재 머신 상태 | 대응 |
|------|------|---------------|------|
| Node.js | 런타임 | **v22.16.0** ✅ (요구 v18+) | OK |
| npm | 패키지 | 10.9.2 ✅ | OK |
| `node_modules` | — | **미설치** ❌ | `npm install` 필요 |
| **ffprobe / ffmpeg** | 미디어 길이 측정 | **PATH에 없음** ❌ | Remotion 동봉 바이너리 사용 또는 `music-metadata`(순수 JS) 채택 |
| Python | Whisper 실행 | **3.14.5** ✅ | `faster-whisper` 별도 설치 필요 |
| `faster-whisper` | 자막 정렬 | 미확인 | 선택 의존성 + 폴백 필수 |
| Chrome/Chromium | Remotion 렌더 | 미확인 | Remotion이 자동 다운로드 |

### 7.3 npm 의존성 재평가

| 패키지 | 현재 | 판정 |
|--------|------|------|
| `remotion`, `@remotion/cli` ^4.0.0 | 사용 중 | **유지** |
| `@remotion/renderer` | **없음** | **추가 필요** (프로그래밍 방식 렌더) |
| `@google/genai` ^1.45.0 | 사용 중 | **유지 (핵심)** |
| `@runwayml/sdk` ^3.15.0 | 사용 중 | **제거 후보** |
| `zod` 3.22.3 (pinned) | **미사용** | **적극 활용** (스키마 검증) — 버전 상향 검토 |
| `dotenv` ^17.3.1 | 사용 중 | 유지 (Node 22면 `--env-file`도 가능) |
| `react`/`react-dom` 19.2.3 | 사용 중 | 유지 |
| `music-metadata` 또는 유사 | 없음 | **추가 후보** (오디오 길이 실측) |
| 테스트 러너 (`vitest` 등) | 없음 | **추가 필요** |

### 7.4 비용/시간 특성 (설계에 반영해야 할 제약)

- Veo 1클립: **1~3분 소요**, 클립당 과금 (README 기준 8초 ~$0.20)
- Runway: 1~5분, $0.12~0.15/초
- **10씬짜리 영상 1편 = Veo 호출 10회 = 최소 10~30분 + 실질 비용**
- → **캐시/재개는 편의 기능이 아니라 필수 기능이다.** 8단계 중 마지막에 실패해서 전부 재생성하면 시간과 돈이 함께 날아간다

---

## 8. 목표에 가장 적합한 최종 directory 구조

### 8.1 설계 원칙

1. **작품(project) 단위 격리** — 여러 영상을 동시에 다룰 수 있어야 하며, 산출물이 소스 트리를 오염시키지 않는다
2. **파이프라인 단계 = 파일** — 각 단계는 파일을 읽고 파일을 쓴다. 중간에 사람이 끼어들어 고칠 수 있다
3. **`src/`(브라우저 번들)와 `pipeline/`(Node)의 엄격한 분리** — API 키가 절대 `src/`로 넘어가지 않는다
4. **타임라인 상수/로직은 단 한 곳** — 복제 금지

### 8.2 제안 구조

```
youtube-video-automation/
├── CLAUDE.md                        # ★ 신규 (§10 제안)
├── README.md                        # 실제 코드와 일치하도록 재작성
├── docs/
│   ├── architecture.md              # 본 문서
│   ├── scene-plan-spec.md           # script.md 작성 규약 + scene-plan 스키마
│   └── character-guide.md           # 캐릭터 레퍼런스 제작/등록 가이드
│
├── projects/                        # ★ 작품 단위 작업 공간 (에셋은 git-ignore, 소스는 커밋)
│   └── <project-id>/
│       ├── script.md                # [입력] 원고
│       ├── project.yaml             # [입력] 제목/테마/보이스/해상도
│       ├── characters/
│       │   ├── characters.json      # [입력] 캐릭터 정의
│       │   └── refs/*.png           # [입력] 레퍼런스 이미지
│       ├── plan/
│       │   ├── scene-plan.json      # [1단계 산출] 사람이 수정 가능
│       │   └── render-plan.json     # [7단계 산출] Remotion props
│       ├── assets/                  # Remotion publicDir
│       │   ├── audio/nar_01.mp3
│       │   ├── images/scene_01.png
│       │   └── video/scene_01.mp4
│       ├── .cache/manifest.json     # 입력 해시 → 산출물 매핑
│       └── out/
│           ├── final.mp4
│           ├── final.srt
│           └── report.json          # 비용/소요시간/실패 기록
│
├── src/                             # Remotion (브라우저 번들) — API 키 접근 금지
│   ├── index.ts
│   ├── Root.tsx                     # calculateMetadata 기반, 하드코딩 제거
│   ├── compositions/
│   │   └── AIVideo.tsx              # 조립만 담당 (얇게)
│   ├── components/
│   │   ├── Title.tsx
│   │   ├── Ending.tsx
│   │   ├── SubtitleOverlay.tsx
│   │   ├── MediaSection.tsx
│   │   ├── VideoSection.tsx         # + 클립 루프/속도조절
│   │   └── KenBurnsImage.tsx
│   ├── timeline/
│   │   ├── constants.ts             # ★ FPS/CROSSFADE/NAR_PAD/TITLE_DUR/END_DUR (SSOT)
│   │   ├── calcTimeline.ts
│   │   └── buildSubtitles.ts
│   ├── theme/themes.ts
│   └── schema/
│       ├── scene-plan.ts            # zod
│       ├── render-plan.ts           # zod (구 ProjectDef)
│       └── characters.ts            # zod
│
├── pipeline/                        # Node 전용 (API 키 취급)
│   ├── cli.mjs                      # 엔트리: run / resume / cost / validate
│   ├── steps/
│   │   ├── 01-analyze-script.mjs    # script.md → scene-plan.json
│   │   ├── 02-generate-narration.mjs# ElevenLabs → audio/*.mp3
│   │   ├── 03-measure-audio.mjs     # 실측 durSec
│   │   ├── 04-align-subtitles.mjs   # Whisper → 자막 타이밍
│   │   ├── 05-generate-images.mjs   # 캐릭터 레퍼런스 기반 이미지
│   │   ├── 06-generate-videos.mjs   # Veo i2v
│   │   ├── 07-build-render-plan.mjs # 전부 취합 → render-plan.json
│   │   └── 08-render.mjs            # @remotion/renderer → final.mp4
│   ├── providers/
│   │   ├── gemini-text.mjs
│   │   ├── gemini-image.mjs
│   │   ├── veo.mjs
│   │   ├── elevenlabs.mjs
│   │   ├── whisper.mjs
│   │   └── runway.mjs               # (선택적 백업)
│   ├── exporters/
│   │   ├── export-srt.mjs           # 이동 + timeline 공유
│   │   └── export-fcpxml.mjs        # 이동 + ffprobe 수정
│   └── core/
│       ├── config.mjs               # ★ 구 api-config.ts (모델 ID/보이스/키)
│       ├── manifest.mjs             # 캐시/재개
│       ├── cost.mjs                 # 비용 추정/상한
│       ├── retry.mjs
│       ├── logger.mjs
│       └── preflight.mjs
│
├── tests/
│   ├── timeline.test.ts
│   ├── subtitles.test.ts
│   └── schema.test.ts
│
├── .env / .env.example
├── remotion.config.ts               # publicDir = projects/<id>/assets
├── package.json
└── tsconfig.json
```

### 8.3 주요 결정 사항

- **`public/` 폐지, `projects/<id>/assets/`를 `publicDir`로 지정** → 작품 간 에셋 충돌 없음, `staticFile("images/scene_01.png")` 형태로 단순화
- **`scripts/` → `pipeline/`으로 개명** — "잡다한 스크립트 모음"이 아니라 "파이프라인"임을 구조로 표현
- **`src/timeline/`이 `pipeline/exporters/`에서도 import 되도록** — 상수 복제의 근본 제거 (`.ts` → Node 실행을 위해 tsx/빌드 또는 `.mjs` 공용 모듈 중 택1)
- **파일명에 번호(`01-`~`08-`)** — 실행 순서가 곧 파일 정렬 순서

---

## 9. 단계별 개발 순서

각 Phase는 **끝날 때 실행 가능한 산출물**이 있어야 한다.

### Phase 0 — 토대 정리 (기존 코드 정리, 신규 기능 없음)
1. `npm install` 및 빌드/렌더 동작 실측 확인
2. `src/timeline/` 추출 — 상수 + `calcTimeline` + `buildSubtitles` SSOT화, 단위 테스트 작성
3. `AIVideo.tsx` 컴포넌트 분리 (`src/components/`)
4. **버그 수정**: §4.1(길이 불일치), §4.3(다중 미디어 공백), §4.6(자막 밀림)
5. `TestAI` 삭제, `api-config.ts` → `pipeline/core/config.mjs` 이동
6. 테스트 러너 + `lint` 스크립트 도입
   - ✅ 완료 기준: 기존 샘플로 `final.mp4`가 **잘림 없이** 렌더되고, 타임라인 테스트가 통과

### Phase 1 — 스키마와 계약 정의 (코드보다 먼저)
1. `script.md` 작성 규약 확정 (front-matter + 헤딩 구조) → `docs/scene-plan-spec.md`
2. zod 스키마 3종 작성 (`scene-plan`, `render-plan`, `characters`)
3. `render-plan.json`을 **손으로 하나 작성**해 Remotion이 정상 렌더하는지 확인
   - ✅ 완료 기준: 수작업 `render-plan.json` → `final.mp4` 렌더 성공 (= 파이프라인의 종착점이 먼저 확보됨)

### Phase 2 — 오케스트레이터 골격
1. `pipeline/cli.mjs` + `core/`(config, manifest, retry, logger, preflight, cost)
2. 모든 단계를 **mock 프로바이더**(더미 mp3/png/mp4 생성)로 구현하여 8단계를 관통
3. `--dry-run`, `--from`, `--only`, 캐시 재개 검증
   - ✅ 완료 기준: API 호출 0건으로 `script.md → final.mp4`(더미 소재) 전 구간 통과

### Phase 3 — 나레이션 축 (오디오 우선 원칙의 근간)
1. `02-generate-narration` — ElevenLabs 실연결 (기존 코드 이식)
2. `03-measure-audio` — 실측 길이 (`music-metadata`)
3. `04-align-subtitles` — Whisper 자동 정렬 + `buildSubtitles` 폴백
   - ✅ 완료 기준: 나레이션 + 검은 화면 + 정확한 자막만으로 영상이 완성됨. **여기서 타임라인이 확정**되므로 이후 단계는 "그림 채우기"에 불과해진다

### Phase 4 — 장면 분석
1. `01-analyze-script` — Gemini structured output, temperature 0, 프롬프트 해시 캐싱
2. 나레이션 원문 보존 검증 (LLM 재작성 탐지)
3. `scene-plan.json` 사람 편집 워크플로 확립
   - ✅ 완료 기준: 실제 `script.md`에서 자동 생성된 `scene-plan.json`으로 Phase 3가 그대로 굴러감

### Phase 5 — 이미지 생성 + 캐릭터 일관성 (가장 불확실 → 실험 우선)
1. **먼저 스파이크(spike)**: 레퍼런스 3방식(§6.3) 중 어느 것이 현재 API 티어에서 실제로 동작하는지 최소 코드로 검증
2. `characters.json` + 레퍼런스 등록
3. `05-generate-images` — 씬별 캐스팅, seed 고정, N장 생성 후 선택
4. 사람 승인 게이트 (`--review images`)
   - ✅ 완료 기준: 동일 캐릭터가 여러 씬에서 알아볼 수 있게 유지된 정지 이미지 슬라이드쇼 영상

### Phase 6 — Veo image-to-video
1. `06-generate-videos` — `source.image` + `motionPrompt`, `generateAudio:false`
2. **클립 길이 < 나레이션 길이 대응**: 루프/속도조절/멀티클립 이어붙이기 (`VideoSection` 확장)
3. 실패 시 정지 이미지로 자동 강등 (graceful degradation)
   - ✅ 완료 기준: 목표 파이프라인 전 구간 실API 통과 → `final.mp4`

### Phase 7 — 완성도
1. 비용 리포트 / `report.json`
2. SRT·FCPXML 익스포터 이관 및 수정 (§4.4)
3. README 재작성 (허구 제거)
4. E2E 스모크 테스트
5. Claude Code 스킬화 (대화형 진입점)

> **순서의 근거**: Phase 1에서 **종착점(Remotion 렌더)을 먼저 고정**하고, Phase 2에서 **뼈대를 mock으로 관통**시킨 뒤, Phase 3에서 **타임라인을 확정**한다. 가장 비싸고 불확실한 이미지/영상 생성(Phase 5-6)을 마지막에 두어, 그때까지는 API 비용 없이 개발할 수 있게 한다. §7.4의 비용/시간 제약이 이 순서를 강제한다.

---

## 10. CLAUDE.md 추가 제안 (참고용 — 본 작업에서 CLAUDE.md는 수정하지 않음)

> **현황**: 이 리포에는 `CLAUDE.md`도 `.claude/` 디렉터리도 **존재하지 않는다**. 현재 적용되는 것은 사용자 전역 규칙(`~/.claude/rules/*.md`: golden-principles, coding-style, verification, security, interaction, git-workflow, date-calculation, agents-v2)뿐이다.
> 아래는 **이번 분석에서 실제로 발견한 문제에 근거한**, 프로젝트 전용 규칙 초안이다. 전역 규칙과 중복되는 내용은 의도적으로 제외했다.

### 제안 1. 타임라인 상수·로직 단일 진실 공급원 (SSOT)
```
FPS / CROSSFADE / NAR_PAD / TITLE_DUR / END_DUR 및 calcTimeline / buildSubtitles 는
src/timeline/ 에만 존재한다. 어떤 파일에도 이 값을 재선언하거나 복사하지 않는다.
Node 스크립트(pipeline/)도 반드시 이 모듈을 import 한다.
"// AIVideo.tsx와 동기화" 류의 주석은 금지 — 그것은 복제가 있다는 뜻이다.
```
*근거*: 현재 3개 파일에 복제되어 있고(`AIVideo.tsx`, `export-srt.mjs`, `export-fcpxml.mjs`), 이미 `Root.tsx:19`에서 `narPad` 불일치로 영상이 6초 잘리는 실제 버그가 발생했다.

### 제안 2. API 키는 `src/` 에 들어갈 수 없다
```
src/ 이하는 Remotion 브라우저 번들이다. process.env 로 시크릿을 읽는 코드를 두지 않는다.
API 키를 다루는 코드는 pipeline/ 이하에만 존재한다.
Remotion 컴포넌트에 필요한 값은 props(render-plan.json)로 전달한다.
```
*근거*: `src/lib/api-config.ts`가 `src/`에서 `ELEVENLABS_API_KEY` 등을 읽고 있다(현재는 死코드라 미발현).

### 제안 3. 음성 우선(音声ファースト) 원칙 — 변경 금지
```
섹션 길이 = 나레이션 실측 길이 + NAR_PAD*2. 나레이션은 절대 잘리지 않는다.
영상 길이가 부족하면 영상을 늘린다(루프/속도조절). 나레이션을 줄이지 않는다.
durSec 은 추정하지 않는다 — 반드시 실측값을 쓴다.
```
*근거*: 커밋 `0aeec21`에서 확립된 설계 원칙. 반면 현재 `generate-ai-video.mjs:280`은 `bytes/16000`으로 **추정**하고 있어 원칙을 스스로 위반한다.

### 제안 4. 생성 API 호출 규약 (비용 안전장치)
```
이미지/영상/음성 생성 API를 호출하는 코드는 반드시 다음을 갖춘다:
  1) 입력 해시 기반 캐시 — 동일 입력은 재생성하지 않는다
  2) --dry-run 지원 — 호출 없이 예상 건수/비용을 출력
  3) 실패를 삼키지 않는다 — manifest 에 기록하고 종료 코드에 반영
Claude 는 사용자의 명시적 승인 없이 유료 생성 API를 실행하지 않는다.
검증 목적이면 mock 프로바이더를 사용한다.
```
*근거*: Veo는 클립당 1~3분 + 과금. `generate-ai-video.mjs:316`은 실패를 `console.error`만 하고 진행해 "성공"처럼 끝난다. `test-apis.mjs:42`는 연결 확인이라면서 **실제 과금 TTS 요청**을 보낸다.

### 제안 5. 중간 산출물은 사람이 고칠 수 있어야 한다
```
scene-plan.json / render-plan.json 은 사람이 열어 수정하는 것을 전제로 한 계약이다.
파이프라인은 사람이 수정한 중간 산출물을 말없이 덮어쓰지 않는다(--force 필요).
자동화의 결과를 콘솔에 출력해 사람이 복붙하게 만드는 설계는 금지한다 — 파일로 쓴다.
```
*근거*: 현재 `generate-ai-video.mjs:337-348`은 TS 코드 조각을 콘솔에 출력하고 사람이 `Root.tsx`에 복붙하도록 되어 있다. 이것이 현 파이프라인의 자동화 단절점이다.

### 제안 6. 모델 ID·보이스 ID는 설정 한 곳에만
```
모델 ID를 코드에 리터럴로 쓰지 않는다. pipeline/core/config.mjs 에만 둔다.
모델 ID를 추가/변경할 때는 context7 또는 공식 문서로 실재 여부를 먼저 확인하고,
확인한 근거(문서 URL / 조회 결과)를 커밋 메시지나 주석에 남긴다.
```
*근거*: `veo-3.1`(api-config.ts) / `veo-3.0-generate-preview`(generate-ai-video.mjs) / `imagen-4-fast`(api-config.ts, 실재 불분명) 세 값이 코드베이스 안에서 충돌하고 있다.

### 제안 7. 외부 바이너리는 선택 의존성으로 취급
```
ffprobe / ffmpeg / faster-whisper 는 없을 수 있다고 가정한다.
없을 때 조용히 기본값으로 대체하지 않는다 — 명시적으로 경고하거나 실패한다.
가능하면 순수 JS 라이브러리 또는 Remotion 동봉 바이너리를 우선한다.
```
*근거*: 현 개발 머신에 `ffprobe`/`ffmpeg`이 없다(확인 완료). `export-fcpxml.mjs:72`는 이 경우 모든 에셋 길이를 150프레임으로 위조한 XML을 **에러 없이** 출력한다.

### 제안 8. README는 코드와 일치해야 한다
```
문서에 기재된 스크립트/명령은 반드시 리포에 존재해야 한다.
기능을 삭제하거나 이름을 바꾸면 같은 커밋에서 README를 갱신한다.
"예정" 기능은 README가 아니라 docs/architecture.md 의 로드맵에 적는다.
```
*근거*: README가 `generate-images.mjs` / `generate-narration.mjs` / `generate-i2v.mjs` 3종과 Claude Code 스킬 `ai-video`의 사용법을 안내하고 있으나, **git 히스토리 전체에 한 번도 존재한 적이 없다.**

---

## 부록 A. 이번 분석에서 확인한 사실 (검증 방법 명시)

| 사실 | 확인 방법 |
|------|-----------|
| 리포 총 파일 14개, 코드 ~1,500줄 | `find` + `wc -l` |
| `api-config.ts` import 0건 | `grep -rn "api-config"` → 결과 없음 |
| `zod` 사용처 0건 | `grep -rn "zod" src scripts` → 결과 없음 |
| README 기재 스크립트 3종 미존재 | `git log --stat` 전체 이력 확인 |
| `ffprobe`/`ffmpeg` PATH 부재 | `command -v ffprobe` → 없음 |
| Node v22.16.0 / npm 10.9.2 / Python 3.14.5 | `node -v`, `npm -v`, `python --version` |
| `node_modules` 미설치 | `ls node_modules` → 없음 |
| Veo i2v는 `source.image`, 폴링은 `getVideosOperation` | context7 `/websites/googleapis_github_io_js-genai_release_docs` 조회 |
| `SubjectReferenceImage` / `editImage` 존재 | 동일 조회 |
| `Root.tsx`의 `narPad=0` vs `AIVideo`의 `pad=30` | 소스 대조 (`Root.tsx:19` ↔ `AIVideo.tsx:341`) |

**미검증(구현 시 실측 필요)**: TypeScript 컴파일 통과 여부, Remotion 렌더 실제 동작, 각 모델 ID의 실재 및 현 API 티어 사용 가능 여부, 캐릭터 일관성 3방식 중 실동작하는 것.
