import { ImageResponse } from "next/og";

/**
 * The share card for every route that doesn't define its own: the product's headline set in the brand's own
 * type and colours on white, with the three-node glyph. No photography, no logos, no gradients.
 */
export const alt = "AI Staffing Agency — describe the job, meet your new hire.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#1d1d1f";
const SECONDARY = "#6e6e73";
const BLUE = "#0071e3";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#ffffff",
          padding: "80px",
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <svg width="44" height="44" viewBox="0 0 24 24">
            <path
              d="M12 9.2v3.1m0 0-4.6 3.2m4.6-3.2 4.6 3.2"
              stroke={INK}
              strokeOpacity="0.45"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="12" cy="6.4" r="2.9" fill={INK} />
            <circle cx="6.4" cy="17.2" r="2.5" fill={INK} fillOpacity="0.72" />
            <circle cx="17.6" cy="17.2" r="2.5" fill={INK} fillOpacity="0.72" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-0.02em" }}>AI Staffing Agency</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05 }}>
            Describe the job.
          </div>
          <div style={{ fontSize: 88, fontWeight: 600, letterSpacing: "-0.025em", lineHeight: 1.05 }}>
            Meet your new hire.
          </div>
          <div style={{ marginTop: 32, fontSize: 32, color: SECONDARY, maxWidth: 900, lineHeight: 1.35 }}>
            Scope the work, hire an AI worker for it, review every deliverable.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: 26, color: SECONDARY }}>
          <div style={{ display: "flex", width: 12, height: 12, borderRadius: 999, backgroundColor: BLUE }} />
          <div style={{ display: "flex" }}>Job → Worker → Runs → Deliverables → Review</div>
        </div>
      </div>
    ),
    size,
  );
}
