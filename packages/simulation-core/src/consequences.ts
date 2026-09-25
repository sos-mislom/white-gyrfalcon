import type {
  AllowedConsequenceDto,
  SessionStateDto,
} from "@vsm/api-contracts";
import { boardingContext } from "./boarding-context";

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

/** Verified response pool. Seeded wording and emotion never change the resolved state. */
export function standardPassengerReply(
  state: SessionStateDto,
  speech: string,
): string | undefined {
  const last = state.appliedActions.at(-1);
  if (
    !last ||
    ![
      "ask_for_ticket",
      "explain_rules",
      "offer_help",
      "close_conversation",
    ].includes(last.actionId)
  )
    return;
  if (state.outcome === "failed") return state.passengerReply;
  const desk = /касс[а-яё]*\s*(?:№\s*)?(\d{1,3})/iu.exec(speech)?.[1];
  const destination = desk
    ? `кассу №${desk}`
    : /контактный центр/iu.test(speech)
      ? "контактный центр"
      : "указанное вами место";
  const variant = (state.seed + state.appliedActions.length) % 2;
  let pool: string[];
  switch (last.actionId) {
    case "ask_for_ticket":
      pool = [
        "Вот заказ и почта. Самого билета нет — что мне делать?",
        "Показываю заказ. Билет так и не пришёл, помогите разобраться.",
      ];
      break;
    case "explain_rules":
      pool = [
        `Понимаю, списание — ещё не билет.${desk ? ` Мне обратиться в ${destination}?` : " Что делать дальше?"}`,
        `Без билета нельзя, понял.${desk ? ` Как решить вопрос через ${destination}?` : " К кому обратиться?"}`,
      ];
      break;
    case "offer_help": {
      const check = state.checks.at(-1);
      if (!check || !state.events.some(event => event.type === "check_resolved" && event.atMinute === state.currentTimeMinutes)) return state.passengerReply;
      const choices = {
        critical_success: [
          `Большое спасибо за участие! Обращусь в ${destination}.`,
          `Вы очень помогли, спасибо! Пойду в ${destination}.`,
        ],
        success: [
          `Ладно, пойду в ${destination}, хотя времени совсем мало.`,
          `Хорошо, обращусь в ${destination}. Только бы не опоздать.`,
        ],
        failure: [
          `В ${destination}? Боюсь не успеть! Позовите начальника поезда.`,
          `А в ${destination} точно помогут? Я волнуюсь, хочу поговорить с начальником поезда.`,
        ],
        critical_failure: [
          `В ${destination}?! Я буду жаловаться! Почему я должен бегать из-за ошибки?`,
          `Опять в ${destination}?! Это возмутительно, подам жалобу!`,
        ],
      };
      pool = choices[check.outcome];
      break;
    }
    default:
      pool = [state.passengerReply];
  }
  const pad = boardingContext(
    state.seed,
    state.difficulty,
    state.currentTimeMinutes,
    last.communication,
  ).emotional_state;
  const urgency =
    pad.arousal >= 0.65 && state.outcome === "active"
      ? "Скорее, времени мало! "
      : "";
  const interruption =
    last.communication?.interrupted && last.communication.rude
      ? "Не перебивайте меня! "
      : "";
  return interruption + urgency + pool[variant % pool.length]!;
}
