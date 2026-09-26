import { describe, expect, it } from "vitest";
import {
  createSession,
  applyAction,
  listScenarios,
  getScenario,
  getRandomScenario,
} from "./index";

describe("Declarative Scenarios & Loader", () => {
  it("lists all scenarios with summaries", () => {
    const list = listScenarios();
    expect(list.length).toBe(20);
    expect(list.some((s) => s.scenarioId === "vsm_vip_cold_coffee_01")).toBe(true);
    expect(list.some((s) => s.characterName === "Игорь Валентинович")).toBe(true);
  });

  it("retrieves a scenario by canonical ID or alias", () => {
    const canonical = getScenario("vsm_boarding_no_ticket_01");
    const alias = getScenario("boarding_no_ticket");
    expect(canonical).toBeDefined();
    expect(alias).toBeDefined();
    expect(canonical?.scenario_id).toBe("vsm_boarding_no_ticket_01");
    expect(alias?.scenario_id).toBe("vsm_boarding_no_ticket_01");
  });

  it("selects a random character scenario with seed", () => {
    const random1 = getRandomScenario(42);
    const random2 = getRandomScenario(42);
    expect(random1.scenario_id).toBe(random2.scenario_id);
    expect(random1.type).toBe("character");
  });

  it("creates and plays a non-boarding scenario (VIP cold coffee)", () => {
    const session = createSession({
      scenarioId: "vsm_vip_cold_coffee_01",
      mode: "training",
      difficulty: 1,
      seed: 77,
    });

    expect(session.scenarioId).toBe("vsm_vip_cold_coffee_01");
    expect(session.passengerReply).toContain("кофе");
    expect(session.availableActions.length).toBeGreaterThanOrEqual(2);
    const idle = applyAction(session, {
      idempotencyKey: crypto.randomUUID(),
      actionId: "wait",
      clientTimestamp: "2026-09-26T00:00:00Z",
    });
    expect(idle.passengerReply).toContain("Проводник молчит");
    expect(idle.availableActions).toEqual(session.availableActions);
    const actionId = session.availableActions[0]!.id;

    const next = applyAction(session, {
      idempotencyKey: crypto.randomUUID(),
      actionId,
      clientTimestamp: "2026-09-26T00:00:00Z",
      communication: {
        polite: true,
        empathy: true,
        rude: false,
      },
    });

    expect(next.checks.length).toBe(1);
    expect(next.completedActionIds).toContain(actionId);
    expect(next.passengerReply).not.toBe(session.passengerReply);
  });

  it("creates a session with scenarioId = 'random'", () => {
    const session = createSession({
      scenarioId: "random",
      mode: "training",
      difficulty: 1,
      seed: 12345,
    });

    expect(session.scenarioId).toBeTruthy();
    expect(session.availableActions.length).toBeGreaterThan(0);
    expect(session.passengerReply).toBeTruthy();
  });
});
