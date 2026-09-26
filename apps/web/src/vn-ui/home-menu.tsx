"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { getScenario, listScenarios, type ScenarioSummaryDto } from "@vsm/simulation-core";
import type { SessionStateDto } from "@vsm/api-contracts";
import { StandRadar, standAxes, standOverall } from "./stand-radar";

type Tab = "scenes" | "history" | "ranking" | "profile";
type Filter = "all" | "character" | "environment";

function Icon({ kind, size = 22 }: { kind: "train" | "ticket" | "medal" | "profile" | "search" | "arrow" | "shuffle"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (kind === "train") return <svg {...common}><path d="M6 18V5.5A2.5 2.5 0 0 1 8.5 3h7A2.5 2.5 0 0 1 18 5.5V18H6Z"/><path d="M6 13h12M9 17h.01M15 17h.01M8 21l2-3m6 0 2 3M9 7h6"/></svg>;
  if (kind === "ticket") return <svg {...common}><path d="M3 8h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V8Z"/><path d="M12 8v10" strokeDasharray="2 2"/></svg>;
  if (kind === "medal") return <svg {...common}><path d="m8 3 4 3 4-3M8 3 6 8l2 3m8-8 2 5-2 3"/><circle cx="12" cy="15" r="5"/><path d="m12 12.5.8 1.7 1.9.2-1.4 1.3.4 1.9-1.7-.9-1.7.9.4-1.9-1.4-1.3 1.9-.2.8-1.7Z"/></svg>;
  if (kind === "profile") return <svg {...common}><circle cx="12" cy="8" r="3.2"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>;
  if (kind === "search") return <svg {...common}><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
  if (kind === "shuffle") return <svg {...common}><path d="M4 7h3c5 0 5 10 10 10h3m-3-3 3 3-3 3M4 17h3c1.7 0 2.8-1.2 3.7-2.7M13.3 9.7C14.2 8.2 15.3 7 17 7h3m-3-3 3 3-3 3"/></svg>;
  return <svg {...common}><path d="M4 12h16m-6-6 6 6-6 6"/></svg>;
}

const tabs: { key: Tab; label: string; icon: "train" | "ticket" | "medal" | "profile" }[] = [
  { key: "scenes", label: "Сцены", icon: "train" },
  { key: "history", label: "История", icon: "ticket" },
  { key: "ranking", label: "Рейтинг", icon: "medal" },
  { key: "profile", label: "Профиль", icon: "profile" },
];
function score(session: SessionStateDto) {
  return standOverall(session);
}
function scenePortrait(scene: ScenarioSummaryDto) {
  const key = getScenario(scene.scenarioId)?.character?.portrait_key;
  return key && key !== "dummy" ? `/visual-novel/${key}.webp` : null;
}
function CoverArt({ scene, className }: { scene: ScenarioSummaryDto; className: string }) {
  const portrait = scenePortrait(scene);
  const background = getScenario(scene.scenarioId)?.visual.background ?? "carriage";
  return <span className={`${className}${portrait ? " has-portrait" : " is-environment"}`} aria-hidden="true">
    <Image className="vn-cover-setting" src={`/visual-novel/bg_${background}.webp`} alt="" fill sizes="(max-width: 600px) 320px, 360px" unoptimized />
    {portrait && <Image className="vn-cover-character" src={portrait} alt="" fill sizes="(max-width: 600px) 320px, 360px" unoptimized />}
  </span>;
}

interface HomeMenuProps {
  ready: boolean;
  busy: boolean;
  history: SessionStateDto[];
  featuredId: string;
  onSelect: (id: string) => void;
  onRandom: () => void;
}

export function HomeMenu({ ready, busy, history, featuredId, onSelect, onRandom }: HomeMenuProps) {
  const [tab, setTab] = useState<Tab>("scenes");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [slide, setSlide] = useState(1);
  const rail = useRef<HTMLDivElement>(null);
  const scenarios = listScenarios();
  const characterScenes = scenarios.filter((scene) => scene.scenarioId !== featuredId && scene.characterName);
  const carousel = [characterScenes.at(-1), scenarios.find((scene) => scene.scenarioId === featuredId), ...characterScenes.slice(0, -1)].filter((scene): scene is ScenarioSummaryDto => Boolean(scene));
  useLayoutEffect(() => {
    if (tab !== "scenes" || !rail.current) return;
    const item = rail.current.children[1] as HTMLElement | undefined;
    if (!item) return;
    rail.current.scrollLeft = item.offsetLeft - rail.current.offsetLeft - (rail.current.clientWidth - item.clientWidth) / 2;
    setSlide(1);
  }, [tab]);
  const visible = scenarios.filter((scene) => {
    const hasCharacter = Boolean(scene.characterName);
    if (filter === "character" && !hasCharacter) return false;
    if (filter === "environment" && hasCharacter) return false;
    return `${scene.title} ${scene.characterName ?? ""} ${scene.location}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
  });
  const finished = history.filter((session) => session.outcome !== "active");
  const assessed = finished.filter((session) => session.outcome !== "abandoned");
  const sorted = [...assessed].sort((left, right) => score(right) - score(left));
  const best = sorted[0];
  const toSlide = (index: number) => {
    setSlide(index);
    const item = rail.current?.children[index] as HTMLElement | undefined;
    if (rail.current && item) rail.current.scrollTo({ left: item.offsetLeft - rail.current.offsetLeft - (rail.current.clientWidth - item.clientWidth) / 2, behavior: "smooth" });
  };
  const syncSlide = () => {
    if (!rail.current) return;
    const middle = rail.current.scrollLeft + rail.current.clientWidth / 2;
    let closest = 0;
    let distance = Infinity;
    [...rail.current.children].forEach((child, index) => {
      const item = child as HTMLElement;
      const current = Math.abs(item.offsetLeft - rail.current!.offsetLeft + item.clientWidth / 2 - middle);
      if (current < distance) { distance = current; closest = index; }
    });
    setSlide(closest);
  };
  return <div className="vn-home">
    <header className="vn-home-header" aria-label="Сводка смен">
      <span className="vn-header-brand"><Image src="/visual-novel/falcon_mark.webp" alt="Белый кречет" width={38} height={38} unoptimized /></span>
      <span className="vn-header-stats">
        <button className="vn-counter-pill" type="button" onClick={() => setTab("history")} aria-label={`Завершено смен: ${assessed.length}`}><Icon kind="ticket" size={20}/><strong>{assessed.length}</strong></button>
        <button className="vn-counter-pill vn-counter-best" type="button" onClick={() => setTab("ranking")} aria-label={`Лучший результат: ${best ? score(best) : 0}`}><Icon kind="medal" size={20}/><strong>{best ? score(best) : 0}</strong></button>
      </span>
      <button className="vn-header-profile" type="button" onClick={() => setTab("profile")} aria-label="Открыть профиль"><Icon kind="profile" size={22}/></button>
    </header>
    <div className="vn-home-scroll" key={tab}>
      {tab === "scenes" && <section className="vn-library" aria-label="Сцены">
        <div className="vn-carousel-wrap"><div className="vn-carousel-rail" ref={rail} onScroll={syncSlide} aria-label="Выбор истории">
          {carousel.map((scene) => <button key={scene.scenarioId} type="button" className="vn-carousel-card" disabled={!ready || busy} onClick={() => onSelect(scene.scenarioId)} aria-label={`Открыть сцену: ${scene.title}`}>
            <CoverArt scene={scene} className="vn-carousel-art" />
            <span className="vn-carousel-shade" aria-hidden="true" />
            <span className="vn-carousel-copy"><strong>{scene.menuLabel}</strong><small>{scene.characterName}</small><span className="vn-carousel-action">Открыть <Icon kind="arrow" size={20}/></span></span>
          </button>)}
        </div><button className="vn-carousel-random" type="button" disabled={!ready || busy} onClick={onRandom} aria-label="Случайная сцена"><Icon kind="shuffle" size={25}/></button></div>
        <div className="vn-carousel-dots" aria-label="Страницы карусели">{carousel.map((scene, index) => <button key={scene.scenarioId} type="button" className={slide === index ? "is-active" : ""} onClick={() => toSlide(index)} aria-label={`Показать историю ${index + 1}`} aria-current={slide === index ? "true" : undefined}/>)}</div>
        <label className="vn-search"><Icon kind="search" size={21}/><span className="vn-sr-only">Поиск сцен</span><input type="search" placeholder="Ситуации, персонажи..." value={query} onChange={(event) => setQuery(event.target.value)}/></label>
        <div className="vn-filter-bar" role="tablist" aria-label="Фильтр сцен">{([ ["all","Все"], ["character","Встречи"], ["environment","В пути"] ] as const).map(([key,label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? "is-active" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div>
        <div className="vn-poster-grid">{visible.map((scene) => <button key={scene.scenarioId} className="vn-poster-card" type="button" disabled={!ready || busy} onClick={() => onSelect(scene.scenarioId)}><span className="vn-poster-frame"><CoverArt scene={scene} className="vn-poster-art" /><span className="vn-poster-corner"><Icon kind="arrow" size={16}/></span></span><strong>{scene.menuLabel}</strong><small>{scene.characterName ?? "В поезде"}</small></button>)}</div>
        {visible.length === 0 && <p className="vn-search-empty">Ничего не найдено</p>}
      </section>}
      {tab === "history" && <section className="vn-tab-content"><h2>История</h2>{finished.length ? <div className="vn-history-list">{[...finished].reverse().map((session, index) => <button className="vn-history-item" key={session.id} type="button" disabled={!ready || busy} onClick={() => onSelect(session.scenarioId)}><span className="vn-history-index">{String(finished.length - index).padStart(2, "0")}</span><span><strong>{getScenario(session.scenarioId)?.menu_label ?? "Смена"}</strong><small>{session.outcome === "abandoned" ? "Прервано · без оценки" : `${session.outcome === "resolved" ? "Разрешено" : "Не разрешено"} · ${score(session)} баллов`}</small></span><Icon kind="arrow" size={18}/></button>)}</div> : <div className="vn-empty-state"><button type="button" onClick={() => setTab("scenes")}>К сценам <Icon kind="arrow" size={18}/></button></div>}</section>}
      {tab === "ranking" && <section className="vn-tab-content"><h2>Рейтинг</h2>{sorted.length ? <div className="vn-ranking-list">{sorted.slice(0,12).map((session,index) => <div className="vn-ranking-item" key={session.id}><span className="vn-ranking-place">{String(index + 1).padStart(2,"0")}</span><span><strong>{getScenario(session.scenarioId)?.menu_label ?? "Смена"}</strong><small>{session.outcome === "resolved" ? "Решено" : "Не решено"}</small></span><b>{score(session)}</b></div>)}</div> : <div className="vn-empty-state"><button type="button" onClick={() => setTab("scenes")}>К сценам <Icon kind="arrow" size={18}/></button></div>}</section>}
      {tab === "profile" && <section className="vn-tab-content"><h2>Профиль</h2>{best ? <><div className="vn-profile-summary"><Image src="/visual-novel/falcon_mark.webp" alt="" width={52} height={52} unoptimized /><strong>{assessed.length} {assessed.length === 1 ? "смена" : "смен"}</strong></div><StandRadar axes={standAxes(best)} id="profile-radar" /></> : <div className="vn-empty-state"><button type="button" onClick={() => setTab("scenes")}>К сценам <Icon kind="arrow" size={18}/></button></div>}</section>}
    </div>
    <nav className="vn-home-nav" aria-label="Разделы">{tabs.map((item) => <button key={item.key} type="button" className={tab === item.key ? "is-active" : ""} aria-current={tab === item.key ? "page" : undefined} onClick={() => setTab(item.key)}><Icon kind={item.icon} size={22}/><small>{item.label}</small></button>)}</nav>
  </div>;
}
