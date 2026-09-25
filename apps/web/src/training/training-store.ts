import {
  ENGINE_VERSION,
  sessionStateSchema,
  freeformActionResultSchema,
  type SessionStateDto,
} from "@vsm/api-contracts";
import {
  applyAction,
  createSession,
  replaySession,
} from "@vsm/simulation-core";
import {
  acknowledge,
  loadActive,
  pendingSessions,
  saveSession,
  type SavedSession,
} from "./journal-storage";

type SyncStatus = "pending" | "syncing" | "synced" | "conflict";
export interface TrainingSnapshot {
  session: SessionStateDto | null;
  record: SavedSession | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  aiError: string | null;
  sync: SyncStatus;
}
export const EMPTY: TrainingSnapshot = {
  session: null,
  record: null,
  ready: false,
  busy: false,
  error: null,
  aiError: null,
  sync: "pending",
};

export class TrainingStore {
  private snapshot = EMPTY;
  private listeners = new Set<() => void>();
  private syncing = false;
  private stopped = false;
  private abort = new AbortController();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private publish(patch: Partial<TrainingSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async initialize() {
    this.stopped = false;
    this.abort = new AbortController();
    try {
      const record = await loadActive();
      this.publish({
        record,
        session: record ? replaySession(record.id, record.journal) : null,
        ready: true,
      });
      void this.sync();
    } catch {
      this.publish({
        ready: true,
        error:
          "Не удалось прочитать сохранение. Данные не удалены. Перезагрузите страницу или проверьте доступ к хранилищу браузера.",
      });
    }
  }
  dispose() {
    this.stopped = true;
    this.abort.abort();
  }

  async start() {
    if (
      this.snapshot.busy ||
      !this.snapshot.ready ||
      this.snapshot.error ||
      this.snapshot.record?.pendingFreeform
    )
      return;
    this.publish({ busy: true });
    try {
      const session = createSession({
        scenarioId: "boarding_no_ticket",
        mode: "training",
        difficulty: 1,
      });
      const record = await saveSession(
        {
          id: session.id,
          revision: 0,
          syncedCount: -1,
          journal: {
            engineVersion: ENGINE_VERSION,
            setup: {
              scenarioId: "boarding_no_ticket",
              mode: session.mode,
              difficulty: session.difficulty,
              seed: session.seed,
            },
            commands: [],
          },
        },
        null,
      );
      this.publish({ session, record, sync: "pending" });
    } catch {
      this.publish({
        error:
          "Не удалось сохранить новую смену. Проверьте свободное место и доступ к хранилищу.",
      });
    } finally {
      this.publish({ busy: false });
    }
    void this.sync();
  }

  async act(actionId: string) {
    const { record, session, busy, error } = this.snapshot;
    if (!record || !session || busy || error || record.pendingFreeform) return;
    this.publish({ busy: true });
    try {
      const command = {
        idempotencyKey: crypto.randomUUID(),
        actionId,
        clientTimestamp: new Date().toISOString(),
      };
      const next = applyAction(session, command);
      const saved = await saveSession(
        {
          ...record,
          journal: {
            ...record.journal,
            commands: [...record.journal.commands, command],
          },
        },
        record.revision,
      );
      this.publish({ session: next, record: saved, sync: "pending" });
    } catch {
      this.publish({
        error:
          "Ход не сохранён. Возможно, смена изменена в другой вкладке или хранилище недоступно. Перезагрузите страницу; сохранённые ходы останутся.",
      });
    } finally {
      this.publish({ busy: false });
    }
    void this.sync();
  }

  async freeform(text: string) {
    let { record } = this.snapshot;
    if (
      !record ||
      this.snapshot.busy ||
      this.snapshot.error ||
      this.snapshot.session?.outcome !== "active"
    )
      return;
    if (!navigator.onLine) {
      this.publish({
        aiError: "Для AI нужна сеть. Явные кнопки работают без неё.",
      });
      return;
    }
    this.publish({ busy: true, aiError: null });
    const api = process.env.NEXT_PUBLIC_API_URL ?? "/api";
    try {
      if (!record.pendingFreeform) {
        record = await saveSession(
          {
            ...record,
            pendingFreeform: {
              sessionId: record.id,
              freeformText: text.trim(),
              clientTimestamp: new Date().toISOString(),
            },
          },
          record.revision,
        );
        this.publish({ record });
      }
      // The API must see the exact preceding journal before interpreting this answer.
      const syncResponse = await fetch(`${api}/sessions/${record.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(record.journal),
        signal: AbortSignal.timeout(10000),
      });
      if (!syncResponse.ok) throw new Error("sync_unavailable");
      const response = await fetch(
        `${api}/sessions/${record.id}/action-freeform`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "if-match": String(record.journal.commands.length),
          },
          body: JSON.stringify(record.pendingFreeform),
          signal: AbortSignal.timeout(100000),
        },
      );
      if ([422, 503].includes(response.status)) {
        record = await saveSession(
          { ...record, pendingFreeform: undefined },
          record.revision,
        );
        this.publish({
          record,
          aiError:
            response.status === 422
              ? "AI не уверен в намерении. Уточните фразу или выберите действие кнопкой. Ход не применён."
              : "AI недоступен. Выберите явное действие — ход и баллы не изменены.",
        });
        return;
      }
      if (!response.ok) throw new Error("freeform_unconfirmed");
      const result = freeformActionResultSchema.parse(await response.json());
      const journal = {
        ...record.journal,
        commands: [...record.journal.commands, result.command],
      };
      const expected = replaySession(record.id, journal);
      if (
        JSON.stringify(sessionStateSchema.parse(expected)) !==
        JSON.stringify(result.session)
      )
        throw new Error("freeform_result_conflict");
      record = await saveSession(
        {
          ...record,
          journal,
          pendingFreeform: undefined,
          lastFreeform: result,
          syncedCount: journal.commands.length,
        },
        record.revision,
      );
      this.publish({ record, session: expected, sync: "synced" });
    } catch {
      this.publish({
        aiError:
          "Ответ не подтверждён. Текст сохранён. Повторите отправку — ход не применится дважды. Не начинайте другую попытку до сверки.",
      });
    } finally {
      this.publish({ busy: false });
    }
  }

  sync = async () => {
    if (
      this.syncing ||
      this.stopped ||
      !this.snapshot.ready ||
      this.snapshot.record?.pendingFreeform
    )
      return;
    if (!navigator.onLine) {
      this.publish({ sync: "pending" });
      return;
    }
    this.syncing = true;
    this.publish({ sync: "syncing" });
    try {
      // Reload the queue after each batch: actions may be saved while a request is in flight.
      for (;;) {
        const pending = (await pendingSessions()).filter(
          (item) => !item.pendingFreeform,
        );
        if (!pending.length) {
          this.publish({ sync: "synced" });
          break;
        }
        for (const record of pending) {
          if (this.stopped) return;
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_API_URL ?? "/api"}/sessions/${record.id}/sync`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(record.journal),
              signal: AbortSignal.any([
                this.abort.signal,
                AbortSignal.timeout(7000),
              ]),
            },
          );
          if (response.status === 409 || response.status === 400)
            throw new Error("server_journal_conflict");
          if (!response.ok) throw new Error("network_unavailable");
          const saved = await acknowledge(
            record.id,
            sessionStateSchema.parse(await response.json()),
          );
          // A metadata acknowledgement must never replace a newer local gameplay revision.
          if (
            this.snapshot.record?.id === saved.id &&
            this.snapshot.record.revision === saved.revision
          )
            this.publish({ record: saved });
        }
      }
    } catch (error) {
      this.publish({
        sync:
          error instanceof Error && error.message === "server_journal_conflict"
            ? "conflict"
            : "pending",
      });
    } finally {
      this.syncing = false;
    }
  };
}
