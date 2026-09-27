import { expect, it } from "vitest";
import { applyAction, createSession } from "@vsm/simulation-core";
import { actorDraftCanSurface, actorIsGrounded } from "./actor-grounding";

const setup = { scenarioId: "boarding_no_ticket", mode: "training" as const, difficulty: 1, seed: 42 };
const command = (actionId: string) => ({ actionId, idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-27T00:00:00Z" });

it("rejects a passenger's claim that an unresolved or prohibited action finished the scene", () => {
  const active = applyAction(createSession(setup), command("ask_for_ticket"));
  const failed = applyAction(createSession(setup), command("allow_boarding"));
  const settled = { consequenceId: "continue", reply: "Спасибо, теперь всё в порядке, вопрос решён." };
  expect(actorIsGrounded(active, settled, "Покажите билет")).toBe(false);
  expect(actorIsGrounded(failed, { ...settled, consequenceId: "failed" }, "Проходите без билета")).toBe(false);
  expect(actorDraftCanSurface(active, settled.reply)).toBe(false);
  expect(actorIsGrounded(active,
    { consequenceId: "continue", reply: "Спасибо, что проверите заказ. Я подожду результата." },
    "Покажите билет")).toBe(true);
});
