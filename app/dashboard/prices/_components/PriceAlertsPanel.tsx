"use client";

import { useEffect, useState } from "react";

interface Alert {
  id: string;
  product_name: string;
  provider_name: string | null;
  alert_type: string;
  threshold_pct: number;
  threshold_price: number | null;
  reference_price: number | null;
  last_price: number | null;
  is_active: boolean;
  created_at: string;
}

interface Notification {
  id: string;
  product_name: string;
  provider_name: string | null;
  old_price: number;
  new_price: number;
  change_pct: number;
  direction: string;
  created_at: string;
}

interface Props {
  onCreateAlert: (productId: string | null, productName: string, providerName: string) => void;
}

export default function PriceAlertsPanel({ onCreateAlert }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formType, setFormType] = useState("threshold_pct");
  const [formThreshold, setFormThreshold] = useState(5);
  const [formThresholdPrice, setFormThresholdPrice] = useState<number | "">("");

  useEffect(() => { loadAlerts(); }, []);

  async function loadAlerts() {
    setLoading(true);
    try {
      const res = await fetch("/api/prices/alerts");
      const data = await res.json();
      setAlerts(data.alerts || []);
      setNotifications(data.notifications || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function createAlert() {
    if (!formName.trim()) return;
    try {
      const res = await fetch("/api/prices/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: formName,
          alert_type: formType,
          threshold_pct: formThreshold,
          threshold_price: formThresholdPrice || null,
        }),
      });
      if (res.ok) {
        setShowForm(false);
        setFormName("");
        loadAlerts();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteAlert(id: string) {
    try {
      await fetch(`/api/prices/alerts?id=${id}`, { method: "DELETE" });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error(err);
    }
  }

  async function markAllRead() {
    try {
      await fetch("/api/prices/alerts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mark_all_read: true }),
      });
      setNotifications([]);
    } catch (err) {
      console.error(err);
    }
  }

  const INPUT_CLS = "w-full rounded-xl border border-navy-200 bg-navy-50/60 px-4 py-2.5 text-sm text-navy-900 placeholder:text-navy-400 focus:border-brand-green/40 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/20 transition-colors dark:border-zinc-800 dark:bg-zinc-900 dark:text-white";

  const alertTypeLabels: Record<string, string> = {
    any_change: "Cualquier cambio",
    threshold_pct: "Cambio > X%",
    price_above: "Precio sube de",
    price_below: "Precio baja de",
  };

  return (
    <div className="space-y-6">
      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/20 p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {notifications.length} notificacion{notifications.length !== 1 ? "es" : ""} sin leer
            </h4>
            <button onClick={markAllRead} className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 underline">
              Marcar todas leidas
            </button>
          </div>
          <div className="space-y-2">
            {notifications.slice(0, 5).map((n) => (
              <div key={n.id} className="flex items-center justify-between text-sm bg-white dark:bg-zinc-900 rounded-lg px-3 py-2 border border-amber-100 dark:border-amber-800">
                <div>
                  <span className="font-medium text-navy-900 dark:text-white">{n.product_name}</span>
                  {n.provider_name && <span className="text-navy-400 ml-1">({n.provider_name})</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-navy-500">{Number(n.old_price).toFixed(2)}</span>
                  <span className="text-navy-400">&rarr;</span>
                  <span className={`font-bold ${n.direction === "up" ? "text-red-500" : "text-emerald-600"}`}>
                    {Number(n.new_price).toFixed(2)}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${n.direction === "up" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300"}`}>
                    {n.direction === "up" ? "+" : ""}{Number(n.change_pct).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create alert */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-navy-700 dark:text-zinc-300 uppercase tracking-wider">Mis alertas ({alerts.length})</h4>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm font-medium text-brand-green hover:text-brand-green-dark transition"
        >
          + Nueva alerta
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-navy-100 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1">Nombre del producto</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Ej: Cemento cola porcelanico..."
              className={INPUT_CLS}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1">Tipo de alerta</label>
              <select value={formType} onChange={(e) => setFormType(e.target.value)} className={INPUT_CLS}>
                <option value="any_change">Cualquier cambio</option>
                <option value="threshold_pct">Cambio mayor a %</option>
                <option value="price_above">Precio sube de</option>
                <option value="price_below">Precio baja de</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-600 dark:text-zinc-300 mb-1">
                {formType === "threshold_pct" ? "Umbral (%)" : formType.includes("price") ? "Precio limite (EUR)" : "Umbral"}
              </label>
              {formType === "threshold_pct" ? (
                <input type="number" min="0.1" step="0.5" value={formThreshold} onChange={(e) => setFormThreshold(parseFloat(e.target.value) || 5)} className={INPUT_CLS} />
              ) : formType.includes("price") ? (
                <input type="number" min="0" step="0.01" value={formThresholdPrice} onChange={(e) => setFormThresholdPrice(e.target.value ? parseFloat(e.target.value) : "")} placeholder="0.00" className={INPUT_CLS} />
              ) : (
                <input type="text" disabled value="N/A" className={INPUT_CLS + " opacity-50"} />
              )}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-navy-500 hover:text-navy-700 dark:text-zinc-400">
              Cancelar
            </button>
            <button onClick={createAlert} disabled={!formName.trim()} className="px-4 py-2 text-sm font-medium text-white bg-brand-green rounded-lg hover:bg-brand-green-dark disabled:opacity-50 transition">
              Crear alerta
            </button>
          </div>
        </div>
      )}

      {/* Alert list */}
      {loading ? (
        <div className="text-center text-navy-400 py-8">Cargando alertas...</div>
      ) : alerts.length === 0 ? (
        <div className="text-center text-navy-400 dark:text-zinc-500 py-8">
          <p className="text-lg font-medium mb-1">No tienes alertas configuradas</p>
          <p className="text-sm">Crea una alerta para recibir notificaciones cuando cambien los precios de tus materiales.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-xl border border-navy-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-navy-900 dark:text-white">{a.product_name}</p>
                <p className="text-xs text-navy-500 dark:text-zinc-400">
                  {alertTypeLabels[a.alert_type] || a.alert_type}
                  {a.alert_type === "threshold_pct" && ` (${a.threshold_pct}%)`}
                  {a.alert_type === "price_above" && a.threshold_price && ` ${Number(a.threshold_price).toFixed(2)} EUR`}
                  {a.alert_type === "price_below" && a.threshold_price && ` ${Number(a.threshold_price).toFixed(2)} EUR`}
                  {a.reference_price && ` | Ref: ${Number(a.reference_price).toFixed(2)} EUR`}
                </p>
              </div>
              <button
                onClick={() => deleteAlert(a.id)}
                className="text-xs text-red-400 hover:text-red-600 dark:text-red-500 px-2 py-1"
              >
                Eliminar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
