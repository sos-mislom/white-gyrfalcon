import { describe, expect, it } from "vitest";

import { createSessionSchema, submitActionSchema } from "./index";

describe("API contracts", () => {
  it("fills safe defaults for a new training session", () => {
    const result = createSessionSchema.parse({
      scenarioId: "boarding_no_ticket",
    });

    expect(result).toEqual({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
    });
  });

  it("rejects an action without an idempotency key", () => {
    const result = submitActionSchema.safeParse({
      actionId: "ask_for_ticket",
      kind: "dialogue",
      durationMinutes: 1,
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });
});
