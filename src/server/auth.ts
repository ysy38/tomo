import { createHash, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, profiles, sessions, answers } from "@/db/client";
import {
  changeAccountPassword,
  confirmEmailToken,
  latestAuthLink,
  normalizeEmail,
  resetPasswordWithToken,
  sendEmailVerification,
  sendEmailVerificationToAddress,
  sendPasswordReset,
  type AuthPurpose,
} from "./account-security";
import { publicAuthError } from "./auth-errors";
import { passwordIssue, verifyPassword, hashPassword } from "./password";
import { allowAuth, limitedMessage } from "./rate-limit";
import { decodeSession, encodeSession } from "./session-cookie";

export { normalizeEmail };

const sessionCookie = "tomo_session";
const guestCookie = "tomo_guest";
const hintCookie = "tomo_in";
const month = 60 * 60 * 24 * 30;

function cookieBase(maxAge: number, httpOnly: boolean) {
  return {
    httpOnly,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
    secure: process.env.NODE_ENV === "production",
  };
}

function hasSupabaseSession(jar: { getAll(): { name: string }[] }) {
  return jar.getAll().some((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"));
}

export async function supabaseEnabled(): Promise<boolean> {
  const { supabaseKey, supabaseUrl } = await import("./supabase");
  return Boolean(supabaseUrl() && supabaseKey());
}

const remoteUsers = new Map<string, { at: number; user: { id: string; email: string } | null }>();

async function supabaseUser(jar: { getAll(): { name: string; value: string }[] }): Promise<{ id: string; email: string } | null> {
  if (!hasSupabaseSession(jar) || !(await supabaseEnabled())) return null;
  const key = createHash("sha256")
    .update(
      jar
        .getAll()
        .filter((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"))
        .map((cookie) => cookie.value)
        .join("."),
    )
    .digest("hex");
  const hit = remoteUsers.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.user;
  const { createSupabaseServer } = await import("./supabase");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data.user ? { id: data.user.id, email: data.user.email ?? "" } : null;
  remoteUsers.set(key, { at: Date.now(), user });
  return user;
}

export async function markSignedIn() {
  const jar = await cookies();
  if (jar.get(hintCookie)?.value === "1") return;
  jar.set(hintCookie, "1", cookieBase(month, false));
}

async function setSession(id: string, version: number) {
  const jar = await cookies();
  jar.set(sessionCookie, encodeSession(id, version), cookieBase(month, true));
  await markSignedIn();
}

export function safeNextPath(value: string | undefined | null, fallback = "/bugun") {
  return value && /^\/(?![/\\])/.test(value) ? value : fallback;
}

/** Origin of the request the learner is actually using, so mail links stay on this host. */
export async function requestOrigin() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]?.trim() ?? "";
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return "http://localhost:3000";
  const forwarded = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwarded === "http" || forwarded === "https" ? forwarded : host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
  return `${proto}://${host}`;
}

function devAuthLink(url?: string) {
  if (process.env.NODE_ENV === "production") return undefined;
  return url;
}

export async function readGuestId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(guestCookie)?.value ?? null;
}

export async function getGuestId(): Promise<string> {
  const existing = await readGuestId();
  if (existing) return existing;
  const id = randomUUID();
  const jar = await cookies();
  jar.set(guestCookie, id, cookieBase(month, true));
  return id;
}

export async function currentProfile() {
  const jar = await cookies();
  const remote = await supabaseUser(jar);
  if (!remote) {
    const parsed = decodeSession(jar.get(sessionCookie)?.value);
    if (!parsed) return null;
    const db = await getDb();
    const rows = await db.select().from(profiles).where(eq(profiles.id, parsed.id)).limit(1);
    const profile = rows[0];
    if (!profile || Number(profile.sessionVersion) !== parsed.version) return null;
    return profile;
  }
  const db = await getDb();
  const found = await db.select().from(profiles).where(eq(profiles.id, remote.id)).limit(1);
  if (found[0]) return found[0];
  const created = {
    id: remote.id,
    email: remote.email || `${remote.id}@supabase.local`,
    passwordHash: null,
    role: adminEmails().includes(remote.email) ? "admin" : "learner",
    onboardingCompleted: false,
  };
  await db.insert(profiles).values(created);
  return (await db.select().from(profiles).where(eq(profiles.id, remote.id)).limit(1))[0] ?? null;
}

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "admin@ydslab.local")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export async function registerAccount(
  email: string,
  password: string,
  confirm: string,
  next = "/bugun",
): Promise<{ error?: string; channel?: "internal" | "supabase"; pending?: boolean }> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: "Geçerli bir e-posta gir." };
  if (password !== confirm) return { error: "Şifreler aynı değil." };
  const issue = passwordIssue(password, normalized);
  if (issue) return { error: issue };
  if (!(await allowAuth("signup", normalized))) return { error: limitedMessage };
  if (await supabaseEnabled()) {
    const { createSupabaseServer } = await import("./supabase");
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.signUp({
      email: normalized,
      password,
      options: { emailRedirectTo: `${await requestOrigin()}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}` },
    });
    if (error) return { error: publicAuthError(error.message) };
    if (data.session) await markSignedIn();
    return { channel: "supabase", pending: !data.session };
  }
  const db = await getDb();
  const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, normalized)).limit(1);
  if (existing[0]) return { error: "Bu e-postayla açılmış bir hesap var. Giriş yap sekmesinden devam edebilirsin." };
  const id = randomUUID();
  await db.insert(profiles).values({
    id,
    email: normalized,
    passwordHash: hashPassword(password),
    role: adminEmails().includes(normalized) ? "admin" : "learner",
  });
  await setSession(id, 0);
  return { channel: "internal" };
}

