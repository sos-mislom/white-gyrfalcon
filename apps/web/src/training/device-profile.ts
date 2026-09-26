import { sessionStateSchema, type SessionStateDto } from "@vsm/api-contracts";
import { z } from "zod";
import type { SavedSession } from "./journal-storage";

declare global {
  interface Window { VsmDevice?: { getId(): string } }
}

const KEY = "vsm-device-profile-id";
const LINKED = "vsm-device-profile-linked";
const validId = /^[a-f0-9]{64}$/;
let ephemeralId: string | undefined;

/** App-scoped pseudonymous ID. Native Android derives it from ANDROID_ID; browsers generate one. */
export function deviceProfileId(): string {
  const nativeId = typeof window !== "undefined" ? window.VsmDevice?.getId() : undefined;
  if (nativeId && validId.test(nativeId)) return nativeId;
  let storage: Storage | undefined;
  try { storage = typeof localStorage !== "undefined" ? localStorage : undefined; } catch { /* Restricted browser storage. */ }
  let stored = ephemeralId;
  try { stored = storage?.getItem(KEY) ?? ephemeralId; } catch { /* Use this tab's identity. */ }
  if (stored && validId.test(stored)) return stored;
  const id = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  try { storage?.setItem(KEY, id); } catch { /* Use this tab's identity. */ }
  ephemeralId = id;
  return id;
}

export function profileHeaders(): Record<string, string> {
  return { "x-vsm-device-id": deviceProfileId() };
}

export async function profileHistory(): Promise<SessionStateDto[]> {
  const api = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const response = await fetch(`${api}/profiles/me`, { headers: profileHeaders(), signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error("profile_unavailable");
  return z.array(sessionStateSchema).parse(await response.json());
}

/** Existing local journals are claimed once, so updating the app retains their server history. */
export async function linkLocalHistory(records: SavedSession[]): Promise<void> {
  const id = deviceProfileId();
  const key = `${LINKED}:${id}`;
  const linked = new Set<string>(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
  const api = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  for (const record of records) {
    if (linked.has(record.id) || record.pendingFreeform) continue;
    const response = await fetch(`${api}/sessions/${record.id}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", ...profileHeaders() },
      body: JSON.stringify(record.journal),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) continue;
    linked.add(record.id);
    localStorage.setItem(key, JSON.stringify([...linked]));
  }
}
