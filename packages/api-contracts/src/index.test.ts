import { describe, expect, it } from "vitest";

import {
  createSessionSchema,
  submitActionSchema,
  syncSessionSchema,
  ENGINE_VERSION,
} from "./index";

describe("API contracts", () => {
  it("requires a reproducible seed and rejects client scores or duplicate command keys", () => {
    const journal = {
      engineVersion: ENGINE_VERSION,
      setup: { scenarioId: "boarding_no_ticket", seed: 42 },
      commands: [],
    };
    expect(syncSessionSchema.safeParse(journal).success).toBe(true);
    expect(
      syncSessionSchema.safeParse({ ...journal, scores: { procedure: 100 } })
        .success,
    ).toBe(false);
    expect(
      syncSessionSchema.safeParse({
        ...journal,
        setup: { scenarioId: "boarding_no_ticket" },
      }).success,
    ).toBe(false);
    const command = {
      actionId: "wait",
      idempotencyKey: crypto.randomUUID(),
      clientTimestamp: "2026-09-25T18:00:00Z",
    };
    expect(
      syncSessionSchema.safeParse({ ...journal, commands: [command, command] })
        .success,
    ).toBe(false);
  });
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

  it("does not let the caller set action duration or inject extra state", () => {
    const command = {
      idempotencyKey: crypto.randomUUID(),
      actionId: "wait",
      clientTimestamp: new Date().toISOString(),
    };
    expect(submitActionSchema.safeParse(command).success).toBe(true);
    expect(
      submitActionSchema.safeParse({ ...command, durationMinutes: 0.1 })
        .success,
    ).toBe(false);
    expect(
      createSessionSchema.safeParse({ scenarioId: "invented" }).success,
    ).toBe(false);
  });
});
