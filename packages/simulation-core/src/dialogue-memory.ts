import type { SessionStateDto } from "@vsm/api-contracts";

/** Compact, replayable extractive memory of employee speech and completed steps. */
export function dialogueMemory(state: SessionStateDto) {
  return {
    summary: state.dialogueSummary,
    completedSteps: [...state.completedActionIds],
    lastEmployeeSpeech: state.appliedActions.at(-1)?.utterance ?? null,
    lastReactionVector: state.passengerReply,
  };
}

/** Compatibility helper for offline actor fallback. */
export function memoryAwareReply(state: SessionStateDto): string | undefined {
  const last = state.appliedActions.at(-1);
  if (!last) return state.passengerReply || undefined;
  if (last.actorReply) return last.actorReply;
  return state.passengerReply || undefined;
}
