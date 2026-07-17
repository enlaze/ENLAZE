"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import { SearchCommandProvider, useSearchCommand } from "@/components/SearchCommand";
import ShortcutsOverlay from "@/components/ShortcutsOverlay";
import ThemeToggle from "@/components/ThemeToggle";
import { SectorProvider, useSector } from "@/lib/sector-context";
import { useToast } from "@/components/ui/toast";
import { analytics, resetAnalytics } from "@/lib/analytics";
import { setSentryUser } from "@/lib/sentry";

/* Canonical sidebar structure — single source of truth.
   Each item has a `section` (null = pinned at top, no header). */
type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  section: "General" | "Negocio" | "Finanzas" | "Sistema" | null;
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

const RegistroActividadIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
    <circle cx="5.5" cy="7" r="1.7" fill="currentColor" stroke="none" />
    <path d="M9.25 7h10.25" />
    <circle cx="5.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <path d="M8.75 12h9.25" />
    <circle cx="5.5" cy="17" r="1.15" fill="currentColor" stroke="none" />
    <path d="M8.75 17h7.5" />
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

const NAV_ITEMS: NavItem[] = [
  // Centro de control — sin sección, siempre arriba del todo
  { href: "/dashboard", label: "Centro de control", icon: ControlCenterIcon, section: null },

  // GENERAL
  { href: "/dashboard/clientes", label: "Clientes", icon: ClientesIcon, section: "General" },
  { href: "/dashboard/messages", label: "WhatsApp", icon: WhatsAppIcon, section: "General" },
  { href: "/dashboard/emails", label: "Emails", icon: EmailsIcon, section: "General" },

  // NEGOCIO
  { href: "/dashboard/budgets", label: "Presupuestos", icon: PresupuestosIcon, section: "Negocio" },
  { href: "/dashboard/prices", label: "Banco de precios", icon: BancoPreciosIcon, section: "Negocio" },
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

  // SISTEMA
  { href: "/dashboard/settings", label: "Ajustes", icon: AjustesIcon, section: "Sistema" },
  { href: "/dashboard/compliance", label: "Cumplimiento", icon: CumplimientoIcon, section: "Sistema" },
  { href: "/dashboard/audit-log", label: "Registro de actividad", icon: RegistroActividadIcon, section: "Sistema" },
];

const SECTION_ORDER: Array<NavItem["section"]> = [null, "General", "Negocio", "Finanzas", "Sistema"];

/* Items that should always appear regardless of sector config */
const ALWAYS_VISIBLE_HREFS = new Set([
  "/dashboard",
  "/dashboard/clientes",
  "/dashboard/settings",
  "/dashboard/compliance",
  "/dashboard/audit-log",
]);

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectorProvider>
      <SearchCommandProvider>
        <DashboardInner>{children}</DashboardInner>
      </SearchCommandProvider>
    </SectorProvider>
  );
}

