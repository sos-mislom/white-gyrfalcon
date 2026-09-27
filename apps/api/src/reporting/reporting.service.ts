import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SessionStateDto } from "@vsm/api-contracts";
import { getScenario } from "@vsm/simulation-core";
import { SessionRepository, hashDeviceId } from "../sessions/session.repository";

export const appConfigSchema = z.strictObject({
  version: z.string().regex(/^[a-z0-9._-]{1,40}$/),
  features: z.strictObject({ voiceInput: z.boolean(), actorVoice: z.boolean(), leaderboard: z.boolean() }),
  vipPolicy: z.strictObject({
    requiredScenarioIds: z.array(z.string().min(1).max(80)).min(1).max(10),
    minAverageScore: z.number().int().min(0).max(100),
    minSafetyScore: z.number().int().min(0).max(100),
    minProcedureScore: z.number().int().min(0).max(100),
  }),
}).superRefine((config, context) => {
  const ids = config.vipPolicy.requiredScenarioIds;
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["vipPolicy", "requiredScenarioIds"], message: "Scenario IDs must be unique" });
  ids.forEach((id, index) => {
    if (!getScenario(id)) context.addIssue({ code: "custom", path: ["vipPolicy", "requiredScenarioIds", index], message: "Unknown scenario" });
  });
});
export type AppConfig = z.infer<typeof appConfigSchema>;

export const defaultAppConfig: AppConfig = {
  version: "training-v1",
  features: { voiceInput: true, actorVoice: true, leaderboard: true },
  vipPolicy: {
    requiredScenarioIds: ["vsm_vip_cold_coffee_01", "vsm_biz_noisy_kids_01", "vsm_vaping_toilet_01"],
    minAverageScore: 80, minSafetyScore: 80, minProcedureScore: 75,
  },
};

export function scoreOf(state: SessionStateDto): number {
  const values = Object.values(state.scores);
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function hasEvidence(state: SessionStateDto): boolean {
  return state.outcome === "resolved" &&
    state.appliedActions.some(action => Boolean(action.utterance?.trim())) &&
    state.checks.some(check => check.outcome === "success" || check.outcome === "critical_success");
}

export function assessVip(sessions: SessionStateDto[], config: AppConfig) {
  const policy = config.vipPolicy;
  const qualifying = sessions.filter(hasEvidence);
  const passed = policy.requiredScenarioIds.filter(id => qualifying.some(session =>
    session.scenarioId === id && scoreOf(session) >= policy.minAverageScore &&
    session.scores.safety >= policy.minSafetyScore && session.scores.procedure >= policy.minProcedureScore));
  const missing = policy.requiredScenarioIds.filter(id => !passed.includes(id));
  return {
    status: missing.length === 0 ? "recommended_for_review" as const : "training_incomplete" as const,
    policyVersion: config.version,
    passedScenarioIds: passed,
    missingScenarioIds: missing,
    note: "Учебная рекомендация. Допуск к работе в VIP-вагоне оформляет уполномоченный работодатель по своим правилам.",
  };
}

@Injectable()
export class ReportingService {
  constructor(private readonly repository: SessionRepository) {}

  async config(): Promise<AppConfig> {
    const stored = await this.repository.readAppConfig();
    return stored === undefined ? defaultAppConfig : appConfigSchema.parse(stored);
  }
  async saveConfig(config: AppConfig): Promise<AppConfig> {
    await this.repository.writeAppConfig(config);
    return config;
  }
  async leaderboard() {
    const config = await this.config();
    if (!config.features.leaderboard) return { entries: [], sampledSessions: 0, limit: 10000 };
    const owned = await this.repository.listOwnedSessions(10000);
    const byDevice = new Map<string, { completed: number; total: number }>();
    for (const { deviceHash, state } of owned) {
      if (!hasEvidence(state)) continue;
      const item = byDevice.get(deviceHash) ?? { completed: 0, total: 0 };
      item.completed += 1;
      item.total += scoreOf(state);
      byDevice.set(deviceHash, item);
    }
    const entries = [...byDevice.entries()].map(([hash, value]) => ({
      player: `Проводник ${createHash("sha256").update(hash).digest("hex").slice(0, 8).toUpperCase()}`,
      completedScenes: value.completed,
      averageScore: Math.round(value.total / value.completed),
    })).sort((a, b) => b.averageScore - a.averageScore || b.completedScenes - a.completedScenes || a.player.localeCompare(b.player))
      .slice(0, 100).map((entry, index) => ({ rank: index + 1, ...entry }));
    return { entries, sampledSessions: owned.length, limit: 10000 };
  }
  async bind(externalId: string, deviceId: string): Promise<boolean> {
    return this.repository.bindExternalUser(externalId, hashDeviceId(deviceId));
  }
  async report(externalId: string) {
    const deviceHash = await this.repository.externalUserHash(externalId);
    if (!deviceHash) return undefined;
    const sessions = await this.repository.sessionsForHash(deviceHash);
    const config = await this.config();
    return {
      externalUserId: externalId,
      generatedAt: new Date().toISOString(),
      sessions: sessions.map(state => ({
        sessionId: state.id, scenarioId: state.scenarioId, mode: state.mode,
        outcome: state.outcome, score: scoreOf(state), scores: state.scores,
        spokenActions: state.appliedActions.filter(action => Boolean(action.utterance?.trim())).length,
        successfulChecks: state.checks.filter(check => check.outcome === "success" || check.outcome === "critical_success").length,
        countsForTraining: hasEvidence(state),
      })),
      vipReadiness: assessVip(sessions, config),
    };
  }
}
