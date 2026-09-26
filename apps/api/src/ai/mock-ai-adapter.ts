import type {
  ActorResponseDto,
  AllowedConsequenceDto,
  NluAnalysisDto,
  SessionStateDto,
} from "@vsm/api-contracts";
import { AiAdapterService, type ActorInput } from "./ai-adapter.service";

// Test-only explicit fixtures, never registered by the application module.
export class MockAiAdapter extends AiAdapterService {
  calls = 0;
  unavailable = false;
  actorUnavailable = false;
  actorConsequence: string | null = null;
  actorReply: string | null = null;
  lastAllowed: AllowedConsequenceDto[] = [];
  lastActorInput?: ActorInput;
  lastActorState?: SessionStateDto;

  override async analyze(text: string): Promise<NluAnalysisDto> {
    this.calls++;
    if (this.unavailable) throw new Error("mock_model_unavailable");
    const fixtures: Record<string, string> = {
      "Я не могу вас посадить без билета, пройдите в кассу №3": "explain_rules",
      "Ладно, проходите так, только быстрее": "allow_boarding",
      "Я не разрешаю посадку без билета": "explain_rules",
      "Покажите, пожалуйста, ваш билет": "ask_for_ticket",
      "Обратитесь в официальный контактный центр": "offer_help",
      "Вам всё понятно? Благодарю за понимание": "close_conversation",
    };
    const matchedActionId = fixtures[text] ?? "unknown";
    return {
      matchedActionId,
      confidence: matchedActionId === "unknown" ? 0.2 : 0.95,
      markers: {
        polite: matchedActionId !== "allow_boarding",
        empathy: text.includes("кассу"),
        rude: false,
        safetyViolation: matchedActionId === "allow_boarding",
      },
      explanation: `Тестовая разметка фразы: ${matchedActionId}.`,
    };
  }
  override async act(
    state: SessionStateDto,
    allowed: AllowedConsequenceDto[],
    input: ActorInput,
  ): Promise<ActorResponseDto> {
    this.lastAllowed = allowed;
    this.lastActorInput = input;
    this.lastActorState = state;
    if (this.actorUnavailable) throw new Error("mock_actor_unavailable");
    return {
      consequenceId: this.actorConsequence ?? allowed[0]!.id,
      reply: this.actorReply ?? "У меня пока нет билета; подскажите следующий шаг.",
    };
  }
}