/* Topbar button that opens the global command palette via the hook. */
function SearchTriggerButton() {
  const { open } = useSearchCommand();
  return (
    <div className="relative hidden max-w-md flex-1 md:block">
      <button
        type="button"
        onClick={open}
        className="flex h-10 w-full items-center gap-2 rounded-xl border border-navy-100 bg-navy-50/60 pl-3 pr-3 text-sm text-navy-400 transition-colors hover:border-navy-200 hover:bg-navy-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-zinc-800 dark:hover:bg-zinc-800"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="flex-1 text-left">Buscar clientes, presupuestos…</span>
        <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-navy-200 bg-white px-1.5 text-[10px] font-medium text-navy-400 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">⌘K</kbd>
      </button>
    </div>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const supabase = createClient();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const { visibleModules } = useSector();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      setLoading(false);
    };
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    analytics.userLoggedOut();
    resetAnalytics();
    setSentryUser(null);
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleResendVerificationEmail = async () => {
    if (!user?.email) return;
    try {
      await fetch("/api/auth/send-verification-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user.email }),
      });
      toast.success("Email de verificación reenviado", {
        description: "Revisa tu bandeja de entrada.",
      });
    } catch (error) {
      console.error("Error resending email:", error);
      toast.error("No se pudo reenviar el email", {
        description: "Inténtalo de nuevo en unos segundos.",
      });
    }
  };

  const emailVerified = user?.user_metadata?.email_verified === true;

  // Build nav items from canonical list, optionally filtered by sector visibility.
  // If the sector config returns an explicit list of modules, only those hrefs
  // (plus always-visible system items) are shown. Otherwise we show everything.
  // The sector config can also override the label per href (e.g. "Presupuestos"
  // → "Propuestas" for Servicios Profesionales).
  const sectorModules = visibleModules();
  const sectorHrefs = new Set(sectorModules.map((m) => m.href));
  const sectorLabelByHref = new Map(sectorModules.map((m) => [m.href, m.label]));
  const navItems = sectorModules.length > 0
    ? NAV_ITEMS
        .filter((item) => sectorHrefs.has(item.href) || ALWAYS_VISIBLE_HREFS.has(item.href))
        .map((item) => {
          const sectorLabel = sectorLabelByHref.get(item.href);
          return sectorLabel ? { ...item, label: sectorLabel } : item;
        })
    : NAV_ITEMS;

  // Group by section, preserving SECTION_ORDER.
  const sections = SECTION_ORDER
    .map((section) => ({
      title: section,
      items: navItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);

  // User initials for the avatar
  const initials = (() => {
    const name = user?.user_metadata?.full_name || user?.user_metadata?.name;
    if (name) {
      return name.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase();
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase();
    return "EN";
  })();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50 dark:bg-zinc-950">
        <div className="text-navy-600 dark:text-zinc-400">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fa_280px)] font-sans dark:bg-zinc-950 dark:bg-none">
      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-navy-100 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
          {/* Logo + mobile toggle */}
          <div className="flex shrink-0 items-center gap-3 lg:w-64">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-navy-700 transition-colors lg:hidden dark:text-zinc-300"
              aria-label="Abrir menú"
            >
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Logo href="/dashboard" size={30} />
          </div>

          {/* Search trigger */}
          <SearchTriggerButton />

          <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
            {/* Theme toggle */}
            <ThemeToggle />

            {/* Notifications */}
            <NotificationCenter />

            {/* Avatar + menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 text-sm text-navy-700 transition-colors hover:border-navy-100 hover:bg-navy-50 dark:text-zinc-300 dark:hover:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white dark:bg-zinc-900 dark:text-zinc-100">
                  {initials}
                </span>
                <span className="hidden max-w-[140px] truncate font-medium sm:block">
                  {user?.email}
                </span>
                <svg className="hidden sm:block" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40">
                    <div className="border-b border-navy-100 px-4 py-3 dark:border-zinc-800">
                      <p className="truncate text-xs text-navy-500 dark:text-zinc-500">Conectado como</p>
                      <p className="truncate text-sm font-medium text-navy-900 dark:text-white">{user?.email}</p>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      onClick={() => setMenuOpen(false)}
                    >
                      Ajustes
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="block w-full px-4 py-2 text-left text-sm text-navy-700 hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Cerrar sesión
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Sidebar overlay on mobile ──────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden dark:bg-black/60"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside
        className={`fixed bottom-0 left-0 top-[57px] z-30 w-64 transform border-r border-navy-100 bg-white transition-transform duration-200 lg:translate-x-0 dark:border-zinc-800 dark:bg-zinc-950 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="h-full overflow-y-auto px-4 py-6">
          {sections.map((group, groupIdx) => (
            <div key={group.title ?? "_top"} className={groupIdx === 0 ? "" : "mt-6"}>
              {group.title && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400 dark:text-zinc-500">
                  {group.title}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname === item.href || pathname.startsWith(item.href + "/");
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          group relative flex items-center gap-3 rounded-xl
                          px-3 py-2.5 text-[13.5px] font-medium
                          transition-colors duration-150
                          ${
                            active
                              ? "bg-brand-green/10 text-brand-green dark:bg-brand-green/15 dark:text-brand-green-light"
                              : "text-navy-700 hover:bg-navy-100 hover:text-navy-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                          }
                        `}
                      >
                        <span
                          className={`
                            text-base transition-transform duration-150
                            ${active ? "" : "opacity-70 group-hover:opacity-100 group-hover:scale-105"}
                          `}
                        >
                          {item.icon}
                        </span>
                        <span className="truncate">{item.label}</span>
                        {active && (
                          <span
                            aria-hidden
                            className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-green shadow-[0_0_0_3px_rgba(0,200,150,0.2)]"
                          />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="pt-[57px] lg:pl-64">
        {/* Email verification banner */}
        {!emailVerified && (
          <div className="mx-6 mt-6 md:mx-12 md:mt-8 rounded-xl border-l-4 border-yellow-500 bg-yellow-50 p-4 md:p-6 shadow-sm dark:bg-yellow-950/40 dark:border-yellow-500/70 dark:ring-1 dark:ring-yellow-900/40">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 text-2xl">⚠️</div>
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 dark:text-yellow-200">Email sin verificar</h3>
                <p className="mt-1 text-sm text-yellow-800 dark:text-yellow-300/90">
                  Revisa tu bandeja de entrada para completar la verificación de tu email. Esto es importante para acceder a todas las funciones.
                </p>
                <button
                  onClick={handleResendVerificationEmail}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 transition-colors dark:bg-yellow-500 dark:text-zinc-950 dark:hover:bg-yellow-400"
                >
                  Reenviar email de verificación
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="px-6 py-10 md:px-12 md:py-14">{children}</div>
      </main>

      {/* Keyboard shortcuts help (press ?) */}
      <ShortcutsOverlay />
    </div>
  );
}
