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
  sceneAnalysis,
  getScenario,
  getFeaturedScenario,
  allowedConsequences,
  SCENE_SOURCE,
} from "@vsm/simulation-core";
import {
  acknowledge,
  clearActive,
  loadActive,
  pendingSessions,
  saveSession,
  type SavedSession,
} from "./journal-storage";
import { readFreeformStream, StreamFailure } from "./freeform-stream";
import { profileHeaders } from "./device-profile";

type SyncStatus = "pending" | "syncing" | "synced" | "conflict";
export interface TrainingSnapshot {
  session: SessionStateDto | null;
  record: SavedSession | null;
  ready: boolean;
  busy: boolean;
  error: string | null;
  aiError: string | null;
  clarification: string | null;
  draftReply: string | null;
  reactionMs: number | null;
  sync: SyncStatus;
}
export const EMPTY: TrainingSnapshot = {
  session: null,
  record: null,
  ready: false,
  busy: false,
  error: null,
  aiError: null,
  clarification: null,
  draftReply: null,
  reactionMs: null,
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
      if (record && record.journal.engineVersion !== ENGINE_VERSION) {
        await clearActive();
        this.publish({ record: null, session: null, ready: true, clarification: "Сцены обновлены. Начните новую ситуацию." });
        return;
      }
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

  async exitToMenu() {
    if (this.snapshot.busy) return;
    try {
      if (this.snapshot.session?.outcome === "active") {
        await this.act("leave_scene");
        if (this.snapshot.error || this.snapshot.session?.outcome === "active") return;
      }
      await clearActive();
      this.publish({ session: null, record: null, error: null, aiError: null, clarification: null, draftReply: null });
    } catch {
      this.publish({ error: "Не удалось выйти в меню: сохранение недоступно." });
    }
  }

  async start(scenarioId = getFeaturedScenario().scenario_id) {
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
        scenarioId,
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
              scenarioId: session.scenarioId,
              mode: session.mode,
              difficulty: session.difficulty,
              seed: session.seed,
            },
            commands: [],
          },
        },
        null,
      );
      this.publish({
        session,
        record,
        sync: "pending",
        aiError: null,
        clarification: null,
        draftReply: null,
        reactionMs: null,
      });
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

  async freeform(text: string, interrupted = false) {
    const started = performance.now();
    let { record } = this.snapshot;
    if (
      !record ||
      this.snapshot.busy ||
      this.snapshot.error ||
      this.snapshot.session?.outcome !== "active"
    )
      return;
    const scene = this.snapshot.session ? getScenario(this.snapshot.session.scenarioId) : undefined;
    const standard = !record.pendingFreeform && scene ? sceneAnalysis(text, scene) : undefined;
    if (standard && !navigator.onLine) {
      this.publish({
        busy: true,
        aiError: null,
        clarification: null,
        draftReply: null,
      });
      try {
        const fallbackReply = "Я вас услышал. Что будем делать дальше?";
        const command = {
          idempotencyKey: crypto.randomUUID(),
          actionId: standard.matchedActionId,
          clientTimestamp: new Date().toISOString(),
          utterance: text.trim(),
          ...(this.snapshot.session?.currentActorId ? { actorId: this.snapshot.session.currentActorId } : {}),
          actorReply: fallbackReply,
          communication: {
            polite: standard.markers.polite,
            empathy: standard.markers.empathy,
            rude: standard.markers.rude,
            ...(interrupted ? { interrupted: true } : {}),
          },
        };
        const next = applyAction(this.snapshot.session!, command);
        const outcomes = allowedConsequences(next);
        const result = freeformActionResultSchema.parse({
          session: next,
          command,
          analysis: standard,
          allowedConsequences: outcomes,
          actor: {
            consequenceId: outcomes[0]!.id,
            reply: fallbackReply,
          },
          actorFallback: true,
          source: scene?.incident.sop_reference ?? SCENE_SOURCE,
          execution: "local",
          responseMode: "fallback",
        });
        record = await saveSession(
          {
            ...record,
            journal: {
              ...record.journal,
              commands: [...record.journal.commands, command],
            },
            lastFreeform: result,
          },
          record.revision,
        );
        this.publish({
          record,
          session: next,
          sync: "pending",
          reactionMs: performance.now() - started,
        });
      } catch {
        this.publish({
          error:
            "Быстрый ход не сохранён. Перезагрузите страницу; журнал не удалён.",
        });
      } finally {
        this.publish({ busy: false });
      }
      void this.sync();
      return;
    }
    if (!navigator.onLine) {
      this.publish({
        aiError: "Для AI нужна сеть. Явные кнопки работают без неё.",
      });
      return;
    }
    this.publish({
      busy: true,
      aiError: null,
      clarification: null,
      draftReply: null,
      reactionMs: null,
    });
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
              ...(interrupted ? { interrupted: true } : {}),
            },
          },
          record.revision,
        );
        this.publish({ record });
      }
      // The API must see the exact preceding journal before interpreting this answer.
      const syncResponse = await fetch(`${api}/sessions/${record.id}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", ...profileHeaders() },
        body: JSON.stringify(record.journal),
        signal: AbortSignal.timeout(10000),
      });
      if (!syncResponse.ok) throw new Error("sync_unavailable");
      const request = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "if-match": String(record.journal.commands.length),
        },
        body: JSON.stringify(record.pendingFreeform),
      };
      let response: Response | undefined;
      try {
        response = await fetch(`${api}/sessions/${record.id}/action-freeform/stream`, {
          ...request,
          signal: AbortSignal.timeout(100000),
        });
      } catch {
        // The server may still have committed; the receipt request below is safe.
      }
      if (response && [422, 503].includes(response.status)) {
        record = await saveSession(
          { ...record, pendingFreeform: undefined },
          record.revision,
        );
        this.publish({
          record,
          aiError:
            response.status === 422
              ? null
              : "Сейчас не могу ответить. Попробуйте ещё раз.",
          clarification:
            response.status === 422
              ? "Простите, я не понял. Повторите, пожалуйста?"
              : null,
        });
        return;
      }
      let result;
      try {
        if (!response) throw new Error("freeform_stream_disconnected");
        if (!response.ok) throw new Error(`freeform_http_${response.status}`);
        result = freeformActionResultSchema.parse(
          await readFreeformStream(response, (draftReply) =>
            this.publish({ draftReply }),
          ),
        );
      } catch (streamError) {
        if (streamError instanceof StreamFailure && [422, 503].includes(streamError.status))
          throw streamError;
        // The stream may end after the server commits. The same request returns
        // its durable receipt, so this does not generate or apply a second turn.
        const receipt = await fetch(`${api}/sessions/${record.id}/action-freeform`, {
          ...request,
          signal: AbortSignal.timeout(100000),
        });
        if ([422, 503].includes(receipt.status)) throw new StreamFailure(receipt.status);
        if (!receipt.ok) throw new Error(`freeform_receipt_${receipt.status}`);
        result = freeformActionResultSchema.parse(await receipt.json());
      }
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
      this.publish({
        record,
        session: expected,
        sync: "synced",
        draftReply: null,
        reactionMs: performance.now() - started,
      });
    } catch (error) {
      if (error instanceof StreamFailure && [422, 503].includes(error.status)) {
        record = await saveSession(
          { ...record, pendingFreeform: undefined },
          record.revision,
        );
        this.publish({
          record,
          aiError:
            error.status === 422
              ? null
              : "Сейчас не могу ответить. Попробуйте ещё раз.",
          clarification:
            error.status === 422
              ? "Простите, я не понял. Повторите, пожалуйста?"
              : null,
          draftReply: null,
        });
        return;
      }
      this.publish({
        aiError: "Связь прервалась. Нажмите отправить ещё раз.",
        draftReply: null,
      });
    } finally {
      this.publish({ busy: false, draftReply: null });
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
              headers: { "content-type": "application/json", ...profileHeaders() },
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
