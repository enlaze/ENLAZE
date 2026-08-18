/**
 * Estructura canónica del menú lateral del dashboard: la lista de secciones,
 * sus iconos y las reglas de filtrado (por sector y por preferencia personal).
 *
 * Vive fuera de app/dashboard/layout.tsx porque un `layout.tsx` del App Router
 * no admite exports propios (Next valida que solo exporte el componente y su
 * configuración), y estas constantes las comparten el sidebar y el panel de
 * Ajustes → Personalización. El layout sigue siendo su único consumidor "de
 * pintado": esto es solo el catálogo.
 */

import type { SidebarModule } from "@/lib/sector-context";

/* Canonical sidebar structure — single source of truth.
   Each item has a `section` (null = pinned at top, no header). */
export type NavSection = "General" | "Negocio" | "Finanzas" | "Sistema" | null;

export type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  section: NavSection;
};

const ControlCenterIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3" y="3" width="9" height="9" rx="1.6" />
    <rect x="14" y="3" width="7" height="6" rx="1.4" />
    <rect x="14" y="11" width="7" height="10" rx="1.4" />
    <rect x="3" y="14" width="9" height="7" rx="1.4" />
    <circle cx="6.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
  </svg>
);

const ClientesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <circle cx="16.5" cy="7.5" r="2.6" />
    <path d="M11 20.5c0-2.7 2.4-4.8 5.5-4.8 1.6 0 3 .55 4 1.5" />
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 20.5c0-3 2.7-5.4 6-5.4s6 2.4 6 5.4" />
    <circle cx="13.4" cy="14.6" r="1.35" fill="currentColor" stroke="none" />
  </svg>
);

const WhatsAppIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M5 4.5h11A3.5 3.5 0 0 1 19.5 8v5.5A3.5 3.5 0 0 1 16 17H10l-3.6 2.7A.6.6 0 0 1 5.5 19.2V17A3.5 3.5 0 0 1 2 13.5V8a3.5 3.5 0 0 1 3-3.5z" />
    <path d="M6.5 11l1.6-2.2L10 12.6l1.7-3.6 1.7 3.4 1.4-1.4h2.7" />
  </svg>
);

const EmailsIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3" y="6.5" width="18" height="13" rx="2.2" />
    <path d="M3.5 8.5l8 5.4a1 1 0 0 0 1 0l8-5.4" />
    <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const PresupuestosIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <line x1="8.4" y1="5.5" x2="8.4" y2="18.5" strokeWidth="1.6" />
    <line x1="11" y1="9" x2="14.5" y2="9" />
    <line x1="11" y1="13" x2="16" y2="13" />
    <text x="15.7" y="9.9" fontFamily="Geist Mono, monospace" fontSize="3.6" fontWeight="600" fill="currentColor" stroke="none">€</text>
  </svg>
);

const BancoPreciosIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="4" y="4.5" width="13" height="3.2" rx="1" />
    <rect x="4" y="9.4" width="13" height="3.2" rx="1" />
    <rect x="4" y="14.3" width="16" height="5.2" rx="1.2" />
    <path d="M16.4 16.2l1.6-1.6 1.4 1.4-1.6 1.6z" fill="currentColor" stroke="none" transform="translate(-.3 .3)" />
  </svg>
);

const ObrasIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M5 20V8.5l5-3 5 3V20" />
    <line x1="3.5" y1="20" x2="20.5" y2="20" />
    <line x1="10" y1="12" x2="10" y2="16" />
    <path d="M16 14.5h4v5.5" />
    <circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none" />
  </svg>
);

const ProveedoresIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="2.5" y="8" width="11" height="8" rx="1" />
    <path d="M13.5 11h4l3.5 3v2h-7.5z" />
    <circle cx="6.5" cy="17.5" r="1.4" />
    <circle cx="16.5" cy="17.5" r="1.4" />
    <path d="M9 5.5l-2.2 2L9 9.5" />
    <line x1="6.8" y1="7.5" x2="11.5" y2="7.5" />
  </svg>
);

const PedidosIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M3.5 8L12 4l8.5 4-8.5 4z" />
    <path d="M3.5 8v9l8.5 4 8.5-4V8" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <line x1="7.5" y1="14.4" x2="10.5" y2="15.8" />
    <line x1="7.5" y1="16.4" x2="10.5" y2="17.8" />
    <line x1="7.5" y1="18.4" x2="10.5" y2="19.8" />
  </svg>
);

const AlbaranesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M5 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <line x1="6" y1="7.5" x2="14" y2="7.5" />
    <line x1="6" y1="10.5" x2="14" y2="10.5" />
    <line x1="6" y1="13.5" x2="11" y2="13.5" />
    <circle cx="17.6" cy="17.4" r="2.6" stroke="currentColor" />
    <path d="M16.6 17.4l.7.8 1.6-1.7" strokeWidth="1.4" />
  </svg>
);

const CalendarioIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <line x1="3.5" y1="9" x2="20.5" y2="9" />
    <line x1="8" y1="3.5" x2="8" y2="6.5" />
    <line x1="16" y1="3.5" x2="16" y2="6.5" />
    <circle cx="9" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    <line x1="12" y1="16.5" x2="17" y2="16.5" strokeWidth="1.6" />
  </svg>
);

const FacturasEmitidasIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M6 4.5h7.5L17 8v9.25A2.25 2.25 0 0 1 14.75 19.5H6A2.25 2.25 0 0 1 3.75 17.25v-10.5A2.25 2.25 0 0 1 6 4.5Z" />
    <path d="M13.25 4.5v3.5h3.5" />
    <path d="M6.75 8.5v8" strokeOpacity=".55" />
    <path d="M9 10.75h5.5" />
    <path d="M9 13.5h5" />
    <path d="M9 16.25h3.5" />
    <circle cx="18" cy="6" r="3" fill="currentColor" stroke="none" />
    <path d="M16.65 6.85L18 5.5l1.35 1.35M18 5.7v2.7" stroke="#fff" strokeWidth="1.6" />
  </svg>
);

const MargenesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M3.5 19.5h17" />
    <rect x="5.5" y="11.25" width="4" height="8.25" rx="1" />
    <rect x="14.5" y="6.5" width="4" height="13" rx="1" fill="currentColor" fillOpacity=".14" stroke="currentColor" />
    <path d="M11 8.5h2.5" />
    <path d="M11.9 7.5 10.9 8.5l1 1" />
    <path d="M12.6 9.5l1-1-1-1" />
  </svg>
);

const ContabilidadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="9" y1="4" x2="9" y2="20" />
    <text x="5" y="8.5" fontFamily="sans-serif" fontSize="4" fontWeight="600" fill="currentColor" stroke="none">€</text>
    <line x1="12" y1="14" x2="18" y2="14" strokeOpacity="0.5" />
    <line x1="12" y1="17" x2="16" y2="17" strokeOpacity="0.5" />
  </svg>
);

const AjustesIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M4 7h13" />
    <path d="M4 12h15" />
    <path d="M4 17h11" />
    <circle cx="9" cy="7" r="2.1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
    <circle cx="7" cy="17" r="2.1" fill="currentColor" stroke="none" />
  </svg>
);

const CumplimientoIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M12 3.5 5 5.75v5.5c0 4.25 3.1 7.6 7 9.25 3.9-1.65 7-5 7-9.25v-5.5L12 3.5Z" />
    <path d="M9 12.25 11.25 14.5" />
    <circle cx="13.25" cy="12.5" r=".7" fill="currentColor" stroke="none" opacity=".55" />
  </svg>
);

const FacturasRecibidasIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M6 4.5h7.5L17 8v9.25A2.25 2.25 0 0 1 14.75 19.5H6A2.25 2.25 0 0 1 3.75 17.25v-10.5A2.25 2.25 0 0 1 6 4.5Z" />
    <path d="M13.25 4.5v3.5h3.5" />
    <path d="M6.75 8.5v8" strokeOpacity=".55" />
    <path d="M9 10.75h5.5" />
    <path d="M9 13.5h5" />
    <path d="M9 16.25h3.5" />
    <circle cx="18" cy="6" r="3" fill="currentColor" stroke="none" />
    <path d="M19.35 5.15 18 6.5l-1.35-1.35M18 6.3V3.6" stroke="#fff" strokeWidth="1.6" />
  </svg>
);

const PagosTesoreriaIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <rect x="3.5" y="6" width="14" height="6" rx="1.25" />
    <rect x="6.5" y="13" width="14" height="6" rx="1.25" />
    <path d="M6 9h3" strokeOpacity=".55" />
    <circle cx="17.25" cy="13" r="3.4" fill="currentColor" stroke="none" />
    <path d="M18.55 11.7c-.55-.45-1.55-.5-2.05.05-.55.6-.55 2 0 2.6.5.55 1.5.5 2.05.05M15.6 12.55h2.05M15.6 13.45h2.05" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const PapeleraIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <path d="M4 7h16" />
    <path d="M9 3h6l1 4H8l1-4Z" />
    <path d="m6 7 1 14h10l1-14" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const NAV_ITEMS: NavItem[] = [
  // Centro de control — sin sección, siempre arriba del todo
  { href: "/dashboard", label: "Centro de control", icon: ControlCenterIcon, section: null },

  // GENERAL
  { href: "/dashboard/clientes", label: "Clientes", icon: ClientesIcon, section: "General" },
  { href: "/dashboard/messages", label: "WhatsApp", icon: WhatsAppIcon, section: "General" },
  { href: "/dashboard/emails", label: "Emails", icon: EmailsIcon, section: "General" },

  // NEGOCIO
  { href: "/dashboard/budgets", label: "Presupuestos", icon: PresupuestosIcon, section: "Negocio" },
  { href: "/dashboard/prices", label: "Rastreador de precios", icon: BancoPreciosIcon, section: "Negocio" },
  { href: "/dashboard/projects", label: "Obras", icon: ObrasIcon, section: "Negocio" },
  { href: "/dashboard/suppliers", label: "Proveedores", icon: ProveedoresIcon, section: "Negocio" },
  { href: "/dashboard/orders", label: "Pedidos", icon: PedidosIcon, section: "Negocio" },
  { href: "/dashboard/delivery-notes", label: "Albaranes", icon: AlbaranesIcon, section: "Negocio" },
  { href: "/dashboard/calendar", label: "Calendario", icon: CalendarioIcon, section: "Negocio" },

  // FINANZAS
  { href: "/dashboard/suppliers/invoices", label: "Facturas recibidas", icon: FacturasRecibidasIcon, section: "Finanzas" },
  { href: "/dashboard/issued-invoices", label: "Facturas emitidas", icon: FacturasEmitidasIcon, section: "Finanzas" },
  { href: "/dashboard/payments", label: "Pagos y tesorería", icon: PagosTesoreriaIcon, section: "Finanzas" },
  { href: "/dashboard/margins", label: "Márgenes", icon: MargenesIcon, section: "Finanzas" },
  { href: "/dashboard/contabilidad", label: "Contabilidad", icon: ContabilidadIcon, section: "Finanzas" },

  // SISTEMA
  { href: "/dashboard/trash", label: "Papelera", icon: PapeleraIcon, section: "Sistema" },
  { href: "/dashboard/settings", label: "Ajustes", icon: AjustesIcon, section: "Sistema" },
  { href: "/dashboard/compliance", label: "Cumplimiento", icon: CumplimientoIcon, section: "Sistema" },
  // "Registro de actividad" (/dashboard/audit-log) se retira del menú lateral: no es de
  // uso diario. La página sigue existiendo y accesible desde Cumplimiento → "Historial de actividad".
];

export const SECTION_ORDER: Array<NavItem["section"]> = [null, "General", "Negocio", "Finanzas", "Sistema"];

/* Items that should always appear regardless of sector config */
const ALWAYS_VISIBLE_HREFS = new Set([
  "/dashboard",
  "/dashboard/clientes",
  "/dashboard/settings",
  "/dashboard/trash",
  "/dashboard/compliance",
]);

/* Secciones que el usuario NO puede ocultar desde Ajustes → Personalización:
   sin ellas no habría forma de volver a activar el resto. */
export const NON_HIDEABLE_HREFS = new Set(["/dashboard", "/dashboard/settings"]);

/**
 * Aplica el filtrado por sector sobre la lista canónica: deja los hrefs que el
 * sector declara (más los siempre visibles) y adopta el label del sector cuando
 * lo hay. Si el sector no declara módulos, se muestra todo.
 *
 * Lo comparte el panel de Personalización para listar exactamente las mismas
 * secciones que el usuario ve en el menú.
 */
export function resolveSectorNavItems(sectorModules: SidebarModule[]): NavItem[] {
  if (sectorModules.length === 0) return NAV_ITEMS;

  const sectorHrefs = new Set(sectorModules.map((m) => m.href));
  const sectorLabelByHref = new Map(sectorModules.map((m) => [m.href, m.label]));

  return NAV_ITEMS
    .filter((item) => sectorHrefs.has(item.href) || ALWAYS_VISIBLE_HREFS.has(item.href))
    .map((item) => {
      // Keep the price tracker name canonical. Legacy sector_config rows
      // still contain "Banco precios" and load after hydration.
      if (item.href === "/dashboard/prices") return item;

      const sectorLabel = sectorLabelByHref.get(item.href);
      return sectorLabel ? { ...item, label: sectorLabel } : item;
    });
}
