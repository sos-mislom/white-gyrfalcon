import type {
  AllowedConsequenceDto,
  SessionStateDto,
} from "@vsm/api-contracts";

export const BOARDING_SOURCE =
  "Ситуации на борту, ситуация 1, стр. 3; ролевая модель, стр. 2";

export function allowedConsequences(
  state: SessionStateDto,
): AllowedConsequenceDto[] {
  const last = state.appliedActions.at(-1);
  if (
    last?.actionId === "dismiss_passenger" &&
    last.conduct === "violent_threat" &&
    state.scores.safety === 0
  )
    return [
      {
        id: "police_custody",
        description:
          "Сотрудник угрожал пассажиру. Пассажир громко привлекает охрану: «Помогите! Сотрудник поезда угрожает расправой! Охрана, полиция!» Это обращение за защитой, не установленный факт задержания. Не придумывать наличие тревожной кнопки, прибытие полиции или приговор.",
      },
    ];
  // The actor may phrase this outcome, but cannot choose new state transitions.
  if (
    state.appliedActions.at(-1)?.actionId === "allow_boarding" &&
    state.currentTimeMinutes < 12 - 2 * state.difficulty
  )
    return [
      {
        id: "boarding_permission_granted",
        description:
          "Сотрудник разрешил пассажиру пройти без действительного билета. Пассажир получил разрешение и доволен уступкой. Нарушение совершил сотрудник; пассажиру не отказали. Не утверждать, что билет появился.",
      },
    ];
  if (state.outcome === "failed")
    return [{ id: "failed_case", description: state.passengerReply }];
  if (state.outcome === "resolved")
    return [
      {
        id:
          state.passengerLoyalty < 0
            ? "unhappy_but_informed"
            : "understands_next_step",
        description: state.passengerReply,
      },
    ];
  const check = state.checks.at(-1);
  if (
    last?.actionId === "offer_help" &&
    check &&
    state.events.some(
      (event) =>
        event.type === "check_resolved" &&
        event.atMinute === state.currentTimeMinutes,
    )
  ) {
    const emotions = {
      critical_success: "Максимально благодарен за участие и эмпатию.",
      success: "Ворчит, но соглашается следовать совету.",
      failure:
        "Паникует, сомневается, просит начальника поезда; начальник ещё не прибыл.",
      critical_failure:
        "Кричит и угрожает подать жалобу; жалоба ещё не подана.",
    };
    return [
      {
        id: "respond_to_current_step",
        description: `${state.passengerReply} Эмоция d20: ${emotions[check.outcome]} Билет не появился, допуск не разрешён. Профессиональные баллы от эмоции не меняются.`,
      },
    ];
  }
  return [{ id: "respond_to_current_step", description: state.passengerReply }];
}
