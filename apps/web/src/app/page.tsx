"use client";

import { useState } from "react";

import { sessionStateSchema, type SessionStateDto } from "@vsm/api-contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3100";

export default function HomePage() {
  const [session, setSession] = useState<SessionStateDto | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function startSession() {
    setStatus("loading");
    try {
      const response = await fetch(`${apiUrl}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioId: "boarding_no_ticket",
          mode: "training",
          difficulty: 1,
          seed: 42,
        }),
      });
      if (!response.ok) throw new Error("API rejected session creation");
      setSession(sessionStateSchema.parse(await response.json()));
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  async function applyAction() {
    if (!session) return;
    setStatus("loading");
    try {
      const response = await fetch(`${apiUrl}/sessions/${session.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(),
          actionId: "ask_for_ticket",
          kind: "dialogue",
          durationMinutes: 1,
          clientTimestamp: new Date().toISOString(),
        }),
      });
      if (!response.ok) throw new Error("API rejected action");
      setSession(sessionStateSchema.parse(await response.json()));
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
        <h2 id="briefing-title">Посадка заканчивается через три минуты</h2>
        <p>
          Пассажир показывает списание с карты, но действительного билета в
          системе нет. Начните смену и проверьте сквозной контракт клиента и
          API.
        </p>
      </section>

      {status === "error" && (
        <div className="error" role="alert">
          API недоступен. Проверьте, что сервер запущен на порту 3100.
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
              <dt>Безопасность</dt>
              <dd>{session.scores.safety}</dd>
            </div>
            <div>
              <dt>Сервис</dt>
              <dd>{session.scores.service}</dd>
            </div>
            <div>
              <dt>Фаза инцидента</dt>
              <dd>{session.incidents[0]?.phase ?? "—"}</dd>
            </div>
          </dl>

          <button
            className="primary-action"
            type="button"
            onClick={applyAction}
            disabled={status === "loading"}
          >
            {status === "loading" ? "Применяем…" : "Попросить предъявить билет"}
          </button>
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
