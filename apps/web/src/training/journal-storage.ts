import { z } from "zod";
import {
  sessionStateSchema,
  syncSessionSchema,
  type SessionStateDto,
} from "@vsm/api-contracts";
import { replaySession } from "@vsm/simulation-core";

export const savedSessionSchema = z
  .strictObject({
    id: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    journal: syncSessionSchema,
    syncedCount: z.number().int().min(-1),
  })
  .refine((record) => record.syncedCount <= record.journal.commands.length);
export type SavedSession = z.infer<typeof savedSessionSchema>;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vsm-training", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("sessions", { keyPath: "id" });
      request.result.createObjectStore("meta");
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
  return transaction("readonly", (tx, result, fail) => {
    const pointer = tx.objectStore("meta").get("active");
    pointer.onsuccess = () => {
      if (!pointer.result) {
        result(null);
        return;
      }
      const request = tx.objectStore("sessions").get(pointer.result);
      request.onsuccess = () => {
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

export async function pendingSessions(): Promise<SavedSession[]> {
  return transaction("readonly", (tx, result, fail) => {
    const request = tx.objectStore("sessions").getAll();
    request.onsuccess = () => {
      const parsed = z.array(savedSessionSchema).safeParse(request.result);
      if (!parsed.success) {
        fail(new Error("stored_journal_invalid"));
        return;
      }
      result(
        parsed.data.filter(
          (item) => item.syncedCount < item.journal.commands.length,
        ),
      );
    };
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
