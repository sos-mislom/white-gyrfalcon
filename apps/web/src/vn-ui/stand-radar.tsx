import type { SessionStateDto, FreeformActionResultDto } from "@vsm/api-contracts";

export interface StandAxis { label: string; value: number }

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function standAxes(session: SessionStateDto, feedback?: FreeformActionResultDto): StandAxis[] {
  const markers = feedback?.analysis?.markers;
  const calm = markers?.rude ? 25 : markers?.polite ? 78 : Math.round((session.scores.service + session.scores.safety) / 2);
  const persuasion = session.outcome === "resolved"
    ? Math.max(68, Math.round((session.scores.service + session.scores.procedure) / 2))
    : Math.round(session.scores.service * 0.55);
  return [
    { label: "Регламент", value: clamp(session.scores.procedure) },
    { label: "Безопасность", value: clamp(session.scores.safety) },
    { label: "Сервис", value: clamp(session.scores.service) },
    { label: "Хладнокровие", value: clamp(calm) },
    { label: "Темп", value: clamp(session.scores.timeManagement) },
    { label: "Убедительность", value: clamp(persuasion) },
  ];
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
