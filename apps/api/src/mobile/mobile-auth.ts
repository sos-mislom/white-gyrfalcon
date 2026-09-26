import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

type MobileClaims = { iss: string; aud: string; sub: string; iat: number; exp: number };

function key(): Buffer | null {
  const path = process.env.MOBILE_TOKEN_HMAC_FILE;
  if (!path) return null;
  try {
    const value = readFileSync(path, "utf8").trim();
    return /^[a-f0-9]{64}$/.test(value) ? Buffer.from(value, "hex") : null;
  } catch { return null; }
}

/** The APK contains only this signed access pass; the signing key remains on the server. */
export function validMobileAccess(token: string | undefined, now = Date.now()): boolean {
  if (!token || token.length > 2000) return false;
  const secret = key();
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  const [header, payload, signature] = parts as [string, string, string];
  try {
    const metadata = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    if (metadata.alg !== "HS256" || metadata.typ !== "JWT") return false;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MobileClaims;
    if (claims.iss !== "white-gyrfalcon" || claims.aud !== "vsm-mobile" ||
        !/^android-release-v\d+\.\d+\.\d+$/.test(claims.sub) ||
        !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
        claims.iat > Math.floor(now / 1000) + 60 || claims.exp <= Math.floor(now / 1000)) return false;
    const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, "base64url");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}
