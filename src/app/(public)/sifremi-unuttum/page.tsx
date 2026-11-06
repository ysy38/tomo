import type { Metadata } from "next";
import { AuthScaffold } from "@/components/auth-scaffold";
import { ForgotPasswordForm } from "@/components/account-forms";

export const metadata: Metadata = {
  title: "Şifremi unuttum",
  description: "outklas şifreni yenilemek için e-posta adresine tek kullanımlık bir bağlantı gönder.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthScaffold
      kicker="Şifre yenileme"
      title="Şifreni yenile."
      lede="E-posta adresini yaz. Hesabın varsa, tek kullanımlık bir bağlantı göndeririz. Adres kayıtlı değilse de aynı yanıtı görürsün."
    >
      <ForgotPasswordForm />
    </AuthScaffold>
  );
}
