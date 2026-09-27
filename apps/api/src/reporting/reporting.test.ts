import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createSession } from "@vsm/simulation-core";
import type { SessionStateDto } from "@vsm/api-contracts";
import { MemorySessionRepository } from "../sessions/session.repository";
import { assessVip, defaultAppConfig, hasEvidence, ReportingService } from "./reporting.service";

function finished(scenarioId: string): SessionStateDto {
  const state = createSession({ scenarioId, mode: "training", difficulty: 1 });
  state.outcome = "resolved";
  state.appliedActions.push({ key: randomUUID(), actionId: "talk", clientTimestamp: new Date().toISOString(), utterance: "Я проверю ситуацию и помогу вам." });
  state.checks.push({ actionId: "talk", index: 0, roll: 12, dc: 10, skillModifier: 1, sopBonus: 1, total: 14, outcome: "success" });
  return state;
}

describe("training evidence and export", () => {
  it("does not award a perfect silent or unfinished session", () => {
    const silent = createSession({ scenarioId: "vsm_vip_cold_coffee_01", mode: "training", difficulty: 1 });
    silent.outcome = "resolved";
    expect(silent.scores.safety).toBe(100);
    expect(hasEvidence(silent)).toBe(false);
    expect(assessVip([silent], defaultAppConfig).status).toBe("training_incomplete");
    const failed = finished("vsm_vip_cold_coffee_01");
    failed.outcome = "failed";
    expect(hasEvidence(failed)).toBe(false);
  });

  it("requires each configured scene and minimum safety/procedure scores", () => {
    const sessions = defaultAppConfig.vipPolicy.requiredScenarioIds.map(finished);
    expect(assessVip(sessions, defaultAppConfig).status).toBe("recommended_for_review");
    sessions[0]!.scores.safety = 40;
    expect(assessVip(sessions, defaultAppConfig).missingScenarioIds).toContain(sessions[0]!.scenarioId);
  });

  it("exports only the bound device's sessions and never raw dialogue", async () => {
    const repo = new MemorySessionRepository();
    const service = new ReportingService(repo);
    const one = finished("vsm_vip_cold_coffee_01");
    const two = finished("vsm_biz_noisy_kids_01");
    const deviceOne = "a".repeat(64), deviceTwo = "b".repeat(64);
    await repo.mutate(one.id, () => one);
    await repo.mutate(two.id, () => two);
    await repo.claimProfileSession(deviceOne, one.id);
    await repo.claimProfileSession(deviceTwo, two.id);
    expect(await service.bind("employee_123", deviceOne)).toBe(true);
    expect(await service.bind("employee_123", deviceTwo)).toBe(false);
    const report = await service.report("employee_123");
    expect(report?.sessions.map(session => session.sessionId)).toEqual([one.id]);
    expect(JSON.stringify(report)).not.toContain("Я проверю ситуацию");
    const board = await service.leaderboard();
    expect(board.entries).toHaveLength(2);
    expect(JSON.stringify(board)).not.toContain(deviceOne);
  });
});
