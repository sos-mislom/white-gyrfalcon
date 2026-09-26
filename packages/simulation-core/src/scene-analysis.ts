import type { NluAnalysisDto, ScenarioDefinitionDto } from "@vsm/api-contracts";

/** Only exact, authored utterance patterns skip model NLU. */
export function sceneAnalysis(text: string, scene: ScenarioDefinitionDto): NluAnalysisDto | undefined {
  const normalized = text.toLocaleLowerCase("ru").replaceAll("ё", "е")
    .replace(/[,.!?—–;:]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 500) return;
  for (const branch of scene.incident.branches) {
    if (!branch.match_patterns.some(pattern => new RegExp(pattern, "iu").test(normalized))) continue;
    return {
      matchedActionId: branch.action_id, confidence: 1,
      markers: {
        polite: /пожалуйста|спасибо|доброго|свидания|благодар/iu.test(normalized),
        empathy: /понимаю|помогу|помощ|обратитесь|подскажу/iu.test(normalized),
        rude: false, safetyViolation: Boolean(branch.is_violation),
      },
      explanation: "Фраза совпала с правилом сцены",
    };
  }
}
