import { Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateSessionDto,
  SessionStateDto,
  SubmitActionDto,
} from "@vsm/api-contracts";
import { applyAction, createSession } from "@vsm/simulation-core";

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<string, SessionStateDto>();

  create(input: CreateSessionDto): SessionStateDto {
    const session = createSession(input);
    this.sessions.set(session.id, session);
    return session;
  }

  getById(sessionId: string): SessionStateDto {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException({
        code: "session_not_found",
        sessionId,
      });
    }

    return session;
  }

  applyAction(sessionId: string, action: SubmitActionDto): SessionStateDto {
    const current = this.getById(sessionId);
    const next = applyAction(current, action);
    this.sessions.set(sessionId, next);
    return next;
  }
}
