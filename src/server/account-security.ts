import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { authChallenges, authMail, profiles } from "@/db/schema";
import { deliverMail } from "./mail";
import { hashPassword, passwordIssue, verifyPassword } from "./password";

type Db = PgliteDatabase<any>;
type TokenResult = { error: string } | { profileId: string; sessionVersion: number };
export type AuthPurpose = "verify_email" | "reset_password";

const hourMs = 60 * 60 * 1000;
const ttlMs: Record<AuthPurpose, number> = {
  verify_email: 24 * hourMs,
  reset_password: 30 * 60 * 1000,
};
const hourlyLimit = 5;

const invalidLink = "Bu bağlantı geçersiz ya da süresi dolmuş.";

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function hashAuthToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function linkFromBody(body: string): string | null {
  return body.match(/https?:\/\/[^\s]+/)?.[0] ?? null;
}

export function verificationMessage(origin: string, token: string) {
  const url = `${origin}/dogrula?token=${encodeURIComponent(token)}`;
  return {
    subject: "Hesabını doğrula",
    url,
    body: `Merhaba,\n\noutklas hesabını doğrulamak için bağlantıyı aç:\n${url}\n\nBağlantı 24 saat geçerlidir ve bir kez kullanılır. Sayfa açılınca doğrulamayı sen onaylarsın; bağlantıya sadece tıklanması hesabı doğrulamaz.\n\nBu isteği sen yapmadıysan bu postayı yok sayabilirsin.\n`,
  };
}

export function resetMessage(origin: string, token: string) {
  const url = `${origin}/sifre-sifirla?token=${encodeURIComponent(token)}`;
  return {
    subject: "Şifreni yenile",
    url,
    body: `Merhaba,\n\noutklas şifreni yenilemek için bağlantıyı aç:\n${url}\n\nBağlantı 30 dakika geçerlidir ve bir kez kullanılır. Yeni şifreyi sayfadaki forma sen yazarsın.\n\nBu isteği sen yapmadıysan bu postayı yok sayabilirsin. Şifren değişmez.\n`,
  };
}

async function pruneAuthRows(db: Db) {
  const weekAgo = new Date(Date.now() - 7 * 24 * hourMs);
  const monthAgo = new Date(Date.now() - 30 * 24 * hourMs);
  await db.delete(authChallenges).where(lt(authChallenges.expiresAt, weekAgo));
  await db.delete(authMail).where(lt(authMail.createdAt, monthAgo));
}

export async function issueAuthChallenge(db: Db, profile: { id: string; email: string }, purpose: AuthPurpose) {
  await pruneAuthRows(db);
  const since = new Date(Date.now() - hourMs);
  const recent = await db
    .select({ id: authChallenges.id })
    .from(authChallenges)
    .where(and(eq(authChallenges.email, profile.email), eq(authChallenges.purpose, purpose), gte(authChallenges.createdAt, since)));
  if (recent.length >= hourlyLimit) return { limited: true as const };
  await db
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(and(eq(authChallenges.profileId, profile.id), eq(authChallenges.purpose, purpose), isNull(authChallenges.usedAt)));
  const token = randomBytes(32).toString("base64url");
  await db.insert(authChallenges).values({
    id: randomUUID(),
    profileId: profile.id,
    email: profile.email,
    purpose,
    tokenHash: hashAuthToken(token),
    expiresAt: new Date(Date.now() + ttlMs[purpose]),
  });
  return { limited: false as const, token };
}

async function sendChallenge(db: Db, profile: { id: string; email: string }, purpose: AuthPurpose, origin: string) {
  const issued = await issueAuthChallenge(db, profile, purpose);
  if (issued.limited) return { limited: true as const };
  const message = purpose === "verify_email" ? verificationMessage(origin, issued.token) : resetMessage(origin, issued.token);
  const delivery = await deliverMail(db, { to: profile.email, purpose, subject: message.subject, body: message.body });
  return { limited: false as const, url: message.url, delivery };
}

/** Same result whether or not the address exists, so the form cannot be used to look up accounts. */
export async function sendPasswordReset(db: Db, emailRaw: string, origin: string) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { error: "Geçerli bir e-posta gir." as const };
  const rows = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
  const profile = rows[0];
  if (!profile?.passwordHash) return { ok: true as const };
  const sent = await sendChallenge(db, profile, "reset_password", origin);
  if (sent.limited) return { ok: true as const };
  return { ok: true as const, devLink: sent.url, delivered: sent.delivery.delivered };
}

export async function sendEmailVerification(db: Db, profileId: string, origin: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  const profile = rows[0];
  if (!profile?.passwordHash) return { error: "Bu hesap e-posta doğrulamasını kendi sağlayıcısından yapıyor." as const };
  if (profile.emailVerifiedAt) return { ok: true as const, already: true as const };
  const sent = await sendChallenge(db, profile, "verify_email", origin);
  if (sent.limited) return { error: "Çok sık denedin. Bir saat sonra yeniden isteyebilirsin." as const };
  return { ok: true as const, devLink: sent.url, delivered: sent.delivery.delivered };
}

