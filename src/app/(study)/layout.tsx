import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/shell";
import { currentProfile } from "@/server/auth";

export default async function StudyLayout({ children }: { children: React.ReactNode }) {
  const profile = await currentProfile();
  if (!profile) redirect("/giris");
  const unverified = Boolean(profile.passwordHash && !profile.emailVerifiedAt);
  return (
    <>
      <AppHeader admin={profile.role === "admin"} />
      {unverified ? (
        <p className="border-b border-line bg-paper px-4 py-2 text-center text-sm print:hidden">
          E-postan henüz doğrulanmadı.{" "}
          <Link href="/dogrula" className="link-underline text-pine">
            Doğrulama bağlantısı gönder
          </Link>
        </p>
      ) : null}
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-5 print:max-w-none print:p-0">{children}</main>
    </>
  );
}
