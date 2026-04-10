"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import Logo from "@/components/Logo";
import { SectorProvider, useSector } from "@/lib/sector-context";

/* Fallback nav items used while sector config loads */
const fallbackNavItems = [
  { href: "/dashboard", label: "Clientes", icon: "👥" },
  { href: "/dashboard/messages", label: "WhatsApp", icon: "💬" },
  { href: "/dashboard/emails", label: "Emails", icon: "📧" },
  { href: "/dashboard/budgets", label: "Presupuestos", icon: "📋" },
  { href: "/dashboard/prices", label: "Banco precios", icon: "💰" },
  { href: "/dashboard/projects", label: "Obras", icon: "🏗️" },
  { href: "/dashboard/suppliers", label: "Proveedores", icon: "🔧" },
  { href: "/dashboard/orders", label: "Pedidos", icon: "📦" },
  { href: "/dashboard/delivery-notes", label: "Albaranes", icon: "📄" },
  { href: "/dashboard/facturas", label: "Facturas recibidas", icon: "🧾" },
  { href: "/dashboard/issued-invoices", label: "Facturas emitidas", icon: "📑" },
  { href: "/dashboard/margins", label: "Márgenes", icon: "📊" },
  { href: "/dashboard/calendar", label: "Calendario", icon: "📅" },
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
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  // Build nav items from sector config or fallback
  const sectorModules = visibleModules();
  const navItems = sectorModules.length > 0
    ? sectorModules.map(m => ({ href: m.href, label: m.label, icon: m.icon }))
    : fallbackNavItems;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-navy-50">
        <div className="text-navy-600">Cargando...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-navy-50">
      <header className="fixed top-0 left-0 right-0 z-40 bg-white border-b border-navy-100">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden text-navy-700 mr-1">
              <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <Logo href="/dashboard" size={32} />
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-navy-600 hidden sm:block">{user?.email}</span>
            <button onClick={handleLogout} className="px-4 py-2 rounded-xl border border-navy-200 text-sm font-medium text-navy-700 hover:bg-navy-50 transition-colors">Salir</button>
          </div>
        </div>
      </header>

      {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside className={`fixed top-[57px] left-0 bottom-0 w-60 bg-white border-r border-navy-100 z-30 transform transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <nav className="p-4 space-y-1">
          {navItems.map(item => (
            <Link key={item.href} href={item.href} onClick={() => setSidebarOpen(false)} className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${pathname === item.href ? "bg-brand-green/10 text-brand-green" : "text-navy-700 hover:bg-navy-50"}`}>
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="pt-[57px] lg:pl-60">
        <div className="p-6 md:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
