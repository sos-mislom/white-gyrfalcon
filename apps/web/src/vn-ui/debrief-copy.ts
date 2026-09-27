import type { SessionStateDto } from "@vsm/api-contracts";
import { getScenario } from "@vsm/simulation-core";

export function debriefCopy(session: SessionStateDto): { title: string; detail: string } {
  if (session.outcome === "resolved") return {
    title: "Смена завершена", detail: "Вы нашли путь к решению.",
  };
  if (session.outcome === "abandoned") return {
    title: "Сцена прервана", detail: "Ситуация осталась без решения.",
  };
  const last = session.appliedActions.at(-1);
  if (last?.conduct === "violent_threat") return {
    title: "Опасная угроза", detail: "Угроза пассажиру завершила сцену.",
  };
  const violation = getScenario(session.scenarioId)?.incident.branches
    .find((branch) => branch.action_id === last?.actionId)?.is_violation;
  if (violation) return {
    title: "Нарушены правила",
    detail: "Пассажир может быть доволен, но действие нарушает правила перевозки.",
  };
  if (session.incidents.some((incident) => incident.phase === 3)) return {
    title: "Ситуация не разрешена", detail: "Время на решение истекло.",
  };
  return { title: "Ситуация не разрешена", detail: "Проблема осталась открытой после ваших действий." };
}
