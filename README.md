# AI Video Generator with Remotion

写真・AI映像・ナレーションを自由に組み合わせて動画を自動生成するパイプライン。
**Veo 3.1** / **Runway**（映像生成）+ **ElevenLabs**（音声合成）+ **Remotion**（合成・レンダリング）

## 4つのモード

セクションごとに素材を自由に組み合わせ可能：

| モード | 映像 | テキスト | 用途 |
|--------|------|---------|------|
| 写真スライドショー | 写真（Ken Burns効果付き） | キャプション | 施工記録、紹介動画 |
| AI動画 | Veo 3.1 / Runway 生成 | キャプション | プロモーション、イメージ映像 |
| I2V混在 | 写真 + Runway i2v動画 | 字幕 | ドキュメンタリー、解説動画 |
| 混在 | セクションごとに切替 | セクションごとに切替 | 柔軟な構成 |

### テキスト表示モード

| モード | `textMode` | 内容 |
|--------|-----------|------|
| キャプション | `"caption"`（デフォルト） | セクションごとに短い説明文を下部に固定表示 |
| 字幕 | `"subtitle"` | ナレーション原稿を句読点で区切り、音声に同期して一文ずつ表示 |

### 映像モード

| モード | `mediaMode` | 内容 |
|--------|-----------|------|
| 写真 | `"photo"`（デフォルト） | 全て写真スライドショー（Ken Burns効果） |
| 部分I2V | `"i2v"` | 一部写真をRunway gen4_turboで動画化して混在 |

```
project.json（プロジェクト定義）
  ↓
各セクションの素材タイプに応じて自動判定
  ├── video: "..."       → 単一動画再生 (OffthreadVideo)
  ├── media: [...]       → 写真+動画混在 (MediaSection)
  ├── photos: [...]      → 写真スライドショー (Img + Ken Burns)
  ├── narration: "..."   → 字幕表示 (SubtitleOverlay)
  └── audio: "..."       → ナレーション再生 (Audio)
          ↓
    Remotion で合成 → 完成動画 (MP4)
```

## 必要なもの

