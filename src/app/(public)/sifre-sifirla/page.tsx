import type { Metadata } from "next";
import Link from "next/link";
import { AuthScaffold } from "@/components/auth-scaffold";
import { RecoveryPasswordForm, ResetPasswordForm } from "@/components/account-forms";
import { currentProfile, safeNextPath } from "@/server/auth";

export const metadata: Metadata = {
  title: "Yeni şifre",
  description: "E-postadaki bağlantıyla outklas şifreni yenile.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; sonra?: string; durum?: string }> }) {
  const { token, sonra, durum } = await searchParams;
  const next = safeNextPath(sonra);
  const profile = await currentProfile();

  if (durum === "guncellendi") {
    return (
      <AuthScaffold kicker="Yeni şifre" title="Şifren güncellendi." lede="Bu cihazdaki oturumun açık. Kaldığın yerden devam edebilirsin. Başka bir cihazda eski şifre artık çalışmaz; orada yeni şifreyle giriş yap.">
        <Link href={next} className="inline-block rounded-full bg-pine px-4 py-3 text-sm text-cream">
          Çalışmaya dön
        </Link>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      kicker="Yeni şifre"
      title="Yeni bir şifre seç."
      lede="Bağlantı kısa süre geçerlidir ve bir kez kullanılır. Kaydettikten sonra bu cihazda çalışmaya devam edersin."
    >
      {token ? (
        <ResetPasswordForm token={token} next={next} />
      ) : profile && durum === "hazir" ? (
        <RecoveryPasswordForm next={next} />
      ) : (
        <div className="space-y-3 text-sm leading-6 text-muted">
          <p>Bu sayfa e-postadaki bağlantıyla açılır. Bağlantı yoksa yeni bir tane iste, sonra gelen kutuna bak.</p>
          <p>
            <Link href="/sifremi-unuttum" className="link-underline text-pine">
              Yeni bağlantı iste
            </Link>
          </p>
          <p>
            <Link href="/giris" className="link-underline text-pine">
              Şifreni hatırladın mı? Giriş yap
            </Link>
          </p>
        </div>
      )}
    </AuthScaffold>
  );
}