import { describe, expect, it } from "vitest";
import { submitFreeformActionSchema, nluAnalysisSchema } from "./index";

it("accepts only bounded freeform input and structured NLU, never model scores", () => {
  const input = {
    sessionId: crypto.randomUUID(),
    freeformText: "  Не пущу без билета  ",
    clientTimestamp: "2026-09-26T00:00:00Z",
  };
  expect(submitFreeformActionSchema.parse(input).freeformText).toBe(
    "Не пущу без билета",
  );
  expect(
    submitFreeformActionSchema.safeParse({ ...input, score: 100 }).success,
  ).toBe(false);
  expect(
    submitFreeformActionSchema.safeParse({
      ...input,
      freeformText: "я".repeat(501),
    }).success,
  ).toBe(false);
  expect(
    nluAnalysisSchema.safeParse({
      matchedActionId: "explain_rules",
      confidence: 2,
    }).success,
  ).toBe(false);
});

import {
  createSessionSchema,
  submitActionSchema,
  syncSessionSchema,
  scenarioDefinitionSchema,
  ENGINE_VERSION,
} from "./index";

describe("API contracts", () => {
  it("requires a reproducible seed and rejects client scores or duplicate command keys", () => {
    const journal = {
      engineVersion: ENGINE_VERSION,
      setup: { scenarioId: "boarding_no_ticket", seed: 42 },
      commands: [],
    };
    expect(syncSessionSchema.safeParse(journal).success).toBe(true);
    expect(
      syncSessionSchema.safeParse({ ...journal, scores: { procedure: 100 } })
        .success,
    ).toBe(false);
    expect(
      syncSessionSchema.safeParse({
        ...journal,
        setup: { scenarioId: "boarding_no_ticket" },
      }).success,
    ).toBe(false);
    const command = {
      actionId: "wait",
      idempotencyKey: crypto.randomUUID(),
      clientTimestamp: "2026-09-25T18:00:00Z",
    };
    expect(
      syncSessionSchema.safeParse({ ...journal, commands: [command, command] })
        .success,
    ).toBe(false);
  });
  it("fills safe defaults for a new training session", () => {
    const result = createSessionSchema.parse({
      scenarioId: "boarding_no_ticket",
    });

    expect(result).toEqual({
      scenarioId: "boarding_no_ticket",
      mode: "training",
      difficulty: 1,
    });
  });

  it("rejects an action without an idempotency key", () => {
    const result = submitActionSchema.safeParse({
      actionId: "ask_for_ticket",
      kind: "dialogue",
      durationMinutes: 1,
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(false);
  });

  it("does not let the caller set action duration or inject extra state", () => {
    const command = {
      idempotencyKey: crypto.randomUUID(),
      actionId: "wait",
      clientTimestamp: new Date().toISOString(),
    };
    expect(submitActionSchema.safeParse(command).success).toBe(true);
    expect(
      submitActionSchema.safeParse({ ...command, durationMinutes: 0.1 })
        .success,
    ).toBe(false);
    expect(createSessionSchema.safeParse({ scenarioId: "" }).success).toBe(
      false,
    );
    expect(
      createSessionSchema.safeParse({
        scenarioId: "vsm_vip_cold_coffee_01",
      }).success,
    ).toBe(true);
  });

  it("validates a declarative scenario contract (JSON/YAML)", () => {
    const scenario = {
      scenario_id: "vsm_vip_cold_coffee_01",
      type: "character" as const,
      title: "Остывший кофе в первом классе",
      legal_basis: [{ act: "Приказ Минтранса № 352", clause: "п. 7", url: "https://publication.pravo.gov.ru/Document/View/0001202210270033", application: "Улучшенный сервис определяется правилами перевозчика." }],
      location: {
        car_number: 1,
        class_type: "first",
        zone: "Купе 1 класса",
        speed_kmh: 400,
      },
      character: {
        id: "char_igor_vip",
        name: "Игорь Валентинович",
        role: "Инвестор, постоянный пассажир",
        archetype: "требовательный_vip",
        psychological_state: {
          patience: 20,
          aggression: 45,
          stress: 30,
        },
        hidden_biases: ["Считает сервис стандартом, а не одолжением"],
      },
      incident: {
        category: "service_quality",
        urgency: "medium" as const,
        difficulty_dc: 14,
        initial_speech: "Девушка, этот кофе холодный. Я плачу не за помои.",
        context_description: "Пассажир первого класса недоволен температурой кофе.",
        sop_reference: "Стандарт сервиса 1 класса ВСМ",
        branches: [
          {
            action_id: "act_replace_coffee_with_apology",
            intent_label: "Принести извинения и немедленно приготовить свежий кофе",
            example_phrases: [
              "Приношу искренние извинения, сейчас же заварю для вас свежий горячий американо",
            ],
            sop_bonus: 2,
            outcomes: {
              critical_success: {
                reaction_vector: "С благодарностью принимает замену.",
                status: "resolved" as const,
              },
              success: {
                reaction_vector: "Принимает решение, но торопится.",
                status: "resolved" as const,
              },
              failure: {
                reaction_vector: "Недоволен задержкой, требует срок.",
                status: "escalating" as const,
              },
              critical_failure: {
                reaction_vector: "Требует ответственного сотрудника.",
                status: "failed" as const,
              },
            },
          },
        ],
        escalation: {
          warning_minutes: 6,
          deadline_minutes: 14,
          warning_vector: "Терпение заканчивается.",
          failure_vector: "Время вышло.",
          wrong_action_vector: "Предложение не решает проблему.",
          idle_vector: "Пассажир просит ответа.",
          conversation_vector: "Пассажир продолжает разговор.",
        },
      },
    };

    expect(scenarioDefinitionSchema.safeParse(scenario).success).toBe(true);
  });
});
