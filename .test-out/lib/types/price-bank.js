"use strict";
/**
 * price-bank.ts
 *
 * Types for the Price Bank V2 system.
 * Maps directly to Supabase tables: pb_providers, pb_products,
 * pb_normalized_concepts, pb_price_sources, pb_price_observations,
 * pb_price_current, pb_sync_runs, pb_sync_run_details.
 *
 * Conventions:
 *   - All amounts in EUR, excl. VAT unless suffixed _incl_vat
 *   - Percentages as decimals (21 = 21%)
 *   - Dates as ISO 8601 strings
 *   - Confidence as 0.00-1.00
 *   - company_id: null = global Enlaze, string = private to that company
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRIORITY_ORDER = void 0;
exports.DEFAULT_PRIORITY_ORDER = [
    "manual_locked",
    "private_tariff",
    "negotiated",
    "historical_approved",
    "preferred_supplier",
    "provider_updated",
    "private_bc3",
    "technical_bank",
    "enlaze_base",
    "market_estimate",
    "ai_estimate",
];
