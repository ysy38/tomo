import type { Metadata } from "next";
import Link from "next/link";
import { AuthScaffold } from "@/components/auth-scaffold";
import { ResetPasswordForm } from "@/components/account-forms";
import { safeNextPath } from "@/server/auth";

export const metadata: Metadata = {
  title: "Yeni şifre",
  description: "E-postadaki bağlantıyla outklas şifreni yenile.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; sonra?: string }> }) {
  const { token, sonra } = await searchParams;
  const next = safeNextPath(sonra);
  return (
    <AuthScaffold
      kicker="Yeni şifre"
      title="Yeni bir şifre seç."
      lede="Bağlantı 30 dakika geçerlidir ve bir kez kullanılır. Kaydettikten sonra diğer cihazlardaki oturumlar kapanır."
    >
      {token ? (
        <ResetPasswordForm token={token} next={next} />
      ) : (
        <p className="text-sm leading-6 text-muted">
          Bu sayfa e-postadaki bağlantıyla açılır.{" "}
          <Link href="/sifremi-unuttum" className="link-underline text-pine">
            Yeni bağlantı iste
          </Link>
        </p>
      )}
    </AuthScaffold>
  );
}
