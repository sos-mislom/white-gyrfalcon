import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  CreateSessionDto,
  SessionStateDto,
  SubmitActionDto,
} from "@vsm/api-contracts";
import {
  applyAction,
  createSession,
  SimulationError,
} from "@vsm/simulation-core";

@Injectable()
export class SessionsService {
  private readonly sessions = new Map<string, SessionStateDto>();

  create(input: CreateSessionDto): SessionStateDto {
    if (this.sessions.size >= 1000)
      throw new ServiceUnavailableException({
        code: "session_capacity_reached",
      });
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
    let next: SessionStateDto;
    try {
      next = applyAction(current, action);
    } catch (error) {
      if (!(error instanceof SimulationError)) throw error;
      if (
        error.code === "idempotency_conflict" ||
        error.code === "session_finished"
      )
        throw new ConflictException({ code: error.code });
      throw new BadRequestException({ code: error.code });
    }
    this.sessions.set(sessionId, next);
    return next;
  }
}
