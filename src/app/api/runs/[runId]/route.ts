import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getRunLiveView } from "@/server/queries/runs";

/**
 * GET /api/runs/[runId] — the poll target of the run page's live timeline. Returns `RunLiveView`
 * (see `@/server/runtime/types`). Route handlers answer 401 JSON rather than redirecting, so a
 * poller whose session expired stops cleanly instead of following a sign-in redirect.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
  }

  const { runId } = await ctx.params;
  try {
    const view = await getRunLiveView(session.organizationId, runId);
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Run not found", code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    console.error("[api/runs] failed to load run", e);
    return NextResponse.json({ error: "Something went wrong", code: "INTERNAL" }, { status: 500, headers: NO_STORE });
  }
}
