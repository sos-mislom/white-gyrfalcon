import type { AllowedConsequenceDto, SessionStateDto } from "@vsm/api-contracts";
import { requireScenario } from "./scenario-loader";

export const SCENE_SOURCE = "Сценарий из каталога YAML; учебные оценки и таймер не являются нормативом";

/** Deterministic state and authored reaction vector; the actor can vary only wording. */
export function allowedConsequences(state: SessionStateDto): AllowedConsequenceDto[] {
  const scene = requireScenario(state.scenarioId);
  const last = state.appliedActions.at(-1);
  const facts = scene.incident.context_description ?? scene.title;
  const id = last?.conduct === "violent_threat" ? "safety_threat"
    : state.outcome === "resolved" ? "resolved"
    : state.outcome === "failed" ? "failed"
    : "continue";
  return [{ id, description: `Факты: ${facts} Исход: ${state.outcome}. Вектор текущей реакции: ${state.passengerReply}`.slice(0, 700) }];
}
