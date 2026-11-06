import type { Metadata } from "next";
import { AuthScaffold } from "@/components/auth-scaffold";
import { ConfirmEmailForm, ResendVerificationForm } from "@/components/account-forms";
import { currentProfile, previewAuthLink, safeNextPath } from "@/server/auth";

export const metadata: Metadata = {
  title: "E-postanı doğrula",
  description: "outklas hesap doğrulama bağlantısını onayla veya yeniden iste.",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string; durum?: string; sonra?: string }> }) {
  const { token, durum, sonra } = await searchParams;
  const next = safeNextPath(sonra);
  const profile = token ? null : await currentProfile();
  const preview = !token && durum === "gonderildi" ? await previewAuthLink("verify_email") : null;
  return (
    <AuthScaffold
      kicker="Hesap doğrulama"
      title={token ? "E-postanı doğrula." : "Doğrulama bağlantısı."}
      lede="Doğrulama, şifre yenileme postasının sana ulaştığını gösterir. Çalışman hesabında durur; doğrulama onu kilitli tutmaz."
    >
      {token ? (
        <ConfirmEmailForm token={token} next={next} />
      ) : (
        <ResendVerificationForm email={profile?.email} sent={durum === "gonderildi"} next={next} preview={preview} />
      )}
    </AuthScaffold>
  );
}
