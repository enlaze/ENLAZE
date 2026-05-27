/**
 * technical-price-importer.ts
 *
 * Imports a ParsedBC3 result into the technical price bank tables:
 *   - technical_chapters
 *   - technical_price_items
 *   - technical_price_components
 *   - technical_import_logs
 *
 * Uses a Supabase admin client (service_role key) for writes.
 * Never touches price_items, sector_data, or supplier tables.
 * Never auto-detects source as "cype" — source is always explicit.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type ParsedBC3,
  type BC3Concept,
  classifyConcepts,
  inferComponentType,
} from "./bc3-parser";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ImportOptions {
  source: string; // "cype" | "ive" | "public_bc3" | "enlaze_base" | "manual"
  region: string; // "comunitat_valenciana" | "espana" | etc.
  edition: string; // "2026", "2025.1"
  fileName: string;
  overwrite: boolean;
  importedBy?: string; // user UUID if available
}

export interface ImportResult {
  ok: boolean;
  logId: string;
  chapters_created: number;
  chapters_updated: number;
  items_created: number;
  items_updated: number;
  components_created: number;
  items_skipped: number;
  errors: Array<{ code?: string; error: string }>;
  warnings: number;
}

interface ImportError {
  code?: string;
  error: string;
}

// ─── Confidence scores by source ────────────────────────────────────────────

const SOURCE_CONFIDENCE: Record<string, number> = {
  cype: 0.90,
  ive: 0.90,
  public_bc3: 0.80,
  enlaze_base: 0.50,
  manual: 0.60,
};

function getConfidence(source: string): number {
  return SOURCE_CONFIDENCE[source] ?? 0.60;
}

// ─── Main import function ───────────────────────────────────────────────────

/**
 * Import parsed BC3 data into the technical price bank.
 *
 * Flow:
 *   1. Create import log entry (status=running)
 *   2. Classify concepts into chapters, items, resources
 *   3. Upsert chapters (technical_chapters)
 *   4. Upsert items (technical_price_items)
 *   5. Insert components (technical_price_components)
 *   6. Update import log with results
 *
 * Uses service_role Supabase client — caller must provide it.
 */
