import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { initSql } from "@/db/init-sql";
import { authLimits } from "@/db/schema";
import { publicAuthError } from "./auth-errors";
import { consumeLimits } from "./rate-limit";
import { sessionExpiryFromChunks } from "./supabase-session";

describe("auth return flow", () => {
  it("turns provider errors into a next step", () => {
    expect(publicAuthError("Email not confirmed")).toMatch(/doğrula/);
    expect(publicAuthError("Invalid login credentials")).toMatch(/yanlış/);
    expect(publicAuthError("User already registered")).toMatch(/hesap var/);
    expect(publicAuthError("over_request_rate_limit")).toMatch(/Çok sık/);
    expect(publicAuthError("database connection reset")).toBe("İşlem tamamlanamadı. Biraz sonra tekrar dene.");
  });

  it("reads a supabase session expiry without calling the network", () => {
    const raw = JSON.stringify({ expires_at: 1_800_000_000, access_token: "a", refresh_token: "b" });
    expect(sessionExpiryFromChunks([raw])).toBe(1_800_000_000);
    expect(sessionExpiryFromChunks([])).toBeNull();
    expect(sessionExpiryFromChunks(["not-json"])).toBe(0);
    const encoded = `base64-${Buffer.from(raw, "utf8").toString("base64url")}`;
    expect(sessionExpiryFromChunks([encoded.slice(0, 20), encoded.slice(20)])).toBe(1_800_000_000);
  });

  it("stops a bucket once it reaches the limit and still allows a different one", async () => {
    const client = new PGlite();
    for (const statement of initSql.split(";").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
    const db = drizzle(client);
    const key = randomUUID();
    const check = { key, purpose: "login:ip", limit: 2, windowMs: 60_000 };
    expect(await consumeLimits(db, [check])).toBe(true);
    expect(await consumeLimits(db, [check])).toBe(true);
    expect(await consumeLimits(db, [check])).toBe(false);
    expect(await consumeLimits(db, [{ ...check, purpose: "signup:ip" }])).toBe(true);
    expect(await db.select().from(authLimits)).toHaveLength(3);
    await client.close();
  });
});
