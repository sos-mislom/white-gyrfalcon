import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  allowedConsequences,
  SCENE_SOURCE,
  replaySession,
} from "@vsm/simulation-core";
import { TrainingStore } from "./training-store";
import { loadActive } from "./journal-storage";

beforeEach(async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("vsm-training");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("freeform client journal", () => {
  it("freezes game time during 15 seconds of inference, ignores double submit, then charges one action", async () => {
    const store = new TrainingStore();
    await store.initialize();
    await store.start();
    const before = store.getSnapshot().session!;
    let finish!: (response: Response) => void;
    const delayed = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    let waiting = false;
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.endsWith("/sync")) return Response.json(before);
      waiting = true;
      return delayed;
    });
    const pending = store.freeform("Можно уточнить ваш номер заказа?");
    await vi.waitFor(() => expect(waiting).toBe(true));
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(15000);
    await store.freeform("Покажите билет");
    expect(store.getSnapshot().busy).toBe(true);
    expect(store.getSnapshot().session).toEqual(before);
    vi.useRealTimers();
    const command = {
      actionId: "ask_for_ticket",
      idempotencyKey: crypto.randomUUID(),
      clientTimestamp: new Date().toISOString(),
    };
    const session = applyAction(before, command);
    finish(
      Response.json({
        session,
        command,
        analysis: null,
        allowedConsequences: allowedConsequences(session),
        actor: {
          consequenceId: "respond_to_current_step",
          reply: "Вот мой заказ.",
        },
        actorFallback: false,
        source: SCENE_SOURCE,
        execution: "server",
      }),
    );
    await pending;
    expect(store.getSnapshot().session?.currentTimeMinutes).toBe(1);
    expect(store.getSnapshot().session?.appliedActions).toHaveLength(1);
    store.dispose();
  });
  it("answers standard phrases offline without fetch and retains replayable communication markers", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = new TrainingStore();
    await store.initialize();
    await store.start();
    for (const text of [
      "Покажите, пожалуйста, ваш билет",
      "Я не могу вас посадить без билета, пройдите в кассу №3",
      "Обратитесь в кассу №3",
      "Всего доброго",
    ])
      await store.freeform(text);
    expect(fetchSpy).not.toHaveBeenCalled();
    const saved = (await loadActive())!;
    expect(saved.lastFreeform?.execution).toBe("local");
    expect(saved.lastFreeform?.responseMode).toBe("fallback");
    expect(store.getSnapshot().session?.outcome).toBe("resolved");
    expect(replaySession(saved.id, saved.journal)).toEqual(
      store.getSnapshot().session,
    );
    store.dispose();
  });
  it("records the server action atomically without putting actor prose in replay", async () => {
    const store = new TrainingStore();
    await store.initialize();
    await store.start();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      const input = JSON.parse(options.body as string);
      const current = store.getSnapshot();
      if (url.endsWith("/sync"))
        return Response.json(replaySession(current.session!.id, input));
      const command = {
        idempotencyKey: crypto.randomUUID(),
        actionId: "ask_for_ticket",
        clientTimestamp: input.clientTimestamp,
      };
      const session = applyAction(current.session!, command);
      return Response.json({
        session,
        command,
        analysis: {
          matchedActionId: command.actionId,
          confidence: 0.95,
          markers: {
            polite: true,
            empathy: false,
            rude: false,
            safetyViolation: false,
          },
          explanation: "Попросили билет.",
        },
        allowedConsequences: allowedConsequences(session),
        actor: {
          consequenceId: allowedConsequences(session)[0]!.id,
          reply: "Вот мой заказ, посмотрите.",
        },
        actorFallback: false,
        source: SCENE_SOURCE,
        execution: "server",
      });
    });
    await store.freeform("Можно взглянуть на номер вашего заказа?");
    const saved = (await loadActive())!;
    expect(saved.pendingFreeform).toBeUndefined();
    expect(saved.syncedCount).toBe(1);
    expect(saved.lastFreeform?.actor.reply).toBe("Вот мой заказ, посмотрите.");
    expect(replaySession(saved.id, saved.journal)).toEqual(
      store.getSnapshot().session,
    );
    store.dispose();
  });

  it("recovers a committed turn when its SSE confirmation is truncated", async () => {
    const store = new TrainingStore();
    await store.initialize();
    await store.start();
    vi.stubGlobal("navigator", { onLine: true });
    let receiptCalls = 0;
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      const current = store.getSnapshot();
      if (url.endsWith("/sync"))
        return Response.json(replaySession(current.session!.id, JSON.parse(options.body as string)));
      if (url.endsWith("/stream"))
        return new Response('data: {"type":"status","stage":"analyzing"}\n\n', {
          headers: { "content-type": "text/event-stream" },
        });
      receiptCalls++;
      const input = JSON.parse(options.body as string);
      const command = {
        idempotencyKey: crypto.randomUUID(),
        actionId: "ask_for_ticket",
        clientTimestamp: input.clientTimestamp,
      };
      const session = applyAction(current.session!, command);
      return Response.json({
        session, command, analysis: null,
        allowedConsequences: allowedConsequences(session),
        actor: { consequenceId: "respond_to_current_step", reply: "Покажу билет." },
        actorFallback: false, source: SCENE_SOURCE, execution: "server",
      });
    });
    await store.freeform("Покажите, пожалуйста, ваш билет.");
    expect(receiptCalls).toBe(1);
    expect(store.getSnapshot().record?.pendingFreeform).toBeUndefined();
    expect(store.getSnapshot().session?.appliedActions).toHaveLength(1);
    expect(store.getSnapshot().aiError).toBeNull();
    store.dispose();
  });

  it("unlocks explicit local actions after a confirmed AI outage", async () => {
    const store = new TrainingStore();
    await store.initialize();
    await store.start();
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("/sync")
        ? Response.json(store.getSnapshot().session)
        : Response.json({ code: "ai_unavailable" }, { status: 503 }),
    );
    await store.freeform("Давайте разберёмся, где вы покупали билет");
    expect(store.getSnapshot().record?.pendingFreeform).toBeUndefined();
    expect(store.getSnapshot().session?.currentTimeMinutes).toBe(0);
    vi.stubGlobal("navigator", { onLine: false });
    await store.act("ask_for_ticket");
    expect(store.getSnapshot().session?.currentTimeMinutes).toBe(1);
    store.dispose();
  });
});
