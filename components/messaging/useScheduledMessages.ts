/* eslint-disable react-hooks/set-state-in-effect */
"use client";

/**
 * La cola de "Programados" de un canal, contra /api/scheduled-messages.
 *
 * Antes era `useState<QueueItem[]>` en cada pantalla y se perdía al recargar.
 * Ahora la fuente de verdad es la tabla `scheduled_messages`, así que WhatsApp
 * y Emails comparten este hook: cargar, crear, pausar/reanudar y cancelar son
 * idénticos en los dos y solo cambia el `channel`.
 *
 * Todas las acciones devuelven `{ ok, error }` en vez de lanzar: quien decide
 * qué toast enseñar es la pantalla, que es la que conoce el vocabulario del
 * canal ("mensaje" vs "email").
 */

import { useCallback, useEffect, useState } from "react";
import type { Audience, MessageChannel, ScheduleSpec, ScheduledMessage } from "@/lib/scheduled-messages";

export type CreateScheduleInput = ScheduleSpec & {
  title: string;
  audience: Audience;
  subject?: string;
  body: string;
};

type ActionResult = { ok: true } | { ok: false; error: string };

export function useScheduledMessages(channel: MessageChannel) {
  const [rows, setRows] = useState<ScheduledMessage[]>([]);
  const [loading, setLoading] = useState(true);
  /** El envío que tiene una acción en vuelo, para bloquear sus botones. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const json = await fetch(`/api/scheduled-messages?channel=${channel}`)
      .then((r) => r.json())
      .catch(() => null);
    setRows(Array.isArray(json?.scheduled) ? (json.scheduled as ScheduledMessage[]) : []);
    setLoading(false);
  }, [channel]);

  useEffect(() => {
    reload();
  }, [reload]);

  const create = useCallback(
    async (input: CreateScheduleInput): Promise<ActionResult> => {
      const res = await fetch("/api/scheduled-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, ...input }),
      }).catch(() => null);
      const payload = res ? await res.json().catch(() => null) : null;

      if (!res || !res.ok) {
        return { ok: false, error: payload?.error || "No se pudo guardar el envío programado." };
      }
      await reload();
      return { ok: true };
    },
    [channel, reload]
  );

  const setStatus = useCallback(
    async (id: string, status: "active" | "paused"): Promise<ActionResult> => {
      setBusyId(id);
      const res = await fetch(`/api/scheduled-messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => null);
      const payload = res ? await res.json().catch(() => null) : null;
      await reload();
      setBusyId(null);

      if (!res || !res.ok) {
        return { ok: false, error: payload?.error || "No se pudo actualizar el envío." };
      }
      return { ok: true };
    },
    [reload]
  );

  const remove = useCallback(
    async (id: string): Promise<ActionResult> => {
      setBusyId(id);
      const res = await fetch(`/api/scheduled-messages/${id}`, { method: "DELETE" }).catch(() => null);
      const payload = res ? await res.json().catch(() => null) : null;
      await reload();
      setBusyId(null);

      if (!res || !res.ok) {
        return { ok: false, error: payload?.error || "No se pudo cancelar el envío." };
      }
      return { ok: true };
    },
    [reload]
  );

  return { rows, loading, busyId, reload, create, setStatus, remove };
}
