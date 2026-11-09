import { databaseInfo, getDb, sql } from "@/db/client";
import { allowUse } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

function describe(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  return code && /^[A-Z0-9]{5}$/.test(code) ? code : "unavailable";
}

export async function GET() {
  const started = Date.now();
  const driver = databaseInfo().driver;
  const region = process.env.VERCEL_REGION ?? null;
  if (!(await allowUse("health"))) return Response.json({ ok: false, driver, region }, { status: 429 });
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, driver, region, ms: Date.now() - started });
  } catch (error) {
    return Response.json({ ok: false, driver, region, ms: Date.now() - started, error: describe(error) }, { status: 503 });
  }
}
