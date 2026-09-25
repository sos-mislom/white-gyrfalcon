import Image from "next/image";
import type {
  FreeformActionResultDto,
  SessionStateDto,
} from "@vsm/api-contracts";

type Expression = "stressed" | "angry" | "grateful";
export function passengerExpression(
  session: SessionStateDto | null,
  feedback?: FreeformActionResultDto,
): Expression {
  if (!session) return "stressed";
  const action = session.appliedActions.at(-1)?.actionId;
  if (
    session.outcome === "failed" ||
    action === "dismiss_passenger" ||
    feedback?.analysis?.markers.rude
  )
    return "angry";
  if (session.outcome === "resolved") return "grateful";
  const check = session.checks.at(-1);
  if (action === "offer_help" && check)
    return ["success", "critical_success"].includes(check.outcome)
      ? "grateful"
      : "angry";
  return action === "explain_rules" ? "angry" : "stressed";
}

export function PassengerScene({
  expression,
  finished,
}: {
  expression: Expression;
  finished: boolean;
}) {
  return (
    <div
      className={`vn-stage${finished ? " vn-stage-finished" : ""}`}
      aria-hidden="true"
    >
      <Image
        className="vn-platform"
        src="/visual-novel/bg_platform.jpg"
        alt=""
        fill
        sizes="100vw"
        preload
        unoptimized
      />
      <div className="vn-stage-shade" />
      <div className="vn-portrait">
        {(["stressed", "angry", "grateful"] as const).map((mood) => (
          <Image
            key={mood}
            className={`vn-passenger${expression === mood ? " is-visible" : ""}`}
            src={`/visual-novel/passenger_${mood}.jpg`}
            alt=""
            fill
            sizes="(max-width: 600px) 100vw, 520px"
            unoptimized
            loading="eager"
          />
        ))}
      </div>
    </div>
  );
}
