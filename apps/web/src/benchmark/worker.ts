import { pipeline, env } from "@huggingface/transformers";
import { prototypes, probes, type Intent } from "./corpus";
import { classify, percentile } from "./scoring";
import { modelManifest } from "./protocol";

let running = false;
const progress = (message: string) =>
  self.postMessage({ type: "progress", message });
self.addEventListener("message", async (event: MessageEvent<unknown>) => {
  if (event.data !== "run" || running) return;
  running = true;
  try {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = "/models/";
    env.backends.onnx.wasm!.numThreads = 1;
    env.backends.onnx.wasm!.wasmPaths = "/ai-runtime/";
    progress("Загрузка локального RuBERT-tiny q8 и WebAssembly…");
    const manifestResponse = await fetch(
      "/models/rubert-tiny-encoder/manifest.json",
    );
    if (!manifestResponse.ok) throw new Error("model_not_prepared");
    const manifest = modelManifest.parse(await manifestResponse.json());
    const loadStart = performance.now();
    const extractor = await pipeline(
      "feature-extraction",
      "rubert-tiny-encoder",
      {
        device: "wasm",
        dtype: "q8",
      },
    );
    const loadMs = performance.now() - loadStart;
    try {
      const embed = async (text: string) => {
        const inputs = extractor.tokenizer(text, {
          padding: true,
          truncation: true,
          max_length: 128,
        });
        const outputs = await extractor.model(inputs);
        if (!outputs.last_hidden_state)
          throw new Error("encoder_hidden_state_missing");
        const output = outputs.last_hidden_state
          .slice(null, 0)
          .normalize(2, -1);
        return Array.from(output.data, Number);
      };
      const firstStart = performance.now();
      await embed("Проверка первого запуска модели.");
      const firstInferenceMs = performance.now() - firstStart;
      const anchors: { label: Intent; vector: number[] }[] = [];
      for (const item of prototypes)
        anchors.push({ label: item.label, vector: await embed(item.text) });
      const rows = [];
      for (const probe of probes) {
        progress(`Русский текст: ${rows.length + 1}/${probes.length}`);
        const timings = [];
        let prediction;
        for (let repetition = 0; repetition < 3; repetition++) {
          const start = performance.now();
          prediction = classify(await embed(probe.text), anchors);
          timings.push(performance.now() - start);
        }
        rows.push({
          id: probe.id,
          expected: probe.expected,
          ...prediction!,
          timings,
        });
      }
      const timings = rows.flatMap((row) => row.timings);
      self.postMessage({
        type: "complete",
        report: {
          candidate: "rubert-tiny-q8-cls-nearest-prototype",
          runtime: "transformers.js 4.3.0 / wasm / 1 thread",
          corpus: "synthetic-diagnostic-1",
          maxTokens: 128,
          manifest,
          loadMs,
          firstInferenceMs,
          p50Ms: percentile(timings, 0.5),
          p95Ms: percentile(timings, 0.95),
          correct: rows.filter((row) => row.label === row.expected).length,
          total: rows.length,
          peakMemoryBytes: null,
          memoryNote:
            "Не измерено. JS heap не равен памяти WASM и браузерного процесса.",
          qualificationScoring: false,
          rows,
        },
      });
    } finally {
      await extractor.dispose();
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "benchmark_failed",
    });
  } finally {
    running = false;
  }
});
