import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { clientAddress } from "./client-address";

function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
}

function supabaseKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ""
  );
}

const freshForMs = 60_000;

function decodeCookie(raw: string) {
  if (!raw.startsWith("base64-")) return raw;
  const b64 = raw.slice("base64-".length).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return atob(b64 + pad);
}

/** A readable token is refreshed only inside the last minute. Unreadable cookies never call Supabase. */
export function shouldRefreshSupabase(expiry: number | null, now = Date.now()): boolean {
  if (expiry === null || expiry <= 0) return false;
  return expiry * 1000 <= now + freshForMs;
}

const refreshHits = new Map<string, number[]>();

function allowRefresh(ip: string) {
  const now = Date.now();
  const recent = (refreshHits.get(ip) ?? []).filter((at) => now - at < 60_000);
  if (recent.length >= 20) {
    refreshHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  refreshHits.set(ip, recent);
  if (refreshHits.size > 5_000) refreshHits.clear();
  return true;
}

/** Unix seconds when the stored Supabase access token expires, or null when there is no session cookie. */
export function sessionExpiryFromChunks(chunks: string[]): number | null {
  if (chunks.length === 0) return null;
  try {
    const parsed = JSON.parse(decodeCookie(chunks.join(""))) as { expires_at?: unknown };
    return typeof parsed.expires_at === "number" ? parsed.expires_at : 0;
  } catch {
    return 0;
  }
}

function expiryFromRequest(request: NextRequest) {
  const chunks = request.cookies
    .getAll()
    .filter((cookie) => cookie.name.includes("-auth-token"))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map((cookie) => cookie.value);
  return sessionExpiryFromChunks(chunks);
}

function hardened(options: { httpOnly?: boolean; sameSite?: "lax" | "strict" | "none" | boolean; secure?: boolean; path?: string; maxAge?: number; expires?: Date } | undefined) {
  return {
    ...options,
    httpOnly: options?.httpOnly ?? true,
    sameSite: options?.sameSite ?? "lax",
    secure: process.env.NODE_ENV === "production",
    path: options?.path ?? "/",
  };
}

/**
 * Refreshes the Supabase session only when a readable access token is about to expire.
 * A missing or unreadable cookie is left alone, so it cannot be used to call Supabase Auth.
 */
export async function refreshSupabaseSession(request: NextRequest) {
  if (!supabaseUrl() || !supabaseKey()) return NextResponse.next();
  const expiry = expiryFromRequest(request);
  if (!shouldRefreshSupabase(expiry)) {
    if (expiry && expiry > 0) {
      const response = NextResponse.next();
      response.cookies.set("tomo_in", "1", { httpOnly: false, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
      return response;
    }
    return NextResponse.next();
  }
  const ip = clientAddress((name) => request.headers.get(name));
  if (!allowRefresh(ip)) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabaseKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const cookie of list) request.cookies.set(cookie.name, cookie.value);
        response = NextResponse.next({ request });
        for (const cookie of list) response.cookies.set(cookie.name, cookie.value, hardened(cookie.options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const hint = { httpOnly: false, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };
  if (data.user) response.cookies.set("tomo_in", "1", { ...hint, maxAge: 60 * 60 * 24 * 30 });
  else response.cookies.set("tomo_in", "", { ...hint, maxAge: 0 });
  return response;
}
