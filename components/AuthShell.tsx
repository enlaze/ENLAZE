import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

// ─────────────────────────────────────────────────────────────
// AuthShell — marco visual compartido de las pantallas de acceso
// (login, registro, recuperar y nueva contraseña).
//
// Telón «aurora» de la landing + tarjeta flotante partida: panel de
// marca (mint) a la izquierda en desktop y el formulario a la derecha.
// En móvil el panel de marca se oculta y el wordmark salta arriba del
// formulario. Diseño pensado solo para modo claro (la tarjeta es blanca
// sobre un telón oscuro propio, así que se ve igual con cualquier tema).
// ─────────────────────────────────────────────────────────────

const AURORA =
  "radial-gradient(600px 420px at 88% 22%, rgba(0,200,150,0.28), transparent 70%)," +
  "radial-gradient(560px 460px at 6% 82%, rgba(84,96,224,0.22), transparent 70%)," +
  "radial-gradient(400px 300px at 50% 110%, rgba(0,200,150,0.10), transparent 70%)";

// Estilos reutilizables de formulario (importables desde las páginas).
export const authLabel =
  "block text-[13px] font-semibold text-[#22334e] mb-1.5";

export const authInput =
  "w-full h-11 rounded-[10px] border border-[#dbe3ee] bg-[#fbfcfe] px-3.5 text-sm text-[#101d33] " +
  "placeholder:text-[#95a3b8] outline-none transition " +
  "focus:border-brand-green focus:bg-white focus:shadow-[0_0_0_3px_rgba(0,200,150,0.14)]";

export const authButton =
  "w-full h-12 rounded-xl bg-brand-green text-white text-[15px] font-bold " +
  "shadow-[0_8px_20px_rgba(0,200,150,0.35)] transition hover:bg-brand-green-dark " +
  "disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2";

function Wordmark({ size = 34 }: { size?: number }) {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-2.5 select-none"
      aria-label="Enlaze"
    >
      <Image
        src="/logo.png"
        alt="Enlaze"
        width={size}
        height={size}
        priority
        className="shrink-0"
      />
      <span
        className="font-bold tracking-tight text-[#101d33]"
        style={{ fontSize: Math.round(size * 0.7) }}
      >
        enla<span className="text-brand-green">z</span>e
      </span>
    </Link>
  );
}

function Underline({ width = 140 }: { width?: number }) {
  return (
    <div
      className="mt-2 h-1 rounded-full"
      style={{
        width,
        background:
          "linear-gradient(90deg, rgba(0,200,150,0.6), rgba(0,200,150,0.1))",
      }}
    />
  );
}

function BrandPanel() {
  return (
    <>
      <div className="flex flex-col gap-[22px]">
        <div className="self-start inline-flex items-center gap-2 rounded-full border border-[#d7ede2] bg-white px-3.5 py-[7px] text-[11px] font-bold tracking-[1px] text-[#33415c]">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-green" />
          PARA AUTÓNOMOS Y PYMES
        </div>
        <h2 className="text-[32px] leading-10 font-bold tracking-[-0.7px] text-[#101d33] text-pretty">
          Vende más, cobra antes, <span className="text-[#159d76]">vive mejor.</span>
          <Underline width={140} />
        </h2>
        <p className="text-[15px] leading-[23px] text-[#54657d]">
          Clientes, presupuestos, facturas y cobros en un solo sitio — sin Excel,
          sin papeles.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {["Sin tarjeta", "Listo en 2 minutos", "Soporte en español"].map((t) => (
          <span
            key={t}
            className="rounded-full border border-[#d7ede2] bg-white px-3 py-1.5 text-xs font-semibold text-[#33415c]"
          >
            {t}
          </span>
        ))}
      </div>
    </>
  );
}

function RecoverPanel() {
  return (
    <>
      <div className="flex flex-col gap-3.5">
        <h2 className="text-[28px] leading-9 font-bold tracking-[-0.6px] text-[#101d33] text-pretty">
          Te ayudamos a recuperar tu acceso.
          <Underline width={110} />
        </h2>
        <p className="text-[15px] leading-[23px] text-[#54657d]">
          Un momento y estás dentro de nuevo.
        </p>
      </div>
      <div />
    </>
  );
}

type AuthShellProps = {
  children: ReactNode;
  /** "brand" = login/registro · "recover" = recuperar/nueva contraseña */
  panel?: "brand" | "recover";
};

export default function AuthShell({ children, panel = "brand" }: AuthShellProps) {
  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#05070d] px-4 py-10 sm:px-6">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: AURORA }} />

      <div className="relative w-full max-w-[1000px] overflow-hidden rounded-3xl bg-white shadow-[0_30px_80px_rgba(0,0,0,0.5)] lg:grid lg:min-h-[620px] lg:grid-cols-[420px_1fr]">
        {/* Panel de marca — solo desktop */}
        <aside
          className="hidden flex-col justify-between border-r border-[#e2f0e9] p-9 lg:flex"
          style={{ background: "linear-gradient(170deg, #f4fbf8 0%, #e9f7f0 100%)" }}
        >
          <Wordmark />
          {panel === "brand" ? <BrandPanel /> : <RecoverPanel />}
        </aside>

        {/* Formulario */}
        <main className="flex items-center justify-center bg-white px-6 py-12 sm:px-10">
          <div className="w-full max-w-[380px]">
            <div className="mb-8 flex justify-center lg:hidden">
              <Wordmark />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
