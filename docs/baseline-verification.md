# Phase 0A — Baseline Verification

> 실행일: 2026-08-26
> 대상 커밋: `fd12b1f` (main)
> 목적: 리팩터링·버그 수정 **이전**의 실제 동작 상태를 실측 기록
> 제약: 유료 생성 API 호출 없음 / `test-apis.mjs` 미실행 / 소스 코드 미수정

## 요약

| 항목 | 결과 |
|------|------|
| 의존성 설치 | ✅ 성공 (395 packages, ~1분) |
| TypeScript 컴파일 | ✅ **에러 0건** (exit 0) |
| Remotion 번들 | ✅ 성공 (54.8s) |
| Composition 목록 | ✅ 2개 인식 (AIVideo 966f / TestAI 1146f) |
| **실제 렌더** | ❌ **실패 (exit 1)** — 샘플 에셋 전부 부재 |
| `npm run render` | ❌ **실패 (exit 1)** — mp4 미생성 |
| 부분 렌더 (타이틀) | ✅ 성공 — 렌더 파이프라인 자체는 정상 |

**결론: 이 리포는 클론 직후 baseline 렌더가 불가능하다.** 코드 결함이 아니라 샘플이 참조하는 미디어 6개가 `.gitignore` 대상이라 리포에 존재하지 않기 때문이다. 이것이 Phase 0의 **첫 번째 차단 요소**다.

부수적으로, `docs/architecture.md` §4.1의 타임라인 잘림 버그를 **정량적으로 실측 확인**했고, 정적 분석에서 놓친 **신규 결함 7건**을 발견했다.

---

## 1. 환경

| 항목 | 값 |
|------|-----|
| OS | Windows 11 Home 10.0.26200 |
| Node.js | v22.16.0 |
| npm | 10.9.2 |
| Python | 3.14.5 |
| 시스템 `ffmpeg` / `ffprobe` | **PATH에 없음** |
| Remotion 동봉 `ffmpeg` | **n7.1 사용 가능** (`npx remotion ffmpeg`) |
| Remotion 동봉 `ffprobe` | **n7.1 사용 가능** (`npx remotion ffprobe`) |
| Chrome Headless Shell | 149.0.7790.0 — 최초 실행 시 **113.3 MB 자동 다운로드** |

> Remotion이 ffmpeg/ffprobe를 동봉한다는 사실은 `architecture.md` §4.4의 해결책이 **실행 가능함**을 확인해 준다. 시스템 설치는 불필요하다.

---

## 2. install 결과

### 2.1 lockfile 상태 (설치 전)

**lockfile이 존재하지 않았다.** `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` / `bun.lockb` 모두 없음.
→ `npm install`이 `package-lock.json`을 **신규 생성**했다. (이번 세션에서 유일하게 추가된 비문서 파일)

### 2.2 설치 결과

```
added 395 packages, and audited 396 packages in 1m
2 low severity vulnerabilities
```

**deprecation 경고 2건**

| 패키지 | 내용 |
|--------|------|
| `node-domexception@1.0.0` | 플랫폼 네이티브 DOMException 사용 권장 |
| `eslint@9.19.0` | **더 이상 지원되지 않는 버전** |

**취약점 2건 (모두 low, devDependency 체인)**

| 패키지 | 내용 |
|--------|------|
| `@eslint/plugin-kit` | ConfigCommentParser ReDoS |
| `eslint` | 위 패키지 경유 |

→ 런타임/렌더에는 영향 없음. eslint 계열 정리 시 함께 해소.

### 2.3 `^` 범위가 실제로 해석된 버전

| 패키지 | package.json | 실제 설치 |
|--------|--------------|-----------|
| `remotion` | `^4.0.0` | **4.0.517** |
| `@remotion/cli` | `^4.0.0` | **4.0.517** |
| `@google/genai` | `^1.45.0` | **1.52.0** |
| `@runwayml/sdk` | `^3.15.0` | **3.24.0** |
| `react` | `19.2.3` (고정) | 19.2.3 |
| `typescript` | `5.9.3` (고정) | 5.9.3 |
| `zod` | `3.22.3` (고정) | 3.22.3 |

