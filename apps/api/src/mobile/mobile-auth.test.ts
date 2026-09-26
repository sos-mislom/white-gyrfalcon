import { createHmac } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { validMobileAccess } from "./mobile-auth";

const folder = mkdtempSync(join(tmpdir(), "vsm-mobile-auth-"));
const path = join(folder, "key");
const secret = Buffer.alloc(32, 7);
writeFileSync(path, secret.toString("hex"));
vi.stubEnv("MOBILE_TOKEN_HMAC_FILE", path);
afterAll(() => { vi.unstubAllEnvs(); rmSync(folder, { recursive: true, force: true }); });

function sign(claims: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

describe("mobile access pass", () => {
  const claims = { iss: "white-gyrfalcon", aud: "vsm-mobile", sub: "android-release-v0.5.1", iat: 1_780_000_000, exp: 1_800_000_000 };
  it("accepts a valid pass and rejects tampering, expiry and another audience", () => {
    const token = sign(claims);
    expect(validMobileAccess(token, 1_790_000_000_000)).toBe(true);
    expect(validMobileAccess(token + "x", 1_790_000_000_000)).toBe(false);
    expect(validMobileAccess(token, 1_810_000_000_000)).toBe(false);
    expect(validMobileAccess(sign({ ...claims, aud: "other" }), 1_790_000_000_000)).toBe(false);
  });
});
