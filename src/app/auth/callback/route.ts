import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { claimGuest, currentProfile, markSignedIn, safeNextPath, supabaseEnabled } from "@/server/auth";
import { createSupabaseServer } from "@/server/supabase";

const otpTypes = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/** Supabase sends the learner here after they open the confirmation or reset link. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const fail = `/dogrula?durum=hata&sonra=${encodeURIComponent(next)}`;
  if (!(await supabaseEnabled())) redirect(fail);

  const supabase = await createSupabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) redirect(fail);
  } else if (tokenHash && type && otpTypes.has(type as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (error) redirect(fail);
  } else {
    redirect(fail);
  }

  await markSignedIn();
  const profile = await currentProfile();
  if (profile) await claimGuest(profile.id);

  if (next === "/sifre-sifirla" || type === "recovery") redirect("/sifre-sifirla?durum=hazir");
  redirect(`/dogrula?durum=onaylandi&sonra=${encodeURIComponent(next)}`);
}
