import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  applyAction,
  allowedConsequences,
} from "@vsm/simulation-core";
import { AiAdapterService } from "./ai-adapter.service";
import { actorDraftCanSurface, actorIsGrounded, actorReference } from "./actor-grounding";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("expands the compact model reply to the unchanged public NLU contract", async () => {
  vi.stubEnv("AI_ACTOR_BASE_URL", "http://model.test");
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
                    p: 0.9,
                    e: 0.7,
                    r: 0.0,
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
  vi.stubEnv("AI_ACTOR_BASE_URL", "http://model.test");
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
  // Conductor speech is now embedded in the system prompt (messages[0]) for stronger role adherence.
  expect(request.messages[0].content).toContain(input.employee_speech);
  // User payload contains action and outcome only.
  const data = JSON.parse(request.messages[1].content);
  expect(data).toMatchObject({
    action: "offer_help",
    outcome: state.outcome,
  });
  expect(request.messages[0].content).toContain("Сергей");
  expect(request.messages[0].content).toContain(state.checks.at(-1)!.outcome);
  expect(request.messages[0].content).not.toContain("По Приказу Минтранса");
});

it("uses the agent for both intent and actor, without a local model retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vsm-actor-key-"));
  try {
    const keyFile = join(directory, "token");
    writeFileSync(keyFile, "test-agent-token\n");
    vi.stubEnv("AI_ACTOR_BASE_URL", "https://agent.timeweb.cloud/agent/v1");
    vi.stubEnv("AI_ACTOR_MODEL_NAME", "timeweb/gpt-oss-120b");
    vi.stubEnv("AI_ACTOR_API_KEY_FILE", keyFile);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const state = createSession({ scenarioId: "boarding_no_ticket", mode: "training", difficulty: 1, seed: 42 });
    const adapter = new AiAdapterService();
    await expect(adapter.analyze("Покажите билет, пожалуйста.", state)).rejects.toThrow();
    await expect(adapter.act(state, allowedConsequences(state), {
      employee_speech: "Покажите билет, пожалуйста.",
      markers: { polite: true, empathy: false, rude: false, safetyViolation: false },
    })).rejects.toThrow();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://agent.timeweb.cloud/agent/v1/chat/completions",
      "https://agent.timeweb.cloud/agent/v1/chat/completions",
    ]);
    for (const call of fetchMock.mock.calls) {
      const headers = call[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-agent-token");
    }
    const intentBody = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    const actorBody = JSON.parse(String(fetchMock.mock.calls[1]![1]?.body));
    expect(intentBody).toMatchObject({ model: "timeweb/gpt-oss-120b", reasoning_effort: "low", max_tokens: 768 });
    expect(actorBody).toMatchObject({ model: "timeweb/gpt-oss-120b", reasoning_effort: "low", max_tokens: 512 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("reconnects once after a transient provider network failure", async () => {
  vi.stubEnv("AI_ACTOR_BASE_URL", "https://agent.timeweb.cloud/agent/v1");
  const fetchMock = vi.fn()
    .mockRejectedValueOnce(new TypeError("connection_reset"))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ reply: "Я слушаю вас." }) }, finish_reason: "stop" }],
    })));
  vi.stubGlobal("fetch", fetchMock);
  const state = createSession({ scenarioId: "boarding_no_ticket", mode: "training", difficulty: 1, seed: 42 });
  const result = await new AiAdapterService().act(state, allowedConsequences(state), {
    employee_speech: "Здравствуйте.",
    markers: { polite: true, empathy: false, rude: false, safetyViolation: false },
  });
  expect(result.reply).toBe("Я слушаю вас.");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(fetchMock.mock.calls[1]?.[0]);
});

it("keeps the passenger role and the named help destination", () => {
  let state = createSession({ scenarioId: "boarding_no_ticket", mode: "training", difficulty: 1, seed: 42 });
  state = applyAction(state, { actionId: "ask_for_ticket", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z" });
  state = applyAction(state, { actionId: "explain_rules", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z" });
  expect(actorIsGrounded(state, { consequenceId: "respond_to_current_step", reply: "Посадка без билета запрещена, пройдите в кассу №3" }, "Пройдите в кассу №3")).toBe(false);
  state = applyAction(state, { actionId: "offer_help", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z" });
  expect(actorIsGrounded(state, { consequenceId: "continue", reply: "Поехал в кассу №3, но билет не числится — нужно помочь." }, "Обратитесь в кассу №3")).toBe(false);
  expect(actorIsGrounded(state, { consequenceId: "continue", reply: "Получу информацию и помогу вам." }, "Обратитесь в кассу №3")).toBe(false);
  expect(actorDraftCanSurface(state, "Получу информацию и помогу вам.")).toBe(false);
  expect(actorIsGrounded(state, { consequenceId: "continue", reply: "Хорошо, обращусь в кассу №3." }, "Обратитесь в кассу №3")).toBe(true);
  expect(actorIsGrounded(state, { consequenceId: "continue", reply: "Вам всё понятно? Благодарю за понимание", }, "Вам всё понятно? Благодарю за понимание")).toBe(false);
  expect(actorReference(state, "Обратитесь в официальный контактный центр")).toContain("Я слушаю");
});
it("rejects a passenger who recites the conductor's boarding rule during small talk", () => {
  let state = createSession({ scenarioId: "boarding_no_ticket", mode: "training", difficulty: 1, seed: 42 });
  state = applyAction(state, {
    actionId: "converse", idempotencyKey: crypto.randomUUID(), clientTimestamp: "2026-09-26T00:00:00Z",
    utterance: "Как настроение?",
  });
  const reply = { consequenceId: "continue", reply: "Чувствую себя нормально, однако без действительного билета посадка невозможна." };
  expect(actorIsGrounded(state, reply, "Как настроение?")).toBe(false);
  expect(actorDraftCanSurface(state, reply.reply)).toBe(false);
  expect(actorIsGrounded(state, { consequenceId: "continue", reply: "Ваш терминал отказался принимать карту." }, "Как настроение?")).toBe(false);
});
