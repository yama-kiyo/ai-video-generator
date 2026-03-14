# AI Video Generator with Remotion

ナレーション原稿からAI動画を自動生成するパイプライン。
**Veo 3.1** / **Runway**（映像生成）+ **ElevenLabs**（音声合成）+ **Remotion**（合成・レンダリング）

## デモ

タイトル → AI生成映像セクション（ナレーション付き）× N → エンディング の構成で自動生成します。

```
ナレーション原稿
    ├── 動画生成（選択式）
    │     --engine veo          → Veo 3.1 (T2V)
    │     --engine runway       → Runway gen4.5 (T2V)
    │     --engine runway-aleph → Runway Aleph (V2V)
    │
    └── ElevenLabs v3 → ナレーション (nar_XX.mp3)
                ↓
        Remotion で合成
                ↓
        完成動画 (MP4)
```

## 必要なもの

| サービス | 用途 | 取得先 |
|---------|------|--------|
| [Google AI Studio](https://aistudio.google.com/apikey) | Gemini / Veo 3.1（映像生成） | APIキー |
| [ElevenLabs](https://elevenlabs.io/settings/api-keys) | 音声合成（日本語対応 v3） | APIキー |
| [Runway](https://app.runwayml.com/settings/api-keys) | Gen4.5 T2V / Aleph V2V（オプション） | APIキー |
| [Node.js](https://nodejs.org/) | v18以上 | - |

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/yama-kiyo/ai-video-generator.git
cd ai-video-generator
npm install
```

### 2. APIキーを設定

```bash
cp .env.example .env
```

`.env` を開いて各APIキーを設定：

```env
GEMINI_API_KEY="your-gemini-api-key"
ELEVENLABS_API_KEY=your-elevenlabs-api-key
RUNWAY_API_KEY=your-runway-api-key          # オプション
```

### 3. API接続テスト

```bash
node scripts/test-apis.mjs
```

正常であれば以下のように表示されます：
```
=== API Connection Test ===

1. Gemini API...
   ✓ Gemini connected: OK
2. Runway API...
   ✓ Runway connected (status: 404)
3. ElevenLabs API...
   ✓ ElevenLabs connected (v3 model)

=== Done ===
```

## 使い方

### 方法1: 自動生成スクリプト（推奨）

```bash
# Veo 3.1 で生成（デフォルト）
node scripts/generate-ai-video.mjs

# Runway gen4.5 で生成 (Text-to-Video)
node scripts/generate-ai-video.mjs --engine runway

# Runway gen4.5 秒数指定（2-10秒、デフォルト5秒）
node scripts/generate-ai-video.mjs --engine runway --duration 8

# Runway Aleph で V2V（Video-to-Video）
node scripts/generate-ai-video.mjs --engine runway-aleph --v2v input.mp4

# V2V で HTTPS URL を入力に使用
node scripts/generate-ai-video.mjs --engine runway-aleph --v2v https://example.com/video.mp4

# ボイスを指定
node scripts/generate-ai-video.mjs --voice adeline

# 音声のみ生成（動画スキップ）
node scripts/generate-ai-video.mjs --skip-video

# 動画のみ生成（音声スキップ）
node scripts/generate-ai-video.mjs --skip-audio

# カスタムセクション設定を使用
node scripts/generate-ai-video.mjs --config my-sections.json
```

### 方法2: 手動ステップ

1. `public/test-ai/` に動画クリップ（`clip_01.mp4` 等）と音声（`nar_01.mp3` 等）を配置
2. `src/TestAI/TestAI.tsx` の `sections` 配列を編集
3. Remotion Studio でプレビュー → レンダリング

### Remotion Studio でプレビュー

```bash
npx remotion studio
```

ブラウザで `TestAI` コンポジションを選択。

### 動画をレンダリング

```bash
npx remotion render TestAI out/video.mp4
```

## 動画生成エンジン

| エンジン | モデル | 用途 | 料金目安 | オプション |
|---------|--------|------|---------|-----------|
| `--engine veo` | Veo 3.1 | テキスト→動画 | ~$0.20/クリップ(8秒) | デフォルト |
| `--engine runway` | gen4.5 | テキスト→動画 | $0.12/秒 | `--duration 2-10` |
| `--engine runway-aleph` | gen4_aleph | 動画→動画 (V2V) | $0.15/秒 | `--v2v <入力動画>` |

### Runway V2V (Video-to-Video) について

既存の動画をプロンプトで変換するモード。実写→アニメ風、昼→夜、天候変更などに使えます。

```bash
# ローカルファイル（自動アップロード）
node scripts/generate-ai-video.mjs --engine runway-aleph --v2v ./source.mp4

# HTTPS URL
node scripts/generate-ai-video.mjs --engine runway-aleph --v2v https://example.com/video.mp4
```

## カスタムセクション設定

`sections.json` を作成してセクションを自由に定義できます：

```json
[
  {
    "narration": "ここにナレーションテキストを入力",
    "videoPrompt": "English prompt for video generation, 4K cinematic",
    "caption": "画面に表示するキャプション"
  },
  {
    "narration": "次のセクションのナレーション",
    "videoPrompt": "Another scene description for video generation",
    "caption": "セクション2"
  }
]
```

```bash
node scripts/generate-ai-video.mjs --config sections.json
```

## ElevenLabs ボイス一覧

| キー | 名前 | 説明 |
|------|------|------|
| `aria` | Aria | デフォルト |
| `lily` | Lily | - |
| `charlotte` | Charlotte | - |
| `adeline` | Adeline | - |
| `riley` | Riley | - |
| `grandpa` | Grandpa Spuds Oxley | - |

ボイスの指定：
```bash
node scripts/generate-ai-video.mjs --voice adeline
```

## プロジェクト構成

```
├── src/
│   ├── TestAI/
│   │   └── TestAI.tsx          # AI動画コンポジション
│   ├── lib/
│   │   └── api-config.ts       # API設定（モデル・ボイス）
│   ├── Root.tsx                 # コンポジション登録
│   └── index.ts                # エントリーポイント
├── scripts/
│   ├── generate-ai-video.mjs   # 一括生成スクリプト（Veo/Runway/V2V対応）
│   └── test-apis.mjs           # API接続テスト
├── public/
│   └── test-ai/                # 生成アセット保存先
├── .env.example                # API キーのテンプレート
├── remotion.config.ts          # Remotion設定
└── package.json
```

## コンポジションの仕組み

`TestAI.tsx` の構成：

1. **タイトル** (3秒) - フェードイン/アウト
2. **ビデオセクション x N** - AI生成映像 + ナレーション + キャプション
   - セクション間は0.5秒のクロスフェード
   - 各セクションの尺はナレーション音声の長さに自動合わせ
3. **エンディング** (2.5秒) - フェードアウト

### カスタマイズポイント

- `BG`: 背景色（デフォルト: `#0A0A0A` ダークテーマ）
- `CROSSFADE`: クロスフェード長（デフォルト: 15フレーム = 0.5秒）
- `TITLE_DUR` / `END_DUR`: タイトル・エンディングの長さ

## 注意事項

- **Veo 3.1** の動画生成には1クリップあたり1〜3分かかります
- **Runway** の生成も1〜5分程度かかります（V2Vはやや長め）
- **ElevenLabs v3** は日本語対応ですが、v2は日本語非対応です
- 生成されたアセット（`.mp4`, `.mp3`）は `.gitignore` で除外されています
- Gemini APIキーに `--` などの特殊文字が含まれる場合は引用符で囲んでください

## API料金の目安

| サービス | 単位 | 料金 |
|---------|------|------|
| Veo 3.1 | 1クリップ（8秒） | 約$0.20 |
| Runway gen4.5 (T2V) | 1秒 | $0.12 |
| Runway Aleph (V2V) | 1秒 | $0.15 |
| ElevenLabs v3 | 1,000文字 | 約$0.30 |

3セクションの動画1本で約 **$1〜2** 程度です。

## ライセンス

MIT

## Remotion について

このプロジェクトは [Remotion](https://remotion.dev/) を使用しています。
商用利用の場合は [Remotionのライセンス](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md) を確認してください。
