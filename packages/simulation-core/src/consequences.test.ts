import { expect, it } from "vitest";
import { allowedConsequences, applyAction, createSession } from "./index";

it("all four emotional rolls stay separate from the professional result", () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 200 && seen.size < 4; seed++) {
    let state = createSession({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
      seed,
    });
    for (const actionId of ["ask_for_ticket", "explain_rules", "offer_help"])
      state = applyAction(state, {
        actionId,
        idempotencyKey: crypto.randomUUID(),
        clientTimestamp: "2026-09-26T00:00:00Z",
      });
    const check = state.checks.at(-1)!;
    seen.add(check.outcome);
    const description = allowedConsequences(state)[0]!.description;
    const expected = {
      critical_success: "благодарен",
      success: "Ворчит",
      failure: "начальника поезда",
      critical_failure: "Кричит",
    };
    expect(description).toContain(expected[check.outcome]);
    expect(state.scores.safety).toBe(100);
    expect(state.scores.procedure).toBe(100);
    state = applyAction(state, {
      actionId: "close_conversation",
      idempotencyKey: crypto.randomUUID(),
      clientTimestamp: "2026-09-26T00:00:01Z",
    });
    expect(state.outcome).toBe("resolved");
    expect(state.checks).toHaveLength(1);
    expect(allowedConsequences(state)[0]!.description).not.toContain(
      "Эмоция d20",
    );
  }
  expect(seen.size).toBe(4);
});
