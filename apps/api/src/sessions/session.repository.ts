import type { SessionStateDto } from "@vsm/api-contracts";

export abstract class SessionRepository {
  abstract get(id: string): Promise<SessionStateDto | undefined>;
  abstract mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
  ): Promise<SessionStateDto>;
  abstract ready(): Promise<boolean>;
}

// Local development and unit tests only. Production requires PostgreSQL explicitly.
export class MemorySessionRepository extends SessionRepository {
  private readonly records = new Map<string, SessionStateDto>();
  async get(id: string): Promise<SessionStateDto | undefined> {
    return structuredClone(this.records.get(id));
  }
  async ready(): Promise<boolean> {
    return true;
  }
  async mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
  ): Promise<SessionStateDto> {
    if (!this.records.has(id) && this.records.size >= 1000)
      throw new Error("Development session capacity reached");
    const next = change(structuredClone(this.records.get(id)));
    this.records.set(id, structuredClone(next));
    return next;
  }
}