---

## 3. TypeScript 컴파일 결과

```
$ npx tsc --noEmit
EXIT_CODE=0
```

**에러·경고 0건.**

> 📌 **`architecture.md` §4.7 정정**: `tsconfig.json`의 `"lib": ["es2015"]`가 lookbehind 정규식 등과 충돌할 것이라 정적 분석에서 지적했으나, **실제로는 컴파일 에러가 발생하지 않는다.** TypeScript는 `lib` 설정으로 정규식 문법을 검사하지 않는다. 해당 항목은 "실재하는 결함"이 아니라 "정리하면 좋을 설정"으로 강등한다.

---

## 4. package scripts 확인 결과

```
dev          -> remotion studio --open
generate     -> node scripts/generate-ai-video.mjs
test-apis    -> node scripts/test-apis.mjs      ← 유료 TTS 호출 가능성, 이번 검증에서 미실행
render       -> remotion render TestAI out/video.mp4
build        -> remotion bundle
upgrade      -> remotion upgrade
```

발견:

- **`render`가 `TestAI`를 가리킨다** — 삭제 예정인 구버전 컴포지션. 실사용 대상 `AIVideo`가 아니다.
- **`lint` 스크립트 없음.** 게다가 `eslint.config.*` / `.eslintrc*` 가 **하나도 없어** eslint 9(flat config 필수)를 실행할 수단 자체가 없다. `@remotion/eslint-config-flat`이 devDependency에 있으나 연결되지 않았다.
- **테스트 스크립트·러너 없음.**

---

## 5. Remotion composition 확인 결과

```
$ npx remotion compositions src/index.ts

AIVideo    30      1920x1080      966 (32.20 sec)
TestAI     30      1920x1080      1146 (38.20 sec)
```

번들링 성공(54.8s), exit 0.

**두 컴포지션은 완전히 동일한 섹션 데이터(`durSec` 10.0 / 10.4 / 7.3)를 쓰는데 길이가 180프레임 다르다.** 이것이 §4.1 버그의 직접 증거다 (아래 §7.1).

---

## 6. 실제 render 결과

### 6.1 `npx remotion render AIVideo out/baseline-aivideo.mp4` → ❌ exit 1

```
Rendered 90/966 ...
An error occurred while rendering frame 91:
Error: Received a status code of 404 while downloading file
       http://localhost:3000/public/test-ai/clip_01.mp4.
{"statusCode":404,"message":"The requested path (...\\public\\test-ai\\clip_01.mp4) could not be found"}
```

- 프레임 **0~90(타이틀 구간)은 정상 렌더**된 뒤, 섹션 1이 시작되는 프레임 91에서 실패
- **mp4 산출물 없음**

### 6.2 `npm run render` (= `remotion render TestAI`) → ❌ exit 1

동일 유형의 에셋 404로 실패. **mp4 산출물 없음.**

### 6.3 원인 (수정하지 않음)

샘플이 참조하는 미디어 **6개 전부 부재**:

```
MISSING public/test-ai/clip_01.mp4    MISSING public/test-ai/nar_01.mp3
MISSING public/test-ai/clip_02.mp4    MISSING public/test-ai/nar_02.mp3
MISSING public/test-ai/clip_03.mp4    MISSING public/test-ai/nar_03.mp3
```

`public/` 안의 실제 파일은 `public/test-ai/.gitkeep` **하나뿐**이다.
`.gitignore`가 `public/test-ai/*.mp4`, `*.mp3`를 제외하므로 **설계상 리포에 존재할 수 없다.**

→ 코드 버그가 아니라 **fixture 부재**. 다만 결과적으로 "클론 → 렌더" 경로가 성립하지 않으며, 이는 회귀 테스트의 기준선을 만들 수 없다는 뜻이다.

### 6.4 부분 렌더 — 렌더 파이프라인 자체는 정상

에셋이 필요 없는 타이틀 프레임은 정상 렌더된다.

```
$ npx remotion still AIVideo out/f0060.png --frame=60   → exit 0
```

