import { expect, it } from "vitest";
import { allowedConsequences, applyAction, createSession } from "@vsm/simulation-core";
import { buildActorContext } from "./actor-context";

it("remembers an early personal detail and speaks as the currently selected actor", () => {
  let state = createSession({ scenarioId: "vsm_biz_noisy_kids_01", mode: "training", difficulty: 1, seed: 42 });
  const turns = [
    ["Я еду к внучке в Петербург.", "Надеюсь, скоро станет тише."],
    ["Понимаю вашу усталость.", "Спасибо, я почти не спала."],
    ["Я сначала поговорю с мамой.", "Хорошо, поговорите."],
    ["Подскажите, как малыш себя чувствует?", "Он устал в дороге."],
    ["Возможно, поможет сменить обстановку.", "Давайте попробуем."],
  ];
  for (const [utterance, actorReply] of turns) state = applyAction(state, {
    actionId: "converse", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z",
    utterance, actorReply, actorId: state.currentActorId,
  });
  state = applyAction(state, {
    actionId: "focus:char_mother_with_child", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z",
  });
  state = applyAction(state, {
    actionId: "converse", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z",
    utterance: "Как вам помочь сейчас?", actorId: state.currentActorId,
  });
  const context = buildActorContext(state, allowedConsequences(state)[0]!, {
    employee_speech: "Как вам помочь сейчас?",
    markers: { polite: true, empathy: true, rude: false, safetyViolation: false },
  });
  expect(context).toContain("Ты — Мария, Мать плачущего ребёнка");
  expect(context).toContain("Я еду к внучке в Петербург");
  expect(context).toContain("Как вам помочь сейчас?");
  expect(context).not.toContain("Ты — Тамара Павловна");
});
