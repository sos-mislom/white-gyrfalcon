import { describe, expect, it } from "vitest";
import { sessionStateSchema, type SubmitActionDto } from "@vsm/api-contracts";
import { applyAction, createSession } from "./index";

const input = {
  scenarioId: "boarding_no_ticket" as const,
  mode: "training" as const,
  difficulty: 1,
  seed: 42,
};
const action = (actionId: string): SubmitActionDto => ({
  idempotencyKey: crypto.randomUUID(),
  actionId,
  clientTimestamp: "2026-09-25T10:00:00Z",
});

describe("boarding scenario", () => {
  it("replays identical input deterministically without mutating the original", () => {
    const id = crypto.randomUUID();
    const first = createSession(input, id);
    const second = createSession(input, id);
    const command = action("ask_for_ticket");
    expect(applyAction(first, command)).toEqual(applyAction(second, command));
    expect(first.currentTimeMinutes).toBe(0);
    expect(first.appliedActions).toHaveLength(0);
  });

  it("completes the full help flow and validates the output DTO", () => {
    let state = createSession(input);
    for (const id of [
      "ask_for_ticket",
      "explain_rules",
      "offer_help",
      "close_conversation",
    ])
      state = applyAction(state, action(id));
    expect(state.outcome).toBe("resolved");
    expect(state.currentTimeMinutes).toBe(3.5);
    expect(state.scores.procedure).toBe(100);
    expect(state.availableActions).toEqual([]);
    expect(sessionStateSchema.safeParse(state).success).toBe(true);
    expect(() => applyAction(state, action("wait"))).toThrow(
      "session_finished",
    );
  });

  it("deduplicates commands and rejects reusing a key with another payload", () => {
    const command = action("ask_for_ticket");
    const once = applyAction(createSession(input), command);
    expect(applyAction(once, command)).toBe(once);
    expect(() => applyAction(once, { ...command, actionId: "wait" })).toThrow(
      "idempotency_conflict",
    );
    expect(() =>
      applyAction(once, {
        ...command,
        clientTimestamp: "2026-09-25T11:00:00Z",
      }),
    ).toThrow("idempotency_conflict");
  });

  it("penalizes admission without a valid ticket", () => {
    const state = applyAction(createSession(input), action("allow_boarding"));
    expect(state.outcome).toBe("failed");
    expect(state.scores.procedure).toBe(30);
    expect(state.incidents[0]?.status).toBe("failed");
  });

  it("escalates across the halfway boundary and fails at the deadline", () => {
    let state = createSession(input);
    for (let i = 0; i < 3; i++) state = applyAction(state, action("wait"));
    expect(state.incidents[0]?.phase).toBe(2);
    expect(state.incidents[0]?.timeUntilEscalationMinutes).toBe(4);
    expect(
      state.events.filter((event) => event.type === "incident_escalated"),
    ).toHaveLength(1);
    state = applyAction(applyAction(state, action("wait")), action("wait"));
    expect(state.outcome).toBe("failed");
    expect(state.currentTimeMinutes).toBe(10);
    expect(state.incidents[0]?.timeUntilEscalationMinutes).toBeNull();
    expect(state.scores.timeManagement).toBeGreaterThanOrEqual(0);
  });

  it("permits recovery after premature closing, but retains the penalty", () => {
    let state = applyAction(createSession(input), action("close_conversation"));
    for (const id of [
      "ask_for_ticket",
      "explain_rules",
      "offer_help",
      "close_conversation",
    ])
      state = applyAction(state, action(id));
    expect(state.outcome).toBe("resolved");
    expect(state.scores.procedure).toBe(80);
  });

  it("rejects unknown actions and scores wrong order", () => {
    const state = createSession(input);
    expect(() => applyAction(state, action("teleport"))).toThrow(
      "unknown_action",
    );
    expect(applyAction(state, action("explain_rules")).scores.procedure).toBe(
      80,
    );
  });

  it("does not resolve a shortcut that skips required verification", () => {
    let state = createSession(input);
    state = applyAction(state, action("explain_rules"));
    state = applyAction(state, action("offer_help"));
    state = applyAction(state, action("close_conversation"));
    expect(state.outcome).toBe("active");
    expect(state.incidents[0]?.phase).toBe(2);
  });
});
