import Image from "next/image";
import type {
  FreeformActionResultDto,
  SessionStateDto,
} from "@vsm/api-contracts";

export type Expression =
  | "neutral"
  | "stressed"
  | "thoughtful"
  | "angry"
  | "grateful";

export function passengerExpression(
  session: SessionStateDto | null,
  feedback?: FreeformActionResultDto,
): Expression {
  if (!session) return "neutral";
  if (session.outcome === "resolved") return "grateful";
  if (session.outcome === "failed" || feedback?.analysis?.markers.rude)
    return "angry";

  const action = session.appliedActions.at(-1)?.actionId;
  if (action === "dismiss_passenger") return "angry";

  const check = session.checks.at(-1);
  if (action === "offer_help" && check) {
    return ["success", "critical_success"].includes(check.outcome)
      ? "grateful"
      : "angry";
  }

  if (action === "explain_rules") {
    const comm = session.appliedActions.at(-1)?.communication;
    if (comm?.polite || comm?.empathy) return "thoughtful";
    return "angry";
  }

  if (action === "ask_for_ticket") {
    return "stressed";
  }

  return "stressed";
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
      <div className="vn-portrait">
        {(
          [
            "neutral",
            "stressed",
            "thoughtful",
            "angry",
            "grateful",
          ] as const
        ).map((mood) => (
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
