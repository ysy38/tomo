import type { Metadata } from "next";
import Link from "next/link";
import { AuthScaffold } from "@/components/auth-scaffold";
import { ConfirmEmailForm, ResendVerificationForm } from "@/components/account-forms";
import { currentProfile, normalizeEmail, previewAuthLink, safeNextPath } from "@/server/auth";

export const metadata: Metadata = {
  title: "E-postanı doğrula",
  description: "outklas hesap doğrulama bağlantısını onayla veya yeniden iste.",
  robots: { index: false, follow: false },
};

function signInHref(next: string) {
  return `/giris?sonra=${encodeURIComponent(next)}`;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; durum?: string; sonra?: string; posta?: string }>;
}) {
  const { token, durum, sonra, posta } = await searchParams;
  const next = safeNextPath(sonra);
  const email = normalizeEmail(posta ?? "") ?? undefined;
  const profile = token ? null : await currentProfile();
  const preview = !token && durum === "gonderildi" ? await previewAuthLink("verify_email") : null;
  const signedIn = Boolean(profile);

  if (durum === "onaylandi") {
    return (
      <AuthScaffold
        kicker="Hesap doğrulama"
        title="E-postan doğrulandı."
        lede={signedIn ? "Oturumun açık. Seviye testin ve günlük çalışman bu hesapta seni bekliyor." : "Hesabın hazır. Bu cihazda devam etmek için giriş yap; kaldığın yer korunur."}
      >
        <div className="space-y-4 text-sm leading-6">
          <p className="text-muted">Başka bir sekmede veya telefonda açtıysan, orada da giriş yapman yeterli. Çalışman e-postana bağlıdır, bu cihaza değil.</p>
          <Link href={signedIn ? next : signInHref(next)} className="inline-block rounded-full bg-pine px-4 py-3 text-cream">
            {signedIn ? "Çalışmaya başla" : "Şimdi giriş yap"}
          </Link>
        </div>
      </AuthScaffold>
    );
  }

  if (durum === "sinir") {
    return (
      <AuthScaffold
        kicker="Hesap doğrulama"
        title="Biraz bekle, sonra yeniden aç."
        lede="Çok kısa sürede çok fazla bağlantı açıldı. Bir dakika sonra e-postadaki bağlantıyı yeniden dene. Hesabın duruyor."
      >
        <Link href={signInHref(next)} className="inline-block rounded-full bg-pine px-4 py-3 text-sm text-cream">
          Giriş yap
        </Link>
      </AuthScaffold>
    );
  }

  if (durum === "hata") {
    return (
      <AuthScaffold
        kicker="Hesap doğrulama"
        title="Bağlantı artık geçersiz."
        lede="Süresi dolmuş ya da daha önce kullanılmış olabilir. Yeni bir bağlantı iste, sonra gelen kutuna bak."
      >
        <ResendVerificationForm
          email={email ?? profile?.email}
          next={next}
          continueHref={signedIn ? next : signInHref(next)}
          continueLabel={signedIn ? "Çalışmaya devam et" : "Giriş yap"}
        />
      </AuthScaffold>
    );
  }

  if (token) {
    return (
      <AuthScaffold
        kicker="Hesap doğrulama"
        title="E-postanı doğrula."
        lede="Bağlantı sana aitse doğrulamayı onayla. Onaydan sonra oturumun açılır ve çalışmana dönersin."
      >
        <ConfirmEmailForm token={token} next={next} />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      kicker="Hesap doğrulama"
      title={durum === "gonderildi" ? "Postanı kontrol et." : "Doğrulama bağlantısı."}
      lede={
        durum === "gonderildi"
          ? "Hesabın açıldı. Doğrulama postası birkaç dakika içinde gelir. Postadaki bağlantı seni geri getirir; oturumun açılır ve çalışman durduğu yerden devam eder."
          : "Doğrulama, şifre yenileme postasının sana ulaştığını gösterir."
      }
    >
      {durum === "gonderildi" ? (
        <ol className="mb-6 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted">
          <li>{email ? `${email} gelen kutusunu aç. İstenmeyen klasöre de bak.` : "Gelen kutunu aç. İstenmeyen klasöre de bak."}</li>
          <li>outklas’tan gelen doğrulama bağlantısına tıkla.</li>
          <li>Açılan sayfada “E-postan doğrulandı” yazısını görürsün. Oradan çalışmaya geçersin.</li>
        </ol>
      ) : null}
      <ResendVerificationForm
        email={email ?? profile?.email}
        sent={durum === "gonderildi"}
        next={next}
        preview={preview}
        continueHref={signedIn ? next : signInHref(next)}
        continueLabel={signedIn ? "Çalışmaya devam et" : "Bağlantıya tıkladım, giriş yapayım"}
      />
    </AuthScaffold>
  );
}
