import type { Ref } from "react";
import type { SessionStateDto } from "@vsm/api-contracts";

export function Debriefing({
  session,
  reply,
  disabled,
  onRestart,
  titleRef,
}: {
  session: SessionStateDto;
  reply: string;
  disabled: boolean;
  onRestart: () => Promise<void>;
  titleRef: Ref<HTMLHeadingElement>;
}) {
  const metrics = [
    ["Безопасность", session.scores.safety],
    ["Процедура", session.scores.procedure],
    ["Сервис", session.scores.service],
    ["Время", session.scores.timeManagement],
  ] as const;
  return (
    <section className="vn-debrief" aria-labelledby="debrief-title">
      <p className="vn-eyebrow">Итоги учебной смены</p>
      <h2 id="debrief-title" tabIndex={-1} ref={titleRef}>
        {session.outcome === "resolved"
          ? "Вы нашли решение"
          : "Есть что разобрать"}
      </h2>
      <blockquote className="vn-final-quote">
        «{reply}»<cite>Сергей, пассажир</cite>
      </blockquote>
      <dl className="vn-scores">
        {metrics.map(([label, score]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              {score}
              <span> / 100</span>
            </dd>
          </div>
        ))}
      </dl>
      <h3>Что говорит регламент</h3>
      <blockquote className="vn-regulation">
        «Спокойно разобраться в ситуации, объяснить правила проезда».
        <br />
        «Направить пассажира в кассу/контактный центр».
      </blockquote>
      <p className="vn-source">
        Учебные материалы РЖД «Примеры ситуаций взаимодействия поездного
        персонала с пассажирами», ситуация 1, стр. 3.
      </p>
      <button className="vn-primary" disabled={disabled} onClick={onRestart}>
        Начать заново
      </button>
    </section>
  );
}
