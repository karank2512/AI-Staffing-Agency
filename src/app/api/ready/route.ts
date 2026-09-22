import { NextResponse } from "next/server";
import { checkReadiness } from "@/server/maintenance/readiness";

/**
 * GET /api/ready — readiness. 200 once the database answers and its schema matches the migrations this build was
 * compiled against; 503 otherwise, so an orchestrator holds traffic back instead of routing it into errors.
 *
 * The body names which check failed but never why: the reason (a connection string, a Postgres error, a missing
 * migration) is logged server-side. This endpoint is reachable without a session.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(): Promise<NextResponse> {
  const report = await checkReadiness();
  return NextResponse.json(
    {
      status: report.ready ? "ready" : "not_ready",
      version: report.version,
      checks: report.checks,
      executors: report.executors,
    },
    { status: report.ready ? 200 : 503, headers: NO_STORE },
  );
}
