import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, type SyncSessionDto } from "@vsm/api-contracts";
import { mergeJournal, replaySession, resolveD20 } from "./index";

describe("deterministic d20", () => {
  it("respects range, seed, check index and critical outcomes", () => {
    const results = Array.from({ length: 1000 }, (_, seed) =>
      resolveD20(seed, 0, "help", 13, 0, 4),
    );
    expect(new Set(results.map((item) => item.roll)).size).toBe(20);
    expect(
      results
        .filter((item) => item.roll === 1)
        .every((item) => item.outcome === "critical_failure"),
    ).toBe(true);
    expect(
      results
        .filter((item) => item.roll === 20)
        .every((item) => item.outcome === "critical_success"),
    ).toBe(true);
    expect(resolveD20(42, 0, "help", 13, 0, 4)).toEqual(
      resolveD20(42, 0, "help", 13, 0, 4),
    );
    expect(resolveD20(42, 0, "help", 13, 0, 4)).not.toEqual(
      resolveD20(42, 1, "help", 13, 0, 4),
    );
  });
  it("negative passenger reaction never turns correct procedure into failure", () => {
    const seed = Array.from({ length: 1000 }, (_, value) => value).find(
      (value) => resolveD20(value, 0, "offer_help", 13, 0, 4).roll === 1,
    )!;
    const journal: SyncSessionDto = {
      engineVersion: ENGINE_VERSION,
      setup: {
        scenarioId: "boarding_no_ticket",
        mode: "training",
        difficulty: 1,
        seed,
      },
      commands: [
        "ask_for_ticket",
        "explain_rules",
        "offer_help",
        "close_conversation",
      ].map((actionId) => ({
        actionId,
        idempotencyKey: crypto.randomUUID(),
        clientTimestamp: "2026-09-25T18:00:00Z",
      })),
    };
    const id = crypto.randomUUID();
    const state = replaySession(id, journal);
    expect(state.checks[0]?.outcome).toBe("critical_failure");
    expect(state.passengerLoyalty).toBe(-40);
    expect(state.outcome).toBe("resolved");
    expect(state.scores.procedure).toBe(100);
    expect(state.scores.communication).toBe(100);
    expect(mergeJournal(id, journal, state).checks).toHaveLength(1);
    expect(replaySession(id, journal).checks).toEqual(state.checks);
  });
});
