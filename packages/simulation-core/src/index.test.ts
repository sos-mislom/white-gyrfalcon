import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { applyAction, createSession } from "./index";

describe("simulation core", () => {
  it("advances time and escalates an overdue incident", () => {
    const initial = createSession({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
      seed: 42,
    });

    const next = applyAction(initial, {
      idempotencyKey: randomUUID(),
      actionId: "check_ticket",
      kind: "standard",
      durationMinutes: 4,
      clientTimestamp: new Date().toISOString(),
    });

    expect(next.currentTimeMinutes).toBe(4);
    expect(next.incidents[0]?.phase).toBe(2);
    expect(next.events.at(-1)?.type).toBe("incident_escalated");
  });

  it("does not apply the same command twice", () => {
    const initial = createSession({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
      seed: 42,
    });
    const action = {
      idempotencyKey: randomUUID(),
      actionId: "ask_question",
      kind: "dialogue" as const,
      durationMinutes: 1,
      clientTimestamp: new Date().toISOString(),
    };

    const once = applyAction(initial, action);
    const twice = applyAction(once, action);

    expect(twice).toBe(once);
    expect(twice.currentTimeMinutes).toBe(1);
  });
});
