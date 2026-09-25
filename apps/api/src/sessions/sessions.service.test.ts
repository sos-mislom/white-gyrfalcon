import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { SessionsService } from "./sessions.service";
import { MemorySessionRepository } from "./session.repository";

describe("SessionsService", () => {
  it("creates a session and applies an action", async () => {
    const service = new SessionsService(new MemorySessionRepository());
    const session = await service.create({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
      seed: 42,
    });

    const next = await service.applyAction(session.id, {
      idempotencyKey: randomUUID(),
      actionId: "ask_for_ticket",
      clientTimestamp: new Date().toISOString(),
    });

    expect(next.currentTimeMinutes).toBe(1);
  });
});
