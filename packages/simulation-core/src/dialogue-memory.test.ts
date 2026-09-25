import { expect, it } from "vitest";
import {
  applyAction,
  createSession,
  dialogueMemory,
  memoryAwareReply,
  standardAnalysis,
  standardPassengerReply,
} from "./index";
import type { SessionStateDto } from "@vsm/api-contracts";
function act(state: SessionStateDto, actionId: string) {
  return applyAction(state, {
    actionId,
    idempotencyKey: crypto.randomUUID(),
    clientTimestamp: "2026-09-26T00:00:00Z",
  });
}
it("remembers rules and the offered route without resetting to the initial grievance", () => {
  let state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
    seed: 42,
  });
  state = act(act(state, "ask_for_ticket"), "explain_rules");
  expect(memoryAwareReply(state)).toContain("списание — не билет");
  state = act(state, "ask_for_ticket");
  expect(standardPassengerReply(state, "Покажите билет")).toContain(
    "списание — не билет",
  );
  state = act(state, "offer_help");
  state = act(state, "offer_help");
  expect(standardPassengerReply(state, "Обратитесь в кассу №3")).toContain(
    "Успею ли",
  );
  expect(dialogueMemory(state).helpOffered).toBe(true);
  expect(dialogueMemory(state).history).toHaveLength(5);
});
it("only closes confirmations after all required steps and cannot hide a threat in a suffix", () => {
  const completed = ["ask_for_ticket", "explain_rules", "offer_help"];
  expect(standardAnalysis("Да, всё верно", [])).toBeUndefined();
  expect(standardAnalysis("Да, всё верно", completed)?.matchedActionId).toBe(
    "close_conversation",
  );
  expect(
    standardAnalysis("Да, всё верно, я тебя убью", completed),
  ).toBeUndefined();
  let state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
  });
  for (const id of completed) state = act(state, id);
  const next = act(
    state,
    standardAnalysis("Вы всё правильно поняли", state.completedActionIds)!
      .matchedActionId,
  );
  expect(next.outcome).toBe("resolved");
  expect(next.currentTimeMinutes - state.currentTimeMinutes).toBe(0.5);
});
