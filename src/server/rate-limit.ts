import { createHash, randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { and, eq, gte, lt } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { getDb } from "@/db/client";
import { authLimits } from "@/db/schema";

type Db = PgliteDatabase<any>;

export const limitedMessage = "Çok sık denedin. Biraz sonra tekrar dene.";

const hour = 60 * 60 * 1000;

function digest(value: string) {
  return createHash("sha256").update(`${process.env.AUTH_SECRET || "dev-only-secret-change-me"}:${value}`).digest("hex");
}

/** Returns false once any bucket is already full. A passing call records one hit in each bucket. */
export async function consumeLimits(db: Db, checks: { key: string; purpose: string; limit: number; windowMs: number }[]): Promise<boolean> {
  const now = Date.now();
  await db.delete(authLimits).where(lt(authLimits.createdAt, new Date(now - 2 * 24 * hour)));
  for (const check of checks) {
    const rows = await db
      .select({ id: authLimits.id })
      .from(authLimits)
      .where(and(eq(authLimits.purpose, check.purpose), eq(authLimits.keyHash, check.key), gte(authLimits.createdAt, new Date(now - check.windowMs))));
    if (rows.length >= check.limit) return false;
  }
  if (checks.length === 0) return true;
  await db.insert(authLimits).values(
    checks.map((check) => ({
      id: randomUUID(),
      keyHash: check.key,
      purpose: check.purpose,
      createdAt: new Date(now),
    })),
  );
  return true;
}

async function callerKeys(email?: string) {
  let ip = "unknown";
  try {
    const h = await headers();
    ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown").split(",")[0]?.trim() || "unknown";
  } catch {
    ip = "no-request";
  }
  return { ip: digest(`ip:${ip}`), email: email ? digest(`email:${email.trim().toLowerCase()}`) : null };
}

const authWindows = {
  signup: { ip: [8, hour], email: [3, hour] },
  login: { ip: [20, 15 * 60 * 1000], email: [10, 15 * 60 * 1000] },
  reset: { ip: [8, hour], email: [5, hour] },
  resend: { ip: [8, hour], email: [5, hour] },
  password: { ip: [8, hour], email: [8, hour] },
} as const;

/** Stops mail and password guessing before the request reaches Supabase or the password hasher. */
export async function allowAuth(purpose: keyof typeof authWindows, email?: string) {
  if (process.env.NODE_ENV === "test") return true;
  const keys = await callerKeys(email);
  const window = authWindows[purpose];
  const checks: { key: string; purpose: string; limit: number; windowMs: number }[] = [
    { key: keys.ip, purpose: `${purpose}:ip`, limit: window.ip[0], windowMs: window.ip[1] },
  ];
  if (keys.email) checks.push({ key: keys.email, purpose: `${purpose}:email`, limit: window.email[0], windowMs: window.email[1] });
  return consumeLimits(await getDb(), checks);
}

const useWindows = {
  session: [
    [8, 10 * 60 * 1000],
    [24, hour],
  ],
  answer: [
    [40, 60 * 1000],
    [300, hour],
  ],
  drill: [[120, hour]],
  health: [[30, 60 * 1000]],
} as const;

/** Caps study and health traffic per network, so a script cannot walk the bank or hammer the database. */
export async function allowUse(purpose: keyof typeof useWindows) {
  if (process.env.NODE_ENV === "test") return true;
  const { ip } = await callerKeys();
  return consumeLimits(
    await getDb(),
    useWindows[purpose].map(([limit, windowMs], index) => ({
      key: ip,
      purpose: index === 0 ? purpose : `${purpose}:${index}`,
      limit,
      windowMs,
    })),
  );
}
