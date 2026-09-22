import { NextResponse } from "next/server";
import { config } from "@/server/config";

/**
 * GET /api/health — liveness. Answers from process state only: no database, no session, no allocation that can
 * queue behind a slow query. A load balancer uses this to decide whether the *process* is wedged; whether it can
 * serve traffic is `/api/ready`.
 *
 * Public by design (see docs/DEPLOYMENT.md) and deliberately boring: it reveals the build version and uptime and
 * nothing else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json(
    { status: "ok", version: config.appVersion, uptimeS: Math.round(process.uptime()) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