![기록] `out/f0060.png` 시각 확인 결과: 배경 `#0A0A0A`, `CEL CORPORATION` / `アパート建設の流れ` / `着工〜組立編` 3단 레이아웃, 일본어 정상 표시.

**즉 Remotion 번들·Chrome·인코딩 경로에는 문제가 없다. 막힌 것은 오직 미디어 에셋이다.**

---

## 7. architecture.md 정적 분석 vs 실제 실행 결과 비교

| # | 정적 분석 (architecture.md) | 실행 검증 결과 | 판정 |
|---|------|------|------|
| §4.1 | Composition 길이 불일치 → 영상 잘림 | 966 vs 1146 프레임 실측, 엔딩 렌더 불가 확인 | ✅ **확증 + 정량화** |
| §4.2 | `src/`에서 시크릿 접근 | 死코드라 런타임에 발현 안 함 | ⚪ 잠재 (변함없음) |
| §4.3 | 다중 미디어 섹션 말미 검은 화면 | 샘플이 단일 video만 사용 → **재현 불가** | ⚠️ **미검증** |
| §4.4 | ffprobe 부재 시 150프레임 위조 | 시스템 ffprobe 부재 **확인** (조건 성립) | 🟡 조건 확인, 실행은 미수행 |
| §4.5 | 생성 스크립트 4개 결함 | 유료 API라 **의도적으로 미실행** | ⚪ 미검증 (설계상) |
| §4.6 | 오디오 없는 섹션 자막 1초 밀림 | 샘플 전 섹션에 audio 존재 → **재현 불가** | ⚠️ **미검증** |
| §4.7 | `lib: es2015` 문제 | **컴파일 에러 없음** | ❌ **정정 필요** |

### 7.1 §4.1 확증 — 실측 증거 3건

**계산 대조**

| | 값 |
|---|---|
| `Root.tsx:19` 이 등록하는 길이 (`narPad=0`) | **966** 프레임 (32.20s) |
| `AIVideo` 내부 실제 계산 (`narPad=30`) | **1146** 프레임 (38.20s) |
| 차이 | **180 프레임 = 6.00초** |

내부 배치: `S1 90~450` / `S2 435~807` / `S3 792~1071` / `Ending 1071~1146`

**증거 A — 마지막 프레임이 엔딩이 아니다**
```
$ npx remotion still AIVideo --frame=965        # 등록된 마지막 프레임
Error: 404 ... public/test-ai/clip_03.mp4
       proxy?src=...clip_03.mp4&time=5.766666666666667
```
마지막 프레임이 **섹션 3 영상의 5.77초 지점**을 요구한다 → 엔딩이 아니라 본편 중간에서 끝난다.

**증거 B — 엔딩은 렌더 자체가 불가능**
```
$ npx remotion still AIVideo --frame=1071       # 내부 계산상 엔딩 시작
RangeError: Cannot use frame 1071: Duration of composition is 966,
            therefore the highest frame that can be rendered is 965
```
엔딩(1071~1146)은 **등록 범위 밖**이다. 결과물에 엔딩이 전혀 포함되지 않는다.

**증거 C — 나레이션이 잘린다 (음성 우선 원칙 위반)**

| 손실 | 양 |
|------|-----|
| 섹션 3 영상 | **105 프레임 (3.50초)** |
| 섹션 3 나레이션 | **75 프레임 (2.50초)** |
| 엔딩 | **75 프레임 전체 (2.50초)** |

`CLAUDE.md` 원칙 3("나레이션은 어떤 경우에도 잘리지 않는다")을 현재 코드가 **실제로 위반하고 있음**이 확인되었다.

### 7.2 §4.3 / §4.6 은 왜 재현하지 못했나

번들된 샘플(`Root.tsx:13-17`)은 세 섹션 모두 `video` + `audio` 조합이다.

- §4.3은 `photos[]` 또는 `media[]`가 **2개 이상**인 섹션이 필요
- §4.6은 `audio` **없이** `narration`만 있는 섹션이 필요

