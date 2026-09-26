import {
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  sessionStateSchema,
  freeformActionResultSchema,
  type FreeformActionResultDto,
  type SessionStateDto,
} from "@vsm/api-contracts";
import { SessionRepository } from "./session.repository";

export class PostgresSessionRepository
  extends SessionRepository
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool = new Pool({
    host: process.env.PGHOST,
    port: Number(process.env.PGPORT ?? 5432),
    database: process.env.PGDATABASE ?? "vsm",
    user: process.env.PGUSER ?? "vsm",
    password: process.env.PGPASSWORD_FILE
      ? readFileSync(process.env.PGPASSWORD_FILE, "utf8").trim()
      : process.env.PGPASSWORD,
    max: 4,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
  });

  constructor() {
    super();
    this.pool.on("error", () =>
      new Logger("SessionRepository").error("Database connection failed"),
    );
  }

  async onModuleInit(): Promise<void> {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS vsm_sessions (
      id uuid PRIMARY KEY,
      state jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS vsm_freeform_receipts (
      key uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES vsm_sessions(id),
      result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.pool.query(`CREATE TABLE IF NOT EXISTS vsm_profile_sessions (
      session_id uuid PRIMARY KEY,
      device_hash text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.pool.query("CREATE INDEX IF NOT EXISTS vsm_profile_sessions_device ON vsm_profile_sessions(device_hash)");
  }
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
  async getFreeform(key: string): Promise<FreeformActionResultDto | undefined> {
    const result = await this.pool.query<{ result: unknown }>(
      "SELECT result FROM vsm_freeform_receipts WHERE key = $1",
      [key],
    );
    return result.rows[0]
      ? freeformActionResultSchema.parse(result.rows[0].result)
      : undefined;
  }
  async ready(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  private profileHash(deviceId: string): string {
    return createHash("sha256").update(deviceId).digest("hex");
  }
  async claimProfileSession(deviceId: string, sessionId: string): Promise<void> {
    const hash = this.profileHash(deviceId);
    const result = await this.pool.query<{ device_hash: string }>(
      `INSERT INTO vsm_profile_sessions(session_id, device_hash) VALUES ($1, $2)
       ON CONFLICT (session_id) DO UPDATE SET device_hash = vsm_profile_sessions.device_hash
       RETURNING device_hash`, [sessionId, hash],
    );
    if (result.rows[0]?.device_hash !== hash) throw new Error("profile_owner_conflict");
  }
  async profileSessions(deviceId: string): Promise<SessionStateDto[]> {
    const result = await this.pool.query<{ state: unknown }>(
      `SELECT s.state FROM vsm_profile_sessions p JOIN vsm_sessions s ON s.id = p.session_id
       WHERE p.device_hash = $1 ORDER BY s.created_at DESC LIMIT 200`,
      [this.profileHash(deviceId)],
    );
    return result.rows.map((row) => sessionStateSchema.parse(row.state));
  }
  async get(id: string): Promise<SessionStateDto | undefined> {
    const result = await this.pool.query<{ state: unknown }>(
      "SELECT state FROM vsm_sessions WHERE id = $1",
      [id],
    );
    return result.rows[0]
      ? sessionStateSchema.parse(result.rows[0].state)
      : undefined;
  }
  async mutate(
    id: string,
    change: (state: SessionStateDto | undefined) => SessionStateDto,
    receipt?: FreeformActionResultDto,
  ): Promise<SessionStateDto> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Also serializes concurrent creation where no row yet exists. Hash collisions only serialize unrelated IDs.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [id]);
      const result = await client.query<{ state: unknown }>(
        "SELECT state FROM vsm_sessions WHERE id = $1 FOR UPDATE",
        [id],
      );
      const current = result.rows[0]
        ? sessionStateSchema.parse(result.rows[0].state)
        : undefined;
      const next = change(current);
      if (next.id !== id) throw new Error("Repository ID mismatch");
      await client.query(
        `INSERT INTO vsm_sessions(id, state) VALUES ($1, $2::jsonb)
        ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
        [id, JSON.stringify(next)],
      );
      if (receipt)
        await client.query(
          "INSERT INTO vsm_freeform_receipts(key, session_id, result) VALUES ($1, $2, $3::jsonb)",
          [receipt.command.idempotencyKey, id, JSON.stringify(receipt)],
        );
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
