"use client";
import { useEffect, useRef, useState } from "react";
import type { SessionStateDto } from "@vsm/api-contracts";
import { getFeaturedScenario, getScenario, memoryAwareReply, replaySession } from "@vsm/simulation-core";
import { useTraining } from "../training/use-training";
import { listSavedSessions } from "../training/journal-storage";
import { linkLocalHistory, profileHistory } from "../training/device-profile";
import { passengerExpression } from "../training/passenger-scene";
import { useNovelViewport } from "../training/use-novel-viewport";
import { useGameClock } from "../training/use-game-clock";
import { queuePassengerSpeech, stopPassengerReply } from "../training/voice-session";
import { NarrationBanner, PassengerStage, PassengerDialogueBubble, ConductorComposer, DebriefModal, HomeMenu } from "../vn-ui";
import "./novel.css";

export default function HomePage() {
  const training = useTraining();
  const { session, busy, ready, error } = training;
  const screen = useNovelViewport();
  const [paused, setPaused] = useState(false);
  const [history, setHistory] = useState<SessionStateDto[]>([]);
  const resultTitle = useRef<HTMLHeadingElement>(null);
  const finished = Boolean(session && session.outcome !== "active");
  const clock = useGameClock(session, paused, busy, () => { void training.act("wait"); });

  useEffect(() => { if (finished) resultTitle.current?.focus(); }, [finished]);
  useEffect(() => {
    if (!ready || session) return;
    let current = true;
    void listSavedSessions().then(async (records) => {
      if (!current) return;
      const states = records.flatMap((record) => {
        try { return [replaySession(record.id, record.journal)]; }
        catch { return []; }
      });
      setHistory(states);
      if (!navigator.onLine) return;
      await linkLocalHistory(records).catch(() => undefined);
      const remote = await profileHistory().catch(() => []);
      if (current) setHistory([...new Map([...remote, ...states].map((state) => [state.id, state])).values()]);
    }).catch(() => undefined);
    return () => { current = false; };
  }, [ready, session]);

  const scenario = session ? getScenario(session.scenarioId) : undefined;
  const featured = getFeaturedScenario();
  const actors = scenario?.character && scenario.interactions?.actors.length
    ? [scenario.character, ...scenario.interactions.actors]
    : undefined;
  const activeActor = actors?.find(actor => actor.id === session?.currentActorId) ?? scenario?.character;
  const characterName = activeActor?.name ?? "В поезде";
  const feedback = training.record?.lastFreeform;
  const latest = session?.appliedActions.at(-1)?.key === feedback?.command.idempotencyKey ? feedback : undefined;
  const reply = latest?.actor.reply ?? (session ? memoryAwareReply(session) ?? session.passengerReply : "");
  const routeText = scenario ? `Белый кречет · ${scenario.location.zone}` : "Белый кречет";
  const finalReplyKey = session ? `${session.id}:final:${latest?.command.idempotencyKey ?? session.appliedActions.at(-1)?.clientTimestamp ?? ""}` : "";
  const finalVoiceGender = activeActor?.voice_profile?.gender ?? "neutral";

  useEffect(() => {
    if (!finished || !reply || !finalReplyKey) return;
    queuePassengerSpeech(reply, finalReplyKey, true, finalVoiceGender);
    return () => stopPassengerReply();
  }, [finished, reply, finalReplyKey, finalVoiceGender]);

  return (
    <main className={`vn-screen${session ? " vn-scene-screen" : " vn-menu-screen"}`} ref={screen} aria-label="Белый кречет">
      <h1 className="vn-sr-only">Белый кречет — интерактивная история проводника</h1>
      <PassengerStage
        key={session ? `${session.id}:${session.currentLocationId}` : "menu"}
        expression={passengerExpression(session, latest)}
        finished={finished}
        avatar={activeActor?.portrait_key ?? null}
        actors={actors}
        activeActorId={session?.currentActorId}
        visitedActorIds={[scenario?.character?.id ?? "", ...(session?.appliedActions.filter(action => action.actionId.startsWith("focus:")).map(action => action.actionId.slice(6)) ?? [])]}
        minute={session?.currentTimeMinutes}
        onSelectActor={session && !busy && !paused && !finished ? (id) => { stopPassengerReply(); void training.act(`focus:${id}`); } : undefined}
        background={scenario?.visual.background ?? "departure"}
        phase={session?.incidents[0]?.phase ?? 0}
      />

      {!session && <HomeMenu ready={ready} busy={busy} history={history} featuredId={featured.scenario_id} onSelect={(id) => { void training.start(id); }} onRandom={() => { void training.start("random"); }} />}

      {session && !finished && <>
        <NarrationBanner clock={clock} onPause={() => { stopPassengerReply(); setPaused(true); }} />
        <div className="vn-dialogue-area">
          <PassengerDialogueBubble name={characterName} text={training.clarification ?? training.draftReply ?? reply} isDraft={Boolean(training.draftReply)} isThinking={busy && !training.draftReply} />
          <ConductorComposer
            busy={busy} active pending={training.record?.pendingFreeform} error={training.aiError}
            reply={training.clarification ?? reply} draftReply={training.draftReply}
            replyKey={training.clarification ? `${session.id}:clarification:${training.record?.revision ?? 0}` : (training.record?.pendingFreeform?.clientTimestamp ?? latest?.command.clientTimestamp ?? session.appliedActions.at(-1)?.clientTimestamp ?? session.id)}
            onSubmit={training.freeform} disabled={Boolean(error) || paused} muted={paused}
            voiceGender={activeActor?.voice_profile?.gender ?? "neutral"}
            speakerId={activeActor?.id}
          />
        </div>
      </>}

      {finished && session && <DebriefModal session={session} reply={reply} feedback={latest} characterName={characterName} onRestart={() => training.start(session.scenarioId)} onMenu={() => training.exitToMenu()} disabled={busy || Boolean(error)} titleRef={resultTitle} />}

      {error && <p className="vn-fatal-alert" role="alert">{error}</p>}
      {paused && session && !finished && <div className="vn-pause-scrim">
        <section className="vn-pause-panel" role="dialog" aria-modal="true" aria-labelledby="vn-pause-title">
          <p className="vn-pause-eyebrow">ПАУЗА <span>· {clock} до отправления</span></p>
          <h2 id="vn-pause-title">{scenario?.title ?? "Смена"}</h2>
          <p>{routeText}</p>
          <div className="vn-pause-actions"><button type="button" onClick={() => setPaused(false)}>Продолжить</button><button type="button" disabled={busy} onClick={() => { void training.exitToMenu(); setPaused(false); }}>Выйти в меню</button></div>
        </section>
      </div>}
    </main>
  );
}
