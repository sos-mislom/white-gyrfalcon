import type { ActorResponseDto, ScenarioDefinitionDto, SessionStateDto } from "@vsm/api-contracts";
import { getScenario } from "@vsm/simulation-core";

export function currentEmotionalCheck(state: SessionStateDto) {
  return state.events.some(event => event.type === "check_resolved" && event.atMinute === state.currentTimeMinutes)
    ? state.checks.at(-1) : undefined;
}

/** Used only when the model is unavailable. No scene-specific final lines. */
export function actorReference(state: SessionStateDto, _speech: string): string {
  return state.outcome === "resolved" ? "Спасибо за помощь."
    : state.outcome === "failed" ? "Подождите, мне всё ещё нужна помощь."
    : "Я слушаю. Что будем делать дальше?";
}

export function actorDraftCanSurface(state: SessionStateDto, draft: string): boolean {
  if (draft.length < 12) return false;
  if (!/[.!?](?:\s|$)/u.test(draft)) return false;
  const scene = getScenario(state.scenarioId);
  if (!scene) return false;
  if (/^(?:я не могу вас посадить|посадка без билета|без билета посадка|покажите (?:мне )?билет|я разрешаю вам|пройдите|обратитесь)/iu.test(draft))
    return false;
  const first = draft.split(/[.!?]/u)[0] ?? draft;
  const action = state.appliedActions.at(-1)?.actionId;
  if (soundsLikeEmployee(first) || repeatsEmployee(first, state.appliedActions.at(-1)?.utterance)) return false;
  if (state.outcome !== "resolved" && claimsFinalResolution(first)) return false;
  if (forbiddenReply(scene.grounding, action, first)) return false;
  const required = action && scene.grounding?.required_terms_by_action[action];
  return !required || new RegExp(required, "iu").test(first);
}

export function actorIsGrounded(state: SessionStateDto, actor: ActorResponseDto, speech: string): boolean {
  const scene = getScenario(state.scenarioId);
  if (!scene) return false;
  const reply = actor.reply.trim();
  if (!reply || /^(?:покажите|предъявите|пройдите|обратитесь|посадка без билета|без билета посадка|я не могу вас посадить|я разрешаю)/iu.test(reply))
    return false;
  if (soundsLikeEmployee(reply) || repeatsEmployee(reply, speech)) return false;
  if (state.outcome !== "resolved" && claimsFinalResolution(reply)) return false;
  const action = state.appliedActions.at(-1)?.actionId;
  if (actor.consequenceId !== "safety_threat" && forbiddenReply(scene.grounding, action, reply))
    return false;
  const previous = state.appliedActions.at(-2);
  if (previous?.actorReply && previous.actionId !== action &&
    previous.actorReply.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]/gu, "") ===
      reply.toLocaleLowerCase("ru").replace(/[^\p{L}\p{N}]/gu, ""))
    return false;
  const required = action && scene.grounding?.required_terms_by_action[action];
  if (required && !new RegExp(required, "iu").test(reply)) return false;
  if (actor.consequenceId === "safety_threat" && /(?:уже\s+прибыл|арестован|задержан)/iu.test(reply))
    return false;
  return true;
}

function claimsFinalResolution(text: string): boolean {
  return /(?:вс[её]\s+(?:в\s+порядке|хорошо|ок(?:ей)?)|(?:вопрос|проблема|ситуация)\s+(?:решен[аоы]?|решён[аоы]?|закрыт[аоы]?)|(?:мне|нам)\s+(?:больше\s+)?(?:ничего\s+не\s+нужно|помощь\s+не\s+нужна))/iu.test(text);
}

function soundsLikeEmployee(text: string): boolean {
  return /(?:^|[.!?]\s*)(?:я\s+)?(?:проверю|посмотрю|уточню|помогу|оформлю|направлю|свяжусь|разберусь|разрешаю|объясню|получу\s+информацию\s+и\s+помогу)(?![\p{L}])/iu.test(text)
    || /(?:ваши?\s+(?:данные|билет|заказ)\s+(?:не\s+)?(?:подтверждены|числятся))|(?:нужно\s+проверить\s+ваши?\s+(?:данные|билет))/iu.test(text);
}

function repeatsEmployee(reply: string, speech: string | undefined): boolean {
  if (!speech) return false;
  const normalized = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const heard = normalized(speech);
  const answer = normalized(reply);
  return heard.length >= 20 && (answer === heard || answer.startsWith(`${heard} `));
}

function forbiddenReply(
  grounding: ScenarioDefinitionDto['grounding'],
  action: string | undefined,
  text: string,
): boolean {
  const patterns = [
    ...(grounding?.forbidden_reply_patterns ?? []),
    ...(action ? grounding?.forbidden_reply_patterns_by_action[action] ?? [] : []),
  ];
  return patterns.some(pattern => new RegExp(pattern, "iu").test(text));
}
