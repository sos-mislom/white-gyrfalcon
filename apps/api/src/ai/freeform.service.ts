import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
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
  BOARDING_SOURCE,
} from "@vsm/simulation-core";
import { SessionRepository } from "../sessions/session.repository";
import { AiAdapterService } from "./ai-adapter.service";
import { screenConduct } from "./conduct-rules";
import { actorIsGrounded, actorReference } from "./actor-grounding";

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
  ): Promise<FreeformActionResultDto> {
    const key = freeformKey(input);
    const cached = await this.repository.getFreeform(key);
    if (cached) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = this.perform(input, key, expectedCount);
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
    if (
      conduct?.kind === "violent_threat" &&
      state.engineVersion !== "boarding-3"
    )
      throw new UnprocessableEntityException({
        code: "ai_intent_uncertain",
        message:
          "Для этого разбора начните новую попытку с актуальными правилами.",
      });
    let analysis;
    try {
      analysis = nluAnalysisSchema.parse(
        conduct?.analysis ??
          farewell(input.freeformText) ??
          (await this.ai.analyze(input.freeformText, state)),
      );
    } catch {
      throw new ServiceUnavailableException({
        code: "ai_unavailable",
        message: "Используйте явные действия: AI недоступен, ход не применён.",
      });
    }
    if (
      analysis.confidence < 0.75 ||
      !state.availableActions.some(
        (action) => action.id === analysis.matchedActionId,
      )
    )
      throw new UnprocessableEntityException({
        code: "ai_intent_uncertain",
        message:
          "Уточните ответ или выберите явное действие; оценка не изменена.",
      });
    // Fail closed on contradiction. This guard is not a substitute for live NLU validation.
    if (
      (analysis.matchedActionId === "allow_boarding" &&
        /(?:^|[\s.,!?])(?:не|нельзя|невозможно)[\s,]/iu.test(
          input.freeformText,
        )) ||
      (analysis.markers.safetyViolation &&
        analysis.matchedActionId !== "allow_boarding" &&
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
        await this.ai.act(next, consequences, {
          employee_speech: input.freeformText,
          markers: analysis.markers,
        }),
      );
      const contradictsPermission =
        proposed.consequenceId === "boarding_permission_granted" &&
        /не\s+(?:мог|смог|разреш|пуст|удалось|пройти)/iu.test(proposed.reply);
      if (
        consequences.some((outcome) => outcome.id === proposed.consequenceId) &&
        !contradictsPermission &&
        actorIsGrounded(next, proposed, input.freeformText)
      ) {
        actor = proposed;
        actorFallback = false;
      }
    } catch {
      /* NLU succeeded. Deterministic narrative remains available without actor. */
    }
    const result: FreeformActionResultDto = {
      session: next,
      command,
      analysis,
      allowedConsequences: consequences,
      actor,
      actorFallback,
      source: BOARDING_SOURCE,
      execution: "server",
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
          return next;
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
