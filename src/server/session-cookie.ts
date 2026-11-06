import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  return process.env.AUTH_SECRET || "dev-only-secret-change-me";
}

function macFor(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

function macMatches(mac: string, payload: string): boolean {
  const left = Buffer.from(mac);
  const right = Buffer.from(macFor(payload));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Stateless session cookie. `version` is the profile's session_version, so a password change signs other devices out. */
export function encodeSession(id: string, version: number): string {
  const payload = `${id}.${version}`;
  return `${payload}.${macFor(payload)}`;
}

/** Accepts the current cookie and the older `id.mac` cookie (version 0). */
export function decodeSession(value: string | undefined): { id: string; version: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length === 2) {
    const [id, mac] = parts;
    if (!id || !mac || !macMatches(mac, id)) return null;
    return { id, version: 0 };
  }
  if (parts.length !== 3) return null;
  const [id, versionText, mac] = parts;
  if (!id || !mac || !/^\d+$/.test(versionText ?? "")) return null;
  const version = Number(versionText);
  if (!macMatches(mac, `${id}.${version}`)) return null;
  return { id, version };
}
