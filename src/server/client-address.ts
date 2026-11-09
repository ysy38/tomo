const ipPattern = /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i;

/** The platform-supplied address. A caller-supplied first hop in x-forwarded-for is ignored. */
export function clientAddress(get: (name: string) => string | null | undefined): string {
  const real = get("x-real-ip")?.split(",")[0]?.trim() ?? "";
  if (ipPattern.test(real)) return real;
  const hops = (get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => ipPattern.test(part));
  return hops.at(-1) ?? "unknown";
}
