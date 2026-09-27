import type {
  SessionStateDto,
  FreeformActionResultDto,
} from "@vsm/api-contracts";
import { createHash } from "node:crypto";

export type OwnedSession = { deviceHash: string; state: SessionStateDto };

export function hashDeviceId(deviceId: string): string {
  return createHash("sha256").update(deviceId).digest("hex");
}

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
  abstract readAppConfig(): Promise<unknown | undefined>;
  abstract writeAppConfig(config: unknown): Promise<void>;
  abstract listOwnedSessions(limit: number): Promise<OwnedSession[]>;
  abstract bindExternalUser(externalId: string, deviceHash: string): Promise<boolean>;
  abstract externalUserHash(externalId: string): Promise<string | undefined>;
  abstract sessionsForHash(deviceHash: string): Promise<SessionStateDto[]>;
}

// Local development and unit tests only. Production requires PostgreSQL explicitly.
export class MemorySessionRepository extends SessionRepository {
  private readonly records = new Map<string, SessionStateDto>();
  private readonly receipts = new Map<string, FreeformActionResultDto>();
  private readonly owners = new Map<string, string>();
  private readonly externalUsers = new Map<string, string>();
  private appConfig: unknown;
  async readAppConfig() { return structuredClone(this.appConfig); }
  async writeAppConfig(config: unknown) { this.appConfig = structuredClone(config); }
  async listOwnedSessions(limit: number): Promise<OwnedSession[]> {
    return [...this.owners.entries()].slice(-limit).reverse().flatMap(([id, deviceHash]) =>
      this.records.get(id) ? [{ deviceHash, state: structuredClone(this.records.get(id)!) }] : []);
  }
  async bindExternalUser(externalId: string, deviceHash: string): Promise<boolean> {
    const existing = this.externalUsers.get(externalId);
    if (existing && existing !== deviceHash) return false;
    this.externalUsers.set(externalId, deviceHash);
    return true;
  }
  async externalUserHash(externalId: string) { return this.externalUsers.get(externalId); }
  async sessionsForHash(deviceHash: string): Promise<SessionStateDto[]> {
    return this.profileSessionsByHash(deviceHash);
  }
  private async profileSessionsByHash(deviceHash: string): Promise<SessionStateDto[]> {
    return [...this.owners.entries()].filter(([, owner]) => owner === deviceHash)
      .flatMap(([id]) => this.records.get(id) ? [structuredClone(this.records.get(id)!)] : []);
  }
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
    const hash = hashDeviceId(deviceId);
    if (owner && owner !== hash) throw new Error("profile_owner_conflict");
    this.owners.set(sessionId, hash);
  }
  async profileSessions(deviceId: string): Promise<SessionStateDto[]> {
    return this.profileSessionsByHash(hashDeviceId(deviceId));
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
