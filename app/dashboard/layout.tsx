"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import NotificationCenter from "@/components/NotificationCenter";
import { SectorProvider, useSector } from "@/lib/sector-context";

/* Fallback nav items used while sector config loads */
const fallbackNavItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/clientes", label: "Clientes", icon: "👥" },
  { href: "/dashboard/budgets", label: "Presupuestos", icon: "📋" },
  { href: "/dashboard/messages", label: "WhatsApp", icon: "💬" },
  { href: "/dashboard/emails", label: "Emails", icon: "📧" },
  { href: "/dashboard/prices", label: "Banco precios", icon: "💰" },
  { href: "/dashboard/projects", label: "Obras", icon: "🏗️" },
  { href: "/dashboard/suppliers", label: "Proveedores", icon: "🔧" },
  { href: "/dashboard/orders", label: "Pedidos", icon: "📦" },
  { href: "/dashboard/delivery-notes", label: "Albaranes", icon: "📄" },
  { href: "/dashboard/facturas", label: "Facturas recibidas", icon: "🧾" },
  { href: "/dashboard/issued-invoices", label: "Facturas emitidas", icon: "📑" },
  { href: "/dashboard/payments", label: "Pagos y Tesorería", icon: "💵" },
  { href: "/dashboard/margins", label: "Márgenes", icon: "📊" },
  { href: "/dashboard/calendar", label: "Calendario", icon: "📅" },
  { href: "/dashboard/compliance", label: "Compliance", icon: "🛡️" },
  { href: "/dashboard/audit-log", label: "Audit Log", icon: "📋" },
  { href: "/dashboard/settings", label: "Ajustes", icon: "⚙️" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SectorProvider>
      <DashboardInner>{children}</DashboardInner>
    </SectorProvider>
  );
}

function DashboardInner({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const supabase = createClient();
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
    await supabase.auth.signOut();
    router.push("/");
  };

  // Build nav items from sector config or fallback
  const sectorModules = visibleModules();
  const complianceItems = [
    { href: "/dashboard/compliance", label: "Compliance", icon: "🛡️" },
    { href: "/dashboard/audit-log", label: "Audit Log", icon: "📋" },
  ];
  const navItems = sectorModules.length > 0
    ? [...sectorModules.map(m => ({ href: m.href, label: m.label, icon: m.icon })), ...complianceItems, { href: "/dashboard/settings", label: "Ajustes", icon: "⚙️" }]
    : fallbackNavItems;

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
      <div className="min-h-screen flex items-center justify-center bg-navy-50">
        <div className="text-navy-600">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f4f7fa_280px)] font-sans">
      {/* ── Topbar ─────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-40 border-b border-navy-100 bg-white/90 backdrop-blur">
        <div className="flex items-center gap-4 px-4 py-3 sm:px-6">
          {/* Logo + mobile toggle */}
          <div className="flex shrink-0 items-center gap-3 lg:w-64">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-navy-700 lg:hidden"
              aria-label="Abrir menú"
            >
              <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Logo href="/dashboard" size={30} />
          </div>

          {/* Search */}
          <div className="relative hidden max-w-md flex-1 md:block">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-400"
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="search"
              placeholder="Buscar clientes, presupuestos…"
              className="h-10 w-full rounded-xl border border-navy-100 bg-navy-50/60 pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20"
            />
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 sm:gap-3">
            {/* Notifications */}
            <NotificationCenter />

            {/* Avatar + menu */}
            <div className="relative">
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="flex items-center gap-2 rounded-xl border border-transparent px-1.5 py-1 text-sm text-navy-700 transition-colors hover:border-navy-100 hover:bg-navy-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
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
                  <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-navy-100 bg-white py-1 shadow-sm">
                    <div className="border-b border-navy-100 px-4 py-3">
                      <p className="truncate text-xs text-navy-500">Conectado como</p>
                      <p className="truncate text-sm font-medium text-navy-900">{user?.email}</p>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      className="block px-4 py-2 text-sm text-navy-700 hover:bg-navy-50"
                      onClick={() => setMenuOpen(false)}
                    >
                      Ajustes
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="block w-full px-4 py-2 text-left text-sm text-navy-700 hover:bg-navy-50"
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
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────── */}
      <aside
        className={`fixed bottom-0 left-0 top-[57px] z-30 w-64 transform border-r border-navy-100 bg-white transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <nav className="h-full overflow-y-auto px-4 py-6">
          <p className="px-3 pb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-navy-400">
            General
          </p>
          <ul className="space-y-0.5">
            {navItems.map(item => {
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
                      transition-all duration-150
                      ${
                        active
                          ? "bg-navy-900 text-white shadow-[0_4px_16px_-8px_rgba(10,25,41,0.4)]"
                          : "text-navy-600 hover:bg-navy-50 hover:text-navy-900"
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
        </nav>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────── */}
      <main className="pt-[57px] lg:pl-64">
        <div className="px-6 py-10 md:px-12 md:py-14">{children}</div>
      </main>
    </div>
  );
}
