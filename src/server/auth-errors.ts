/** Supabase error strings stay on the server. Learners see a short Turkish next step. */
export function publicAuthError(message: string): string {
  const text = message.toLowerCase().replaceAll("_", " ");
  if (text.includes("not confirmed")) return "E-postanı henüz doğrulamadın. Gelen kutundaki bağlantıya tıkla, sonra giriş yap.";
  if (text.includes("invalid login") || text.includes("invalid credentials") || text.includes("invalid grant")) {
    return "E-posta ya da şifre yanlış. Tekrar dener misin?";
  }
  if (text.includes("already registered") || text.includes("already been registered") || text.includes("user already")) {
    return "Bu e-postayla açılmış bir hesap var. Giriş yap sekmesinden devam edebilirsin.";
  }
  if (text.includes("rate limit") || text.includes("too many") || text.includes("email rate")) return "Çok sık denedin. Biraz sonra tekrar dene.";
  if (text.includes("password")) return "Şifre kabul edilmedi. En az 8 karakter kullan.";
  return "İşlem tamamlanamadı. Biraz sonra tekrar dene.";
}
