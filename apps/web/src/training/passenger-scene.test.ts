import { expect, it } from "vitest";
import { createSession, applyAction } from "@vsm/simulation-core";
import { passengerExpression } from "./passenger-scene";
it("selects stress, refusal, failure and resolution portraits from engine state", () => {
  const state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
  });
  expect(passengerExpression(state)).toBe("stressed");
  const refuse = applyAction(state, {
    actionId: "explain_rules",
    idempotencyKey: crypto.randomUUID(),
    clientTimestamp: "2026-09-26T00:00:00Z",
  });
  expect(passengerExpression(refuse)).toBe("angry");
  expect(passengerExpression({ ...state, outcome: "failed" })).toBe("angry");
  expect(passengerExpression({ ...state, outcome: "resolved" })).toBe(
    "grateful",
  );
});
