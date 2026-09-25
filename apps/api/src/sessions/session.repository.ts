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
}

// Local development and unit tests only. Production requires PostgreSQL explicitly.
export class MemorySessionRepository extends SessionRepository {
  private readonly records = new Map<string, SessionStateDto>();
  private readonly receipts = new Map<string, FreeformActionResultDto>();
  async getFreeform(key: string) {
    return structuredClone(this.receipts.get(key));
  }
  async get(id: string): Promise<SessionStateDto | undefined> {
    return structuredClone(this.records.get(id));
  }
  async ready(): Promise<boolean> {
    return true;
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
