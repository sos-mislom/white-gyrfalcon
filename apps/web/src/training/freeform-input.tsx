"use client";
import { useState } from "react";
import type {
  FreeformActionResultDto,
  SubmitFreeformActionDto,
} from "@vsm/api-contracts";
import { VoiceInput } from "./voice-input";

export function FreeformInput({
  busy,
  active,
  pending,
  error,
  feedback,
  onSubmit,
  disabled,
}: {
  busy: boolean;
  active: boolean;
  pending?: SubmitFreeformActionDto;
  error: string | null;
  feedback?: FreeformActionResultDto;
  disabled?: boolean;
  onSubmit: (text: string, interrupted?: boolean) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [interrupted, setInterrupted] = useState(false);
  const value = pending?.freeformText ?? text;
  const send = async (spoken: string, wasInterrupted: boolean) => {
    if (await onSubmit(spoken, wasInterrupted)) setText(current => current === spoken ? "" : current);
  };
  if (!active) return null;
  return (
    <div className="vn-composer">
      <form
        className="vn-answer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim() || busy || disabled) return;
          void send(value, pending?.interrupted ?? interrupted);
          setInterrupted(false);
        }}
      >
        <label className="vn-sr-only" htmlFor="freeform-text">
          Ваш ответ пассажиру
        </label>
        <textarea
          id="freeform-text"
          rows={2}
          maxLength={500}
          required
          placeholder="Ваш ответ пассажиру…"
          value={value}
          disabled={busy || Boolean(pending) || disabled}
          onChange={(event) => setText(event.target.value)}
        />
        <VoiceInput
          busy={busy || Boolean(pending) || Boolean(disabled)}
          reply={feedback?.actor.reply}
          replyKey={feedback?.command.idempotencyKey}
          onText={(spoken, wasInterrupted) => {
            setText(spoken);
            setInterrupted(wasInterrupted);
            if (!busy && !pending && !disabled) {
              void send(spoken, wasInterrupted);
              setInterrupted(false);
            }
          }}
        />
        <button
          className="vn-send"
          type="submit"
          aria-label={pending ? "Повторить отправку" : "Отправить ответ"}
          disabled={busy || !value.trim() || disabled}
        >
          <span aria-hidden="true">➤</span>
        </button>
      </form>
      {busy && (
        <p className="vn-wait" role="status">
          Сергей обдумывает ответ… Учебное время на паузе.
        </p>
      )}
      {error && (
        <div className="vn-input-error" role="alert">
          <p>{error}</p>
          {!pending && (
            <small>
              Без AI работают стандартные фразы: «Покажите билет», «Не пущу без
              билета», «Обратитесь в кассу №3», «Всего доброго».
            </small>
          )}
        </div>
      )}
      {feedback?.analysis && (
        <details className="vn-analysis">
          <summary>
            🔍 AI-разбор: {feedback.command.actionId} (эмпатия:{" "}
            {feedback.analysis.markers.empathy ? "да" : "нет"})
          </summary>
          <div>
            <p>{feedback.analysis.explanation}</p>
            <p>
              {feedback.responseMode === "pool"
                ? "Стандартная фраза: модель не вызывалась."
                : feedback.actorFallback
                  ? "Показана проверенная резервная реплика."
                  : "Реплика модели проверена по исходу движка."}
            </p>
          </div>
        </details>
      )}
    </div>
  );
}
