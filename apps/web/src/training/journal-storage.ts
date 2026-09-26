import { z } from "zod";
import {
  ENGINE_VERSION,
  sessionStateSchema,
  syncSessionSchema,
  submitFreeformActionSchema,
  freeformActionResultSchema,
  type SessionStateDto,
} from "@vsm/api-contracts";
import { replaySession } from "@vsm/simulation-core";

export const savedSessionSchema = z
  .strictObject({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    journal: syncSessionSchema,
    syncedCount: z.number().int().min(-1),
    pendingFreeform: submitFreeformActionSchema.optional(),
    lastFreeform: freeformActionResultSchema.optional(),
  })
  .refine((record) => record.syncedCount <= record.journal.commands.length);
export type SavedSession = z.infer<typeof savedSessionSchema>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vsm-training", 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("sessions")) request.result.createObjectStore("sessions", { keyPath: "id" });
      if (!request.result.objectStoreNames.contains("meta")) request.result.createObjectStore("meta");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("storage_blocked"));
  });
}

async function transaction<T>(
  mode: IDBTransactionMode,
  execute: (
    tx: IDBTransaction,
    result: (value: T) => void,
    fail: (error: Error) => void,
  ) => void,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(["sessions", "meta"], mode, {
      durability: "strict",
    });
    let value: T;
    let failure: Error | null = null;
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onabort = () => {
      db.close();
      reject(failure ?? tx.error ?? new Error("storage_aborted"));
    };
    const fail = (error: Error) => {
      failure = error;
      tx.abort();
    };
    try {
      execute(
        tx,
        (result) => {
          value = result;
        },
        fail,
      );
    } catch (error) {
      fail(error as Error);
    }
  });
}

export async function loadActive(): Promise<SavedSession | null> {
  return transaction("readwrite", (tx, result, fail) => {
    const pointer = tx.objectStore("meta").get("active");
    pointer.onsuccess = () => {
      if (!pointer.result) {
        result(null);
        return;
      }
      const request = tx.objectStore("sessions").get(pointer.result);
      request.onsuccess = () => {
        if (request.result?.journal?.engineVersion !== ENGINE_VERSION) {
          tx.objectStore("meta").delete("active");
          result(null);
          return;
        }
        const parsed = savedSessionSchema.safeParse(request.result);
        if (!parsed.success) {
          fail(new Error("stored_journal_invalid"));
          return;
        }
        result(parsed.data);
      };
    };
  });
}

export async function clearActive(): Promise<void> {
  return transaction("readwrite", (tx, result) => {
    tx.objectStore("meta").delete("active");
    result(undefined);
  });
}

export async function pendingSessions(): Promise<SavedSession[]> {
  return transaction("readonly", (tx, result, fail) => {
    const request = tx.objectStore("sessions").getAll();
    request.onsuccess = () => {
      const current = (request.result as unknown[]).filter((item): item is { journal: { engineVersion: string } } =>
        typeof item === "object" && item !== null && "journal" in item &&
        typeof item.journal === "object" && item.journal !== null &&
        "engineVersion" in item.journal && item.journal.engineVersion === ENGINE_VERSION);
      const parsed = z.array(savedSessionSchema).safeParse(current);
      if (!parsed.success) {
        fail(new Error("stored_journal_invalid"));
        return;
      }
      result(
        parsed.data.filter(
          (item) => item.journal.engineVersion === ENGINE_VERSION &&
            item.syncedCount < item.journal.commands.length,
        ),
      );
    };
  });
}

export async function listSavedSessions(): Promise<SavedSession[]> {
  return transaction("readonly", (tx, result, fail) => {
    const request = tx.objectStore("sessions").getAll();
    request.onsuccess = () => {
      const valid = (request.result as unknown[])
        .map((item) => savedSessionSchema.safeParse(item))
        .filter((item): item is { success: true; data: SavedSession } => item.success)
        .map((item) => item.data)
        .filter((item) => item.journal.engineVersion === ENGINE_VERSION);
      result(valid);
    };
    request.onerror = () => fail(request.error ?? new Error("history_unavailable"));
  });
}

export async function saveSession(
  record: SavedSession,
  expectedRevision: number | null,
): Promise<SavedSession> {
  savedSessionSchema.parse(record);
  return transaction("readwrite", (tx, result, fail) => {
    const store = tx.objectStore("sessions");
    const request = store.get(record.id);
    request.onsuccess = () => {
      const current = request.result
        ? savedSessionSchema.safeParse(request.result)
        : null;
      if (current && !current.success) {
        fail(new Error("stored_journal_invalid"));
        return;
      }
      const previous = current?.data;
      if (
        (expectedRevision === null && previous) ||
        (expectedRevision !== null && previous?.revision !== expectedRevision)
      ) {
        fail(new Error("local_revision_conflict"));
        return;
      }
      const next = {
        ...record,
        revision: (expectedRevision ?? -1) + 1,
        syncedCount: Math.max(record.syncedCount, previous?.syncedCount ?? -1),
      };
      store.put(next);
      if (expectedRevision === null)
        tx.objectStore("meta").put(record.id, "active");
      result(next);
    };
  });
}

export async function acknowledge(
  id: string,
  authoritative: SessionStateDto,
): Promise<SavedSession> {
  return transaction("readwrite", (tx, result, fail) => {
    const store = tx.objectStore("sessions");
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        const current = savedSessionSchema.parse(request.result);
        const count = authoritative.appliedActions.length;
        if (count > current.journal.commands.length)
          throw new Error("server_journal_conflict");
        const expected = replaySession(id, {
          ...current.journal,
          commands: current.journal.commands.slice(0, count),
        });
        if (
          JSON.stringify(sessionStateSchema.parse(expected)) !==
          JSON.stringify(sessionStateSchema.parse(authoritative))
        )
          throw new Error("server_journal_conflict");
        const next = {
          ...current,
          syncedCount: Math.max(count, current.syncedCount),
        };
        store.put(next);
        result(next);
      } catch (error) {
        fail(error as Error);
      }
    };
  });
}
