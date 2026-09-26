import type { AllowedConsequenceDto, NluAnalysisDto, SessionStateDto } from "@vsm/api-contracts";
import { getScenario } from "@vsm/simulation-core";
import { currentEmotionalCheck } from "./actor-grounding";

export interface ActorContextInput {
  employee_speech: string;
  markers: NluAnalysisDto["markers"];
  previousPassengerReply?: string;
}

/** The scene describes motives; the journal supplies the conversation. No scene-specific prompt branches. */
export function buildActorContext(state: SessionStateDto, consequence: AllowedConsequenceDto, input: ActorContextInput): string {
  const scenario = getScenario(state.scenarioId);
  if (!scenario) throw new Error("unknown_scenario");
  const actor = scenario.interactions?.actors.find((item) => item.id === state.currentActorId) ?? scenario.character;
  const lastAction = state.appliedActions.at(-1)?.actionId ?? "wait";
  const direction = lastAction === "wait" ? scenario.incident.escalation.idle_vector
    : lastAction === "converse" ? scenario.incident.escalation.conversation_vector
    : scenario.incident.branches.find((branch) => branch.action_id === lastAction)?.intent_label ?? "Реагируй на последнее действие.";
  const primaryActorId = scenario.character?.id;
  const previousTurns = state.appliedActions.slice(0, -1);
  const history = previousTurns.map((turn, index) => {
    const speaker = scenario.interactions?.actors.find((item) => item.id === turn.actorId)
      ?? (turn.actorId === primaryActorId || !turn.actorId ? scenario.character : undefined);
    const employee = turn.utterance?.replace(/\s+/gu, " ").trim().slice(0, 180);
    const reply = turn.actorReply?.replace(/\s+/gu, " ").trim().slice(0, 180);
    return `${index + 1}. Проводник${employee ? `: «${employee}»` : `: действие ${turn.actionId}`}${reply ? `; ${speaker?.name ?? "Пассажир"}: «${reply}»` : ""}`;
  });
  const fullHistory = history.join("\n");
  const memory = fullHistory.length <= 6000 ? fullHistory || "Диалог только начался."
    : `${history.slice(0, 2).join("\n")}\n…\n${fullHistory.slice(-5000)}`;
  const priorReply = [...previousTurns].reverse().find((turn) =>
    turn.actorReply && (turn.actorId ?? primaryActorId) === (actor?.id ?? primaryActorId))?.actorReply
    ?? (state.currentActorId === primaryActorId ? input.previousPassengerReply : undefined);
  const identity = actor ? `${actor.name}, ${actor.role}. Характер: ${actor.archetype}.` : "пассажир поезда";

  return [
    "=== РОЛЬ ===",
    `Ты — ${identity} Говоришь только за этого персонажа, от первого лица.`,
    "Ты пассажир. Не проводник, не рассказчик и не оценщик. Не произноси реплики других персонажей.",
    "",
    "=== СЦЕНА ===",
    `Ситуация: ${scenario.incident.context_description ?? scenario.title}`,
    actor?.dialogue_vector ? `Мотив: ${actor.dialogue_vector}` : "",
    `Место: ${state.currentLocationId}. Прошло минут: ${state.currentTimeMinutes}.`,
    `Выполнено: ${state.completedActionIds.join(", ") || "ничего"}.`,
    `Вектор реакции: ${direction}`,
    `Эмоциональный исход: ${currentEmotionalCheck(state)?.outcome ?? "none"}. Грубость проводника: ${input.markers.rude}.`,
    `Последствие (факт, не готовая реплика): ${consequence.description}`,
    "",
    "=== ПАМЯТЬ ДИАЛОГА ===",
    memory,
    priorReply ? `Твоя последняя реплика: «${priorReply.slice(0, 180)}»` : "",
    "",
    "=== СЛОВА ПРОВОДНИКА СЕЙЧАС ===",
    `«${input.employee_speech.slice(0, 500)}»`,
    "",
    "=== ОТВЕТ ===",
    "Ответь естественно, одной репликой до 35 слов. Помни сказанное ранее, реагируй на смысл последней фразы.",
    "Допустим короткий разговор на отвлечённую тему, если он не противоречит мотиву и обстановке.",
    "Не повторяй дословно слова проводника и свой прошлый ответ. Не придумывай новые события или полномочия.",
    "Не обещай действий проводника от своего имени. Только JSON: {\"reply\":\"...\"}",
  ].filter(Boolean).join("\n");
}
