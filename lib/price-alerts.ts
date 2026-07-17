/**
 * price-alerts.ts
 *
 * Generates and stores alerts when price changes exceed thresholds.
 * Designed to integrate with the existing notification system.
 *
 * Alert types:
 *   - price_increase:  product price went up > threshold
 *   - price_decrease:  product price went down > threshold (opportunity)
 *   - became_unavailable: product no longer available
 *   - became_available: previously unavailable product is back
 *   - stale_warning: price hasn't been checked in > X days
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PriceChange } from "./price-sync-v2";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertType =
  | "price_increase"
  | "price_decrease"
  | "became_unavailable"
  | "became_available"
  | "stale_warning";

export type AlertSeverity = "info" | "warning" | "critical";

export interface PriceAlert {
  type: AlertType;
  severity: AlertSeverity;
  product_id: string;
  product_name: string;
  provider_id: string;
  provider_name: string;
  message: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface AlertConfig {
  /** Threshold % for warning severity */
  warning_threshold_pct: number;
  /** Threshold % for critical severity */
  critical_threshold_pct: number;
  /** Days without check before stale warning */
  stale_warning_days: number;
}

export const DEFAULT_ALERT_CONFIG: AlertConfig = {
  warning_threshold_pct: 5,
  critical_threshold_pct: 15,
  stale_warning_days: 14,
};

// ─── Generate alerts from price changes ──────────────────────────────────────

/**
 * Transform price changes from a sync run into structured alerts.
 * Pure function — no DB access.
 */
export function generateAlertsFromChanges(
  changes: PriceChange[],
  config: Partial<AlertConfig> = {}
): PriceAlert[] {
  const cfg = { ...DEFAULT_ALERT_CONFIG, ...config };
  const alerts: PriceAlert[] = [];
  const now = new Date().toISOString();

  for (const change of changes) {
    const absPct = Math.abs(change.change_pct);

    const severity: AlertSeverity =
      absPct >= cfg.critical_threshold_pct ? "critical"
      : absPct >= cfg.warning_threshold_pct ? "warning"
      : "info";

    const type: AlertType = change.direction === "up" ? "price_increase" : "price_decrease";

    const dirLabel = change.direction === "up" ? "subido" : "bajado";
    const message = `${change.product_name} (${change.provider_name}): precio ha ${dirLabel} ${absPct.toFixed(1)}% — de ${change.old_price.toFixed(2)}€ a ${change.new_price.toFixed(2)}€`;

    alerts.push({
      type,
      severity,
      product_id: change.product_id,
      product_name: change.product_name,
      provider_id: change.provider_id,
      provider_name: change.provider_name,
      message,
      details: {
        old_price: change.old_price,
        new_price: change.new_price,
        change_pct: change.change_pct,
        direction: change.direction,
      },
      created_at: now,
    });
  }

  return alerts;
}

// ─── Store alerts in notifications table ─────────────────────────────────────

/**
 * Persist alerts into the notifications table so they appear in the
 * user's notification center. Uses the existing notification system.
 */
export async function storeAlerts(
  supabase: SupabaseClient,
  alerts: PriceAlert[],
  userId: string
): Promise<{ stored: number; errors: string[] }> {
  const errors: string[] = [];
  let stored = 0;

  if (alerts.length === 0) return { stored, errors };

  // Map alerts to notification rows
  const notifications = alerts.map((alert) => ({
    user_id: userId,
    type: "price_alert",
    title: alertTitle(alert),
    message: alert.message,
    severity: alert.severity,
    metadata: {
      alert_type: alert.type,
      product_id: alert.product_id,
      provider_id: alert.provider_id,
      ...alert.details,
    },
    is_read: false,
    created_at: alert.created_at,
  }));

  // Insert in batches
  const BATCH = 50;
  for (let i = 0; i < notifications.length; i += BATCH) {
    const batch = notifications.slice(i, i + BATCH);
    const { error } = await supabase
      .from("notifications")
      .insert(batch);

    if (error) {
      errors.push(`Batch ${i}: ${error.message}`);
    } else {
      stored += batch.length;
    }
  }

  return { stored, errors };
}

// ─── Generate stale warnings ─────────────────────────────────────────────────

/**
 * Check pb_price_current for products that haven't been checked
 * in more than stale_warning_days and generate alerts.
 */
export async function generateStaleAlerts(
  supabase: SupabaseClient,
  config: Partial<AlertConfig> = {}
): Promise<PriceAlert[]> {
  const cfg = { ...DEFAULT_ALERT_CONFIG, ...config };
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - cfg.stale_warning_days);

  const { data: staleProducts } = await supabase
    .from("pb_price_current")
    .select(`
      product_id, checked_at,
      pb_products!inner ( commercial_name, provider_id ),
      pb_providers!inner ( name )
    `)
    .eq("is_available", true)
    .lt("checked_at", cutoff.toISOString())
    .limit(100);

  if (!staleProducts || staleProducts.length === 0) return [];

  const now = new Date().toISOString();

  return staleProducts.map((row): PriceAlert => {
    const prodRaw = row.pb_products as unknown;
    const prod = Array.isArray(prodRaw) ? prodRaw[0] as Record<string, unknown> | undefined : prodRaw as Record<string, unknown> | null;
    const provRaw = row.pb_providers as unknown;
    const prov = Array.isArray(provRaw) ? provRaw[0] as Record<string, unknown> | undefined : provRaw as Record<string, unknown> | null;
    const daysSince = Math.floor(
      (Date.now() - new Date(String(row.checked_at)).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      type: "stale_warning",
      severity: daysSince > cfg.stale_warning_days * 2 ? "warning" : "info",
      product_id: row.product_id,
      product_name: String(prod?.commercial_name ?? ""),
      provider_id: String(prod?.provider_id ?? ""),
      provider_name: String(prov?.name ?? ""),
      message: `${prod?.commercial_name}: precio no verificado en ${daysSince} días`,
      details: { checked_at: row.checked_at, days_since: daysSince },
      created_at: now,
    };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function alertTitle(alert: PriceAlert): string {
  switch (alert.type) {
    case "price_increase":
      return "Subida de precio";
    case "price_decrease":
      return "Bajada de precio";
    case "became_unavailable":
      return "Producto no disponible";
    case "became_available":
      return "Producto disponible de nuevo";
    case "stale_warning":
      return "Precio sin verificar";
  }
}
