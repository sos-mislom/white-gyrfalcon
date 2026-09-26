import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, type SyncSessionDto } from "@vsm/api-contracts";
import { mergeJournal, replaySession, applyAction } from "./index";

it("rejects old journals explicitly after the declarative scene upgrade", () => {
  const journal: SyncSessionDto = {
    engineVersion: "boarding-2",
    setup: {
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
      seed: 42,
    },
    commands: [
      {
        idempotencyKey: crypto.randomUUID(),
        actionId: "allow_boarding",
        clientTimestamp: "2026-09-26T00:00:00Z",
      },
    ],
  };
  const id = crypto.randomUUID();
  expect(() => replaySession(id, journal)).toThrow("engine_version_mismatch");
  expect(
    replaySession(id, { ...journal, engineVersion: ENGINE_VERSION }).scores
      .safety,
  ).toBe(30);
});

const createJournal = (): SyncSessionDto => ({
  engineVersion: ENGINE_VERSION,
  setup: {
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
    seed: 42,
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
});
describe("journal replay", () => {
  it("conduct is part of idempotency and history, and cannot alter other actions", () => {
    const journal = createJournal();
    const command = {
      ...journal.commands[0]!,
      actionId: "dismiss_passenger",
      conduct: "violent_threat" as const,
    };
    const id = crypto.randomUUID();
    const state = replaySession(id, { ...journal, commands: [command] });
    expect(state.scores.safety).toBe(0);
    expect(() =>
      applyAction(state, { ...command, conduct: undefined }),
    ).toThrow("idempotency_conflict");
    expect(() =>
      mergeJournal(
        id,
        { ...journal, commands: [{ ...command, conduct: undefined }] },
        state,
      ),
    ).toThrow("journal_conflict");
    expect(() =>
      replaySession(id, {
        ...journal,
        commands: [{ ...command, actionId: "offer_help" }],
      }),
    ).toThrow("invalid_conduct");
    expect(
      replaySession(id, {
        ...journal,
        commands: [{ ...command, conduct: undefined }],
      }).scores.safety,
    ).toBe(100);
  });
  it("incremental sync and full offline replay produce identical states", () => {
    const id = crypto.randomUUID(),
      journal = createJournal();
    const first = mergeJournal(id, {
      ...journal,
      commands: journal.commands.slice(0, 2),
    });
    const completed = mergeJournal(id, journal, first);
    expect(completed).toEqual(replaySession(id, journal));
    expect(completed.outcome).toBe("resolved");
    expect(mergeJournal(id, journal, completed)).toBe(completed);
    expect(
      mergeJournal(
        id,
        { ...journal, commands: journal.commands.slice(0, 1) },
        completed,
      ),
    ).toBe(completed);
  });
  it("does not merge divergent branches or seed changes", () => {
    const id = crypto.randomUUID(),
      journal = createJournal();
    const first = mergeJournal(id, {
      ...journal,
      commands: journal.commands.slice(0, 1),
    });
    expect(() =>
      mergeJournal(
        id,
        {
          ...journal,
          commands: [{ ...journal.commands[0]!, actionId: "wait" }],
        },
        first,
      ),
    ).toThrow("journal_conflict");
    expect(() =>
      mergeJournal(
        id,
        { ...journal, setup: { ...journal.setup, seed: 7 } },
        first,
      ),
    ).toThrow("session_setup_conflict");
    expect(first.currentTimeMinutes).toBe(1);
  });
  it("rejects repeated keys and actions after the scenario ends", () => {
    const journal = createJournal();
    expect(() =>
      replaySession(crypto.randomUUID(), {
        ...journal,
        commands: [journal.commands[0]!, journal.commands[0]!],
      }),
    ).toThrow("duplicate_journal_key");
    expect(() =>
      replaySession(crypto.randomUUID(), {
        ...journal,
        commands: [
          ...journal.commands,
          { ...journal.commands[0]!, idempotencyKey: crypto.randomUUID() },
        ],
      }),
    ).toThrow("session_finished");
  });
});
