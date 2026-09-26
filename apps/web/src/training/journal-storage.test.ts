import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ENGINE_VERSION, type SubmitActionDto } from "@vsm/api-contracts";
import { replaySession } from "@vsm/simulation-core";
import {
  acknowledge,
  loadActive,
  pendingSessions,
  saveSession,
  type SavedSession,
} from "./journal-storage";

const command = (actionId = "ask_for_ticket"): SubmitActionDto => ({
  actionId,
  idempotencyKey: crypto.randomUUID(),
  clientTimestamp: "2026-09-25T18:00:00Z",
});
const record = (): SavedSession => ({
  id: crypto.randomUUID(),
  revision: 0,
  syncedCount: -1,
  journal: {
    engineVersion: ENGINE_VERSION,
    setup: {
      scenarioId: "boarding_no_ticket",
      seed: 42,
      mode: "training",
      difficulty: 1,
    },
    commands: [],
  },
});
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("vsm-training");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("durable local journal", () => {
  it("preserves legacy history while clearing its active pointer", async () => {
    const legacy = { ...record(), journal: { ...record().journal, engineVersion: "boarding-4" }, lastFreeform: { oldShape: true } };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vsm-training", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", { keyPath: "id" });
        request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction(["sessions", "meta"], "readwrite");
    tx.objectStore("sessions").put(legacy);
    tx.objectStore("meta").put(legacy.id, "active");
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    expect(await loadActive()).toBeNull();
    expect(await pendingSessions()).toEqual([]);
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vsm-training", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = upgraded.transaction(["sessions", "meta"], "readonly");
    const history = read.objectStore("sessions").get(legacy.id);
    const active = read.objectStore("meta").get("active");
    await new Promise<void>((resolve, reject) => {
      read.oncomplete = () => resolve();
      read.onerror = () => reject(read.error);
    });
    expect(history.result).toEqual(legacy);
    expect(active.result).toBeUndefined();
    upgraded.close();
  });
  it("repairs an incomplete legacy database without deleting saved data", async () => {
    const empty = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("vsm-training", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    empty.close();
    expect(await loadActive()).toBeNull();
    expect(await saveSession(record(), null)).toBeDefined();
  });
  it("restores a saved turn after reopening storage", async () => {
    expect(await loadActive()).toBeNull();
    const first = await saveSession(record(), null);
    const changed = await saveSession(
      { ...first, journal: { ...first.journal, commands: [command()] } },
      first.revision,
    );
    expect(await loadActive()).toEqual(changed);
    expect(replaySession(changed.id, changed.journal).currentTimeMinutes).toBe(
      1,
    );
  });
  it("rejects a stale writer from another tab without overwriting data", async () => {
    const first = await saveSession(record(), null);
    const updated = await saveSession(
      { ...first, journal: { ...first.journal, commands: [command()] } },
      first.revision,
    );
    await expect(saveSession(first, first.revision)).rejects.toThrow(
      "local_revision_conflict",
    );
    expect(await loadActive()).toEqual(updated);
  });
  it("keeps completed offline attempts queued when a new attempt is started", async () => {
    const first = await saveSession(record(), null);
    const second = await saveSession(record(), null);
    expect((await pendingSessions()).map((item) => item.id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect((await loadActive())?.id).toBe(second.id);
  });
  it("does not acknowledge a different server score", async () => {
    const first = await saveSession(record(), null);
    const state = replaySession(first.id, first.journal);
    state.scores.procedure = 0;
    await expect(acknowledge(first.id, state)).rejects.toThrow(
      "server_journal_conflict",
    );
    expect(await pendingSessions()).toHaveLength(1);
  });
  it("an acknowledgement arriving during a new turn preserves that turn and only confirms its prefix", async () => {
    const first = await saveSession(record(), null);
    const response = replaySession(first.id, first.journal);
    const second = await saveSession(
      { ...first, journal: { ...first.journal, commands: [command()] } },
      first.revision,
    );
    const ack = await acknowledge(first.id, response);
    expect(ack.journal.commands).toEqual(second.journal.commands);
    expect(ack.syncedCount).toBe(0);
    expect(await pendingSessions()).toHaveLength(1);
    await acknowledge(first.id, replaySession(second.id, second.journal));
    expect(await pendingSessions()).toHaveLength(0);
  });
});
