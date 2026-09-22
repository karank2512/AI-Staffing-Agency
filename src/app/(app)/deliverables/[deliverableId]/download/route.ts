import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getDeliverableFile } from "@/server/queries/deliverables";

/**
 * GET /deliverables/[deliverableId]/download — the deliverable's content as a file (markdown / CSV / JSON).
 * Org-scoped through the query; a foreign id is a 404 like everywhere else.
 */

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ deliverableId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not signed in", code: "UNAUTHENTICATED" }, { status: 401 });

  const { deliverableId } = await ctx.params;
  try {
    const file = await getDeliverableFile(session.organizationId, deliverableId);
    return new NextResponse(file.content, {
      status: 200,
      headers: {
        "Content-Type": file.contentType,
        // The filename is a slug (ASCII only) so no RFC 5987 encoding is needed.
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Deliverable not found", code: "NOT_FOUND" }, { status: 404 });
    }
    console.error("[deliverables/download] failed", e);
    return NextResponse.json({ error: "Something went wrong", code: "INTERNAL" }, { status: 500 });
  }
}
