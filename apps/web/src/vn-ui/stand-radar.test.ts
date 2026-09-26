import { expect, it } from "vitest";
import { applyAction, createSession } from "@vsm/simulation-core";
import { standAxes, standOverall } from "./stand-radar";

const setup = { scenarioId: "boarding_no_ticket", mode: "training" as const, difficulty: 1, seed: 42 };
const act = (actionId: string) => ({ actionId, idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z" });

it("gives no credit for a shift spent only waiting", () => {
  let state = createSession(setup);
  while (state.outcome === "active") state = applyAction(state, act("wait"));
  expect(state.outcome).toBe("failed");
  expect(standAxes(state).map((axis) => axis.value)).toEqual([0, 0, 0, 0, 0, 0]);
  expect(standOverall(state)).toBe(0);
});

it("awards earned progress for the scene's actual solution path", () => {
  let state = createSession(setup);
  const start = standOverall(state);
  state = applyAction(state, act("ask_for_ticket"));
  const partial = standOverall(state);
  for (const id of ["explain_rules", "offer_help", "close_conversation"]) state = applyAction(state, act(id));
  expect(state.outcome).toBe("resolved");
  expect(start).toBe(0);
  expect(partial).toBeGreaterThan(start);
  expect(standOverall(state)).toBeGreaterThan(partial);
});
