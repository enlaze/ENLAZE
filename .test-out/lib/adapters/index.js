"use strict";
/**
 * Price source adapters — barrel export.
 *
 * Import this module to register all adapters and access the registry.
 *
 * Usage:
 *   import { getAdapter, syncSource } from "@/lib/adapters";
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncSource = exports.BC3ImportAdapter = exports.TechnicalBankAdapter = exports.N8nWebhookAdapter = exports.listRegisteredAdapters = exports.hasAdapter = exports.getAdapter = exports.registerAdapter = exports.BasePriceAdapter = void 0;
// Base adapter + registry
var base_adapter_1 = require("./base-adapter");
Object.defineProperty(exports, "BasePriceAdapter", { enumerable: true, get: function () { return base_adapter_1.BasePriceAdapter; } });
Object.defineProperty(exports, "registerAdapter", { enumerable: true, get: function () { return base_adapter_1.registerAdapter; } });
Object.defineProperty(exports, "getAdapter", { enumerable: true, get: function () { return base_adapter_1.getAdapter; } });
Object.defineProperty(exports, "hasAdapter", { enumerable: true, get: function () { return base_adapter_1.hasAdapter; } });
Object.defineProperty(exports, "listRegisteredAdapters", { enumerable: true, get: function () { return base_adapter_1.listRegisteredAdapters; } });
// Concrete adapters (importing registers them)
var n8n_webhook_adapter_1 = require("./n8n-webhook-adapter");
Object.defineProperty(exports, "N8nWebhookAdapter", { enumerable: true, get: function () { return n8n_webhook_adapter_1.N8nWebhookAdapter; } });
var technical_bank_adapter_1 = require("./technical-bank-adapter");
Object.defineProperty(exports, "TechnicalBankAdapter", { enumerable: true, get: function () { return technical_bank_adapter_1.TechnicalBankAdapter; } });
var bc3_import_adapter_1 = require("./bc3-import-adapter");
Object.defineProperty(exports, "BC3ImportAdapter", { enumerable: true, get: function () { return bc3_import_adapter_1.BC3ImportAdapter; } });
// Sync pipeline
var sync_pipeline_1 = require("./sync-pipeline");
Object.defineProperty(exports, "syncSource", { enumerable: true, get: function () { return sync_pipeline_1.syncSource; } });
