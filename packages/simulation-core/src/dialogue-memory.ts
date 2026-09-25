import type { SessionStateDto } from "@vsm/api-contracts";

const steps: Record<string, string> = {
  ask_for_ticket:
    "Сотрудник проверил билет и обстоятельства покупки; действительного билета нет.",
  explain_rules:
    "Сотрудник объяснил: списание денег не является билетом, без билета посадка запрещена.",
  offer_help: "Сотрудник назвал маршрут помощи: касса или контактный центр.",
  close_conversation: "Сотрудник уточнил понимание и попрощался.",
  allow_boarding:
    "Сотрудник разрешил посадку без билета — нарушение регламента.",
  dismiss_passenger: "Сотрудник отказал без помощи.",
  wait: "Сотрудник попросил подождать.",
};

/** Semantic history from committed actions, not an invented verbatim transcript. */
export function dialogueMemory(state: SessionStateDto) {
  return {
    completedActionIds: state.completedActionIds,
    rulesExplained: state.completedActionIds.includes("explain_rules"),
    helpOffered: state.completedActionIds.includes("offer_help"),
    history: state.appliedActions.slice(-6).map((action) => ({
      actionId: action.actionId,
      summary: steps[action.actionId] ?? action.actionId,
    })),
  };
}

export function memoryAwareReply(state: SessionStateDto): string | undefined {
  if (state.outcome !== "active") return;
  const memory = dialogueMemory(state);
  const last = state.appliedActions.at(-1)?.actionId;
  if (!last || ["allow_boarding", "dismiss_passenger"].includes(last)) return;
  if (memory.helpOffered)
    return "Хорошо, маршрут помощи я понял. Успею ли обратиться до отправления?";
  if (memory.rulesExplained)
    return "Хорошо, я понял: списание — не билет. Что мне теперь делать, куда обратиться?";
}
