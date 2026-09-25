import type { NluAnalysisDto } from "@vsm/api-contracts";

/** Closed grammar, not similarity search. Unmatched suffixes and mixed intents use NLU. */
export function standardAnalysis(
  input: string,
  completed: readonly string[] = [],
): NluAnalysisDto | undefined {
  if (!input.trim() || input.trim().length > 500) return;
  const text = input
    .trim()
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е")
    .replace(/[,.!?—–]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let action: string | undefined;
  const confirmed =
    ["ask_for_ticket", "explain_rules", "offer_help"].every((id) =>
      completed.includes(id),
    ) &&
    /^(?:да (?:все верно|именно|вы все правильно поняли|касса\s*№?\s*\d{1,3})|все верно(?: обращайтесь в кассу\s*№?\s*\d{1,3})?|вы все правильно поняли)$/u.test(
      text,
    );
  if (confirmed) action = "close_conversation";
  else if (
    /^(?:(?:всего доброго|до свидания|счастливого пути|обращайтесь|спасибо|благодарю за понимание|вам все понятно)\s*)+$/u.test(
      text,
    )
  )
    action = "close_conversation";
  else if (
    /^(?:покажите|предъявите) (?:пожалуйста )?(?:ваш )?(?:билет|билет и документ|билет дату и канал покупки)(?: пожалуйста)?$/u.test(
      text,
    )
  )
    action = "ask_for_ticket";
  else if (
    /^(?:я )?(?:не могу вас посадить|не разрешаю посадку|не пущу(?: вас)?|нельзя пройти) без (?:действительного )?билета(?: (?:пройдите|обратитесь) в кассу(?:\s*№?\s*\d{1,3})?)?$/u.test(
      text,
    )
  )
    action = "explain_rules";
  else if (
    /^(?:пожалуйста )?(?:обратитесь|пройдите|подойдите) в (?:кассу(?:\s*№?\s*\d{1,3})?|(?:официальный )?контактный центр)(?: там помогут разобраться с заказом)?(?: пожалуйста)?$/u.test(
      text,
    )
  )
    action = "offer_help";
  if (!action) return;
  return {
    matchedActionId: action,
    confidence: 1,
    markers: {
      polite:
        /пожалуйста|спасибо|доброго|свидания|счастливого|благодарю/iu.test(
          text,
        ),
      empathy: /кассу|контактный центр/iu.test(text),
      rude: false,
      safetyViolation: false,
    },
    explanation:
      "Стандартная фраза распознана проверенным правилом; баллы и исход определяет движок.",
  };
}
