import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, type SyncSessionDto } from "@vsm/api-contracts";
import { SessionsService } from "./sessions.service";
import { MemorySessionRepository } from "./session.repository";

describe("session synchronization", () => {
  it("persists a new offline session and maps a branch conflict to HTTP 409", async () => {
    const service = new SessionsService(new MemorySessionRepository());
    const id = crypto.randomUUID();
    const journal: SyncSessionDto = {
      engineVersion: ENGINE_VERSION,
      setup: {
        scenarioId: "boarding_no_ticket",
        difficulty: 1,
        seed: 42,
        mode: "training",
      },
      commands: [
        {
          actionId: "ask_for_ticket",
          idempotencyKey: crypto.randomUUID(),
          clientTimestamp: "2026-09-25T18:00:00Z",
        },
      ],
    };
    const state = await service.sync(id, journal);
    expect(await service.getById(id)).toEqual(state);
    await expect(
      service.sync(id, {
        ...journal,
        commands: [{ ...journal.commands[0]!, actionId: "wait" }],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await service.getById(id)).toEqual(state);
  });
  it("does not persist a partial journal if a later action is invalid", async () => {
    const repository = new MemorySessionRepository();
    const service = new SessionsService(repository);
    const id = crypto.randomUUID();
    await expect(
      service.sync(id, {
        engineVersion: ENGINE_VERSION,
        setup: {
          scenarioId: "boarding_no_ticket",
          difficulty: 1,
          seed: 42,
          mode: "training",
        },
        commands: ["ask_for_ticket", "invented"].map((actionId) => ({
          actionId,
          idempotencyKey: crypto.randomUUID(),
          clientTimestamp: "2026-09-25T18:00:00Z",
        })),
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await repository.get(id)).toBeUndefined();
  });
  it("keeps device profiles separate and refuses a second device claiming the same session", async () => {
    const service = new SessionsService(new MemorySessionRepository());
    const first = "a".repeat(64), second = "b".repeat(64);
    const journal: SyncSessionDto = {
      engineVersion: ENGINE_VERSION,
      setup: { scenarioId: "boarding_no_ticket", difficulty: 1, seed: 42, mode: "training" },
      commands: [],
    };
    const one = crypto.randomUUID(), two = crypto.randomUUID();
    await service.sync(one, journal, first);
    await service.sync(two, journal, second);
    expect((await service.profileSessions(first)).map((state) => state.id)).toEqual([one]);
    expect((await service.profileSessions(second)).map((state) => state.id)).toEqual([two]);
    await expect(service.sync(one, journal, second)).rejects.toMatchObject({ status: 409 });
  });
});
