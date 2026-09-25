"use client";

import { useRef, useState } from "react";

import {
  sessionStateSchema,
  type SessionStateDto,
  type SubmitActionDto,
} from "@vsm/api-contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export default function HomePage() {
  const [session, setSession] = useState<SessionStateDto | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const pendingAction = useRef<SubmitActionDto | null>(null);
  const [canRetryAction, setCanRetryAction] = useState(false);

  async function startSession() {
    setCanRetryAction(false);
    setStatus("loading");
    try {
      const response = await fetch(`${apiUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "boarding_no_ticket",
          mode: "training",
          difficulty: 1,
        }),
      });
      if (!response.ok) throw new Error("API rejected session creation");
      setSession(sessionStateSchema.parse(await response.json()));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function applyAction(actionId?: string) {
    if (!session) return;
    if (!pendingAction.current && actionId)
      pendingAction.current = {
        idempotencyKey: crypto.randomUUID(),
        actionId,
        clientTimestamp: new Date().toISOString(),
      };
    if (!pendingAction.current) return;
    setCanRetryAction(true);
    setStatus("loading");
    try {
      const response = await fetch(`${apiUrl}/sessions/${session.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pendingAction.current),
      });
      if (!response.ok) throw new Error("API rejected action");
      setSession(sessionStateSchema.parse(await response.json()));
      pendingAction.current = null;
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <span className="product-mark" aria-hidden="true">
          БК
        </span>
        <div>
          <p className="eyebrow">Тренажёр проводника</p>
          <h1>Учебная смена</h1>
        </div>
        <span className="connection" role="status">
          Фаза 1
        </span>
      </header>

      <section className="briefing" aria-labelledby="briefing-title">
        <p className="eyebrow">Рейс ВСМ · Москва — Санкт-Петербург</p>
        <h2 id="briefing-title">Списание есть, билета нет</h2>
        <p>
          Пассажир показывает списание с карты, но действительного билета в
          системе нет. Помогите ему разобраться, соблюдая правила посадки. Время
          идёт только при выборе действия. На ситуацию отведено 10 учебных
          минут.
        </p>
      </section>

      {status === "error" && (
        <div className="error" role="alert">
          Не удалось получить ответ сервера.
          {canRetryAction ? (
            <button type="button" onClick={() => applyAction()}>
              Повторить отправку того же действия
            </button>
          ) : (
            " Попробуйте начать смену ещё раз."
          )}
        </div>
      )}

      {session ? (
        <section className="session" aria-labelledby="session-title">
          <div className="session-heading">
            <div>
              <p className="eyebrow">Активная ситуация</p>
              <h2 id="session-title">Пассажир без билета</h2>
            </div>
            <time>{session.currentTimeMinutes} мин</time>
          </div>

          <dl className="metrics">
            <div>
              <dt>Процедура</dt>
              <dd>{session.scores.procedure}</dd>
            </div>
            <div>
              <dt>Сервис</dt>
              <dd>{session.scores.service}</dd>
            </div>
            <div>
              <dt>Общение</dt>
              <dd>{session.scores.communication}</dd>
            </div>
          </dl>

          <p className="passenger-reply" role="status">
            {session.passengerReply}
          </p>
          <div className="action-list" aria-busy={status === "loading"}>
            {session.availableActions.map((action) => (
              <button
                className="scenario-action"
                type="button"
                key={action.id}
                onClick={() => applyAction(action.id)}
                disabled={status === "loading" || status === "error"}
              >
                {action.label} <span>{action.durationMinutes} мин</span>
              </button>
            ))}
          </div>
          {session.outcome !== "active" && (
            <section aria-labelledby="result-title">
              <h3 id="result-title">
                {session.outcome === "resolved"
                  ? "Ситуация решена"
                  : "Есть что разобрать"}
              </h3>
              <p>
                Управление временем: {session.scores.timeManagement}/100. Это
                учебная оценка по правилам, не заключение о квалификации.
              </p>
              <button
                className="primary-action"
                type="button"
                onClick={startSession}
                disabled={status === "loading"}
              >
                Новая попытка
              </button>
            </section>
          )}
          <details className="event-log" open={session.outcome !== "active"}>
            <summary>Разбор действий</summary>
            <ol>
              {session.events.map((event) => (
                <li key={event.id}>
                  <time>{event.atMinute} мин</time> — {event.message}
                </li>
              ))}
            </ol>
          </details>
        </section>
      ) : (
        <button
          className="primary-action"
          type="button"
          onClick={startSession}
          disabled={status === "loading"}
        >
          {status === "loading" ? "Создаём смену…" : "Начать учебную смену"}
        </button>
      )}
    </main>
  );
}
