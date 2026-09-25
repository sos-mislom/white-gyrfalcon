"use client";
import { useTraining } from "../training/use-training";
import { OfflineStatus } from "../training/offline-status";
import { FreeformInput } from "../training/freeform-input";

const syncLabels = {
  pending: "Сохранено на устройстве. Ожидает отправки на сервер.",
  syncing: "Сохранено на устройстве. Сверяем журнал с сервером…",
  synced: "Все сохранённые смены подтверждены сервером.",
  conflict:
    "Сервер обнаружил несовпадение журнала или версии правил. Локальные данные сохранены; требуется разбор, повторная отправка их не перезапишет.",
};

export default function HomePage() {
  const training = useTraining();
  const { session, ready, busy, error } = training;
  const disabled =
    !ready ||
    busy ||
    Boolean(error) ||
    Boolean(training.record?.pendingFreeform);
  const feedback = training.record?.lastFreeform;
  const latestIsFreeform =
    session?.appliedActions.at(-1)?.key === feedback?.command.idempotencyKey;
  return (
    <main className="shell">
      <h1>Тренажёр проводника</h1>
      <p>Фаза 3 · Ситуация, свободный ответ и AI-разбор</p>
      <OfflineStatus />
      {ready && training.record && (
        <div className="sync-status">
          <p role="status">{syncLabels[training.sync]}</p>
          <button
            type="button"
            onClick={training.syncNow}
            disabled={training.sync === "syncing"}
          >
            Синхронизировать
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!ready && <p role="status">Читаем сохранённую смену…</p>}
      <section className="briefing" aria-labelledby="briefing-title">
        <h2 id="briefing-title">Списание есть, билета нет</h2>
        <p>
          Пассажир показывает списание с карты, но действительного билета нет.
          Помогите разобраться, соблюдая правила посадки. На ситуацию отведено
          10 учебных минут. Ходы и оценка рассчитываются на этом устройстве.
        </p>
      </section>
      {session ? (
        <section aria-labelledby="session-title">
          <div className="session-heading">
            <h2 id="session-title">Пассажир без билета</h2>
            <time>{session.currentTimeMinutes} мин</time>
          </div>
          <dl className="metrics">
            <div>
              <dt>Безопасность</dt>
              <dd>{session.scores.safety}</dd>
            </div>
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
            {latestIsFreeform && feedback
              ? feedback.actor.reply
              : session.passengerReply}
          </p>
          <p>
            Лояльность пассажира: {session.passengerLoyalty}. Это отдельный
            показатель, не оценка вашей квалификации.
          </p>
          {(session.outcome === "active" || feedback) && (
            <FreeformInput
              busy={busy}
              active={session.outcome === "active"}
              pending={training.record?.pendingFreeform}
              error={training.aiError}
              feedback={feedback}
              onSubmit={training.freeform}
              draftReply={training.draftReply}
              reactionMs={training.reactionMs}
            />
          )}
          <div className="action-list" aria-busy={busy}>
            {session.availableActions.map((action) => (
              <button
                key={action.id}
                className="scenario-action"
                type="button"
                disabled={disabled}
                onClick={() => training.act(action.id)}
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
                Управление временем: {session.scores.timeManagement}/100.
                Учебная оценка по правилам, не заключение о квалификации.
              </p>
              <button
                className="primary-action"
                type="button"
                onClick={training.start}
                disabled={disabled}
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
          disabled={disabled}
          onClick={training.start}
        >
          Начать учебную смену
        </button>
      )}
      <p className="storage-note">
        Сохранение привязано к этому браузеру и адресу. Не очищайте данные сайта
        до синхронизации; приватный режим не подходит для хранения смен.
      </p>
    </main>
  );
}
