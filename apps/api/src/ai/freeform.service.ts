import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  actorResponseSchema,
  nluAnalysisSchema,
  type FreeformActionResultDto,
  type SubmitFreeformActionDto,
  type NluAnalysisDto,
} from "@vsm/api-contracts";
import {
  allowedConsequences,
  applyAction,
  SCENE_SOURCE,
  sceneAnalysis,
  getScenario,
} from "@vsm/simulation-core";
import { SessionRepository } from "../sessions/session.repository";
import { AiAdapterService } from "./ai-adapter.service";
import { screenConduct } from "./conduct-rules";
import { actorDraftCanSurface, actorIsGrounded, actorReference } from "./actor-grounding";

@Injectable()
export class FreeformService {
  private readonly pending = new Map<
    string,
    Promise<FreeformActionResultDto>
  >();
  constructor(
    private readonly repository: SessionRepository,
    private readonly ai: AiAdapterService,
  ) {}

  async submit(
    input: SubmitFreeformActionDto,
    expectedCount?: number,
    onDraft?: (text: string) => void,
  ): Promise<FreeformActionResultDto> {
    const key = freeformKey(input);
    const cached = await this.repository.getFreeform(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.perform(input, key, expectedCount, onDraft);
    this.pending.set(key, task);
    try {
      return await task;
    } finally {
      this.pending.delete(key);
    }
  }

  private async perform(
    input: SubmitFreeformActionDto,
    key: string,
    expectedCount?: number,
    onDraft?: (text: string) => void,
  ): Promise<FreeformActionResultDto> {
    const state = await this.repository.get(input.sessionId);
    if (!state) throw new NotFoundException({ code: "session_not_found" });
    if (
      state.outcome !== "active" ||
      (expectedCount !== undefined &&
        state.appliedActions.length !== expectedCount)
    )
      throw new ConflictException({ code: "session_changed" });
    const conduct = screenConduct(input.freeformText);
    if (conduct?.kind === "uncertain")
      throw new UnprocessableEntityException({
        code: "ai_intent_uncertain",
        message:
          "Уточните, чья это реплика: цитата, отрицание и угроза не равнозначны. Ход не применён.",
      });
    const scene = getScenario(state.scenarioId);
    if (!scene) throw new UnprocessableEntityException({ code: "unknown_scenario" });
    const standard = sceneAnalysis(input.freeformText, scene);
    let analysis: NluAnalysisDto;
    try {
      analysis = nluAnalysisSchema.parse(
        conduct?.analysis ??
          standard ??
          farewell(input.freeformText) ??
          (await this.ai.analyze(input.freeformText, state)),
      );
    } catch {
      analysis = nluAnalysisSchema.parse({
        matchedActionId: "converse", confidence: 1,
        markers: { polite: false, empathy: false, rude: false, safetyViolation: false },
        explanation: "Разговор продолжается без определённого действия",
      });
    }
    if (analysis.markers.safetyViolation &&
      (analysis.confidence < 0.75 ||
        !state.availableActions.some(action => action.id === analysis.matchedActionId)))
      throw new UnprocessableEntityException({
        code: "ai_intent_uncertain",
        message: "Уточните, разрешаете ли вы действие: от этого зависит оценка безопасности.",
      });
    if (analysis.confidence < 0.75 ||
      !state.availableActions.some(action => action.id === analysis.matchedActionId))
      analysis = { ...analysis, matchedActionId: "converse", confidence: 1,
        markers: { ...analysis.markers, safetyViolation: false } };
    // Fail closed on contradiction. This guard is not a substitute for live NLU validation.
    if (
      (Boolean(scene.incident.branches.find(b => b.action_id === analysis.matchedActionId)?.is_violation) &&
        /(?:^|[\s.,!?])(?:не|нельзя|невозможно)[\s,]/iu.test(
          input.freeformText,
        )) ||
      (analysis.markers.safetyViolation &&
        !scene.incident.branches.find(b => b.action_id === analysis.matchedActionId)?.is_violation &&
        !(
          analysis.matchedActionId === "dismiss_passenger" &&
          conduct?.kind === "violent_threat"
        ))
    )
      throw new UnprocessableEntityException({
        code: "ai_intent_uncertain",
        message: "В распознавании есть противоречие. Выберите действие явно.",
      });
    const command = {
      idempotencyKey: key,
      actionId: analysis.matchedActionId,
      clientTimestamp: input.clientTimestamp,
      utterance: input.freeformText,
      ...(state.currentActorId ? { actorId: state.currentActorId } : {}),
      communication: {
        polite: analysis.markers.polite,
        empathy: analysis.markers.empathy,
        rude: analysis.markers.rude,
        ...(input.interrupted ? { interrupted: true } : {}),
      },
      ...(conduct?.kind === "violent_threat"
        ? { conduct: "violent_threat" as const }
        : {}),
    };
    const next = applyAction(state, command);
    const consequences = allowedConsequences(next);
    let actor = {
      consequenceId: consequences[0]!.id,
      reply: actorReference(next, input.freeformText),
    };
    let actorFallback = true;
    try {
    const proposed = actorResponseSchema.parse(
      await this.ai.act(
        next,
        consequences,
        {
          employee_speech: input.freeformText,
          markers: analysis.markers,
          previousPassengerReply: state.appliedActions.at(-1)?.actorReply ?? state.passengerReply,
        },
        onDraft ? (draft) => { if (actorDraftCanSurface(next, draft)) onDraft(draft); } : undefined,
      ),
    );
    if (
      consequences.some(
        (outcome) => outcome.id === proposed.consequenceId,
      ) &&
      actorIsGrounded(next, proposed, input.freeformText)
    ) {
      actor = proposed;
      actorFallback = false;
    }
    } catch {
      /* Keep a grounded fallback if the model fails. */
    }
    const committedCommand = { ...command, actorReply: actor.reply };
    const committedNext = applyAction(state, committedCommand);
    const result: FreeformActionResultDto = {
      session: committedNext,
      command: committedCommand,
      analysis,
      allowedConsequences: consequences,
      actor,
      actorFallback,
      source: scene.incident.sop_reference || SCENE_SOURCE,
      execution: "server",
      // Old browser builds validate this response strictly; keep their wire shape intact.
      responseMode: actorFallback ? "fallback" as const : "generated" as const,
    };
    try {
      await this.repository.mutate(
        state.id,
        (current) => {
          if (
            !current ||
            current.appliedActions.length !== state.appliedActions.length
          )
            throw new ConflictException({ code: "session_changed" });
          return committedNext;
        },
        result,
      );
    } catch (error) {
      const duplicate = await this.repository.getFreeform(key);
      if (duplicate) return duplicate;
      throw error;
    }
    return result;
  }
}

export function freeformKey(input: SubmitFreeformActionDto): string {
  const hex = createHash("sha256")
    .update(
      JSON.stringify([
        input.sessionId,
        input.freeformText,
        input.clientTimestamp,
        ...(input.interrupted === undefined ? [] : [input.interrupted]),
      ]),
    )
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// Exact etiquette-only phrases: no substring override of threats or mixed intentions.
function farewell(text: string): NluAnalysisDto | undefined {
  const normalized = text
    .toLocaleLowerCase("ru")
    .replace(/[.,!?—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    !/^(?:(?:всего доброго|до свидания|счастливого пути|обращайтесь|спасибо|благодарю за понимание|вам все понятно|вам всё понятно)\s*)+$/u.test(
      normalized,
    )
  )
    return;
  return {
    matchedActionId: "close_conversation",
    confidence: 1,
    markers: {
      polite: true,
      empathy: false,
      rude: false,
      safetyViolation: false,
    },
    explanation:
      "Этикетное прощание распознано правилом NLU. Полноту решения проверяет движок.",
  };
}
