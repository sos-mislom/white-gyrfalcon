import { describe, expect, it } from "vitest";
import { classify, percentile } from "./scoring";
describe("benchmark diagnostics", () => {
  it("uses nearest-rank percentiles without mutating measurements", () => {
    const input = [5, 1, 3, 2, 4];
    expect(percentile(input, 0.5)).toBe(3);
    expect(percentile(input, 0.95)).toBe(5);
    expect(input).toEqual([5, 1, 3, 2, 4]);
    expect(() => percentile([], 0.5)).toThrow();
  });
  it("abstains on similar classes and rejects malformed embeddings", () => {
    const anchors = [
      { label: "empathy" as const, vector: [1, 0] },
      { label: "hostility" as const, vector: [0, 1] },
    ];
    expect(classify([1, 0], anchors).label).toBe("empathy");
    expect(classify([0.71, 0.71], anchors).label).toBe("unknown");
    expect(() => classify([NaN, 0], anchors)).toThrow();
    expect(() => classify([1], anchors)).toThrow();
  });
});
