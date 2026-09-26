"use client";

import type { Ref } from "react";
import type { FreeformActionResultDto, SessionStateDto } from "@vsm/api-contracts";
import { StandRadar, standAxes } from "./stand-radar";
import { getScenario } from "@vsm/simulation-core";

interface DebriefModalProps {
  session: SessionStateDto;
  reply: string;
  feedback?: FreeformActionResultDto;
  disabled: boolean;
  onRestart: () => Promise<void>;
  onMenu?: () => Promise<void>;
  characterName?: string;
  titleRef: Ref<HTMLHeadingElement>;
}

export function DebriefModal({ session, reply, feedback, disabled, onRestart, onMenu, characterName = "Пассажир", titleRef }: DebriefModalProps) {
  const success = session.outcome === "resolved";
  const axes = standAxes(session, feedback);
  const measured = axes.filter((_, index) => index !== 3 && index !== 5);
  const strongest = measured.reduce((a, b) => a.value >= b.value ? a : b);
  const overall = Math.round(measured.reduce((sum, axis) => sum + axis.value, 0) / measured.length);
  const title = success ? "Смена завершена" : session.outcome === "abandoned" ? "Сцена прервана" : "Ситуация не разрешена";
  const norms = getScenario(session.scenarioId)?.legal_basis ?? [];
  const share = async () => {
    const text = `Белый кречет · ${title}\n${overall} баллов · ${strongest.label}`;
    try {
      if (navigator.share) await navigator.share({ title: "Белый кречет", text });
      else await navigator.clipboard.writeText(text);
    } catch { /* The share sheet can be dismissed. */ }
  };
  return (
    <section className="vn-debrief-card" aria-labelledby="debrief-title">
      <div className="vn-debrief-top"><span className="vn-debrief-kicker">ИТОГ СМЕНЫ</span><span className="vn-debrief-star" aria-hidden="true">✧</span></div>
      <div className="vn-debrief-heading"><span className="vn-debrief-number">{overall}<small>/100</small></span><div><h2 id="debrief-title" tabIndex={-1} ref={titleRef}>{title}</h2><p>{success ? "Вы нашли путь к решению." : session.outcome === "abandoned" ? "Ситуация осталась без решения." : "Решение не было найдено вовремя."}</p></div></div>
      {reply && <blockquote className="vn-final-quote"><p>«{reply}»</p><cite>{characterName}</cite></blockquote>}
      <div className="vn-debrief-section-title"><span>ВАШ СТИЛЬ</span><strong>{strongest.label}</strong></div>
      <StandRadar axes={axes} id={`debrief-${session.id}`} />
      <section className="vn-debrief-norms" aria-label="Правовая основа сцены">
        <h3>ОСНОВАНИЕ</h3>
        {norms.map((norm) => <a key={`${norm.act}:${norm.clause}`} href={norm.url} target="_blank" rel="noopener noreferrer"><strong>{norm.act} · {norm.clause}</strong><span>{norm.application}</span></a>)}
      </section>
      <div className="vn-debrief-actions"><button type="button" className="vn-debrief-primary" disabled={disabled} onClick={onMenu}>К историям <span aria-hidden="true">→</span></button><div><button type="button" disabled={disabled} onClick={onRestart}>Повторить</button><button type="button" onClick={share}>Поделиться</button></div></div>
    </section>
  );
}
