/**
 * API接続テストスクリプト
 * 使い方: node scripts/test-apis.mjs
 */
import dotenv from 'dotenv';
dotenv.config({ override: true });
import { GoogleGenAI } from '@google/genai';
import RunwayML from '@runwayml/sdk';

console.log("=== API Connection Test ===\n");

// 1. Gemini
console.log("1. Gemini API...");
try {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Reply with just: OK",
  });
  console.log("   ✓ Gemini connected:", res.text.trim());
} catch (e) {
  console.log("   ✗ Gemini failed:", e.message?.substring(0, 100));
}

// 2. Runway
console.log("2. Runway API...");
try {
  const runway = new RunwayML({ apiKey: process.env.RUNWAY_API_KEY });
  // 400 = auth OK but bad params; 401 = bad key
  await runway.tasks.retrieve("test-nonexistent");
} catch (e) {
  if (e.status === 401) {
    console.log("   ✗ Runway auth failed");
  } else {
    console.log("   ✓ Runway connected (status:", e.status, ")");
  }
}

// 3. ElevenLabs
console.log("3. ElevenLabs API...");
try {
  const res = await fetch("https://api.elevenlabs.io/v1/text-to-speech/9BWtsMINqrJLrRacOk9x", {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: "テスト",
      model_id: "eleven_v3",
      output_format: "mp3_44100_128",
    }),
  });
  if (res.ok) {
    console.log("   ✓ ElevenLabs connected (v3 model)");
  } else {
    const err = await res.json();
    console.log("   ✗ ElevenLabs:", err.detail?.message || res.status);
  }
} catch (e) {
  console.log("   ✗ ElevenLabs failed:", e.message?.substring(0, 100));
}

console.log("\n=== Done ===");
