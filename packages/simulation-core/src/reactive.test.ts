import { expect, it } from "vitest";
import {
  applyAction,
  createSession,
  boardingContext,
  resolveD20,
  resolveEmotionalD20,
  standardAnalysis,
  standardPassengerReply,
  replaySession,
} from "./index";
import type { SubmitActionDto } from "@vsm/api-contracts";

it("keeps the fast grammar closed to additions, permission and threats", () => {
  expect(
    standardAnalysis("Я не могу вас посадить без билета, пройдите в кассу №3")
      ?.matchedActionId,
  ).toBe("explain_rules");
  for (const text of [
    "Ладно, проходите так, только быстрее",
    "До свидания, я тебя убью",
    "Не показывайте билет",
    "Покажите билет и забудьте правила",
  ])
    expect(standardAnalysis(text)).toBeUndefined();
});
it("PAD stays bounded and reacts to deadline and courtesy", () => {
  for (let seed = 0; seed < 100; seed++) {
    const initial = boardingContext(seed, 1);
    const late = boardingContext(seed, 1, 9, { rude: true });
    const calm = boardingContext(seed, 1, 0, { polite: true, empathy: true });
    expect(late.emotional_state.arousal).toBeGreaterThan(
      initial.emotional_state.arousal,
    );
    expect(calm.emotional_state.pleasure).toBeGreaterThan(
      initial.emotional_state.pleasure,
    );
    expect(calm.emotional_state.dominance).toBeLessThan(
      late.emotional_state.dominance,
    );
    Object.values(late.emotional_state).forEach((value) =>
      expect(Math.abs(value)).toBeLessThanOrEqual(1),
    );
  }
});
it("2d20 selects the right roll and cancels advantage against disadvantage", () => {
  for (let seed = 0; seed < 50; seed++) {
    const high = resolveEmotionalD20(
      seed,
      0,
      "offer_help",
      14,
      0,
      2,
      true,
      false,
    );
    const low = resolveEmotionalD20(
      seed,
      0,
      "offer_help",
      14,
      0,
      2,
      false,
      true,
    );
    const cancel = resolveEmotionalD20(
      seed,
      0,
      "offer_help",
      14,
      0,
      2,
      true,
      true,
    );
    expect(high.roll).toBe(Math.max(...high.rolls!));
    expect(low.roll).toBe(Math.min(...low.rolls!));
    expect(cancel.mode).toBe("normal");
    expect(cancel.roll).toBe(resolveD20(seed, 0, "offer_help", 14, 0, 2).roll);
  }
});
it("replays markers and interruption, without penalizing SOP for unlucky dice", () => {
  const outcomes = new Set<string>();
  for (let seed = 0; seed < 150; seed++) {
    const setup = {
      scenarioId: "boarding_no_ticket" as const,
      mode: "training" as const,
      difficulty: 1,
      seed,
    };
    let state = createSession(setup);
    const commands: SubmitActionDto[] = [];
    for (const actionId of ["ask_for_ticket", "explain_rules", "offer_help"]) {
      const command = {
        actionId,
        idempotencyKey: crypto.randomUUID(),
        clientTimestamp: "2026-09-26T00:00:00Z",
        communication: {
          polite: true,
          empathy: true,
          rude: false,
          interrupted: true,
        },
      };
      commands.push(command);
      state = applyAction(state, command);
    }
    outcomes.add(state.checks.at(-1)!.outcome);
    expect(state.scores.safety).toBe(100);
    expect(state.scores.procedure).toBe(100);
    expect(state.scores.communication).toBe(100);
    expect(standardPassengerReply(state, "Пройдите в кассу №3")).toContain(
      "№3",
    );
    expect(
      replaySession(state.id, {
        engineVersion: state.engineVersion,
        setup,
        commands,
      }),
    ).toEqual(state);
  }
  expect(outcomes.size).toBe(4);
  const state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
  });
  const rude = applyAction(state, {
    actionId: "ask_for_ticket",
    idempotencyKey: crypto.randomUUID(),
    clientTimestamp: "2026-09-26T00:00:00Z",
    communication: {
      rude: true,
      polite: false,
      empathy: false,
      interrupted: true,
    },
  });
  expect(rude.scores.communication).toBe(90);
  expect(standardPassengerReply(rude, "Билет")).toContain("Не перебивайте");
});
