"use strict";
/**
 * budget-v2.ts
 *
 * Tipos e interfaces para el generador de presupuestos v2.
 * Sistema de 6 fases: Analisis -> Generacion -> Precios -> Economia -> Planificacion -> Validacion
 *
 * Convenciones:
 *   - Todos los importes en EUR, 2 decimales
 *   - Porcentajes como numeros enteros (25 = 25%)
 *   - Fechas como ISO 8601 strings
 *   - Confianza como 0.00-1.00
 */
Object.defineProperty(exports, "__esModule", { value: true });
