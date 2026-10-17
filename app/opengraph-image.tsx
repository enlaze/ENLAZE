import { ImageResponse } from "next/og";

export const alt = "Enlaze — Ocúpate de tu oficio. Del papeleo nos ocupamos nosotros.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0a1929 0%, #132f4c 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Logo text */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "16px",
              background: "#00c896",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
              fontWeight: 800,
              color: "white",
            }}
          >
            E
          </div>
          <span
            style={{
              fontSize: "48px",
              fontWeight: 700,
              color: "white",
              letterSpacing: "-0.02em",
            }}
          >
            ENLAZE
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "36px",
            fontWeight: 600,
            color: "white",
            textAlign: "center",
            maxWidth: "800px",
            lineHeight: 1.3,
          }}
        >
          Ocúpate de tu oficio.
        </div>
        <div
          style={{
            fontSize: "36px",
            fontWeight: 600,
            color: "#00c896",
            textAlign: "center",
            maxWidth: "800px",
            lineHeight: 1.3,
          }}
        >
          Del papeleo nos ocupamos nosotros.
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "18px",
            color: "#94a3b8",
            marginTop: "24px",
            textAlign: "center",
            maxWidth: "600px",
          }}
        >
          El asistente con IA para autónomos y pymes
        </div>
      </div>
    ),
    { ...size }
  );
}
