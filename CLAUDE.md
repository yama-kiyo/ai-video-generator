# CLAUDE.md

`script.md → 장면 분석 → 나레이션 → 캐릭터 기반 이미지 → Veo i2v → 자막 → Remotion → final.mp4`
영상 자동 생성 파이프라인.

**전체 분석·설계·로드맵은 [`docs/architecture.md`](docs/architecture.md)가 유일한 기준 문서다.**
이 파일은 그중 "코드를 쓸 때 반드시 지켜야 할 것"만 추린다.

> 전역 규칙(`~/.claude/rules/*.md` — golden-principles, coding-style, verification, security, interaction, git-workflow)은 그대로 적용된다. 여기서는 **이 프로젝트에서만 의미 있는 규칙**만 다루며 전역 규칙을 반복하지 않는다.

---

## 현재 단계 (중요)

**Phase 0 이전 — 분석 완료, 구현 미착수.**

- `docs/architecture.md` §8의 최종 디렉터리 구조를 **한 번에 생성하거나 일괄 리팩터링하지 않는다.**
  구조는 Phase가 진행되며 필요한 부분만 점진적으로 생긴다.
- **각 Phase는 별도의 구현 계획 수립 → 사용자 승인 → 구현 → 검증** 순서를 거친다.
  한 세션에서 여러 Phase를 앞질러 진행하지 않는다.
- **기존 코드를 변경하기 전에 baseline 동작을 먼저 실측한다.**
  `npm install` → 빌드/렌더가 현재 어떻게 동작하는지(또는 어떻게 실패하는지) 확인한 뒤에 손댄다.
  "고치기 전 상태"를 모르면 고친 뒤의 상태도 판단할 수 없다.
- **기존 동작을 바꿀 때는 테스트를 먼저 추가한다.** 특히 타임라인·자막 계산은 순수 함수라 예외가 없다.

---

## 1. 타임라인 상수·로직은 SSOT

`FPS` / `CROSSFADE` / `NAR_PAD` / `TITLE_DUR` / `END_DUR` 와 `calcTimeline()` / `buildSubtitles()` 는
**단 하나의 모듈에만 존재한다** (목표 위치: `src/timeline/`).

- 어떤 파일에서도 이 값을 재선언하거나 복사하지 않는다. Node 스크립트도 import 한다.
- `// AIVideo.tsx와 동기화` 류의 주석은 **금지**. 그 주석은 복제가 존재한다는 자백이다.

*근거*: 현재 `src/AIVideo/AIVideo.tsx`, `scripts/export-srt.mjs:42`, `scripts/export-fcpxml.mjs:40` 3곳에 복제되어 있고, 이미 `src/Root.tsx:19`의 `narPad` 불일치로 **완성 영상이 6초 잘리는 버그**가 발생했다.

## 2. `src/`에서 API key·secret 접근 금지

`src/` 이하는 Remotion 브라우저 번들이다.

- `src/` 어디에도 `process.env`로 시크릿을 읽는 코드를 두지 않는다.
- API 키를 다루는 코드는 `pipeline/`(Node 전용)에만 존재한다.
- Remotion 컴포넌트가 필요로 하는 값은 **props(`render-plan.json`)로 전달**한다.

*근거*: `src/lib/api-config.ts`가 `src/`에서 `ELEVENLABS_API_KEY` 등을 읽는다. 현재는 import 0건인 死코드라 미발현이나, `REMOTION_` 접두사가 붙는 순간 시크릿이 렌더 번들에 박힌다.

## 3. 음성 우선(audio-first) 원칙 — 변경 금지

```
섹션 길이 = 나레이션 실측 길이 + NAR_PAD*2
```

- **나레이션은 어떤 경우에도 잘리지 않는다.**
- 영상이 나레이션보다 짧으면 **영상을 늘린다**(루프 / 속도조절 / 멀티클립 이어붙이기).
  나레이션을 줄이거나 빠르게 만들지 않는다.
- 이 원칙이 파이프라인 순서(ElevenLabs → 이미지 → Veo)를 결정한다. 순서를 바꾸려면 이 원칙부터 재검토해야 한다.

*근거*: 커밋 `0aeec21`에서 확립된 설계 원칙.

## 4. `durSec`은 추정하지 않는다

- 오디오 길이는 **반드시 실측한다** (순수 JS 라이브러리 또는 Remotion 동봉 ffprobe).
- 파일 크기·비트레이트로 역산하지 않는다.

*근거*: `scripts/generate-ai-video.mjs:280`의 `buffer.length / 16000`은 CBR 128kbps 가정이며, 그 오차가 **그대로 자막 타이밍 오차**가 된다. 원칙 3을 코드가 스스로 위반하고 있다.

## 5. 유료 생성 API는 승인 없이 실행 금지

- 이미지 / 영상 / 음성 **생성** API(Gemini Image, Veo, ElevenLabs, Runway)는
  **사용자의 명시적 승인 없이 실행하지 않는다.**
- 동작 검증 목적이면 **mock 프로바이더**를 쓴다.
- 연결 확인(preflight)은 **과금되지 않는 엔드포인트**로 한다.

*근거*: Veo는 클립당 1~3분 + 과금. 현재 `scripts/test-apis.mjs:42`는 "연결 테스트"라면서 실제 과금되는 TTS 요청을 보낸다.

## 6. 생성 API 호출부의 4가지 필수 요건

