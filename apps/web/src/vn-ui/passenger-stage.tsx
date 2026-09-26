"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { Expression } from "../training/passenger-scene";

export type PortraitKey = "sergey" | "elena" | "igor" | "tamara" | "artem" | "mikhail" | "inna" | "maria_child" | "dummy";

interface PassengerStageProps {
  expression: Expression;
  finished: boolean;
  avatar?: PortraitKey | null;
  phase?: number;
  background?: "departure" | "carriage";
  actors?: { id: string; name: string; portrait_key: PortraitKey; callout_after_minutes?: number }[];
  activeActorId?: string;
  visitedActorIds?: string[];
  minute?: number;
  onSelectActor?: (id: string) => void;
}

const portraits: Record<PortraitKey, string> = {
  sergey: "/visual-novel/sergey.webp",
  elena: "/visual-novel/elena.webp",
  igor: "/visual-novel/igor.webp",
  tamara: "/visual-novel/tamara.webp",
  artem: "/visual-novel/artem.webp",
  mikhail: "/visual-novel/mikhail.webp",
  inna: "/visual-novel/inna.webp",
  maria_child: "/visual-novel/maria_child.webp",
  dummy: "/visual-novel/sergey.webp",
};
const emotionFrames: Partial<Record<PortraitKey, Partial<Record<Expression, string>>>> = {
  sergey: { angry: "/visual-novel/sergey_angry.webp", grateful: "/visual-novel/sergey_grateful.webp" },
  elena: { stressed: "/visual-novel/elena_stressed.webp" },
};
const blinkFrames: Partial<Record<PortraitKey, string>> = {
  sergey: "/visual-novel/sergey_blink.webp",
  elena: "/visual-novel/elena_blink.webp",
  igor: "/visual-novel/igor_blink.webp",
  tamara: "/visual-novel/tamara_blink.webp",
  artem: "/visual-novel/artem_blink.webp",
  mikhail: "/visual-novel/mikhail_blink.webp",
  inna: "/visual-novel/inna_blink.webp",
};

export function PassengerStage({ expression, finished, avatar = null, phase = 0, background = "departure", actors, activeActorId, visitedActorIds = [], minute = 0, onSelectActor }: PassengerStageProps) {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (!avatar || !blinkFrames[avatar] || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let wait: ReturnType<typeof setTimeout>;
    let close: ReturnType<typeof setTimeout>;
    const schedule = () => {
      wait = setTimeout(() => {
        setBlinking(true);
        close = setTimeout(() => { setBlinking(false); schedule(); }, 135);
      }, 2800 + Math.random() * 3400);
    };
    schedule();
    return () => { clearTimeout(wait); clearTimeout(close); };
  }, [avatar]);
  return (
    <div className={`vn-stage vn-stage-phase-${Math.min(phase, 3)}${finished ? " vn-stage-finished" : ""}`}>
      <Image className="vn-stage-background" src={`/visual-novel/bg_${background}.webp`} alt="" fill sizes="100vw" priority unoptimized />
      <div className="vn-stage-wash" />
      {(actors?.length ? actors : avatar ? [{ id: "primary", name: "", portrait_key: avatar }] : []).map((actor, index) => {
        const isActive = !actors?.length || actor.id === activeActorId;
        const key = actor.portrait_key;
        const unread = !isActive && minute >= (actor.callout_after_minutes ?? Number.POSITIVE_INFINITY) && !visitedActorIds.includes(actor.id);
        const art = (
        <div key={actor.id} className={`vn-portrait-frame vn-character-${key} vn-emotion-${isActive ? expression : "thoughtful"}${isActive ? " is-active" : ` is-background is-background-${index % 2}`}`}>
          <div className="vn-portrait-art">
            <Image className="vn-passenger-sprite" src={portraits[key]} alt="" fill sizes="(max-width: 600px) 100vw, 520px" priority={isActive} unoptimized />
            {isActive && emotionFrames[key]?.[expression] && <Image key={emotionFrames[key]?.[expression]} className="vn-passenger-sprite vn-expression-frame" src={emotionFrames[key]![expression]!} alt="" fill sizes="(max-width: 600px) 100vw, 520px" unoptimized loading="eager" />}
            {isActive && blinkFrames[key] && <Image className={`vn-passenger-sprite vn-blink-frame${blinking ? " is-blinking" : ""}`} src={blinkFrames[key]} alt="" fill sizes="(max-width: 600px) 100vw, 520px" unoptimized loading="eager" />}
          </div>
          {!isActive && <span className="vn-actor-tag">{unread && <b aria-hidden="true">●</b>}{actor.name}</span>}
        </div>);
        return !isActive ? <button key={actor.id} type="button" className={`vn-actor-target is-background-${index % 2}`} disabled={!onSelectActor} onClick={() => onSelectActor?.(actor.id)} aria-label={`${unread ? "Новый разговор. " : ""}Поговорить: ${actor.name}`}>{art}</button> : art;
      })}
      <div className="vn-stage-vignette" />
    </div>
  );
}
