import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { initSql } from "@/db/init-sql";
import { authLimits } from "@/db/schema";
import { safeNextPath } from "./auth";
import { publicAuthError } from "./auth-errors";
import { clientAddress } from "./client-address";
import { consumeLimits } from "./rate-limit";
import { practiceIdsWithinCap, practiceQuestionCap } from "./sessions";
import { sessionExpiryFromChunks, shouldRefreshSupabase } from "./supabase-session";

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

  it("keeps the next page on this site", () => {
    expect(safeNextPath("/bugun")).toBe("/bugun");
    expect(safeNextPath("https://evil.example")).toBe("/bugun");
    expect(safeNextPath("//evil.example")).toBe("/bugun");
    expect(safeNextPath("/%2f%2fevil.example")).toBe("/bugun");
    expect(safeNextPath("/bugun%00.evil")).toBe("/bugun");
    expect(safeNextPath("/giris?sonra=%2Fbugun")).toBe("/giris?sonra=/bugun");
  });

  it("uses the platform address instead of a spoofed first hop", () => {
    const headers = new Map([
      ["x-forwarded-for", "1.2.3.4, 203.0.113.8"],
      ["x-real-ip", "203.0.113.8"],
    ]);
    expect(clientAddress((name) => headers.get(name))).toBe("203.0.113.8");
    headers.delete("x-real-ip");
    expect(clientAddress((name) => headers.get(name))).toBe("203.0.113.8");
  });

  it("does not refresh an unreadable supabase cookie", () => {
    expect(shouldRefreshSupabase(null)).toBe(false);
    expect(shouldRefreshSupabase(0)).toBe(false);
    expect(shouldRefreshSupabase(Math.floor(Date.now() / 1000) + 3600)).toBe(false);
    expect(shouldRefreshSupabase(Math.floor(Date.now() / 1000) + 10)).toBe(true);
  });

  it("refuses a practice request that names the whole bank", () => {
    const allowed = new Set(["a", "b", "c"]);
    const requested = ["a", "a", "missing", ...Array.from({ length: practiceQuestionCap + 5 }, (_, index) => `q${index}`), "b"];
    const picked = practiceIdsWithinCap(requested, allowed);
    expect(picked).toEqual(["a", "b"]);
    const bank = Array.from({ length: 200 }, (_, index) => `item-${index}`);
    expect(practiceIdsWithinCap(bank, new Set(bank))).toHaveLength(practiceQuestionCap);
  });
});
