import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  CreateSessionDto,
  SessionStateDto,
  SubmitActionDto,
  SyncSessionDto,
} from "@vsm/api-contracts";
import {
  applyAction,
  createSession,
  mergeJournal,
  SimulationError,
} from "@vsm/simulation-core";
import { SessionRepository } from "./session.repository";

@Injectable()
export class SessionsService {
  constructor(private readonly repository: SessionRepository) {}

  create(input: CreateSessionDto): Promise<SessionStateDto> {
    let session: SessionStateDto;
    try {
      session = createSession(input);
    } catch (error) {
      if (error instanceof SimulationError)
        throw new BadRequestException({ code: error.code });
      throw error;
    }
    return this.repository.mutate(session.id, () => session);
  }

  async getById(id: string): Promise<SessionStateDto> {
    return this.required(await this.repository.get(id));
  }

  async profileSessions(deviceId: string): Promise<SessionStateDto[]> {
    return this.repository.profileSessions(deviceId);
  }

  applyAction(id: string, action: SubmitActionDto): Promise<SessionStateDto> {
    return this.mutate(id, (state) => {
      const current = this.required(state);
      return applyAction(current, action);
    });
  }

  async sync(id: string, journal: SyncSessionDto, deviceId?: string): Promise<SessionStateDto> {
    if (deviceId) {
      try { await this.repository.claimProfileSession(deviceId, id); }
      catch (error) {
        if (error instanceof Error && error.message === "profile_owner_conflict")
          throw new ConflictException({ code: "profile_owner_conflict" });
        throw error;
      }
    }
    return this.mutate(id, (state) => mergeJournal(id, journal, state));
  }

  private required(state?: SessionStateDto): SessionStateDto {
    if (!state) throw new NotFoundException({ code: "session_not_found" });
    return state;
  }

  private async mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
  ): Promise<SessionStateDto> {
    try {
      return await this.repository.mutate(id, change);
    } catch (error) {
      if (!(error instanceof SimulationError)) throw error;
      if (
        [
          "idempotency_conflict",
          "session_finished",
          "journal_conflict",
          "session_setup_conflict",
          "engine_version_mismatch",
        ].includes(error.code)
      )
        throw new ConflictException({ code: error.code });
      throw new BadRequestException({ code: error.code });
    }
  }
}
