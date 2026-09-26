import type { SessionStateDto, FreeformActionResultDto } from "@vsm/api-contracts";

import { getScenario } from "@vsm/simulation-core";

export interface StandAxis { label: string; value: number }

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function standAxes(session: SessionStateDto, feedback?: FreeformActionResultDto): StandAxis[] {
  const branches = getScenario(session.scenarioId)?.incident.branches ?? [];
  const byId = new Map(branches.map((branch) => [branch.action_id, branch]));
  const requiredPath = (id: string, visited = new Set<string>()): Set<string> => {
    if (visited.has(id)) return visited;
    visited.add(id);
    for (const prerequisite of byId.get(id)?.requires ?? []) requiredPath(prerequisite, visited);
    return visited;
  };
  const completed = new Set(session.completedActionIds);
  const paths = branches
    .filter((branch) => !branch.is_violation && Object.values(branch.outcomes).some((outcome) => outcome?.status === "resolved"))
    .map((branch) => requiredPath(branch.action_id));
  const progress = paths.length
    ? Math.max(...paths.map((path) => [...path].filter((id) => completed.has(id)).length / path.size))
    : 0;
  const earned = session.outcome === "resolved" ? progress : Math.min(progress, 0.7);
  const saidSomething = session.appliedActions.some((action) => Boolean(action.utterance?.trim()));
  const rude = feedback?.analysis?.markers.rude || session.appliedActions.some((action) => action.communication?.rude);
  const polite = feedback?.analysis?.markers.polite || session.appliedActions.some((action) => action.communication?.polite);
  const empathy = feedback?.analysis?.markers.empathy || session.appliedActions.some((action) => action.communication?.empathy);
  const calm = earned * (rude ? 35 : polite ? 90 : 75);
  const service = earned * (70 + (saidSomething ? 10 : 0) + (empathy ? 20 : 0));
  const persuasion = earned * (session.outcome === "resolved" ? 75 + (saidSomething ? 15 : 0) : 45);
  return [
    { label: "Регламент", value: clamp(Math.min(session.scores.procedure, earned * 100)) },
    { label: "Безопасность", value: clamp(Math.min(session.scores.safety, earned * 100)) },
    { label: "Сервис", value: clamp(Math.min(session.scores.service, service)) },
    { label: "Хладнокровие", value: clamp(Math.min(session.scores.communication, calm)) },
    { label: "Темп", value: clamp(Math.min(session.scores.timeManagement, earned * 100)) },
    { label: "Убедительность", value: clamp(persuasion) },
  ];
}

export function standOverall(session: SessionStateDto, feedback?: FreeformActionResultDto): number {
  const axes = standAxes(session, feedback).filter((_, index) => index !== 3 && index !== 5);
  return Math.round(axes.reduce((sum, axis) => sum + axis.value, 0) / axes.length);
}

function point(index: number, radius: number) {
  const angle = -Math.PI / 2 + index * Math.PI / 3;
  return `${120 + Math.cos(angle) * radius},${120 + Math.sin(angle) * radius}`;
}

export function StandRadar({ axes, id = "stand" }: { axes: StandAxis[]; id?: string }) {
  return (
    <div className="vn-radar-wrap">
      <svg className="vn-radar" viewBox="0 0 240 240" role="img" aria-label={axes.map((axis) => `${axis.label}: ${axis.value} из 100`).join(", ")}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d9aa69" stopOpacity=".78" />
            <stop offset="1" stopColor="#72b9bd" stopOpacity=".58" />
          </linearGradient>
        </defs>
        {[24, 43, 62, 81, 100].map((radius) => (
          <polygon key={radius} points={axes.map((_, index) => point(index, radius)).join(" ")} className="vn-radar-grid" />
        ))}
        {axes.map((_, index) => <line key={index} x1="120" y1="120" x2={point(index, 100).split(",")[0]} y2={point(index, 100).split(",")[1]} className="vn-radar-line" />)}
        <polygon points={axes.map((axis, index) => point(index, axis.value)).join(" ")} fill={`url(#${id}-fill)`} className="vn-radar-shape" />
        {axes.map((axis, index) => <circle key={axis.label} cx={point(index, axis.value).split(",")[0]} cy={point(index, axis.value).split(",")[1]} r="3.5" className="vn-radar-node" />)}
      </svg>
      <div className="vn-radar-legend">
        {axes.map((axis) => <div key={axis.label}><span>{axis.label}</span><strong>{axis.value}</strong></div>)}
      </div>
    </div>
  );
}
