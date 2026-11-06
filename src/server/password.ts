import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const maxPasswordLength = 128;

/** NIST-style check: length matters, composition rules do not. Returns a Turkish message, or null when the password is acceptable. */
export function passwordIssue(password: string, email?: string): string | null {
  if (password.length < 8) return "Şifre en az 8 karakter olmalı.";
  if (password.length > maxPasswordLength) return "Şifre en fazla 128 karakter olabilir.";
  if (!/\S/.test(password)) return "Şifre boş olamaz.";
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) return "Şifre e-postanla aynı olamaz.";
  return null;
}

export function hashPassword(password: string): string {
  if (password.length > maxPasswordLength) throw new Error("password too long");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored || password.length > maxPasswordLength) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const previous = Buffer.from(hash, "hex");
  if (next.length !== previous.length) return false;
  return timingSafeEqual(next, previous);
}
