import type {
  CreateSessionDto,
  ScoreStateDto,
  SessionEventDto,
  SessionStateDto,
  SubmitActionDto,
} from "@vsm/api-contracts";

// No Node imports: these same rules can execute in a phone browser.
const ACTIONS = [
  {
    id: "ask_for_ticket",
    label: "Проверить билет, дату и канал покупки",
    durationMinutes: 1,
  },
  {
    id: "explain_rules",
    label: "Спокойно объяснить условия посадки",
    durationMinutes: 1,
  },
  {
    id: "offer_help",
    label: "Подсказать кассу или контактный центр",
    durationMinutes: 1,
  },
  {
    id: "close_conversation",
    label: "Уточнить, всё ли понятно, и завершить разговор",
    durationMinutes: 0.5,
  },
  {
    id: "allow_boarding",
    label: "Пропустить по подтверждению списания",
    durationMinutes: 0.5,
  },
  {
    id: "dismiss_passenger",
    label: "Отказать без объяснения",
    durationMinutes: 0.5,
  },
  { id: "wait", label: "Отложить разговор на две минуты", durationMinutes: 2 },
] as const;

export class SimulationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function createSession(
  input: CreateSessionDto,
  sessionId = globalThis.crypto.randomUUID(),
): SessionStateDto {
  if (input.scenarioId !== "boarding_no_ticket")
    throw new SimulationError("unknown_scenario");
  const seed =
    input.seed ??
    globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_648;
  const variant = ((Math.imul(seed, 1664525) + 1013904223) >>> 0) % 3;
  const replies = [
    "Деньги списались, а билет на почту не пришёл. Как мне уехать?",
    "Я покупал на сайте из рекламы. Вот списание — разве этого мало?",
    "В приложении только номер заказа. Поезд скоро уйдёт, помогите!",
  ];
  return {
    id: sessionId,
    scenarioId: input.scenarioId,
    mode: input.mode,
    difficulty: input.difficulty,
    seed,
    currentTimeMinutes: 0,
    currentLocationId: "car_01_boarding",
    scores: {
      safety: 100,
      service: 100,
      communication: 100,
      procedure: 100,
      timeManagement: 100,
      recovery: 100,
    },
    incidents: [
      {
        id: "boarding_no_ticket_primary",
        locationId: "car_01_boarding",
        status: "active",
        urgency: "medium",
        phase: 1,
        timeUntilEscalationMinutes: deadline(input.difficulty) / 2,
      },
    ],
    events: [
      {
        id: `${sessionId}:0`,
        type: "session_started",
        atMinute: 0,
        message:
          "Пассажир на посадке без действительного билета. Таймер и веса оценки — учебная настройка, не норматив.",
      },
    ],
    appliedIdempotencyKeys: [],
    appliedActions: [],
    completedActionIds: [],
    passengerReply: replies[variant]!,
    outcome: "active",
    availableActions: [...ACTIONS],
  };
}

