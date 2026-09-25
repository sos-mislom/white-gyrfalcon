import { afterEach, expect, it, vi } from "vitest";
import {
  createSession,
  applyAction,
  allowedConsequences,
  boardingContext,
} from "@vsm/simulation-core";
import { AiAdapterService } from "./ai-adapter.service";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("expands the compact model reply to the unchanged public NLU contract", async () => {
  vi.stubEnv("AI_BASE_URL", "http://model.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    a: "explain_rules",
                    c: 0.95,
                    p: true,
                    e: true,
                    r: false,
                    why: "Отказ в посадке с предложением помощи.",
                  }),
                },
                finish_reason: "stop",
              },
            ],
          }),
        ),
    ),
  );
  const state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
    seed: 42,
  });
  const analysis = await new AiAdapterService().analyze(
    "Не могу посадить, обратитесь в кассу №3",
    state,
  );
  expect(analysis).toEqual({
    matchedActionId: "explain_rules",
    confidence: 0.95,
    markers: {
      polite: true,
      empathy: true,
      rude: false,
      safetyViolation: false,
    },
    explanation: "Отказ в посадке с предложением помощи.",
  });
});
it("sends heard speech, markers, character and the engine's actual d20 to the actor", async () => {
  vi.stubEnv("AI_BASE_URL", "http://model.test");
  let state = createSession({
    scenarioId: "boarding_no_ticket",
    mode: "training",
    difficulty: 1,
    seed: 42,
  });
  for (const actionId of ["ask_for_ticket", "explain_rules", "offer_help"])
    state = applyAction(state, {
      actionId,
      idempotencyKey: crypto.randomUUID(),
      clientTimestamp: "2026-09-26T00:00:00Z",
    });
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  consequenceId: "respond_to_current_step",
                  reply: "Ладно, обращусь в кассу №3.",
                }),
              },
              finish_reason: "stop",
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const input = {
    employee_speech: "Обратитесь в кассу №3",
    markers: {
      polite: true,
      empathy: true,
      rude: false,
      safetyViolation: false,
    },
  };
  const result = await new AiAdapterService().act(
    state,
    allowedConsequences(state),
    input,
  );
  expect(result.reply).toContain("кассу №3");
  const request = JSON.parse(
    (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
      .body as string,
  );
  const data = JSON.parse(request.messages[1].content);
  expect(data.reference_response).toContain("кассу №3");
  expect(data).toMatchObject({
    ...input,
    lastCheck: state.checks.at(-1),
    currentCheck: true,
    context: boardingContext(42, 1),
  });
  expect(request.messages[0].content).toContain(state.checks.at(-1)!.outcome);
});