export async function importBC3ToDatabase(
  supabase: SupabaseClient,
  parsed: ParsedBC3,
  options: ImportOptions
): Promise<ImportResult> {
  const errors: ImportError[] = [];
  let chapters_created = 0;
  let chapters_updated = 0;
  let items_created = 0;
  let items_updated = 0;
  let components_created = 0;
  let items_skipped = 0;

  // ── 1. Create import log ──
  const { data: logRow, error: logError } = await supabase
    .from("technical_import_logs")
    .insert({
      source: options.source,
      file_name: options.fileName,
      region: options.region,
      edition: options.edition,
      status: "running",
      imported_by: options.importedBy || null,
      metadata: {
        fiebdc_version: parsed.metadata.fiebdcVersion,
        generated_by: parsed.metadata.generatedBy,
        stats: parsed.stats,
        parser_warnings: parsed.warnings.length,
      },
    })
    .select("id")
    .single();

  if (logError || !logRow) {
    return {
      ok: false,
      logId: "",
      chapters_created: 0,
      chapters_updated: 0,
      items_created: 0,
      items_updated: 0,
      components_created: 0,
      items_skipped: 0,
      errors: [{ error: `Failed to create import log: ${logError?.message}` }],
      warnings: parsed.warnings.length,
    };
  }

  const logId = logRow.id;

  try {
    // ── 2. Classify concepts ──
    const classified = classifyConcepts(parsed);
    const conceptMap = new Map<string, BC3Concept>();
    for (const c of parsed.concepts) {
      conceptMap.set(c.code, c);
    }

    // ── 3. Upsert chapters ──
    // We need to insert in depth order so parent_id references work
    const chaptersByDepth = [...classified.chapterCodes].sort((a, b) => {
      const da = classified.chapterDepth.get(a) || 1;
      const db = classified.chapterDepth.get(b) || 1;
      return da - db;
    });

    // Map BC3 code → DB uuid for chapters
    const chapterIdMap = new Map<string, string>();

    for (const code of chaptersByDepth) {
      const concept = conceptMap.get(code);
      if (!concept) continue;

      const parentBC3Code = classified.chapterParent.get(code);
      const parentId =
        parentBC3Code && !classified.rootCodes.includes(parentBC3Code)
          ? chapterIdMap.get(parentBC3Code) || null
          : null;

      const depth = classified.chapterDepth.get(code) || 1;
      const sortOrder = chaptersByDepth.indexOf(code);

      const row = {
        code,
        name: concept.summary || code,
        description: "",
        parent_id: parentId,
        level: depth,
        sort_order: sortOrder,
        source: options.source,
        region: options.region,
        edition: options.edition,
      };

      if (options.overwrite) {
        const { data, error } = await supabase
          .from("technical_chapters")
          .upsert(row, { onConflict: "code,source,region" })
          .select("id")
          .single();

        if (error) {
          errors.push({ code, error: `Chapter upsert: ${error.message}` });
          continue;
        }
        chapterIdMap.set(code, data.id);
        // We can't easily tell if it was create vs update with upsert,
        // so we count all as created (conservative)
        chapters_created++;
      } else {
        // Insert only — skip existing
        const { data: existing } = await supabase
          .from("technical_chapters")
          .select("id")
          .eq("code", code)
          .eq("source", options.source)
          .eq("region", options.region)
          .maybeSingle();

        if (existing) {
          chapterIdMap.set(code, existing.id);
          chapters_updated++;
          continue;
        }

        const { data, error } = await supabase
          .from("technical_chapters")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          errors.push({ code, error: `Chapter insert: ${error.message}` });
          continue;
        }
        chapterIdMap.set(code, data.id);
        chapters_created++;
      }
    }

    // ── 4. Upsert items (partidas) ──
    // Find which chapter each item belongs to by walking up the decomposition tree
    const itemChapterMap = new Map<string, string>();
    for (const itemCode of classified.itemCodes) {
      // Walk up parent chain until we find a chapter
      const parents = classified.childParentMap.get(itemCode) || [];
      for (const parent of parents) {
        if (classified.chapterCodes.has(parent)) {
          itemChapterMap.set(itemCode, parent);
          break;
        }
        // Check if parent's parent is a chapter (one more level)
        const grandparents = classified.childParentMap.get(parent) || [];
        for (const gp of grandparents) {
          if (classified.chapterCodes.has(gp)) {
            itemChapterMap.set(itemCode, gp);
            break;
          }
        }
      }
    }

    // Also handle standalone items
    for (const itemCode of classified.standaloneCodes) {
      const parents = classified.childParentMap.get(itemCode) || [];
      for (const parent of parents) {
        if (classified.chapterCodes.has(parent)) {
          itemChapterMap.set(itemCode, parent);
          break;
        }
      }
    }

    const allItemCodes = [
      ...classified.itemCodes,
      ...classified.standaloneCodes,
    ];
    const itemIdMap = new Map<string, string>();
    const confidence = getConfidence(options.source);

    for (const itemCode of allItemCodes) {
      const concept = conceptMap.get(itemCode);
      if (!concept) continue;

      const chapterBC3Code = itemChapterMap.get(itemCode);
      const chapterId = chapterBC3Code
        ? chapterIdMap.get(chapterBC3Code)
        : null;

      if (!chapterId) {
        errors.push({
          code: itemCode,
          error: `No chapter found for item ${itemCode}`,
        });
        items_skipped++;
        continue;
      }

      // Get long text if available
      const longText =
        parsed.longTexts.find((lt) => lt.code === itemCode)?.text || "";

      // Pre-calculate cost breakdown from components if this item has decomposition
      let laborCost = 0;
      let materialCost = 0;
      let machineryCost = 0;
      let indirectCost = 0;

      const children =
        classified.parentChildMap.get(itemCode) || [];
      for (const child of children) {
        const childConcept = conceptMap.get(child.childCode);
        if (!childConcept) continue;
        const componentType = inferComponentType(childConcept);
        const cost = child.quantityPerUnit * childConcept.price;
        switch (componentType) {
          case "labor":
            laborCost += cost;
            break;
          case "material":
            materialCost += cost;
            break;
          case "machinery":
            machineryCost += cost;
            break;
          case "auxiliary":
            indirectCost += cost;
            break;
        }
      }

      // Use the declared price if available, otherwise sum of components
      const unitPrice =
        concept.price > 0
          ? concept.price
          : laborCost + materialCost + machineryCost + indirectCost;

      const row = {
        chapter_id: chapterId,
        item_code: itemCode,
        name: concept.summary || itemCode,
        description: "",
        long_text: longText,
        unit: concept.unit || "ud",
        unit_price: Math.round(unitPrice * 10000) / 10000,
        labor_cost: Math.round(laborCost * 10000) / 10000,
        material_cost: Math.round(materialCost * 10000) / 10000,
        machinery_cost: Math.round(machineryCost * 10000) / 10000,
        indirect_cost: Math.round(indirectCost * 10000) / 10000,
        quality_tier: "media",
        confidence_score: confidence,
        source: options.source,
        source_code: itemCode,
        region: options.region,
        edition: options.edition,
      };

      if (options.overwrite) {
        const { data, error } = await supabase
          .from("technical_price_items")
          .upsert(row, { onConflict: "item_code,source,region" })
          .select("id")
          .single();

        if (error) {
          errors.push({ code: itemCode, error: `Item upsert: ${error.message}` });
          items_skipped++;
          continue;
        }
        itemIdMap.set(itemCode, data.id);
        items_created++;
      } else {
        const { data: existing } = await supabase
          .from("technical_price_items")
          .select("id")
          .eq("item_code", itemCode)
          .eq("source", options.source)
          .eq("region", options.region)
          .maybeSingle();

        if (existing) {
          itemIdMap.set(itemCode, existing.id);
          items_updated++;
          continue;
        }

        const { data, error } = await supabase
          .from("technical_price_items")
          .insert(row)
          .select("id")
          .single();

        if (error) {
          errors.push({
            code: itemCode,
            error: `Item insert: ${error.message}`,
          });
          items_skipped++;
          continue;
        }
        itemIdMap.set(itemCode, data.id);
        items_created++;
      }
    }

    // ── 5. Insert components ──
    // For each item that has decomposition, insert its children as components
    for (const itemCode of classified.itemCodes) {
      const itemId = itemIdMap.get(itemCode);
      if (!itemId) continue;

      const children =
        classified.parentChildMap.get(itemCode) || [];

      // If overwriting, delete existing components first
      if (options.overwrite) {
        await supabase
          .from("technical_price_components")
          .delete()
          .eq("price_item_id", itemId);
      }

      for (let sortIdx = 0; sortIdx < children.length; sortIdx++) {
        const child = children[sortIdx];
        const childConcept = conceptMap.get(child.childCode);
        if (!childConcept) {
          errors.push({
            code: child.childCode,
            error: `Component concept not found for item ${itemCode}`,
          });
          continue;
        }

        const componentType = inferComponentType(childConcept);

        const componentRow = {
          price_item_id: itemId,
          component_type: componentType,
          code: child.childCode,
          name: childConcept.summary || child.childCode,
          description: "",
          unit: childConcept.unit || "ud",
          // DB column is "yield" — we use the object key directly
          yield: child.quantityPerUnit,
          unit_cost: childConcept.price,
          source: options.source,
          sort_order: sortIdx,
        };

        const { error } = await supabase
          .from("technical_price_components")
          .insert(componentRow);

        if (error) {
          errors.push({
            code: `${itemCode}/${child.childCode}`,
            error: `Component insert: ${error.message}`,
          });
        } else {
          components_created++;
        }
      }
    }

    // ── 6. Update import log ──
    const finalStatus =
      errors.length === 0
        ? "completed"
        : items_created > 0 || chapters_created > 0
          ? "partial"
          : "failed";

    await supabase
      .from("technical_import_logs")
      .update({
        chapters_created,
        chapters_updated,
        items_created,
        items_updated,
        components_created,
        items_skipped,
        errors: errors.length > 0 ? errors : [],
        status: finalStatus,
        finished_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return {
      ok: finalStatus !== "failed",
      logId,
      chapters_created,
      chapters_updated,
      items_created,
      items_updated,
      components_created,
      items_skipped,
      errors,
      warnings: parsed.warnings.length,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push({ error: `Import failed: ${msg}` });

    await supabase
      .from("technical_import_logs")
      .update({
        chapters_created,
        chapters_updated,
        items_created,
        items_updated,
        components_created,
        items_skipped,
        errors,
        status: "failed",
        finished_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return {
      ok: false,
      logId,
      chapters_created,
      chapters_updated,
      items_created,
      items_updated,
      components_created,
      items_skipped,
      errors,
      warnings: parsed.warnings.length,
    };
  }
}
