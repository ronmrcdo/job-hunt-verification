import { ImageResponse } from "next/og";
import { SITE_NAME, SITE_DESCRIPTION } from "../lib/site";

// The default social-share card for the whole site (inherited by every route
// without its own opengraph-image). Rendered with next/og — flexbox + a
// subset of CSS only; no grid. Colours mirror the product's off-white canvas
// (surface-alt #FAFAF8) and ink text.
export const alt = `${SITE_NAME} — check a job posting before you apply`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "80px",
          background: "#FAFAF8",
          color: "#1A1A1A",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 34, letterSpacing: 2 }}>
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              background: "#1A1A1A",
              marginRight: 18,
            }}
          />
          {SITE_NAME.toUpperCase()}
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* satori has no <br /> and refuses any multi-child element without an
              explicit display — each headline line is its own flex row. */}
          <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 500, lineHeight: 1.1 }}>
            <div style={{ display: "flex" }}>Check a job posting</div>
            <div style={{ display: "flex" }}>before you apply.</div>
          </div>
          <div style={{ fontSize: 30, marginTop: 32, color: "#5A5A55", maxWidth: 900, lineHeight: 1.4 }}>
            {SITE_DESCRIPTION}
          </div>
        </div>

        <div style={{ fontSize: 24, letterSpacing: 3, color: "#5A5A55" }}>
          jobverifai.ronmrcdo.dev
        </div>
      </div>
    ),
    { ...size },
  );
}
