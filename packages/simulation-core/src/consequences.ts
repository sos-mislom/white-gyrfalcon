import type {
  AllowedConsequenceDto,
  SessionStateDto,
} from "@vsm/api-contracts";

export const BOARDING_SOURCE =
  "Ситуации на борту, ситуация 1, стр. 3; ролевая модель, стр. 2";

export function allowedConsequences(
  state: SessionStateDto,
): AllowedConsequenceDto[] {
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
  return [{ id: "respond_to_current_step", description: state.passengerReply }];
}
