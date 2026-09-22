import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getRunLiveView } from "@/server/queries/runs";
import { RATE_RULES, hit, publicErrorMessage } from "@/server/security";

/**
 * GET /api/runs/[runId] — the poll target of the run page's live timeline. Returns `RunLiveView`
 * (see `@/server/runtime/types`). Route handlers answer 401 JSON rather than redirecting, so a
 * poller whose session expired stops cleanly instead of following a sign-in redirect.
 *
 * Each poll is a multi-table read and the page polls every 1.5 s per open tab, so it is rate limited per
 * user (INF-05). A foreign or unknown id gets the same 404 — ids are never an existence oracle.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(_request: Request, ctx: { params: Promise<{ runId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
  }

  const limit = await hit(RATE_RULES.pollUser, session.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests", code: "LIMIT_EXCEEDED", retryAfterSec: limit.retryAfterSec },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const { runId } = await ctx.params;
  try {
    const view = await getRunLiveView(session.organizationId, runId);
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Run not found", code: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    }
    const { ref } = publicErrorMessage(e);
    return NextResponse.json({ error: "Something went wrong", code: "INTERNAL", ref }, { status: 500, headers: NO_STORE });
  }
}
