"use client";
import { useEffect, useRef } from "react";
import { memoryAwareReply } from "@vsm/simulation-core";
import { useTraining } from "../training/use-training";
import { FreeformInput } from "../training/freeform-input";
import {
  PassengerScene,
  passengerExpression,
} from "../training/passenger-scene";
import { Debriefing } from "../training/debriefing";
import { useNovelViewport } from "../training/use-novel-viewport";
import "./novel.css";

export default function HomePage() {
  const training = useTraining();
  const { session, busy, ready, error } = training;
  const screen = useNovelViewport();
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const finished = Boolean(session && session.outcome !== "active");
  useEffect(() => {
    if (finished) resultTitle.current?.focus();
  }, [finished]);
  const feedback = training.record?.lastFreeform;
  const latest =
    session?.appliedActions.at(-1)?.key === feedback?.command.idempotencyKey
      ? feedback
      : undefined;
  const reply =
    latest?.actor.reply ??
    (session
      ? (memoryAwareReply(session) ?? session.passengerReply)
      : "Деньги списались, а билет так и не пришёл. Вы поможете мне разобраться?");
  const remaining = session
    ? Math.max(0, 12 - 2 * session.difficulty - session.currentTimeMinutes)
    : 10;
  const clock = `${Math.floor(remaining)}:${remaining % 1 ? "30" : "00"}`;
  return (
    <main
      className="vn-screen"
      ref={screen}
      aria-label="Учебная смена проводника"
    >
      <h1 className="vn-sr-only">Белый кречет — учебная смена</h1>
      <PassengerScene
        expression={passengerExpression(session, latest)}
        finished={finished}
      />
      <header className="vn-header">
        <span className="vn-route">
          Белый кречет<span>Москва — Санкт-Петербург</span>
        </span>
        {!finished && (
          <div
            className="vn-clock"
            aria-label={`До отправления ${clock}. Учебное время${busy ? ", на паузе" : ""}`}
          >
            <span>До отправления</span>
            <time>{clock}</time>
            {busy && <small>Время на паузе</small>}
          </div>
        )}
      </header>
      {finished && session ? (
        <Debriefing
          session={session}
          reply={reply}
          onRestart={training.start}
          disabled={busy || Boolean(error)}
          titleRef={resultTitle}
        />
      ) : (
        <section className="vn-dialogue" aria-labelledby="passenger-name">
          <h2 className="vn-name" id="passenger-name">
            Сергей <span>(Пассажир)</span>
          </h2>
          <div className="vn-dialogue-content">
            <div
              className="vn-speech"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {training.draftReply && (
                <small className="vn-draft">
                  Сергей отвечает · реплика уточняется
                </small>
              )}
              <p>{training.draftReply ?? reply}</p>
            </div>
            {session ? (
              <FreeformInput
                busy={busy}
                active={!finished}
                pending={training.record?.pendingFreeform}
                error={training.aiError}
                feedback={latest}
                onSubmit={training.freeform}
                disabled={Boolean(error)}
              />
            ) : (
              <div className="vn-intro">
                <p>
                  Разберитесь в ситуации и помогите пассажиру, соблюдая правила
                  посадки.
                </p>
                <button
                  className="vn-primary"
                  disabled={!ready || busy || Boolean(error)}
                  onClick={training.start}
                >
                  {ready ? "Начать учебную смену" : "Открываем смену…"}
                </button>
              </div>
            )}
          </div>
        </section>
      )}
      {error && (
        <p className="vn-fatal" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
