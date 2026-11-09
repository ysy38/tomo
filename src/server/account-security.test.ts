import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initSql } from "@/db/init-sql";
import { migratePglite } from "@/db/migrations";
import { authChallenges, authMail, profiles } from "@/db/schema";
import {
  changeAccountPassword,
  confirmEmailToken,
  hashAuthToken,
  issueAuthChallenge,
  normalizeEmail,
  resetPasswordWithToken,
  sendEmailVerification,
  sendPasswordReset,
} from "./account-security";
import { smtpData } from "./mail";
import { hashPassword, passwordIssue, verifyPassword } from "./password";
import { decodeSession, encodeSession } from "./session-cookie";

const origin = "http://localhost:3000";
let client: PGlite;
let db: ReturnType<typeof drizzle>;

async function learner(email: string) {
  const id = randomUUID();
  await db.insert(profiles).values({ id, email, passwordHash: hashPassword("correct-horse") });
  return id;
}

beforeAll(async () => {
  client = new PGlite();
  for (const statement of initSql.split(";").map((part) => part.trim()).filter(Boolean)) await client.exec(statement);
  db = drizzle(client);
});

afterAll(async () => {
  await client.close();
});

describe("account security", () => {
  it("keeps init.sql and the bundled copy identical", () => {
    expect(initSql).toBe(readFileSync("src/db/init.sql", "utf8"));
  });

  it("rejects weak passwords and sloppy emails", () => {
    expect(passwordIssue("short")).toMatch(/8 karakter/);
    expect(passwordIssue("        ")).toMatch(/boş/);
    expect(passwordIssue("learner@example.com", "learner@example.com")).toMatch(/e-posta/);
    expect(passwordIssue("correct-horse")).toBeNull();
    expect(normalizeEmail("  Learner@Example.com ")).toBe("learner@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });

  it("stuffs SMTP dots and refuses header injection", () => {
    const data = smtpData({ from: "Outklas <info@outklas.com>", to: "a@b.co", subject: "Şifre", body: "line\n.dot\n" });
    expect(data).toContain("\r\n..dot\r\n");
    expect(data).toContain("Subject: =?UTF-8?B?");
    expect(() => smtpData({ from: "a@b.co", to: "a@b.co", subject: "bad\nBcc: x", body: "no" })).toThrow(/line break/);
  });

  it("signs the session cookie and still accepts the previous format", () => {
    process.env.AUTH_SECRET = "test-secret";
    const id = "11111111-1111-4111-8111-111111111111";
    expect(decodeSession(encodeSession(id, 4))).toEqual({ id, version: 4 });
    const legacy = createHmac("sha256", "test-secret").update(id).digest("hex");
    expect(decodeSession(`${id}.${legacy}`)).toEqual({ id, version: 0 });
    expect(decodeSession(`${id}.4.deadbeef`)).toBeNull();
  });

  it("resets a password from a single-use link and signs out older sessions", async () => {
    const id = await learner("learner@example.com");
    const sent = await sendPasswordReset(db, "Learner@Example.com", origin);
    expect(sent).toMatchObject({ ok: true });
    const mail = await db.select().from(authMail);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.deliveredAt).toBeNull();
    const token = new URL(mail[0]!.body.match(/https?:\/\/\S+/)![0]!).searchParams.get("token")!;
    expect(await resetPasswordWithToken(db, token, "short", "short")).toMatchObject({ error: expect.stringMatching(/8 karakter/) });
    const reset = await resetPasswordWithToken(db, token, "new-password-1", "new-password-1");
    expect(reset).toMatchObject({ profileId: id, sessionVersion: 1 });
    expect(await resetPasswordWithToken(db, token, "another-password", "another-password")).toMatchObject({ error: expect.stringMatching(/geçersiz/) });
    const profile = (await db.select().from(profiles).where(eq(profiles.id, id)))[0]!;
    expect(verifyPassword("correct-horse", profile.passwordHash)).toBe(false);
    expect(verifyPassword("new-password-1", profile.passwordHash)).toBe(true);
    expect(profile.emailVerifiedAt).toBeTruthy();
    expect(Number(profile.sessionVersion)).toBe(1);
  });

  it("does not reveal whether an email is registered", async () => {
    const before = await db.select({ id: authMail.id }).from(authMail);
    const hidden = await sendPasswordReset(db, "missing@example.com", origin);
    expect(hidden).toEqual({ ok: true });
    expect(await db.select({ id: authMail.id }).from(authMail)).toHaveLength(before.length);
  });

  it("verifies an email once and refuses an expired link", async () => {
    const id = await learner("verify@example.com");
    const sent = await sendEmailVerification(db, id, origin);
    expect("devLink" in sent).toBe(true);
    const token = new URL(sent.devLink!).searchParams.get("token")!;
    expect(await confirmEmailToken(db, token)).toMatchObject({ profileId: id, sessionVersion: 0 });
    expect(await confirmEmailToken(db, token)).toMatchObject({ error: expect.stringMatching(/geçersiz/) });
    expect(await sendEmailVerification(db, id, origin)).toMatchObject({ already: true });

    const expiredId = await learner("expired@example.com");
    const issued = await issueAuthChallenge(db, { id: expiredId, email: "expired@example.com" }, "verify_email");
    expect(issued.limited).toBe(false);
    if (issued.limited) return;
    await db.update(authChallenges).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(authChallenges.tokenHash, hashAuthToken(issued.token)));
    expect(await confirmEmailToken(db, issued.token)).toMatchObject({ error: expect.stringMatching(/geçersiz/) });
    const row = (await db.select().from(authChallenges).where(eq(authChallenges.profileId, expiredId)))[0]!;
    expect(row.usedAt).toBeNull();
  });

  it("limits how often a mailbox can request a link", async () => {
    const id = await learner("rate@example.com");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await issueAuthChallenge(db, { id, email: "rate@example.com" }, "reset_password")).limited).toBe(false);
    }
    expect((await issueAuthChallenge(db, { id, email: "rate@example.com" }, "reset_password")).limited).toBe(true);
  });

  it("changes the password only when the current one matches", async () => {
    const id = await learner("change@example.com");
    expect(await changeAccountPassword(db, id, "wrong-password", "new-password-2", "new-password-2")).toMatchObject({ error: expect.stringMatching(/Mevcut/) });
    expect(await changeAccountPassword(db, id, "correct-horse", "new-password-2", "other-password")).toMatchObject({ error: expect.stringMatching(/aynı değil/) });
    expect(await changeAccountPassword(db, id, "correct-horse", "new-password-2", "new-password-2")).toMatchObject({ sessionVersion: 1 });
  });

  it("hides challenge and mail tables from the public data api", async () => {
    const migrated = new PGlite();
    await migratePglite(migrated);
    const grants = await migrated.query<{ grantee: string }>(
      "select grantee from information_schema.role_table_grants where table_schema = 'public' and table_name in ('auth_challenges', 'auth_mail', 'auth_limits', 'items', 'choices', 'profiles', 'sessions', 'answers') and grantee in ('anon', 'authenticated', 'PUBLIC')",
    );
    expect(grants.rows).toEqual([]);
    await migrated.close();
  }, 60_000);
});
