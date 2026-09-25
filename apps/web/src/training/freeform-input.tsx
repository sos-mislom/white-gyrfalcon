"use client";
import { useState } from "react";
import { VoiceInput } from "./voice-input";
import type {
  FreeformActionResultDto,
  SubmitFreeformActionDto,
} from "@vsm/api-contracts";

export function FreeformInput({
  busy,
  active,
  pending,
  error,
  feedback,
  onSubmit,
  draftReply,
  reactionMs,
}: {
  busy: boolean;
  active: boolean;
  pending?: SubmitFreeformActionDto;
  error: string | null;
  feedback?: FreeformActionResultDto;
  onSubmit: (text: string, interrupted?: boolean) => Promise<void>;
  draftReply?: string | null;
  reactionMs?: number | null;
}) {
  const [text, setText] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  return (
    <section aria-labelledby="freeform-title">
      <h3 id="freeform-title">Ответить своими словами</h3>
      <p>
        Стандартные фразы разбираются на устройстве, импровизация — AI на
        сервере. Не вводите реальные персональные данные. Без AI доступны явные
        действия ниже.
      </p>
      {active && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onSubmit(pending?.freeformText ?? text, interrupted);
            setInterrupted(false);
          }}
        >
          <label htmlFor="freeform-text">Ваша реплика пассажиру</label>
          <textarea
            id="freeform-text"
            className="benchmark-report"
            rows={3}
            maxLength={500}
            required
            disabled={busy || Boolean(pending)}
            value={pending?.freeformText ?? text}
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="submit"
            className="primary-action"
            disabled={busy || !(pending?.freeformText ?? text).trim()}
          >
            {pending ? "Повторить отправку" : "Ответить"}
          </button>
        </form>
      )}
      {active && (
        <VoiceInput
          busy={busy || Boolean(pending)}
          reply={feedback?.actor.reply}
          replyKey={feedback?.command.idempotencyKey}
          onText={(spoken, wasInterrupted) => {
            setText(spoken);
            setInterrupted(wasInterrupted);
            if (!busy && !pending) {
              void onSubmit(spoken, wasInterrupted);
              setInterrupted(false);
            }
          }}
        />
      )}
      {draftReply && (
        <div aria-label="Поток реплики">
          <p>Пассажир отвечает (черновик, исход ещё проверяется):</p>
          <p>{draftReply}</p>
        </div>
      )}
      {reactionMs != null && (
        <p>Результат хода: {Math.round(reactionMs)} мс.</p>
      )}
      {busy && (
        <p role="status">
          Обрабатываем ход… Ожидание AI не расходует учебное время.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {feedback && (
        <div>
          <h3>Почему движок так оценил ответ</h3>
          <p>
            {feedback.analysis?.explanation ?? "Сохранённый результат хода."}
          </p>
          <p>
            Действие: {feedback.command.actionId}. Уверенность разбора:{" "}
            {feedback.analysis
              ? `${Math.round(feedback.analysis.confidence * 100)}%`
              : "нет данных"}
            .
          </p>
          {feedback.analysis && (
            <p>
              Вежливость: {feedback.analysis.markers.polite ? "да" : "нет"};
              эмпатия: {feedback.analysis.markers.empathy ? "да" : "нет"};
              грубость: {feedback.analysis.markers.rude ? "да" : "нет"}. Маркеры
              — результат разбора речи, нормативные баллы считает движок.
            </p>
          )}
          <p>
            Основание: {feedback.source}. Порядок: проверить билет → объяснить
            ограничение → предложить помощь → завершить разговор.
          </p>
          <p>
            Разрешённое последствие:{" "}
            {
              feedback.allowedConsequences.find(
                (item) => item.id === feedback.actor.consequenceId,
              )?.description
            }
          </p>
          <p>
            {feedback.responseMode === "pool"
              ? "Проверенная реплика движка: модель не вызывалась."
              : feedback.actorFallback
                ? "AI-актёр недоступен или предложил недопустимый исход: показан текст движка."
                : "Реплика сформулирована AI в рамках исхода движка."}
          </p>
        </div>
      )}
    </section>
  );
}
