import type { Intent } from "./corpus";

export function percentile(values: number[], q: number): number {
  if (
    !values.length ||
    q <= 0 ||
    q > 1 ||
    values.some((v) => !Number.isFinite(v))
  )
    throw new Error("invalid_measurements");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * q) - 1]!;
}

// Diagnostic thresholds are fixed before the probe run; similarity is NOT probability.
export function classify(
  vector: number[],
  anchors: { label: Intent; vector: number[] }[],
) {
  const byLabel = new Map<Intent, number>();
  for (const anchor of anchors) {
    if (anchor.vector.length !== vector.length || !vector.length)
      throw new Error("invalid_embedding");
    const score = vector.reduce(
      (sum, value, i) => sum + value * anchor.vector[i]!,
      0,
    );
    if (!Number.isFinite(score)) throw new Error("invalid_embedding");
    byLabel.set(
      anchor.label,
      Math.max(byLabel.get(anchor.label) ?? -Infinity, score),
    );
  }
  const ranked = [...byLabel].sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) throw new Error("insufficient_labels");
  const similarity = ranked[0]![1];
  const margin = similarity - ranked[1]![1];
  return {
    label: (similarity >= 0.7 && margin >= 0.08
      ? ranked[0]![0]
      : "unknown") as Intent,
    nearest: ranked[0]![0],
    similarity,
    margin,
  };
}