export function applyAction(
  state: SessionStateDto,
  command: SubmitActionDto,
): SessionStateDto {
  const previous = state.appliedActions.find(
    (item) => item.key === command.idempotencyKey,
  );
  if (previous) {
    if (
      previous.actionId !== command.actionId ||
      previous.clientTimestamp !== command.clientTimestamp
    )
      throw new SimulationError("idempotency_conflict");
    return state;
  }
  if (state.outcome !== "active") throw new SimulationError("session_finished");
  const action = ACTIONS.find((item) => item.id === command.actionId);
  if (!action) throw new SimulationError("unknown_action");
  const next: SessionStateDto = structuredClone(state);
  next.currentTimeMinutes += action.durationMinutes;
  next.appliedIdempotencyKeys.push(command.idempotencyKey);
  next.appliedActions.push({
    key: command.idempotencyKey,
    actionId: command.actionId,
    clientTimestamp: command.clientTimestamp,
  });
  const done = (id: string) => state.completedActionIds.includes(id);
  const record = (
    message: string,
    type: SessionEventDto["type"] = "action_applied",
    atMinute = next.currentTimeMinutes,
  ) => {
    next.events.push({
      id: `${state.id}:${next.events.length}`,
      type,
      atMinute,
      message,
    });
  };
  const penalty = (
    metric: keyof ScoreStateDto,
    points: number,
    reason: string,
  ) => {
    next.scores[metric] = Math.max(0, next.scores[metric] - points);
    record(`${reason} (−${points})`);
  };
  record(action.label);
  if (done(action.id)) {
    penalty(
      "timeManagement",
      10,
      "Повторная проверка уже выполненного шага тратит время",
    );
    next.passengerReply = "Мы это уже обсуждали. Что мне делать дальше?";
  } else {
    switch (action.id) {
      case "ask_for_ticket":
        next.passengerReply =
          "Вот заказ и почта. Да, самого билета нет. Что теперь?";
        break;
      case "explain_rules":
        if (!done("ask_for_ticket"))
          penalty(
            "procedure",
            20,
            "Правило объяснено до проверки билета и обстоятельств покупки",
          );
        next.passengerReply =
          "Понимаю, списание — ещё не билет. К кому обратиться?";
        break;
      case "offer_help":
        if (!done("explain_rules"))
          penalty(
            "communication",
            15,
            "Направление в кассу без объяснения ограничения",
          );
        next.passengerReply =
          "Спасибо, обращусь в официальный контактный центр. Там помогут с заказом?";
        break;
      case "close_conversation":
        if (["ask_for_ticket", "explain_rules", "offer_help"].every(done)) {
          next.outcome = "resolved";
          next.passengerReply = "Да, теперь понятно. Спасибо за помощь.";
        } else {
          penalty(
            "service",
            20,
            "Разговор завершён без проверки, объяснения или маршрута помощи",
          );
          next.passengerReply =
            "Подождите, я так и не понял, как мне решить вопрос.";
        }
        break;
      case "allow_boarding":
        penalty(
          "procedure",
          70,
          "Списание не подтверждает наличие действительного билета",
        );
        next.outcome = "failed";
        next.passengerReply =
          "Вы разрешили посадку без действительного проездного документа.";
        break;
      case "dismiss_passenger":
        penalty("service", 50, "Пассажир остался без помощи");
        penalty("communication", 40, "Отказ без спокойного объяснения");
        next.outcome = "failed";
        next.passengerReply = "Но вы даже не объяснили, куда мне идти!";
        break;
      case "wait":
        penalty("timeManagement", 10, "Вопрос пассажира отложен");
        next.passengerReply = "Я жду. Поезд ведь не будет ждать меня?";
        break;
    }
    // Failed closing attempts must not prevent a later successful one.
    if (["ask_for_ticket", "explain_rules", "offer_help"].includes(action.id))
      next.completedActionIds.push(action.id);
  }
  const incident = next.incidents[0]!;
  const limit = deadline(state.difficulty);
  if (
    state.currentTimeMinutes < limit / 2 &&
    next.currentTimeMinutes >= limit / 2
  ) {
    incident.phase = 2;
    incident.urgency = "high";
    penalty(
      "timeManagement",
      10,
      "Разговор затянулся, очередь на посадке растёт",
    );
    record(
      "Пассажир торопится, очередь растёт",
      "incident_escalated",
      limit / 2,
    );
  }
  // Deadline wins even if the last action would otherwise resolve the case.
  if (next.currentTimeMinutes >= limit) {
    incident.phase = 3;
    incident.urgency = "critical";
    next.outcome = "failed";
    penalty("timeManagement", 30, "Учебное окно посадки закончилось");
    next.passengerReply =
      "Время истекло. Вопрос не решён до окончания посадки.";
  }
  incident.status =
    next.outcome === "active"
      ? "active"
      : next.outcome === "resolved"
        ? "resolved"
        : "failed";
  incident.timeUntilEscalationMinutes =
    next.outcome === "active"
      ? (incident.phase === 1 ? limit / 2 : limit) - next.currentTimeMinutes
      : null;
  next.availableActions = next.outcome === "active" ? [...ACTIONS] : [];
  if (next.outcome !== "active")
    record(
      next.outcome === "resolved"
        ? "Ситуация завершена: помощь предложена, правило посадки соблюдено"
        : "Ситуация завершена с ошибкой",
      "session_finished",
    );
  next.events.sort((left, right) => left.atMinute - right.atMinute);
  return next;
}

function deadline(difficulty: number): number {
  return 12 - difficulty * 2;
}
