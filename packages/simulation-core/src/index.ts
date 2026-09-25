import { randomUUID } from "node:crypto";

import type {
  CreateSessionDto,
  IncidentStateDto,
  SessionEventDto,
  SessionStateDto,
  SubmitActionDto,
} from "@vsm/api-contracts";

const INITIAL_LOCATION = "car_01_service_compartment";

export function createSession(
  input: CreateSessionDto,
  sessionId = randomUUID(),
): SessionStateDto {
  return {
    id: sessionId,
    scenarioId: input.scenarioId,
    mode: input.mode,
    difficulty: input.difficulty,
    seed: input.seed ?? randomSeed(),
    currentTimeMinutes: 0,
    currentLocationId: INITIAL_LOCATION,
    scores: {
      safety: 100,
      service: 100,
      communication: 100,
      procedure: 100,
      timeManagement: 100,
      recovery: 100,
    },
    incidents: initialIncidents(input.scenarioId),
    events: [event("session_started", 0, "Смена началась")],
    appliedIdempotencyKeys: [],
  };
}

export function applyAction(
  state: SessionStateDto,
  action: SubmitActionDto,
): SessionStateDto {
  if (state.appliedIdempotencyKeys.includes(action.idempotencyKey)) {
    return state;
  }

  const nextTime = state.currentTimeMinutes + action.durationMinutes;
  const escalationEvents: SessionEventDto[] = [];
  const incidents = state.incidents.map((incident) =>
    advanceIncident(
      incident,
      action.durationMinutes,
      nextTime,
      escalationEvents,
    ),
  );

  return {
    ...state,
    currentTimeMinutes: nextTime,
    currentLocationId: action.targetLocationId ?? state.currentLocationId,
    incidents,
    events: [
      ...state.events,
      event(
        "action_applied",
        nextTime,
        `Выполнено действие: ${action.actionId}`,
      ),
      ...escalationEvents,
    ],
    appliedIdempotencyKeys: [
      ...state.appliedIdempotencyKeys,
      action.idempotencyKey,
    ],
  };
}

function advanceIncident(
  incident: IncidentStateDto,
  elapsedMinutes: number,
  atMinute: number,
  events: SessionEventDto[],
): IncidentStateDto {
  if (
    incident.status !== "active" ||
    incident.timeUntilEscalationMinutes === null
  ) {
    return incident;
  }

  const timeLeft = incident.timeUntilEscalationMinutes - elapsedMinutes;
  if (timeLeft > 0) {
    return { ...incident, timeUntilEscalationMinutes: timeLeft };
  }

  const nextPhase = incident.phase + 1;
  events.push(
    event(
      "incident_escalated",
      atMinute,
      `Инцидент ${incident.id} перешёл в фазу ${nextPhase}`,
    ),
  );

  return {
    ...incident,
    phase: nextPhase,
    urgency: raiseUrgency(incident.urgency),
    status: nextPhase >= 4 ? "failed" : "active",
    timeUntilEscalationMinutes:
      nextPhase >= 4 ? null : escalationWindow(nextPhase),
  };
}

function initialIncidents(scenarioId: string): IncidentStateDto[] {
  return [
    {
      id: `${scenarioId}_primary`,
      locationId: "car_01_main_zone",
      status: "active",
      urgency: "medium",
      phase: 1,
      timeUntilEscalationMinutes: 4,
    },
  ];
}

function raiseUrgency(
  urgency: IncidentStateDto["urgency"],
): IncidentStateDto["urgency"] {
  const order: IncidentStateDto["urgency"][] = [
    "routine",
    "medium",
    "high",
    "critical",
  ];
  const index = order.indexOf(urgency);
  return order[Math.min(index + 1, order.length - 1)] ?? "critical";
}

function escalationWindow(phase: number): number {
  return Math.max(1, 5 - phase);
}

function event(
  type: SessionEventDto["type"],
  atMinute: number,
  message: string,
): SessionEventDto {
  return { id: randomUUID(), type, atMinute, message };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}