export async function sendEmailVerificationToAddress(db: Db, emailRaw: string, origin: string) {
  const email = normalizeEmail(emailRaw);
  if (!email) return { error: "Geçerli bir e-posta gir." as const };
  const rows = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
  const profile = rows[0];
  if (!profile?.passwordHash || profile.emailVerifiedAt) return { ok: true as const };
  const sent = await sendChallenge(db, profile, "verify_email", origin);
  if (sent.limited) return { ok: true as const };
  return { ok: true as const, devLink: sent.url, delivered: sent.delivery.delivered };
}

export async function latestAuthLink(db: Db, email: string, purpose: AuthPurpose) {
  const rows = await db
    .select({ body: authMail.body })
    .from(authMail)
    .where(and(eq(authMail.toEmail, email), eq(authMail.purpose, purpose)))
    .orderBy(desc(authMail.createdAt))
    .limit(1);
  return rows[0] ? linkFromBody(rows[0].body) : null;
}

async function consumeChallenge(db: Db, token: string, purpose: AuthPurpose) {
  if (!token || token.length < 20 || token.length > 200) return null;
  const consumed = await db
    .update(authChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authChallenges.tokenHash, hashAuthToken(token)),
        eq(authChallenges.purpose, purpose),
        isNull(authChallenges.usedAt),
        gte(authChallenges.expiresAt, new Date()),
      ),
    )
    .returning({ profileId: authChallenges.profileId, email: authChallenges.email });
  return consumed[0] ?? null;
}

export async function confirmEmailToken(db: Db, token: string): Promise<TokenResult> {
  return db.transaction(async (tx) => {
    const challenge = await consumeChallenge(tx as Db, token, "verify_email");
    if (!challenge) return { error: invalidLink };
    const updated = await tx
      .update(profiles)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(profiles.id, challenge.profileId))
      .returning({ id: profiles.id, sessionVersion: profiles.sessionVersion });
    const profile = updated[0];
    if (!profile) return { error: invalidLink };
    return { profileId: profile.id, sessionVersion: Number(profile.sessionVersion) };
  });
}

export async function resetPasswordWithToken(db: Db, token: string, password: string, confirm: string): Promise<TokenResult> {
  if (password !== confirm) return { error: "Şifreler aynı değil." };
  const issue = passwordIssue(password);
  if (issue) return { error: issue };
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ email: authChallenges.email })
      .from(authChallenges)
      .where(and(eq(authChallenges.tokenHash, hashAuthToken(token || "missing")), eq(authChallenges.purpose, "reset_password"), isNull(authChallenges.usedAt), gte(authChallenges.expiresAt, new Date())))
      .limit(1);
    const emailIssue = found[0] ? passwordIssue(password, found[0].email) : null;
    if (emailIssue) return { error: emailIssue };
    const challenge = await consumeChallenge(tx as Db, token, "reset_password");
    if (!challenge) return { error: invalidLink };
    const updated = await tx
      .update(profiles)
      .set({
        passwordHash: hashPassword(password),
        sessionVersion: sql`${profiles.sessionVersion} + 1`,
        emailVerifiedAt: new Date(),
      })
      .where(eq(profiles.id, challenge.profileId))
      .returning({ id: profiles.id, sessionVersion: profiles.sessionVersion });
    const profile = updated[0];
    if (!profile) return { error: invalidLink };
    return { profileId: profile.id, sessionVersion: Number(profile.sessionVersion) };
  });
}

export async function changeAccountPassword(db: Db, profileId: string, current: string, next: string, confirm: string) {
  if (next !== confirm) return { error: "Şifreler aynı değil." as const };
  const rows = await db.select().from(profiles).where(eq(profiles.id, profileId)).limit(1);
  const profile = rows[0];
  if (!profile?.passwordHash) return { error: "Bu hesapta şifre, giriş sağlayıcısından değiştirilir." as const };
  if (!verifyPassword(current, profile.passwordHash)) return { error: "Mevcut şifre yanlış." as const };
  const issue = passwordIssue(next, profile.email);
  if (issue) return { error: issue };
  if (verifyPassword(next, profile.passwordHash)) return { error: "Yeni şifre eskisinden farklı olmalı." as const };
  const updated = await db
    .update(profiles)
    .set({ passwordHash: hashPassword(next), sessionVersion: sql`${profiles.sessionVersion} + 1` })
    .where(eq(profiles.id, profileId))
    .returning({ sessionVersion: profiles.sessionVersion });
  const row = updated[0];
  if (!row) return { error: "Hesap bulunamadı." as const };
  return { sessionVersion: row.sessionVersion };
}
