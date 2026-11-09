"use client";

import { useState } from "react";
import Link from "next/link";
import { PendingButton } from "@/components/pending-button";
import { changePasswordAction, completeRecoveryAction, confirmEmailAction, forgotPasswordAction, resendVerificationAction, resetPasswordAction } from "@/server/actions";

const field = "mt-1.5 w-full rounded-2xl border border-line bg-paper px-4 py-3 outline-none focus:border-pine";

function Notice({ error, message }: { error: string | null; message: string | null }) {
  if (error) return <p role="alert" className="text-sm text-clay">{error}</p>;
  if (message) return <p role="status" className="text-sm text-pine">{message}</p>;
  return null;
}

export function ForgotPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [email, setEmail] = useState("");

  async function submit(formData: FormData) {
    setError(null);
    setDone(null);
    const result = await forgotPasswordAction(formData);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    setDone("Bu adres için bir hesap varsa, şifre yenileme bağlantısını gönderdik. Postadaki bağlantı yeni şifreni yazacağın sayfayı açar. Kaydedince çalışmana dönersin.");
    setDevLink(result && "devLink" in result ? result.devLink ?? null : null);
  }

  return (
    <form action={submit} className="space-y-4">
      <label className="block text-sm">
        E-posta
        <input name="email" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="sen@posta.com" className={field} />
      </label>
      <Notice error={error} message={done} />
      {devLink ? (
        <p className="text-sm">
          <a href={devLink} className="link-underline text-pine">
            Geliştirme bağlantısı
          </a>
        </p>
      ) : null}
      <PendingButton pendingLabel="Gönderiliyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream">
        Bağlantı gönder
      </PendingButton>
      <p className="text-sm text-muted">
        Şifreni hatırladın mı?{" "}
        <Link href="/giris" className="link-underline text-pine">
          Giriş yap
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token, next }: { token: string; next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    const result = await resetPasswordAction(formData);
    if (result && "error" in result) setError(result.error);
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />
      <label className="block text-sm">
        Yeni şifre
        <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="En az 8 karakter" className={field} />
      </label>
      <label className="block text-sm">
        Yeni şifre, tekrar
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={field} />
      </label>
      <Notice error={error} message={null} />
      <PendingButton pendingLabel="Kaydediliyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream">
        Şifreyi kaydet
      </PendingButton>
    </form>
  );
}

export function RecoveryPasswordForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    const result = await completeRecoveryAction(formData);
    if (result && "error" in result && result.error) setError(result.error);
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <p className="text-sm leading-6 text-muted">E-postadaki bağlantı bu cihazdaki oturumu açtı. Yeni şifreni kaydet; çalışman hesabında durur.</p>
      <label className="block text-sm">
        Yeni şifre
        <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="En az 8 karakter" className={field} />
      </label>
      <label className="block text-sm">
        Yeni şifre, tekrar
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className={field} />
      </label>
      <Notice error={error} message={null} />
      <PendingButton pendingLabel="Kaydediliyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream">
        Şifreyi kaydet
      </PendingButton>
    </form>
  );
}

export function ConfirmEmailForm({ token, next }: { token: string; next: string }) {
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    const result = await confirmEmailAction(formData);
    if (result && "error" in result) setError(result.error);
  }

  return (
    <form action={submit} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />
      <p className="text-sm leading-6 text-muted">Bağlantı sana aitse doğrulamayı onayla. Posta güvenlik tarayıcıları bağlantıyı kendiliğinden açabildiği için doğrulama bir düğmeyle tamamlanır.</p>
      <Notice error={error} message={null} />
      <PendingButton pendingLabel="Doğrulanıyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream">
        E-postamı doğrula
      </PendingButton>
      {error ? (
        <p className="text-sm text-muted">
          <Link href="/dogrula" className="link-underline text-pine">
            Yeni bağlantı iste
          </Link>
        </p>
      ) : null}
    </form>
  );
}

export function ResendVerificationForm({
  email,
  sent,
  next,
  preview,
  continueHref,
  continueLabel = "Çalışmaya devam et",
}: {
  email?: string;
  sent?: boolean;
  next: string;
  preview?: string | null;
  continueHref?: string;
  continueLabel?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(sent ? "Doğrulama bağlantısını e-postana gönderdik. Gelen kutundaki bağlantıya tıkla." : null);
  const [devLink, setDevLink] = useState<string | null>(preview ?? null);
  const [address, setAddress] = useState("");

  async function submit(formData: FormData) {
    setError(null);
    const result = await resendVerificationAction(formData);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    if (result && "already" in result && result.already) {
      setMessage("Bu e-posta zaten doğrulanmış.");
      return;
    }
    setMessage("Bu adres için doğrulama gerekiyorsa, bağlantıyı gönderdik.");
    setDevLink(result && "devLink" in result ? result.devLink ?? devLink : devLink);
  }

  return (
    <form action={submit} className="space-y-4">
      {email ? (
        <>
          <input type="hidden" name="email" value={email} />
          <p className="text-sm leading-6 text-muted">
            Bağlantı <span className="text-ink">{email}</span> adresine gider.
          </p>
        </>
      ) : (
        <label className="block text-sm">
          E-posta
          <input name="email" type="email" required autoComplete="email" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="sen@posta.com" className={field} />
        </label>
      )}
      <Notice error={error} message={message} />
      {devLink ? (
        <p className="text-sm">
          <a href={devLink} className="link-underline text-pine">
            Geliştirme bağlantısı
          </a>
        </p>
      ) : null}
      <PendingButton pendingLabel="Gönderiliyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream">
        {sent || message ? "Bağlantıyı yeniden gönder" : "Doğrulama bağlantısı gönder"}
      </PendingButton>
      <p className="text-sm text-muted">
        <Link href={continueHref ?? next} className="link-underline text-pine">
          {continueLabel}
        </Link>
      </p>
    </form>
  );
}

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setError(null);
    setMessage(null);
    const result = await changePasswordAction(formData);
    if (result && "error" in result && result.error) {
      setError(result.error);
      return;
    }
    setMessage("Şifren güncellendi. Diğer cihazlardaki oturumlar kapatıldı.");
  }

  return (
    <form action={submit} className="mt-6 space-y-4">
      <h2 className="text-2xl">Şifre</h2>
      <label className="block text-sm">
        Mevcut şifre
        <input name="current" type="password" required autoComplete="current-password" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2" />
      </label>
      <label className="block text-sm">
        Yeni şifre
        <input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="En az 8 karakter" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2" />
      </label>
      <label className="block text-sm">
        Yeni şifre, tekrar
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" className="mt-1 w-full rounded-xl border border-line bg-card px-3 py-2" />
      </label>
      <Notice error={error} message={message} />
      <PendingButton pendingLabel="Kaydediliyor…" className="w-full rounded-full bg-pine px-4 py-3 text-cream sm:w-auto">
        Şifreyi güncelle
      </PendingButton>
    </form>
  );
}