둘 다 현재 샘플에 존재하지 않는다. **이 두 버그는 Phase 0에서 "테스트를 먼저 작성"할 때 재현 fixture와 함께 검증해야 한다** (CLAUDE.md 「현재 단계」 규칙).

---

## 8. 발견된 error / warning

### 8.1 정적 분석에 없던 신규 발견 7건

**N1. 🔴 zod 버전 충돌 — Phase 1 차단 요소**

Remotion 명령을 실행할 때마다 다음 경고가 출력된다.

```
Version mismatch:
Extra packages with wrong versions:
  - zod: installed 3.22.3, required 4.4.3
You may experience breakages such as:
- React context and hooks not working
- Type errors and feature incompatibilities
- Failed renders and unclear errors
```

Remotion 4.0.517은 **zod 4.4.3**을 요구하는데 `package.json`은 `zod: 3.22.3`으로 **고정**되어 있다.
`architecture.md`는 "zod는 미사용이니 스키마 검증에 활용하자"고만 적었으나, 실제로는 **버전이 맞지 않아 그대로 쓸 수 없다.** Phase 1(스키마 정의)은 이 정렬(`npx remotion add zod`) 없이는 시작할 수 없다.

**N2. 🟠 lockfile 부재 → 빌드 재현 불가**

설치 전 lockfile이 없었다. `^4.0.0`이 오늘은 4.0.517로 풀리지만 내일은 다른 버전이 된다. baseline을 "고정"하려면 lockfile 커밋이 전제다.

**N3. 🟠 TestAI 엔딩 배치 결함 (AIVideo와는 별개 버그)**

`TestAI.tsx:230`은 `from={cursor - END_DUR}`를 쓴다.

```
cursor(루프 종료) = 1071  →  Ending = 996 ~ 1071
TEST_AI_TOTAL     = 1146
→ 프레임 1071 ~ 1145 (75프레임 = 2.5초) 에는 Sequence 가 하나도 없다 = 순수 검은 화면
→ 동시에 엔딩(996~1071)이 섹션 3(792~1071)과 완전히 겹친다
```

실측 확인:
```
$ npx remotion still TestAI --frame=1145   → exit 0, 완전한 검은 PNG (34,422 B)
$ npx remotion still TestAI --frame=1110   → exit 0, 동일 크기 검은 PNG
$ npx remotion still TestAI --frame=1030   → 404 clip_03.mp4  (아직 섹션 3 구간)
```

즉 **TestAI 결과물은 마지막 2.5초가 검은 화면으로 끝난다.** TestAI는 삭제 예정이므로 수정 대상은 아니나, `AIVideo`가 `total - END_DUR`(올바름)를 쓰는 것과 대조되어 **엔딩 배치 로직이 두 곳에서 다르다**는 점이 기록될 가치가 있다.

**N4. 🟠 eslint 실행 불가**

`eslint.config.*` / `.eslintrc*` 부재 + `lint` 스크립트 부재. eslint 9는 flat config가 필수이므로 현재 **정적 검사 수단이 전무**하다.

**N5. 🟡 폰트 미고정 → 렌더 결과 비재현**

전 컴포넌트가 `fontFamily: "'Hiragino Kaku Gothic ProN', sans-serif"`를 쓴다. Hiragino는 **macOS 전용 폰트**이며, 이 Windows 환경에서는 시스템 sans-serif로 폴백되었다(렌더는 정상). **머신마다 다른 폰트로 렌더된다** — CI나 다른 개발자 환경에서 자간·행높이가 달라져 자막 줄바꿈이 변할 수 있다.

**N6. 🟠 커밋 가능한 테스트 fixture 부재**

§6.3의 귀결. 회귀 테스트의 기준 산출물을 만들 수 없다.

**N7. 🟡 Chrome Headless Shell 113 MB 최초 다운로드**

CI 도입 시 캐싱 전략이 필요하다.

### 8.2 이번 검증에서 관측된 전체 warning

