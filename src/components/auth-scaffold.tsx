export function AuthScaffold({
  title,
  lede,
  kicker,
  children,
}: {
  title: string;
  lede: string;
  kicker: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 py-10 sm:px-5 sm:py-16 lg:grid-cols-[0.9fr_1fr]">
      <div className="max-w-md">
        <p className="text-xs lowercase tracking-[0.04em] text-pine">outklas.</p>
        <h1 className="display mt-4">{title}</h1>
        <p className="mt-4 leading-7 text-muted">{lede}</p>
      </div>
      <div className="rounded-[28px] border border-line bg-card p-6 shadow-[0_30px_80px_-48px_rgba(18,32,40,0.45)] sm:p-8">
        <p className="text-xs uppercase tracking-[0.18em] text-gold">{kicker}</p>
        <div className="mt-6">{children}</div>
      </div>
    </section>
  );
}
