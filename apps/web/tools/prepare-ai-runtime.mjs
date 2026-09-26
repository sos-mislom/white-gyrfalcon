import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const target = new URL("../public/ai-runtime/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jspi.mjs",
  "ort-wasm-simd-threaded.jspi.wasm",
]) {
  await copyFile(
    new URL(`../../../node_modules/onnxruntime-web/dist/${name}`, import.meta.url),
    new URL(name, target),
  );
}
console.log("Local ONNX browser runtime prepared (no CDN).");
const voiceTarget = new URL(
  "../public/voice-runtime/",
  import.meta.url,
);
await mkdir(voiceTarget, { recursive: true });
const require = createRequire(import.meta.url);
const vadDir = dirname(require.resolve("@ricky0123/vad-web"));
const vadRequire = createRequire(join(vadDir, "index.js"));
const ortDir = dirname(vadRequire.resolve("onnxruntime-web/wasm"));
for (const name of ["silero_vad_v5.onnx", "vad.worklet.bundle.min.js"]) {
  await copyFile(join(vadDir, name), new URL(name, voiceTarget));
}
for (const name of ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  await copyFile(join(ortDir, name), new URL(name, voiceTarget));
}
console.log("Local Silero VAD and its WASM runtime prepared (no CDN).");