| 출처 | 내용 | 심각도 |
|------|------|--------|
| npm install | `node-domexception@1.0.0` deprecated | 낮음 |
| npm install | `eslint@9.19.0` 지원 종료 | 낮음 |
| npm audit | `@eslint/plugin-kit` ReDoS (low) ×2 | 낮음 (dev 전용) |
| Remotion 전 명령 | **zod 3.22.3 ≠ required 4.4.3** | **높음** |
| render | 404 × 6 (에셋 부재) | **높음** |
| still --frame=1071 | `RangeError` (엔딩 렌더 불가) | **높음** |

---

## 9. Phase 0 구현 전에 해결해야 할 항목

우선순위 순. **P0-1과 P0-2는 차단 요소**다.

| # | 항목 | 이유 | 차단 대상 |
|---|------|------|-----------|
| **P0-1** | **커밋 가능한 경량 fixture 구축** | 렌더 baseline이 없으면 "고치기 전/후" 비교가 불가능. CLAUDE.md의 baseline 선검증 규칙을 만족시킬 수 없다. 수 KB 더미 mp4/mp3 또는 photo-only 프로젝트 | Phase 0 전체 |
| **P0-2** | **zod 4.4.3 정렬** | Remotion이 명시적으로 요구. 현재 전 명령에서 경고 출력 중 | Phase 1 (스키마) |
| P0-3 | `package-lock.json` 커밋 여부 결정 | 재현 가능한 baseline의 전제 | Phase 0 |
| P0-4 | 테스트 러너 도입 | §4.3/§4.6은 fixture + 테스트 없이는 검증 불가. "기존 동작 변경 전 테스트 선작성" 규칙의 전제 | Phase 0 버그 수정 |
| P0-5 | eslint flat config + `lint` 스크립트 | 정적 검사 수단 확보 | Phase 0 |
| P0-6 | 폰트 전략 결정 | 렌더 재현성. `@remotion/google-fonts` 또는 폰트 파일 동봉 | Phase 0~1 |
| P0-7 | §4.3 / §4.6 재현 fixture | 미검증 버그 2건을 확증해야 수정 가능 | Phase 0 버그 수정 |

### Phase 0 진입 시 정정할 architecture.md 항목

1. **§4.7 강등** — `lib: es2015`는 컴파일 에러를 일으키지 않는다. "결함"이 아니라 "정리 항목"
2. **§7.3 수정** — zod는 "미사용이니 활용하자"가 아니라 **"버전 충돌 상태이므로 4.4.3으로 올려야 사용 가능"**
3. **§5 보강** — TestAI에 자체 엔딩 배치 결함(N3)이 있음을 기록. 삭제 판단은 유지
4. **§4.4 보강** — Remotion 동봉 ffprobe(n7.1)로 해결 가능함이 확인됨

---

## 부록 — 이번 세션에서 실행한 명령 전체

```bash
npm install                                          # exit 0
npx tsc --noEmit                                     # exit 0
npx remotion compositions src/index.ts               # exit 0
npx remotion render AIVideo out/baseline-aivideo.mp4 # exit 1 (404)
npm run render                                       # exit 1 (404)
npx remotion still AIVideo out/f0060.png --frame=60  # exit 0
npx remotion still AIVideo --frame=965               # exit 1 (404 clip_03)
npx remotion still AIVideo --frame=1071              # exit 1 (RangeError)
npx remotion still TestAI  --frame=1145              # exit 0 (검은 화면)
npx remotion still TestAI  --frame=1110              # exit 0 (검은 화면)
npx remotion still TestAI  --frame=1030              # exit 1 (404 clip_03)
npx remotion ffmpeg -version                         # n7.1
npx remotion ffprobe -version                        # n7.1
```

**실행하지 않은 것 (의도적)**: `npm run test-apis`, `npm run generate`,
그리고 ElevenLabs / Veo / Gemini Image / Runway 등 모든 유료 생성 API.

**생성된 산출물** (`out/` — `.gitignore` 대상):
`f0060.png`, `testai_f1110.png`, `testai_f1145.png` — 검증 증거로 보존.
mp4는 **하나도 생성되지 않았다.**

**소스 코드 변경**: 없음. `npm install`이 만든 `package-lock.json` 외 추가·수정 파일 없음.
