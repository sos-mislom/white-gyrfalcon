import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAction,
  allowedConsequences,
  BOARDING_SOURCE,
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
afterEach(() => vi.unstubAllGlobals());

describe("freeform client journal", () => {
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
        source: BOARDING_SOURCE,
        execution: "server",
      });
    });
    await store.freeform("Покажите, пожалуйста, ваш билет");
    const saved = (await loadActive())!;
    expect(saved.pendingFreeform).toBeUndefined();
    expect(saved.syncedCount).toBe(1);
    expect(saved.lastFreeform?.actor.reply).toBe("Вот мой заказ, посмотрите.");
    expect(replaySession(saved.id, saved.journal)).toEqual(
      store.getSnapshot().session,
    );
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
    await store.freeform("Не пущу без билета");
    expect(store.getSnapshot().record?.pendingFreeform).toBeUndefined();
    expect(store.getSnapshot().session?.currentTimeMinutes).toBe(0);
    vi.stubGlobal("navigator", { onLine: false });
    await store.act("ask_for_ticket");
    expect(store.getSnapshot().session?.currentTimeMinutes).toBe(1);
    store.dispose();
  });
});
