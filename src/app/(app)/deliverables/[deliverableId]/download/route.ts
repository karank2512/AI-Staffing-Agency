import { NextResponse } from "next/server";
import { getSession } from "@/server/auth";
import { isAppError } from "@/server/errors";
import { getDeliverableFile } from "@/server/queries/deliverables";
import { DOWNLOAD_CSP, publicErrorMessage } from "@/server/security";

/**
 * GET /deliverables/[deliverableId]/download — the deliverable's content as a file (markdown / CSV / JSON).
 * Org-scoped through the query; a foreign id is a 404 like everywhere else.
 *
 * The file is worker output, so the response is served inert: `nosniff` (a .md that looks like HTML must not
 * be rendered as HTML), a deny-everything CSP, and `private, no-store` so a shared proxy never caches one
 * tenant's deliverable (F-015, INF-06).
 */

export const dynamic = "force-dynamic";

/** Windows/macOS-safe ASCII fallback; the RFC 5987 `filename*` carries the real one for modern browsers. */
function asciiFilename(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\/:*?<>|]/g, "-")
    .trim();
  return ascii === "" ? "deliverable" : ascii.slice(0, 120);
}

function contentDisposition(filename: string): string {
  return `attachment; filename="${asciiFilename(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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
        "Content-Disposition": contentDisposition(file.filename),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": DOWNLOAD_CSP,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") {
      return NextResponse.json({ error: "Deliverable not found", code: "NOT_FOUND" }, { status: 404 });
    }
    const { ref } = publicErrorMessage(e);
    return NextResponse.json({ error: "Something went wrong", code: "INTERNAL", ref }, { status: 500 });
  }
}
