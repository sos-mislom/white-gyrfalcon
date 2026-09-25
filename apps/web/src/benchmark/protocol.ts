import { z } from "zod";
const intent = z.enum([
  "check_ticket",
  "explain_rule",
  "offer_help",
  "empathy",
  "hostility",
  "unsafe_permission",
  "unknown",
]);
const milliseconds = z.number().finite().nonnegative();
export const modelManifest = z
  .object({
    repository: z.literal("onnx-community/rubert-tiny-ONNX"),
    revision: z.literal("9a8d2ed31c37246d2a8d4d9f500dc1ca66563114"),
    license: z.string(),
    conversion: z.literal("extract-final-encoder-1"),
    files: z
      .array(
        z
          .object({
            name: z.string(),
            bytes: z.number().int().positive(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .length(6),
  })
  .strict();
export const benchmarkReport = z
  .object({
    candidate: z.literal("rubert-tiny-q8-cls-nearest-prototype"),
    runtime: z.literal("transformers.js 4.3.0 / wasm / 1 thread"),
    corpus: z.literal("synthetic-diagnostic-1"),
    maxTokens: z.literal(128),
    manifest: modelManifest,
    loadMs: milliseconds,
    firstInferenceMs: milliseconds,
    p50Ms: milliseconds,
    p95Ms: milliseconds,
    correct: z.number().int().min(0).max(12),
    total: z.literal(12),
    peakMemoryBytes: z.null(),
    memoryNote: z.string(),
    qualificationScoring: z.literal(false),
    rows: z
      .array(
        z
          .object({
            id: z.string(),
            expected: intent,
            label: intent,
            nearest: intent,
            similarity: z.number().finite(),
            margin: z.number().finite(),
            timings: z.array(milliseconds).length(3),
          })
          .strict(),
      )
      .length(12),
  })
  .strict();
export const workerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("progress"), message: z.string() }).strict(),
  z.object({ type: z.literal("error"), message: z.string() }).strict(),
  z
    .object({
      type: z.literal("complete"),
      report: benchmarkReport,
    })
    .strict(),
]);
