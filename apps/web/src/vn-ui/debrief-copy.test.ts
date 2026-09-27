import { expect, it } from "vitest";
import { applyAction, createSession } from "@vsm/simulation-core";
import { debriefCopy } from "./debrief-copy";

const setup = { scenarioId: "boarding_no_ticket", mode: "training" as const, difficulty: 1, seed: 42 };
const command = (actionId: string) => ({ actionId, idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-27T00:00:00Z" });

it("explains a passenger-friendly rule violation as a violation, not a timeout", () => {
  const failed = applyAction(createSession(setup), command("allow_boarding"));
  expect(failed.outcome).toBe("failed");
  expect(debriefCopy(failed)).toEqual({
    title: "Нарушены правила",
    detail: "Пассажир может быть доволен, но действие нарушает правила перевозки.",
  });
});

it("shows time expiry only for a scene that actually expired", () => {
  let timedOut = createSession(setup);
  while (timedOut.outcome === "active") timedOut = applyAction(timedOut, command("wait"));
  expect(debriefCopy(timedOut).detail).toBe("Время на решение истекло.");
});
