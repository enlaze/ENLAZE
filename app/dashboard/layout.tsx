"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

const LinkIcon = () => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const navItems = [
  { href: "/dashboard", label: "Clientes", icon: "👥" },
  { href: "/dashboard/messages", label: "WhatsApp", icon: "💬" },
  { href: "/dashboard/emails", label: "Emails", icon: "📧" },
  { href: "/dashboard/calendar", label: "Calendario", icon: "📅" },
  { href: "/dashboard/settings", label: "Ajustes", icon: "⚙️" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();

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
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-navy-800 flex items-center justify-center"><LinkIcon /></div>
              <span className="text-lg font-bold text-navy-900">Enlaze</span>
            </Link>
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