| サービス | 用途 | 必須? |
|---------|------|-------|
| [Node.js](https://nodejs.org/) v18以上 | 実行環境 | 必須 |
| [Google AI Studio](https://aistudio.google.com/apikey) | Veo 3.1 映像生成 / Imagen 4 画像生成 | AI動画・画像を使う場合 |
| [ElevenLabs](https://elevenlabs.io/settings/api-keys) | 音声合成（日本語v3） | ナレーション自動生成する場合 |
| [Runway](https://app.runwayml.com/settings/api-keys) | Gen4.5 / Aleph V2V / gen4_turbo I2V | Runwayを使う場合 |

**写真スライドショーだけなら API キー不要**で動画を作成できます。

## セットアップ

```bash
git clone https://github.com/yama-kiyo/ai-video-generator.git
cd ai-video-generator
npm install
cp .env.example .env   # APIキーを設定（AI機能を使う場合）
```

## クイックスタート

### 写真スライドショー（APIキー不要）

1. `public/` に写真を配置
2. `project.json` を作成（後述）
3. `src/Root.tsx` のプロジェクト定義を更新
4. `npx remotion studio` でプレビュー
5. `npx remotion render AIVideo out/video.mp4`

### AI動画 + ナレーション

```bash
# API接続テスト
node scripts/test-apis.mjs

# AI映像 + ナレーション一括生成
node scripts/generate-ai-video.mjs

# プレビュー → レンダリング
npx remotion studio
npx remotion render AIVideo out/video.mp4
```

### I2V + 字幕モード（ドキュメンタリー向け）

```bash
# 1. 画像生成（Imagen 4）
node scripts/generate-images.mjs

# 2. ナレーション生成（ElevenLabs）
node scripts/generate-narration.mjs --voice grandpa

# 3. I2V生成（Runway gen4_turbo — インパクトのあるカットのみ）
node scripts/generate-i2v.mjs

# 4. project.json で textMode: "subtitle", mediaMode: "i2v" を設定
npx remotion studio
npx remotion render AIVideo out/documentary.mp4
```

## project.json — プロジェクト定義

動画全体の構成を1つのJSONで定義します。

```json
{
  "title": "動画タイトル",
  "subtitle": "サブタイトル",
  "organization": "組織名",
  "theme": "dark",
  "endingText": "つづく",
  "textMode": "subtitle",
  "mediaMode": "i2v",
  "sections": [
    {
      "caption": "HOOK",
      "media": [
        { "type": "video", "src": "project/v01.mp4" },
        { "type": "photo", "src": "project/s01_02.png" },
        { "type": "photo", "src": "project/s01_03.png" }
      ],
      "audio": "project/nar_01.mp3",
      "narration": "ナレーション原稿全文をここに入力。句読点で自動分割される。",
      "durSec": 47.7
    },
    {
      "caption": "写真セクション",
      "photos": ["project/001.jpg", "project/002.jpg"],
      "audio": "project/nar_02.mp3",
      "durSec": 10.0
    },
    {
      "caption": "動画セクション",
      "video": "project/clip_01.mp4",
      "audio": "project/nar_03.mp3",
      "narration": "動画セクションでも字幕表示可能。",
      "durSec": 10.4
    }
  ]
}
```

### プロジェクト設定

| フィールド | 型 | デフォルト | 説明 |
|-----------|-----|----------|------|
| `title` | string | — | 動画タイトル（必須） |
| `subtitle` | string | — | サブタイトル |
| `organization` | string | — | 組織名 |
| `theme` | `"dark"` \| `"light"` | `"dark"` | 色テーマ |
| `textMode` | `"caption"` \| `"subtitle"` | `"caption"` | テキスト表示モード |
| `mediaMode` | `"photo"` \| `"i2v"` | `"photo"` | 映像モード |
| `endingText` | string | `"つづく"` | エンディングテキスト |

### セクション定義

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `caption` | string | キャプション表示テキスト（必須） |
| `photos` | string[] | 写真パス配列（`public/` 相対） |
| `video` | string | 単一動画パス（最優先） |
| `media` | MediaItem[] | 写真+動画混在配列（`{ type, src }`） |
| `audio` | string | ナレーション音声パス |
| `narration` | string | ナレーション原稿（字幕モード用） |
| `durSec` | number | セクション尺（秒）— ナレーション音声の実尺に合わせる |

**素材の優先順位**: `video` > `media` > `photos`

### テーマ

| テーマ | 背景 | 文字色 | 向いている用途 |
|--------|------|--------|-------------|
| `dark` | 黒 (#0A0A0A) | 白 | AI動画、プロモーション、ドキュメンタリー |
| `light` | アイボリー (#F5F3EF) | 黒 | 写真スライドショー、報告書 |

### 尺の決め方ガイド

| 素材 | 推奨 `durSec` |
|------|--------------|
| ナレーションあり | ナレーション音声の長さに合わせる |
| 写真のみ | 写真枚数 x 5秒 |
| AI動画（ナレなし） | 動画クリップの長さ（8-10秒） |

**重要**: 音声を先に配置し尺を決め、映像をそれに合わせる。ナレーションは絶対にカットしない。

## AI映像・ナレーション生成

### 生成スクリプト

```bash
# Veo 3.1 で生成（デフォルト）
node scripts/generate-ai-video.mjs

# Runway gen4.5 で生成
node scripts/generate-ai-video.mjs --engine runway --duration 8

# Runway Aleph V2V（既存動画をスタイル変換）
node scripts/generate-ai-video.mjs --engine runway-aleph --v2v input.mp4

# ボイス・スキップ指定
node scripts/generate-ai-video.mjs --voice adeline --skip-video   # ナレーションのみ
node scripts/generate-ai-video.mjs --skip-audio                    # 動画のみ

# カスタムセクション設定
node scripts/generate-ai-video.mjs --config sections.json
```

### 動画生成エンジン

| エンジン | モデル | 用途 | 料金目安 |
|---------|--------|------|---------|
| `--engine veo` | Veo 3.1 | テキスト→動画 | ~$0.20/クリップ(8秒) |
| `--engine runway` | gen4.5 | テキスト→動画 | $0.12/秒 (2-10秒) |
| `--engine runway-aleph` | gen4_aleph | 動画→動画 V2V | $0.15/秒 |
| Runway gen4_turbo | I2V | 画像→動画（部分I2V用） | $0.10/秒 (5秒) |

### ElevenLabs ボイス（v3モデル・日本語対応）

| キー | 名前 |
|------|------|
| `aria` | Aria（デフォルト） |
| `adeline` | Adeline |
| `riley` | Riley |
| `grandpa` | Grandpa Spuds Oxley |
| `lily` | Lily |
| `charlotte` | Charlotte |

## Claude Code との連携

[Claude Code](https://claude.ai/claude-code) のスキルとして使えます。
`ai-video` と入力すると対話形式で以下をヒアリングし、自動で動画を生成します：

1. 動画のタイトル・内容
2. 素材の種類（写真 / AI生成 / 混在）
3. ナレーションの有無（自動生成 / 手動 / なし）
4. **テキスト表示モード（キャプション / 字幕）**
5. **映像モード（写真スライドショー / 部分I2V）**
6. テーマ（ダーク / ライト）

## プロジェクト構成

```
├── src/
│   ├── AIVideo/
│   │   └── AIVideo.tsx          # 統合コンポジション（写真/動画/字幕/キャプション自動切替）
│   ├── TestAI/
│   │   └── TestAI.tsx           # AI動画専用コンポジション（旧）
│   ├── lib/
│   │   └── api-config.ts        # API設定（モデル・ボイス）
│   ├── Root.tsx                  # コンポジション登録
│   └── index.ts                  # エントリーポイント
├── scripts/
│   ├── generate-ai-video.mjs    # AI映像+ナレーション一括生成
│   └── test-apis.mjs            # API接続テスト
├── public/                       # 素材・生成アセット保存先
├── .env.example                  # APIキーテンプレート
├── project.example.json          # プロジェクト定義サンプル
├── sections.example.json         # AI生成用セクション定義サンプル
├── remotion.config.ts
└── package.json
```

## ナレーション間隔について

**原則: 音声を先に配置し尺を決め、映像をそれに合わせる。**

セクションの尺は `ナレーション実尺 + 頭1秒 + 尻1秒` で計算されます。
ナレーションは絶対にカットされず、フル再生されます。

```tsx
const NAR_PAD = 30; // 1秒 @30fps
const narFrames = sections.map((s) => Math.ceil(s.durSec * FPS));
const sectionFrames = narFrames.map((nf) => nf + NAR_PAD * 2);

// ナレーション: 頭1秒後に開始、実尺分フル再生
<Sequence from={sectionStarts[i] + NAR_PAD} durationInFrames={narFrames[i]}>
  <Audio src={staticFile(sec.audio)} volume={1} />
</Sequence>
```

## 注意事項

- Veo 3.1 の動画生成には1クリップあたり1〜3分かかります
- Runway の生成も1〜5分程度かかります
- ElevenLabs v3 は日本語対応ですが、v2は非対応です
- 生成アセット（.mp4, .mp3）は `.gitignore` で除外されています
- 写真スライドショーだけなら APIキー不要で利用可能です
- Runway I2V の `uploads.createEphemeral()` は `uri`（`url` ではない）を返します
- Runway の `tasks.waitForTaskOutput()` は使えないため、`tasks.retrieve()` でポーリングしてください

## ライセンス

MIT

## Remotion について

このプロジェクトは [Remotion](https://remotion.dev/) を使用しています。
商用利用の場合は [Remotionのライセンス](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) を確認してください。