export async function loginAccount(email: string, password: string): Promise<{ error?: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: "Geçerli bir e-posta gir." };
  if (!(await allowAuth("login", normalized))) return { error: limitedMessage };
  if (await supabaseEnabled()) {
    const { createSupabaseServer } = await import("./supabase");
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
    if (error) return { error: publicAuthError(error.message) };
    await markSignedIn();
    return {};
  }
  const db = await getDb();
  const rows = await db.select().from(profiles).where(eq(profiles.email, normalized)).limit(1);
  const profile = rows[0];
  if (!profile || !verifyPassword(password, profile.passwordHash)) return { error: "E-posta ya da şifre yanlış. Tekrar dener misin?" };
  await setSession(profile.id, profile.sessionVersion);
  return {};
}

export async function logoutAccount() {
  const jar = await cookies();
  if (hasSupabaseSession(jar) && (await supabaseEnabled())) {
    const { createSupabaseServer } = await import("./supabase");
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  jar.delete(sessionCookie);
  jar.delete(hintCookie);
}

export async function requestPasswordReset(email: string) {
  const origin = await requestOrigin();
  const normalized = normalizeEmail(email);
  if (!normalized) return { error: "Geçerli bir e-posta gir." };
  if (!(await allowAuth("reset", normalized))) return { error: limitedMessage };
  if (await supabaseEnabled()) {
    try {
      const { createSupabaseServer } = await import("./supabase");
      const supabase = await createSupabaseServer();
      await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/sifre-sifirla")}` });
    } catch {
      // The response stays the same when the address is unknown.
    }
    return { ok: true as const };
  }
  const result = await sendPasswordReset(await getDb(), email, origin);
  if ("error" in result && result.error) return { error: result.error };
  return { ok: true as const, devLink: devAuthLink("devLink" in result ? result.devLink : undefined) };
}

export async function requestEmailVerification(email?: string) {
  const origin = await requestOrigin();
  const profile = await currentProfile();
  if (profile && !email) {
    if (!(await allowAuth("resend", profile.email))) return { error: limitedMessage };
    if (!profile.passwordHash && (await supabaseEnabled())) {
      try {
        const { createSupabaseServer } = await import("./supabase");
        const supabase = await createSupabaseServer();
        const { error } = await supabase.auth.resend({
          type: "signup",
          email: profile.email,
          options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/bugun")}` },
        });
        if (error) return { error: "Doğrulama postası şu an gönderilemedi. Biraz sonra tekrar dene." };
      } catch {
        return { error: "Doğrulama postası şu an gönderilemedi. Biraz sonra tekrar dene." };
      }
      return { ok: true as const };
    }
    const result = await sendEmailVerification(await getDb(), profile.id, origin);
    if ("error" in result && result.error) return { error: result.error };
    return { ok: true as const, already: "already" in result ? result.already : undefined, devLink: devAuthLink("devLink" in result ? result.devLink : undefined) };
  }
  if (await supabaseEnabled()) {
    const normalized = normalizeEmail(email ?? "");
    if (!normalized) return { error: "Geçerli bir e-posta gir." };
    if (!(await allowAuth("resend", normalized))) return { error: limitedMessage };
    try {
      const { createSupabaseServer } = await import("./supabase");
      const supabase = await createSupabaseServer();
      await supabase.auth.resend({
        type: "signup",
        email: normalized,
        options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent("/bugun")}` },
      });
    } catch {
      // Same response whether or not the address can receive mail.
    }
    return { ok: true as const };
  }
  const normalized = normalizeEmail(email ?? "");
  if (!normalized) return { error: "Geçerli bir e-posta gir." };
  if (!(await allowAuth("resend", normalized))) return { error: limitedMessage };
  const result = await sendEmailVerificationToAddress(await getDb(), normalized, origin);
  if ("error" in result && result.error) return { error: result.error };
  return { ok: true as const, devLink: devAuthLink("devLink" in result ? result.devLink : undefined) };
}

export async function confirmEmail(token: string): Promise<{ error: string } | { ok: true }> {
  const result = await confirmEmailToken(await getDb(), token);
  if ("error" in result) return { error: result.error };
  await setSession(result.profileId, Number(result.sessionVersion));
  return { ok: true };
}

export async function resetPassword(token: string, password: string, confirm: string): Promise<{ error: string } | { ok: true }> {
  const result = await resetPasswordWithToken(await getDb(), token, password, confirm);
  if ("error" in result) return { error: result.error };
  await setSession(result.profileId, Number(result.sessionVersion));
  return { ok: true };
}

export async function updatePassword(current: string, next: string, confirm: string) {
  const profile = await currentProfile();
  if (!profile) return { error: "Devam etmek için giriş yap." };
  if (!profile.passwordHash && (await supabaseEnabled())) {
    if (next !== confirm) return { error: "Şifreler aynı değil." };
    const issue = passwordIssue(next, profile.email);
    if (issue) return { error: issue };
    if (!(await allowAuth("password", profile.email))) return { error: limitedMessage };
    const { createSupabaseServer } = await import("./supabase");
    const supabase = await createSupabaseServer();
    const signed = await supabase.auth.signInWithPassword({ email: profile.email, password: current });
    if (signed.error) return { error: "Mevcut şifre yanlış." };
    const updated = await supabase.auth.updateUser({ password: next });
    if (updated.error) return { error: publicAuthError(updated.error.message) };
    return { ok: true as const };
  }
  const result = await changeAccountPassword(await getDb(), profile.id, current, next, confirm);
  if ("error" in result) return result;
  await setSession(profile.id, Number(result.sessionVersion));
  return { ok: true as const };
}

/** Sets a new password from the Supabase recovery session opened by the email link. */
export async function completeRecovery(password: string, confirm: string) {
  if (password !== confirm) return { error: "Şifreler aynı değil." };
  const issue = passwordIssue(password);
  if (issue) return { error: issue };
  if (!(await supabaseEnabled())) return { error: "Bu sayfa e-postadaki bağlantıyla açılır." };
  if (!(await allowAuth("password"))) return { error: limitedMessage };
  const { createSupabaseServer } = await import("./supabase");
  const supabase = await createSupabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) return { error: "Bu sayfa e-postadaki bağlantıyla açılır. Bağlantının süresi dolmuş olabilir." };
  const emailIssue = passwordIssue(password, data.user.email);
  if (emailIssue) return { error: emailIssue };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: publicAuthError(error.message) };
  await markSignedIn();
  return { ok: true as const };
}

/** Development only. Production never reads the mail queue back into a page. */
export async function previewAuthLink(purpose: AuthPurpose) {
  if (process.env.NODE_ENV === "production") return null;
  const profile = await currentProfile();
  if (!profile) return null;
  return latestAuthLink(await getDb(), profile.email, purpose);
}

export async function claimGuest(profileId: string) {
  const guestId = await getGuestId();
  const db = await getDb();
  const pending = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.guestId, guestId), isNull(sessions.profileId)));
  if (pending.length === 0) return;
  const ids = pending.map((row) => row.id);
  await db.update(sessions).set({ profileId }).where(inArray(sessions.id, ids));
  await db.update(answers).set({ profileId }).where(inArray(answers.sessionId, ids));
}
