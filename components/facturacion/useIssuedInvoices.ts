/* eslint-disable react-hooks/set-state-in-effect */
"use client";

/**
 * Carga de facturas emitidas para el hub de Facturación.
 *
 * Es la misma consulta que hacía app/dashboard/issued-invoices, subida a un
 * hook para que el resumen de arriba (KPIs + gráfico) y la pestaña "Emitidas"
 * compartan una única lectura en vez de pedir lo mismo dos veces.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { Client, IssuedInvoice, Project } from "./shared";

export function useIssuedInvoices() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [userId, setUserId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<IssuedInvoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }
    setUserId(user.id);

    const [invRes, clientsRes, projRes] = await Promise.all([
      supabase.from("issued_invoices").select("*, clients(id, name, email)").eq("user_id", user.id).order("number", { ascending: false }),
      supabase.from("clients").select("id, name, email").eq("user_id", user.id).order("name"),
      supabase.from("projects").select("id, name").eq("user_id", user.id).order("name"),
    ]);

    setInvoices((invRes.data as IssuedInvoice[]) || []);
    setClients((clientsRes.data as Client[]) || []);
    setProjects((projRes.data as Project[]) || []);
    setLoading(false);
  }, [router, supabase]);

  useEffect(() => { load(); }, [load]);

  return { supabase, userId, invoices, setInvoices, clients, projects, loading, reload: load };
}

export type IssuedInvoicesState = ReturnType<typeof useIssuedInvoices>;
