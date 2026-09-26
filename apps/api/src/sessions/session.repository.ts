import type {
  SessionStateDto,
  FreeformActionResultDto,
} from "@vsm/api-contracts";

export abstract class SessionRepository {
  abstract get(id: string): Promise<SessionStateDto | undefined>;
  abstract getFreeform(
    key: string,
  ): Promise<FreeformActionResultDto | undefined>;
  abstract mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
    receipt?: FreeformActionResultDto,
  ): Promise<SessionStateDto>;
  abstract ready(): Promise<boolean>;
  abstract claimProfileSession(deviceId: string, sessionId: string): Promise<void>;
  abstract profileSessions(deviceId: string): Promise<SessionStateDto[]>;
}

// Local development and unit tests only. Production requires PostgreSQL explicitly.
export class MemorySessionRepository extends SessionRepository {
  private readonly records = new Map<string, SessionStateDto>();
  private readonly receipts = new Map<string, FreeformActionResultDto>();
  private readonly owners = new Map<string, string>();
  async getFreeform(key: string) {
    return structuredClone(this.receipts.get(key));
  }
  async get(id: string): Promise<SessionStateDto | undefined> {
    return structuredClone(this.records.get(id));
  }
  async ready(): Promise<boolean> {
    return true;
  }
  async claimProfileSession(deviceId: string, sessionId: string): Promise<void> {
    const owner = this.owners.get(sessionId);
    if (owner && owner !== deviceId) throw new Error("profile_owner_conflict");
    this.owners.set(sessionId, deviceId);
  }
  async profileSessions(deviceId: string): Promise<SessionStateDto[]> {
    return [...this.owners.entries()].filter(([, owner]) => owner === deviceId)
      .flatMap(([id]) => this.records.get(id) ? [structuredClone(this.records.get(id)!)] : []);
  }
  async mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
    receipt?: FreeformActionResultDto,
  ): Promise<SessionStateDto> {
    if (!this.records.has(id) && this.records.size >= 1000)
      throw new Error("Development session capacity reached");
    const next = change(structuredClone(this.records.get(id)));
    this.records.set(id, structuredClone(next));
    if (receipt)
      this.receipts.set(
        receipt.command.idempotencyKey,
        structuredClone(receipt),
      );
    return next;
  }
}
