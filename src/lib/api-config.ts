/**
 * API設定・ボイス設定
 * 各種APIのキーは .env から読み込み
 */

// ── ElevenLabs ──────────────────────────────────────────
export const ELEVENLABS = {
  apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  model: "eleven_v3", // 日本語はv3必須
  outputFormat: "mp3_44100_128" as const,

  // 利用可能ボイス（全て v3 で使用）
  voices: {
    aria:      { id: "9BWtsMINqrJLrRacOk9x", name: "Aria",      gender: "female" },
    lily:      { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily",      gender: "female" },
    charlotte: { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte", gender: "female" },
    voice_5l5f:{ id: "5l5f8iK3YPeGga21rQIX", name: "Voice A",   gender: "female" },
    voice_hA4z:{ id: "hA4zGnmTwX2NQiTRMt7o", name: "Voice B",   gender: "female" },
    voice_NOp: { id: "NOpBlnGInO9m6vDvFkFC", name: "Voice C",   gender: "female" },
  },

  // デフォルトボイス
  defaultVoice: "aria",
};

// ── Google Gemini (Veo 3.1 / Imagen 4) ─────────────────
export const GEMINI = {
  apiKey: process.env.GEMINI_API_KEY ?? "",
  models: {
    text: "gemini-2.5-flash",
    video: "veo-3.1",         // 動画生成
    videoFast: "veo-3.1-fast", // 動画生成（高速・低コスト）
    image: "imagen-4-fast",    // 画像生成
  },
};

// ── Runway (Gen-4) ──────────────────────────────────────
export const RUNWAY = {
  apiKey: process.env.RUNWAY_API_KEY ?? "",
  models: {
    turbo: "gen4_turbo",     // 高速（$0.05/秒）
    standard: "gen4.5",       // 高品質（$0.12/秒）
    aleph: "gen4_aleph",      // 最高品質（$0.15/秒）
  },
  defaultRatio: "1280:720" as const,
  defaultDuration: 5,
};
