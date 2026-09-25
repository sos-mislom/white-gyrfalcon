import type { ActorResponseDto, SessionStateDto } from "@vsm/api-contracts";

export function currentEmotionalCheck(state: SessionStateDto) {
  return state.outcome === "active" &&
    state.appliedActions.at(-1)?.actionId === "offer_help" &&
    state.events.some(
      (event) =>
        event.type === "check_resolved" &&
        event.atMinute === state.currentTimeMinutes,
    )
    ? state.checks.at(-1)
    : undefined;
}

function deskNumber(speech: string) {
  return /касс[а-яё]*\s*(?:№\s*)?(\d{1,3})/iu.exec(speech)?.[1];
}

// Rendering hints/fallback only. These functions cannot modify state or scores.
export function actorReference(state: SessionStateDto, speech: string): string {
  const desk = deskNumber(speech);
  const destination = desk ? `кассу №${desk}` : "указанное вами место";
  const check = currentEmotionalCheck(state);
  if (check)
    return {
      critical_success: `Большое спасибо за участие, вы очень помогли! Обращусь в ${destination}.`,
      success: `Ладно, пойду в ${destination}, хотя времени совсем мало.`,
      failure: `В ${destination}? Боюсь не успеть! Позовите начальника поезда.`,
      critical_failure: `В ${destination}?! Я буду жаловаться! Почему я должен бегать из-за ошибки?`,
    }[check.outcome];
  if (
    state.outcome === "active" &&
    state.appliedActions.at(-1)?.actionId === "explain_rules" &&
    desk
  )
    return `Понимаю, без билета нельзя. Мне нужно обратиться в кассу №${desk}?`;
  return state.passengerReply;
}

export function actorIsGrounded(
  state: SessionStateDto,
  actor: ActorResponseDto,
  speech: string,
): boolean {
  const check = currentEmotionalCheck(state);
  if (check) {
    const anchors = {
      critical_success: /спасибо|благодар/iu,
      success: /ладно|пойду|обращусь|соглас|хорошо/iu,
      failure: /начальник/iu,
      critical_failure: /жалоб|жалова/iu,
    };
    if (!anchors[check.outcome].test(actor.reply)) return false;
  }
  const desk = deskNumber(speech);
  if (
    desk &&
    (check || state.appliedActions.at(-1)?.actionId === "explain_rules") &&
    deskNumber(actor.reply) !== desk
  )
    return false;
  if (
    actor.consequenceId === "police_custody" &&
    (!/помогите|охран|полици/iu.test(actor.reply) ||
      /арестован|задержан|уже\s+прибыл/iu.test(actor.reply))
  )
    return false;
  return true;
}
