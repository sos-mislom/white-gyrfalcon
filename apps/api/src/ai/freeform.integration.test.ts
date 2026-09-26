import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "@vsm/api-contracts";
import { replaySession } from "@vsm/simulation-core";
import { MemorySessionRepository } from "../sessions/session.repository";
import { SessionsService } from "../sessions/sessions.service";
import { FreeformService } from "./freeform.service";
import { MockAiAdapter } from "./mock-ai-adapter";

async function setup(scenarioId = "boarding_no_ticket") {
  const repository = new MemorySessionRepository();
  const sessions = new SessionsService(repository);
  const model = new MockAiAdapter();
  const freeform = new FreeformService(repository, model);
  const session = await sessions.sync(randomUUID(), {
    engineVersion: ENGINE_VERSION, commands: [],
    setup: { scenarioId, difficulty: 1, mode: "training", seed: 42 },
  });
  const request = (freeformText: string) => ({
    sessionId: session.id, freeformText, clientTimestamp: "2026-09-26T00:00:00Z",
  });
  return { repository, sessions, model, freeform, session, request };
}

describe("freeform and scene engine", () => {
  it("persists both sides of the dialogue as replayable memory", async () => {
    const t = await setup();
    t.model.actorReply = "У меня есть номер заказа, но самого билета нет.";
    const first = await t.freeform.submit(t.request("Покажите, пожалуйста, ваш билет"));
    expect(first.analysis?.matchedActionId).toBe("ask_for_ticket");
    expect(first.session.dialogueSummary).toContain("Покажите");
    expect(first.session.dialogueSummary).toContain("номер заказа");
    expect(first.command.actorReply).toBe(first.actor.reply);
    expect(replaySession(first.session.id, {
      engineVersion: ENGINE_VERSION,
      setup: { scenarioId: first.session.scenarioId, mode: "training", difficulty: 1, seed: 42 },
      commands: [first.command],
    })).toEqual(first.session);
    t.model.actorReply = "Понял, без билета нельзя. Куда мне обратиться?";
    const second = await t.freeform.submit(t.request("Я не могу вас посадить без билета, пройдите в кассу №3"));
    expect(second.session.dialogueSummary).toContain("номер заказа");
    expect(t.model.lastActorState?.dialogueSummary).toContain("Покажите");
    expect(t.model.lastActorInput?.previousPassengerReply).toBe(first.actor.reply);
    expect(await t.freeform.submit(t.request("Покажите, пожалуйста, ваш билет"))).toEqual(first);
  });

  it("rejects a conductor-shaped actor line and keeps deterministic state", async () => {
    const t = await setup();
    t.model.actorReply = "Посадка без билета запрещена, пройдите в кассу №3.";
    const result = await t.freeform.submit(t.request("Покажите, пожалуйста, ваш билет"));
    expect(result.actorFallback).toBe(true);
    expect(result.actor.reply).not.toContain("пройдите в кассу");
    expect(result.session.completedActionIds).toContain("ask_for_ticket");
    expect(result.responseMode).toBe("fallback");
  });

  it("does not mutate state on ambiguous quoted threats", async () => {
    const t = await setup();
    await expect(t.freeform.submit(t.request("Пассажир сказал: «Я тебя убью»")))
      .rejects.toThrow();
    expect(await t.repository.get(t.session.id)).toEqual(t.session);
  });

  it("scores direct threats through the universal safety path", async () => {
    const t = await setup("vsm_vip_cold_coffee_01");
    const result = await t.freeform.submit(t.request("Я тебя убью, если не уйдёшь!"));
    expect(result.analysis?.matchedActionId).toBe("dismiss_passenger");
    expect(result.session.scores.safety).toBe(0);
    expect(result.session.outcome).toBe("failed");
    expect(result.actor.consequenceId).toBe("safety_threat");
  });

  it("uses scene action vectors for another passenger without boarding conditions", async () => {
    const t = await setup("vsm_vip_cold_coffee_01");
    t.model.actorReply = "Я просил заменить холодный кофе. Сможете сейчас?";
    t.model.analyze = async () => ({
      matchedActionId: "act_instant_replace_plus_gift", confidence: 0.98,
      markers: { polite: true, empathy: true, rude: false, safetyViolation: false },
      explanation: "Предложена замена",
    });
    const result = await t.freeform.submit(t.request("Извините, заменю кофе прямо сейчас"));
    expect(result.session.scenarioId).toBe("vsm_vip_cold_coffee_01");
    expect(result.session.checks.at(-1)?.actionId).toBe("act_instant_replace_plus_gift");
    expect(result.allowedConsequences[0]?.description).toContain("кофе");
  });

  it("continues a free conversation when NLU is unavailable and still advances the scene clock", async () => {
    const t = await setup("vsm_vip_cold_coffee_01");
    t.model.unavailable = true;
    const result = await t.freeform.submit(t.request("А вы часто ездите этим поездом?"));
    expect(result.analysis?.matchedActionId).toBe("converse");
    expect(result.session.currentTimeMinutes).toBe(0.5);
    expect(result.session.outcome).toBe("active");
    expect(result.session.dialogueSummary).toContain("ездите");
  });
});
