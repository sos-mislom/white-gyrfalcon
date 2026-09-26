import { describe, expect, it } from "vitest";
import { ENGINE_VERSION, sessionStateSchema } from "@vsm/api-contracts";
import { applyAction, createSession, getFeaturedScenario, getScenario, loadAllScenarios, replaySession, sceneAnalysis } from "./index";

const command = (actionId: string, utterance?: string, actorReply?: string) => ({
  idempotencyKey: crypto.randomUUID(), actionId, clientTimestamp: "2026-09-26T00:00:00Z",
  ...(utterance ? { utterance } : {}), ...(actorReply ? { actorReply } : {}),
});

describe("YAML scene engine", () => {
  it("validates independent escalation and reaction vectors for every scene", () => {
    const scenes = loadAllScenarios();
    expect(scenes).toHaveLength(20);
    expect(getFeaturedScenario().menu_label).toBe("Посадка без билета");
    for (const scene of scenes) {
      expect(scene.incident.escalation.warning_minutes).toBeLessThan(scene.incident.escalation.deadline_minutes);
      expect(scene.incident.escalation.idle_vector).toBeTruthy();
      expect(scene.incident.escalation.wrong_action_vector).toBeTruthy();
      expect(scene.legal_basis.length).toBeGreaterThan(0);
      for (const norm of scene.legal_basis) {
        expect(scene.incident.sop_reference).toContain(norm.clause);
        expect(norm.url).toMatch(/^https:\/\//);
      }
      for (const branch of scene.incident.branches)
        for (const outcome of Object.values(branch.outcomes))
          if (outcome) {
            expect(outcome.reaction_vector).toBeTruthy();
            expect("passenger_reply" in outcome).toBe(false);
          }
    }
  });

  it.each(["vsm_boarding_no_ticket_01", "vsm_vip_cold_coffee_01", "vsm_env_blackout_01"])(
    "applies each scene's own idle escalation and deadline: %s", (scenarioId) => {
      let state = createSession({ scenarioId, mode: "training", difficulty: 1, seed: 42 });
      const rule = getScenario(scenarioId)!.incident.escalation;
      while (state.outcome === "active") state = applyAction(state, command("wait"));
      expect(state.incidents[0]?.phase).toBe(3);
      expect(state.currentTimeMinutes).toBeGreaterThanOrEqual(rule.deadline_minutes);
      expect(state.passengerReply).toBe(rule.failure_vector);
      expect(state.events.some(event => event.type === "incident_escalated")).toBe(true);
      expect(sessionStateSchema.safeParse(state).success).toBe(true);
    },
  );

  it("escalates a missing prerequisite and permits recovery", () => {
    let state = createSession({ scenarioId: "boarding_no_ticket", mode: "training", difficulty: 1, seed: 42 });
    state = applyAction(state, command("explain_rules"));
    expect(state.incidents[0]?.phase).toBe(2);
    expect(state.scores.procedure).toBe(80);
    for (const actionId of ["ask_for_ticket", "explain_rules", "offer_help", "close_conversation"])
      state = applyAction(state, command(actionId));
    expect(state.outcome).toBe("resolved");
    expect(state.scores.procedure).toBe(80);
  });

  it("keeps an extractive summary with both sides' speech across replay", () => {
    const setup = { scenarioId: "boarding_no_ticket", mode: "training" as const, difficulty: 1, seed: 42 };
    const commands = [
      command("ask_for_ticket", "Покажите билет и номер заказа", "У меня есть номер заказа, но билета нет."),
      command("explain_rules", "Без билета нельзя, пройдите в кассу №3", "Понял, мне в кассу №3."),
    ];
    const id = crypto.randomUUID();
    const state = replaySession(id, { engineVersion: ENGINE_VERSION, setup, commands });
    expect(state.dialogueSummary).toContain("номер заказа");
    expect(state.dialogueSummary).toContain("кассу №3");
    expect(state.dialogueSummary).toContain("Понял");
    expect(replaySession(id, { engineVersion: ENGINE_VERSION, setup, commands })).toEqual(state);
    expect(() => applyAction(state, { ...commands[1]!, actorReply: "Подменённый ответ" }))
      .toThrow("idempotency_conflict");
  });

  it("uses authored exact patterns without matching unrelated speech", () => {
    const scene = getScenario("boarding_no_ticket")!;
    expect(sceneAnalysis("Покажите ваш билет", scene)?.matchedActionId).toBe("ask_for_ticket");
    expect(sceneAnalysis("Ладно, проходите так", scene)?.matchedActionId).toBe("allow_boarding");
    expect(sceneAnalysis("Покажите мне кофе", scene)).toBeUndefined();
  });

  it("records leaving an unresolved scene as finished across replay", () => {
    const setup = { scenarioId: "vsm_biz_noisy_kids_01", mode: "training" as const, difficulty: 1, seed: 42 };
    const id = crypto.randomUUID();
    const commands = [command("leave_scene")];
    const state = replaySession(id, { engineVersion: ENGINE_VERSION, setup, commands });
    expect(state.outcome).toBe("abandoned");
    expect(state.availableActions).toHaveLength(0);
    expect(state.events.at(-1)?.type).toBe("session_finished");
    expect(() => applyAction(state, command("converse"))).toThrow("session_finished");
  });

  it("lets the conductor speak to both people in one scene and restores each voice", () => {
    const setup = { scenarioId: "vsm_biz_noisy_kids_01", mode: "training" as const, difficulty: 1, seed: 42 };
    const id = crypto.randomUUID();
    const motherId = "char_mother_with_child";
    const elderId = "char_tamara_noisy_kids";
    const commands = [
      command(`focus:${motherId}`),
      { ...command("converse", "Чем помочь ребёнку?", "Можно пройти в тихое место?"), actorId: motherId },
      command(`focus:${elderId}`),
      command(`focus:${motherId}`),
    ];
    const state = replaySession(id, { engineVersion: ENGINE_VERSION, setup, commands });
    expect(state.currentActorId).toBe(motherId);
    expect(state.currentLocationId).toBe("Ряд 6, место матери");
    expect(state.passengerReply).toBe("Можно пройти в тихое место?");
    expect(state.dialogueSummary).toContain("Чем помочь ребёнку?");
    expect(sessionStateSchema.safeParse(state).success).toBe(true);
  });

  it("does not resolve a two-person conflict before both have been addressed", () => {
    let state = createSession({ scenarioId: "vsm_biz_noisy_kids_01", mode: "training", difficulty: 1, seed: 42 });
    state = applyAction(state, { ...command("act_mediate_quietly", "Я поговорю с матерью."), actorId: "char_tamara_noisy_kids" });
    expect(state.checks).toHaveLength(0);
    expect(state.outcome).toBe("active");
    state = applyAction(state, command("focus:char_mother_with_child"));
    state = applyAction(state, { ...command("act_mediate_quietly", "Мария, давайте найдём тихое место для вас с ребёнком."), actorId: "char_mother_with_child" });
    expect(state.checks).toHaveLength(1);
    expect(state.completedActionIds).toContain("talk:char_tamara_noisy_kids");
    expect(state.completedActionIds).toContain("talk:char_mother_with_child");
  });
});
