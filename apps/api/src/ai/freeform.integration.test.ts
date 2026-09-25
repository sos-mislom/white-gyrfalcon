import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemorySessionRepository } from "../sessions/session.repository";
import { SessionsService } from "../sessions/sessions.service";
import { FreeformService } from "./freeform.service";
import { MockAiAdapter } from "./mock-ai-adapter";
import { replaySession } from "@vsm/simulation-core";

async function setup(
  engineVersion: "boarding-3" | "boarding-4" = "boarding-3",
) {
  const repository = new MemorySessionRepository();
  const sessions = new SessionsService(repository);
  const model = new MockAiAdapter();
  const freeform = new FreeformService(repository, model);
  const session = await sessions.sync(randomUUID(), {
    engineVersion,
    commands: [],
    setup: {
      scenarioId: "boarding_no_ticket",
      difficulty: 1,
      mode: "training",
      seed: 42,
    },
  });
  const request = (freeformText: string) => ({
    sessionId: session.id,
    freeformText,
    clientTimestamp: "2026-09-26T00:00:00Z",
  });
  return { repository, sessions, model, freeform, session, request };
}

describe("boarding freeform → NLU → core → allowed actor → persisted result", () => {
  it("boarding-4 fast path completes a dialogue with no model even during an outage", async () => {
    const t = await setup("boarding-4");
    t.model.unavailable = true;
    t.model.actorUnavailable = true;
    for (const text of [
      "Покажите, пожалуйста, ваш билет",
      "Я не могу вас посадить без билета, пройдите в кассу №3",
      "Обратитесь в кассу №3",
      "Всего доброго, до свидания",
    ]) {
      const input = t.request(text);
      const result = await t.freeform.submit(input);
      expect(result.responseMode).toBe("pool");
      expect(result.actorFallback).toBe(false);
      expect(await t.freeform.submit(input)).toEqual(result);
      if (text.includes("кассу")) expect(result.actor.reply).toContain("№3");
    }
    expect(t.model.calls).toBe(0);
    expect(t.model.lastActorInput).toBeUndefined();
    expect((await t.sessions.getById(t.session.id)).outcome).toBe("resolved");
  });
  it("closes a completed case with farewell alone, without an NLU round trip", async () => {
    const t = await setup();
    for (const actionId of ["ask_for_ticket", "explain_rules", "offer_help"])
      await t.sessions.applyAction(t.session.id, {
        actionId,
        idempotencyKey: randomUUID(),
        clientTimestamp: "2026-09-26T00:00:00Z",
      });
    const result = await t.freeform.submit(
      t.request("Всего доброго, до свидания"),
    );
    expect(result.analysis?.matchedActionId).toBe("close_conversation");
    expect(result.session.outcome).toBe("resolved");
    expect(result.responseMode).toBeUndefined(); // Existing boarding-3 clients use a strict DTO.
    expect(t.model.calls).toBe(0);
    expect(t.model.lastActorInput?.employee_speech).toBe(
      "Всего доброго, до свидания",
    );
    expect(t.model.lastActorState?.checks).toEqual(result.session.checks);
  });
  it("resolves direct threats in the engine and replays the exact safety penalty", async () => {
    const t = await setup();
    const input = t.request("Я тебя убью, если не уйдёшь!");
    const result = await t.freeform.submit(input);
    expect(result.analysis?.matchedActionId).toBe("dismiss_passenger");
    expect(result.analysis?.markers.safetyViolation).toBe(true);
    expect(result.analysis?.explanation).toContain("ст. 119 УК РФ");
    expect(result.analysis?.explanation).toContain("ст. 20.1 КоАП РФ");
    expect(result.actor.consequenceId).toBe("police_custody");
    expect(result.session.scores.safety).toBe(0);
    expect(result.session.outcome).toBe("failed");
    expect(await t.freeform.submit(input)).toEqual(result);
    expect(
      replaySession(t.session.id, {
        engineVersion: result.session.engineVersion,
        setup: {
          scenarioId: "boarding_no_ticket",
          mode: "training",
          difficulty: 1,
          seed: 42,
        },
        commands: [result.command],
      }),
    ).toEqual(result.session);
    expect(t.model.calls).toBe(0);
  });
  it("ambiguous quoted threats never reach model scoring and premature farewells do not resolve", async () => {
    const t = await setup();
    await expect(
      t.freeform.submit(t.request("Пассажир сказал: «Я тебя убью»")),
    ).rejects.toThrow();
    expect(await t.repository.get(t.session.id)).toEqual(t.session);
    const result = await t.freeform.submit(t.request("До свидания"));
    expect(result.session.outcome).toBe("active");
    expect(result.session.scores.safety).toBe(100);
  });
  it("does not turn granted boarding permission into a passenger refusal", async () => {
    const t = await setup();
    t.model.actorReply = "Я не смог пройти посадку";
    const result = await t.freeform.submit(
      t.request("Ладно, проходите так, только быстрее"),
    );
    expect(result.actorFallback).toBe(true);
    expect(result.actor.consequenceId).toBe("boarding_permission_granted");
    expect(result.actor.reply).toBe(result.session.passengerReply);
  });
  it("distinguishes the required negative and permissive phrases", async () => {
    const safe = await setup();
    await safe.sessions.applyAction(safe.session.id, {
      idempotencyKey: randomUUID(),
      actionId: "ask_for_ticket",
      clientTimestamp: "2026-09-25T23:59:00Z",
    });
    const good = await safe.freeform.submit(
      safe.request("Я не могу вас посадить без билета, пройдите в кассу №3"),
      1,
    );
    expect(good.analysis?.matchedActionId).toBe("explain_rules");
    expect(good.analysis?.markers.empathy).toBe(true);
    expect(good.session.scores.procedure).toBe(100);
    expect(good.session.scores.safety).toBe(100);
    expect(safe.model.lastAllowed).toEqual(good.allowedConsequences);
    const unsafe = await setup();
    const bad = await unsafe.freeform.submit(
      unsafe.request("Ладно, проходите так, только быстрее"),
      0,
    );
    expect(bad.analysis?.matchedActionId).toBe("allow_boarding");
    expect(bad.session.scores.safety).toBe(30);
    expect(bad.session.outcome).toBe("failed");
  });

  it("retries do not rerun NLU or advance time, and replay needs no model", async () => {
    const t = await setup();
    const input = t.request("Покажите, пожалуйста, ваш билет");
    const first = await t.freeform.submit(input, 0);
    expect(await t.freeform.submit(input, 0)).toEqual(first);
    expect(t.model.calls).toBe(1);
    expect(
      replaySession(t.session.id, {
        engineVersion: first.session.engineVersion,
        setup: {
          scenarioId: "boarding_no_ticket",
          difficulty: 1,
          mode: "training",
          seed: 42,
        },
        commands: [first.command],
      }),
    ).toEqual(first.session);
  });

  it("NLU outage leaves state unchanged and explicit actions still work", async () => {
    const t = await setup();
    t.model.unavailable = true;
    await expect(
      t.freeform.submit(t.request("Я не разрешаю посадку без билета")),
    ).rejects.toThrow();
    expect(await t.repository.get(t.session.id)).toEqual(t.session);
    const explicit = await t.sessions.applyAction(t.session.id, {
      idempotencyKey: randomUUID(),
      actionId: "ask_for_ticket",
      clientTimestamp: "2026-09-26T00:00:00Z",
    });
    expect(explicit.currentTimeMinutes).toBe(1);
  });

  it("an invalid actor consequence falls back without rewriting the engine", async () => {
    const t = await setup();
    t.model.actorConsequence = "invented_resolution";
    const result = await t.freeform.submit(
      t.request("Я не разрешаю посадку без билета"),
    );
    expect(result.actorFallback).toBe(true);
    expect(result.actor.reply).toBe(result.session.passengerReply);
    expect(result.session.outcome).toBe("active");
  });

  it("completes the full dialogue and rejects uncertain input without a penalty", async () => {
    const t = await setup();
    await expect(t.freeform.submit(t.request("???"))).rejects.toThrow();
    expect((await t.repository.get(t.session.id))?.currentTimeMinutes).toBe(0);
    for (const text of [
      "Покажите, пожалуйста, ваш билет",
      "Я не разрешаю посадку без билета",
      "Обратитесь в официальный контактный центр",
      "Вам всё понятно? Благодарю за понимание",
    ])
      await t.freeform.submit(t.request(text));
    expect((await t.repository.get(t.session.id))?.outcome).toBe("resolved");
  });
});