생성 API를 호출하는 코드는 예외 없이 다음을 갖춘다.

1. **캐시** — 입력 해시(프롬프트 + 모델 + seed)가 같으면 재생성하지 않는다
2. **`--dry-run`** — 호출 없이 예상 건수와 비용을 출력한다
3. **재시도** — 지수 백오프, rate limit 대응
4. **실패 manifest** — 실패를 삼키지 않는다. manifest에 기록하고 **종료 코드에 반영**한다

*근거*: `scripts/generate-ai-video.mjs:316-318`은 실패를 `console.error`만 하고 계속 진행해, 클립이 없는 상태로 "완료"라고 끝낸다.

## 7. 사람이 고친 중간 산출물을 덮어쓰지 않는다

`plan/scene-plan.json` 과 `plan/render-plan.json` 은 **사람이 열어 수정하는 것을 전제로 한 계약**이다.

- 파이프라인은 이 파일들을 **`--force` 없이 덮어쓰지 않는다.**
- 자동화 결과를 콘솔에 출력해 사람이 복붙하게 만드는 설계는 **금지**. 파일로 쓴다.

*근거*: `scripts/generate-ai-video.mjs:337-348`은 TS 코드 조각을 콘솔에 출력하고 사람이 `Root.tsx`에 복붙하도록 되어 있다. 이것이 현 파이프라인의 자동화 단절점이다.

## 8. 모델 ID·보이스 ID는 중앙 설정에서만

- 모델 ID를 코드에 리터럴로 쓰지 않는다. 중앙 설정 모듈(목표: `pipeline/core/config.mjs`) 한 곳에만 둔다.
- 모델 ID를 추가·변경할 때는 **context7 또는 공식 문서로 실재 여부를 먼저 확인**하고,
  확인 근거(문서 URL / 조회 결과)를 주석이나 커밋 메시지에 남긴다.

*근거*: `veo-3.1`(`src/lib/api-config.ts:32`) / `veo-3.0-generate-preview`(`scripts/generate-ai-video.mjs:131`) / `imagen-4-fast`(실재 불분명) 세 값이 코드베이스 안에서 충돌한다.

## 9. 외부 도구 부재를 조용히 대체하지 않는다

`ffmpeg` / `ffprobe` / `faster-whisper` 는 **없을 수 있다고 가정한다.**

- 없을 때 조용히 기본값으로 대체하지 않는다. **명시적으로 경고하거나 실패한다.**
- 폴백을 쓸 경우(예: Whisper 없음 → `buildSubtitles()` 문자수 비례) 반드시 **경고를 출력하고 산출물에 표시**한다.
- 가능하면 순수 JS 라이브러리 또는 Remotion 동봉 바이너리를 우선한다.

*근거*: 현재 개발 머신에 `ffprobe`/`ffmpeg`이 없다. `scripts/export-fcpxml.mjs:72`는 이 경우 모든 에셋 길이를 150프레임으로 위조한 XML을 **에러 없이** 출력한다.

## 10. README는 코드와 일치해야 한다

- README에 적힌 스크립트·명령은 **반드시 리포에 존재해야 한다.**
- 기능을 삭제하거나 이름을 바꾸면 **같은 커밋에서** README를 갱신한다.
- "예정" 기능은 README가 아니라 `docs/architecture.md`의 로드맵에 적는다.

*근거*: README가 `generate-images.mjs` / `generate-narration.mjs` / `generate-i2v.mjs` 3종과 Claude Code 스킬 `ai-video`의 사용법을 안내하지만, **git 히스토리 전체에 한 번도 존재한 적이 없다.** 이 리포에서 README는 사양서가 아니다 — **코드가 유일한 사실이다.**

---

## 보고 규칙

**실패를 숨기거나 성공처럼 보고하지 않는다.**

- 렌더가 실패했으면 실패했다고, 클립 3개 중 1개만 생성됐으면 1개라고 보고한다.
- 검증 명령을 실행하지 않았으면 "확인했다"고 말하지 않는다.
- 이 프로젝트에서 특히 위험한 것은 **조용한 성공**이다 —
  잘린 영상, 150프레임으로 위조된 FCPXML, 클립 없는 "완료", 1초 밀린 자막은
  **모두 에러 없이 산출물을 만들어낸다.** 산출물이 나왔다는 사실은 성공의 증거가 아니다.

---

## 알려진 결함 (수정 전까지 유효)

착수 시 참고. 상세는 `docs/architecture.md` §4.

| 위치 | 증상 |
|------|------|
| `src/Root.tsx:19` | `calcTimeline(sections, 0)` — 컴포지션 길이가 섹션당 60프레임 부족, 영상 말미 잘림 |
| `src/AIVideo/AIVideo.tsx:227` | 미디어 n≥2인 섹션 말미에 `15*(n-1)` 프레임 검은 화면 |
| `src/AIVideo/AIVideo.tsx:153` | 오디오 없는 섹션의 자막이 1초 밀림 |
| `scripts/export-fcpxml.mjs:72` | ffprobe 부재 시 모든 길이를 150프레임으로 위조 |
| `scripts/generate-ai-video.mjs:280` | 오디오 길이를 파일 크기로 추정 |
| `scripts/generate-ai-video.mjs:316` | 생성 실패를 삼키고 "완료" 처리 |
| `src/lib/api-config.ts` | import 0건인 死코드 + `src/`에서 시크릿 접근 |
