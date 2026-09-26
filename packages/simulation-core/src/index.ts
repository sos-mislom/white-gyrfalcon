import type { CreateSessionDto, SessionEventDto, SessionStateDto, SubmitActionDto, SyncSessionDto } from "@vsm/api-contracts";
import { ENGINE_VERSION } from "@vsm/api-contracts";
import { resolveEmotionalD20 } from "./d20";
import { getScenario, getRandomScenario, getFeaturedScenario, listScenarios, loadAllScenarios, requireScenario, type ScenarioSummaryDto } from "./scenario-loader";

export { resolveD20, resolveEmotionalD20 } from "./d20";
export { dialogueMemory, memoryAwareReply } from "./dialogue-memory";
export { sceneAnalysis } from "./scene-analysis";
export { getScenario, getRandomScenario, getFeaturedScenario, listScenarios, loadAllScenarios, requireScenario, type ScenarioSummaryDto };
export { allowedConsequences, SCENE_SOURCE } from "./consequences";

export class SimulationError extends Error {
  constructor(public readonly code: string) { super(code); }
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const loyalty = (n: number) => Math.max(-100, Math.min(100, n));
function deadlines(state: SessionStateDto) {
  const rule = requireScenario(state.scenarioId).incident.escalation;
  const adjustment = (state.difficulty - 1) * 2;
  return { warning: Math.max(1, rule.warning_minutes - adjustment),
    failure: Math.max(2, rule.deadline_minutes - adjustment) };
}

export function createSession(input: CreateSessionDto,
  sessionId: string = globalThis.crypto.randomUUID(),
  engineVersion: SessionStateDto["engineVersion"] = ENGINE_VERSION): SessionStateDto {
  if (engineVersion !== ENGINE_VERSION) throw new SimulationError("engine_version_mismatch");
  const seed = input.seed ?? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_648;
  const scene = input.scenarioId === "random" ? getRandomScenario(seed) : getScenario(input.scenarioId);
  if (!scene) throw new SimulationError("unknown_scenario");
  const incident = scene.incident;
  const locationId = scene.location.zone;
  const warning = Math.max(1, incident.escalation.warning_minutes - (input.difficulty - 1) * 2);
  return {
    id: sessionId, engineVersion, scenarioId: scene.scenario_id, mode: input.mode,
    difficulty: input.difficulty, seed, currentTimeMinutes: 0, currentLocationId: locationId,
    currentActorId: scene.character?.id,
    passengerLoyalty: 0, checks: [],
    scores: { safety: 100, service: 100, communication: 100, procedure: 100, timeManagement: 100, recovery: 100 },
    incidents: [{ id: `${scene.scenario_id}_primary`, locationId, status: "active",
      urgency: incident.urgency, phase: 1, timeUntilEscalationMinutes: warning }],
    events: [{ id: `${sessionId}:0`, type: "session_started", atMinute: 0,
      message: `${scene.title}. Таймер и веса оценки — учебная настройка, не норматив.` }],
    appliedIdempotencyKeys: [], appliedActions: [], completedActionIds: [], dialogueSummary: "",
    passengerReply: incident.initial_speech ?? incident.context_description ?? scene.title,
    outcome: "active",
    availableActions: [
      ...incident.branches.map(b => ({ id: b.action_id, label: b.intent_label, durationMinutes: b.duration_minutes })),
      { id: "wait", label: "Ожидать две минуты", durationMinutes: 2 },
      { id: "converse", label: "Продолжить разговор", durationMinutes: 0.5 },
      { id: "leave_scene", label: "Покинуть ситуацию", durationMinutes: 0.1 },
    ],
  };
}

export function applyAction(state: SessionStateDto, command: SubmitActionDto): SessionStateDto {
  const previous = state.appliedActions.find(item => item.key === command.idempotencyKey);
  if (previous) {
    if (previous.actionId !== command.actionId || previous.conduct !== command.conduct ||
      previous.utterance !== command.utterance || previous.actorReply !== command.actorReply || previous.actorId !== command.actorId ||
      previous.clientTimestamp !== command.clientTimestamp ||
      JSON.stringify(previous.communication) !== JSON.stringify(command.communication))
      throw new SimulationError("idempotency_conflict");
    return state;
  }
  if (state.engineVersion !== ENGINE_VERSION) throw new SimulationError("engine_version_mismatch");
  if (state.outcome !== "active") throw new SimulationError("session_finished");
  const scene = requireScenario(state.scenarioId);
  const focusedActorId = command.actionId.startsWith("focus:") ? command.actionId.slice(6) : null;
  const focusedActor = focusedActorId === scene.character?.id
    ? { ...scene.character, zone: scene.location.zone, initial_speech: scene.incident.initial_speech ?? scene.incident.context_description ?? scene.title }
    : scene.interactions?.actors.find(actor => actor.id === focusedActorId);
  const branch = scene.incident.branches.find(b => b.action_id === command.actionId);
  const action = state.availableActions.find(a => a.id === command.actionId);
  if ((!action && !focusedActor) || (!branch && !focusedActor && !["wait", "converse", "leave_scene"].includes(command.actionId))) throw new SimulationError("unknown_action");
  if (command.conduct && command.actionId !== "dismiss_passenger") throw new SimulationError("invalid_conduct");
  const next = structuredClone(state);
  next.currentTimeMinutes += action?.durationMinutes ?? 0.1;
  next.appliedIdempotencyKeys.push(command.idempotencyKey);
  next.appliedActions.push({ key: command.idempotencyKey, actionId: command.actionId,
    clientTimestamp: command.clientTimestamp,
    ...(command.conduct ? { conduct: command.conduct } : {}),
    ...(command.utterance ? { utterance: command.utterance } : {}),
    ...(command.actorReply ? { actorReply: command.actorReply } : {}),
    ...(command.actorId ? { actorId: command.actorId } : {}),
    ...(command.communication ? { communication: command.communication } : {}) });
  if (command.utterance && command.actorId && !next.completedActionIds.includes(`talk:${command.actorId}`))
    next.completedActionIds.push(`talk:${command.actorId}`);
  const earlier = next.appliedActions.slice(0, -3);
  const recent = next.appliedActions.slice(-3);
  next.dialogueSummary = [
    earlier.length ? `Ранее: ${[...new Set(earlier.map(a => a.actionId))].join(", ")}.` : "",
    ...recent.map(a => `Проводник (${a.actionId}${a.actorId ? `, ${a.actorId}` : ""}): ${a.utterance?.replace(/\s+/g, " ").slice(0, 120) ?? "действие без реплики"}${a.actorReply ? `; персонаж: ${a.actorReply.replace(/\s+/g, " ").slice(0, 120)}` : ""}`),
  ].filter(Boolean).join(" ").slice(-1000);
  const record = (message: string, type: SessionEventDto["type"] = "action_applied", atMinute = next.currentTimeMinutes) =>
    next.events.push({ id: `${state.id}:${next.events.length}`, type, atMinute, message });
  const penalty = (metric: keyof typeof next.scores, amount: number, reason: string) => {
    next.scores[metric] = clamp(next.scores[metric] - amount);
    record(`${reason} (−${amount})`);
  };
  record(action?.label ?? `Поговорить: ${focusedActor?.name}`);
  if (command.communication?.interrupted && command.communication.rude)
    penalty("communication", 10, "Грубое перебивание");
  const escalation = scene.incident.escalation;
  const incident = next.incidents[0]!;
  if (focusedActor) {
    next.currentActorId = focusedActor.id;
    next.currentLocationId = focusedActor.zone;
    next.passengerReply = [...state.appliedActions].reverse().find(item => item.actorId === focusedActor.id && item.actorReply)?.actorReply ?? focusedActor.initial_speech;
  } else if (command.actionId === "leave_scene") {
    next.outcome = "abandoned";
    next.passengerReply = "Ситуация осталась без решения.";
  } else if (command.conduct === "violent_threat") {
    next.outcome = "failed";
    next.scores.safety = 0;
    next.passengerReply = "Проводник угрожал пассажиру; пассажир зовёт на помощь. Прибытие полиции не установлено.";
    record("Прямая угроза пассажиру", "incident_escalated");
  } else if (command.actionId === "wait") {
    penalty("timeManagement", escalation.idle_time_penalty, "Вопрос оставлен без ответа");
    next.passengerReply = escalation.idle_vector;
  } else if (command.actionId === "converse") {
    next.passengerReply = escalation.conversation_vector;
  } else if (state.completedActionIds.includes(command.actionId)) {
    penalty("timeManagement", escalation.wrong_action_penalty, "Повтор уже выполненного шага");
    next.passengerReply = escalation.wrong_action_vector;
  } else if (branch) {
    const missing = branch.requires.filter(id => !next.completedActionIds.includes(id));
    if (missing.length) {
      const rule = branch.missing_requirement;
      next.passengerReply = rule?.reaction_vector ?? escalation.wrong_action_vector;
      next.scores.procedure = clamp(next.scores.procedure + (rule?.procedure_delta ?? -10));
      if ((rule?.status ?? "escalating") === "escalating") {
        incident.phase = 2; incident.urgency = "high";
      }
      record(`Не выполнены предварительные действия: ${missing.join(", ")}`, "incident_escalated");
    } else {
      const currentCharacter = scene.interactions?.actors.find(actor => actor.id === state.currentActorId) ?? scene.character;
      const check = resolveEmotionalD20(state.seed, state.checks.length, branch.action_id,
        scene.incident.difficulty_dc + (state.difficulty - 1) * 2, 0, branch.sop_bonus,
        Boolean(command.communication?.polite && command.communication.empathy),
        Boolean(command.communication?.rude || (currentCharacter?.psychological_state.stress ?? 0) > 70));
      next.checks.push(check);
      const outcome = branch.outcomes[check.outcome] ?? branch.outcomes.success ?? branch.outcomes.failure;
      if (!outcome) throw new SimulationError("missing_branch_outcome");
      next.passengerReply = outcome.reaction_vector;
      next.scores.procedure = clamp(next.scores.procedure + (outcome.procedure_delta ?? 0));
      next.scores.safety = clamp(next.scores.safety + (outcome.safety_delta ?? 0));
      next.scores.service = clamp(next.scores.service + (outcome.service_delta ?? 0));
      next.passengerLoyalty = loyalty(next.passengerLoyalty + (outcome.nps_delta ?? 0));
      if (outcome.status === "resolved") next.outcome = "resolved";
      if (outcome.status === "failed") next.outcome = "failed";
      if (outcome.status === "escalating") {
        incident.phase = 2; incident.urgency = "high";
        penalty("timeManagement", escalation.wrong_action_penalty, "Ситуация обострилась");
      }
      next.completedActionIds.push(command.actionId);
      record(`Проверка d20=${check.roll}, итог=${check.total}, DC=${check.dc}, ${check.outcome}`, "check_resolved");
    }
  }
  const { warning, failure } = deadlines(state);
  if (next.outcome === "active" && incident.phase === 1 && next.currentTimeMinutes >= warning) {
    incident.phase = 2; incident.urgency = "high";
    next.passengerReply = escalation.warning_vector;
    penalty("timeManagement", escalation.warning_time_penalty, "Истекло время до предупреждения");
    record(escalation.warning_vector, "incident_escalated", warning);
  }
  if (next.outcome === "active" && next.currentTimeMinutes >= failure) {
    incident.phase = 3; incident.urgency = "critical"; next.outcome = "failed";
    if (command.conduct !== "violent_threat") next.passengerReply = escalation.failure_vector;
    penalty("timeManagement", escalation.failure_time_penalty, "Срок решения истёк");
    record(escalation.failure_vector, "incident_escalated", failure);
  }
  incident.status = next.outcome === "active" ? "active" : next.outcome === "resolved" ? "resolved" : "failed";
  incident.timeUntilEscalationMinutes = next.outcome === "active"
    ? Math.max(0, (incident.phase === 1 ? warning : failure) - next.currentTimeMinutes) : null;
  next.availableActions = next.outcome === "active" ? [...state.availableActions] : [];
  if (next.outcome !== "active") record(next.outcome === "resolved" ? "Ситуация разрешена" : next.outcome === "abandoned" ? "Ситуация покинута" : "Ситуация завершена с ошибкой", "session_finished");
  next.events.sort((a, b) => a.atMinute - b.atMinute);
  return next;
}

export function replaySession(id: string, journal: SyncSessionDto): SessionStateDto {
  return mergeJournal(id, journal);
}
export function mergeJournal(id: string, journal: SyncSessionDto, current?: SessionStateDto): SessionStateDto {
  if (journal.engineVersion !== ENGINE_VERSION || (current && current.engineVersion !== journal.engineVersion))
    throw new SimulationError("engine_version_mismatch");
  if (new Set(journal.commands.map(c => c.idempotencyKey)).size !== journal.commands.length)
    throw new SimulationError("duplicate_journal_key");
  const canonical = getScenario(journal.setup.scenarioId)?.scenario_id;
  if (!canonical) throw new SimulationError("unknown_scenario");
  if (current && (current.id !== id || current.seed !== journal.setup.seed ||
    current.scenarioId !== canonical || current.mode !== journal.setup.mode ||
    current.difficulty !== journal.setup.difficulty)) throw new SimulationError("session_setup_conflict");
  let state = current ?? createSession(journal.setup, id, journal.engineVersion);
  const shared = Math.min(state.appliedActions.length, journal.commands.length);
  for (let index = 0; index < shared; index++) {
    const stored = state.appliedActions[index]!, command = journal.commands[index]!;
    if (stored.key !== command.idempotencyKey || stored.actionId !== command.actionId ||
      stored.utterance !== command.utterance || stored.actorReply !== command.actorReply ||
      stored.actorId !== command.actorId ||
      stored.conduct !== command.conduct || stored.clientTimestamp !== command.clientTimestamp ||
      JSON.stringify(stored.communication) !== JSON.stringify(command.communication))
      throw new SimulationError("journal_conflict");
  }
  for (const command of journal.commands.slice(state.appliedActions.length)) state = applyAction(state, command);
  return state;
}
