import type { NluAnalysisDto } from "@vsm/api-contracts";

// Adapted from norma-rf's lexical signals + context gates, not a legal verdict.
// JS \b is ASCII-only: use Unicode letter boundaries for Russian words.
const threat =
  /(?<![\p{L}])(?:убью|прикончу|зарежу|застрелю|покалечу|изобью|расправлюсь|сломаю\s+(?:тебе|вам|тебя|вас)|лишу\s+(?:тебя\s+|вас\s+)?жизни)(?![\p{L}])/iu;
const threatMention =
  /убив|убить|избить|угроз|угрожа|расправ|покалеч|приконч|зареж|застрел/iu;
const profanity =
  /(?<![\p{L}])(?:бляд[ььи]|сук[аиу]|(?:на|по)?хуй|охуе[\p{L}]*|пизд[\p{L}]*|еб[ао][\p{L}]*|мудак|долбоеб|пидор)(?![\p{L}])/iu;
const bribe =
  /(?:дай|дайте|заплати|заплатите|переведи|переведите)\s+(?:мне\s+|лично\s+мне\s+)(?:\d+|денег|деньги|взятку|откат)|(?:хочу|требую|давай|дайте)\s+(?:мне\s+)?(?:взятку|откат)/iu;
const paymentMention = /взятк|откат/iu;
const contextGate =
  /[«»"“”]|(?:сказал|сказала|сказали|цитирую|пассажир\s+(?:угрожает|кричит))|(?:не\s+(?:буду|собираюсь|хочу|беру|требую|предлагайте|платите)|никогда|нельзя|запрещено)|(?:можно ли|что будет|какая статья)|убью\s+время/iu;

export const THREAT_EXPLANATION =
  "Распознана прямая угроза пассажиру; учебный штраф задаёт движок. Правовые ориентиры, не вывод о виновности: ст. 119 УК РФ — угроза убийством или тяжким вредом при основаниях опасаться её осуществления; ст. 20.1 КоАП РФ — при признаках нарушения общественного порядка; п. 5 ч. 1 ст. 81 ТК РФ — неоднократное неисполнение обязанностей при действующем дисциплинарном взыскании, не автоматическое увольнение за фразу.";

export type ConductScreen = {
  kind: "violent_threat" | "profanity" | "improper_payment" | "uncertain";
  analysis?: NluAnalysisDto;
};

export function screenConduct(input: string): ConductScreen | undefined {
  const text = input
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replaceAll("ё", "е");
  const clauses = text.split(/[.!?;\n]+/).filter(Boolean);
  let ambiguous = false;
  let other: ConductScreen | undefined;
  for (const clause of clauses) {
    const threatMatch = threat.exec(clause);
    const directThreat = Boolean(threatMatch);
    const swear = profanity.test(clause);
    const payment = bribe.test(clause);
    if (!(
      directThreat ||
      swear ||
      payment ||
      threatMention.test(clause) ||
      paymentMention.test(clause)
    ))
      continue;
    // Never apply a severe penalty to quoted/reported/negated speech by keyword alone.
    if (
      contextGate.test(clause) ||
      (threatMatch &&
        /(?:^|\s)не\s+(?:\S+\s+){0,3}$/iu.test(
          clause.slice(0, threatMatch.index),
        ))
    ) {
      ambiguous = true;
      continue;
    }
    if (directThreat) return finding("violent_threat", THREAT_EXPLANATION);
    if (swear)
      other = finding(
        "profanity",
        "Обнаружена нецензурная брань. Ст. 20.1 КоАП РФ требует признаков нарушения общественного порядка; одно слово не устанавливает состав. В тренажёре это грубый отказ, не доказанная угроза жизни.",
      );
    else if (payment)
      other = finding(
        "improper_payment",
        "Распознано требование личной оплаты или упоминание взятки. Недопустимый способ решения вопроса; квалификация зависит от обстоятельств и статуса лица. Ст. 290 УК РФ не применяется автоматически к любому сотруднику. Это не доказанная угроза жизни.",
      );
    else ambiguous = true;
  }
  return ambiguous ? { kind: "uncertain" } : other;
}

function finding(
  kind: Exclude<ConductScreen["kind"], "uncertain">,
  explanation: string,
): ConductScreen {
  return {
    kind,
    analysis: {
      matchedActionId: "dismiss_passenger",
      confidence: 1,
      markers: {
        polite: false,
        empathy: false,
        rude: true,
        safetyViolation: kind === "violent_threat",
      },
      explanation,
    },
  };
}
