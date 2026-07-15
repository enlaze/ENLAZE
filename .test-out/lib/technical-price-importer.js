"use strict";
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
 *
 * V2 enhancements:
 *   - Content-hash dedup: SHA-256 of (code + unit + price + source + region)
 *   - Merge strategies: overwrite | keep_existing | keep_newer | merge_components
 *   - Duplicate detection report before committing
 *   - Batch upserts for performance (chunks of 100)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.contentHash = contentHash;
exports.compareEditions = compareEditions;
exports.detectDuplicates = detectDuplicates;
exports.importBC3ToDatabase = importBC3ToDatabase;
const bc3_parser_1 = require("./bc3-parser");
const crypto_1 = require("crypto");
// ─── Content hashing for dedup ──────────────────────────────────────────────
/**
 * Generate a content hash for deduplication.
 * Two items with the same hash are semantically identical imports.
 */
function contentHash(parts) {
    const input = [
        parts.code.trim().toLowerCase(),
        parts.unit.trim().toLowerCase(),
        parts.price.toFixed(4),
        parts.source.trim().toLowerCase(),
        parts.region.trim().toLowerCase(),
    ].join("|");
    return (0, crypto_1.createHash)("sha256").update(input).digest("hex").slice(0, 16);
}
/**
 * Compare two edition strings. Returns >0 if a is newer, <0 if b is newer, 0 if equal.
 * Handles: "2026" > "2025", "2026.2" > "2026.1", "2025.Q4" > "2025.Q3"
 */
function compareEditions(a, b) {
    const partsA = a.split(/[.\-_]/);
    const partsB = b.split(/[.\-_]/);
    const len = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < len; i++) {
        const pa = partsA[i] || "0";
        const pb = partsB[i] || "0";
        // Try numeric comparison first
        const na = parseFloat(pa.replace(/[^0-9.]/g, "")) || 0;
        const nb = parseFloat(pb.replace(/[^0-9.]/g, "")) || 0;
        if (na !== nb)
            return na - nb;
        // Fall back to string comparison (handles Q1 < Q2 etc.)
        if (pa !== pb)
            return pa.localeCompare(pb);
    }
    return 0;
}
// ─── Confidence scores by source ────────────────────────────────────────────
const SOURCE_CONFIDENCE = {
    cype: 0.90,
    ive: 0.90,
    public_bc3: 0.80,
    enlaze_base: 0.50,
    manual: 0.60,
};
function getConfidence(source) {
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
/**
 * Detect duplicates between incoming BC3 items and existing DB records.
 * Returns a list of conflicts with price diff and recommended action.
 */
async function detectDuplicates(supabase, parsed, options) {
    const classified = (0, bc3_parser_1.classifyConcepts)(parsed);
    const conceptMap = new Map();
    for (const c of parsed.concepts) {
        conceptMap.set(c.code, c);
    }
    const allItemCodes = [...classified.itemCodes, ...classified.standaloneCodes];
    const duplicates = [];
    // Batch lookup: fetch all existing items for this source+region in one query
    const { data: existingItems } = await supabase
        .from("technical_price_items")
        .select("item_code, name, unit_price, edition")
        .eq("source", options.source)
        .eq("region", options.region)
        .in("item_code", allItemCodes.slice(0, 1000)); // Supabase .in() limit
    if (!existingItems)
        return duplicates;
    const existingMap = new Map(existingItems.map((e) => [e.item_code, e]));
    const strategy = options.mergeStrategy || (options.overwrite ? "overwrite" : "keep_existing");
    for (const itemCode of allItemCodes) {
        const existing = existingMap.get(itemCode);
        if (!existing)
            continue;
        const concept = conceptMap.get(itemCode);
        if (!concept)
            continue;
        const incomingPrice = concept.price;
        const existingPrice = existing.unit_price;
        const diff = existingPrice > 0
            ? ((incomingPrice - existingPrice) / existingPrice) * 100
            : incomingPrice > 0 ? 100 : 0;
        let action = "skip";
        if (strategy === "overwrite") {
            action = "overwrite";
        }
        else if (strategy === "keep_newer") {
            action = compareEditions(options.edition, existing.edition) > 0
                ? "overwrite"
                : "skip";
        }
        else if (strategy === "merge_components") {
            action = "merge";
        }
        duplicates.push({
            item_code: itemCode,
            item_name: concept.summary || itemCode,
            existing_edition: existing.edition,
            existing_price: existingPrice,
            incoming_price: incomingPrice,
            price_diff_pct: Math.round(diff * 100) / 100,
            action,
        });
    }
    return duplicates;
}
async function importBC3ToDatabase(supabase, parsed, options) {
    const errors = [];
    let chapters_created = 0;
    let chapters_updated = 0;
    let items_created = 0;
    let items_updated = 0;
    let components_created = 0;
    let items_skipped = 0;
    let duplicates_found = 0;
    const duplicates_resolved = [];
    const strategy = options.mergeStrategy || (options.overwrite ? "overwrite" : "keep_existing");
    // ── 0. Dry run: detect duplicates only ──
    if (options.dryRun) {
        const dupes = await detectDuplicates(supabase, parsed, options);
        return {
            ok: true,
            logId: "dry-run",
            chapters_created: 0,
            chapters_updated: 0,
            items_created: 0,
            items_updated: 0,
            components_created: 0,
            items_skipped: 0,
            duplicates_found: dupes.length,
            duplicates_resolved: dupes,
            errors: [],
            warnings: parsed.warnings.length,
        };
    }
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
            merge_strategy: strategy,
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
            duplicates_found: 0,
            duplicates_resolved: [],
            errors: [{ error: `Failed to create import log: ${logError?.message}` }],
            warnings: parsed.warnings.length,
        };
    }
    const logId = logRow.id;
    // Pre-fetch existing items for duplicate detection
    const dupeReport = await detectDuplicates(supabase, parsed, options);
    duplicates_found = dupeReport.length;
    const dupeActionMap = new Map(dupeReport.map((d) => [d.item_code, d]));
    try {
        // ── 2. Classify concepts ──
        const classified = (0, bc3_parser_1.classifyConcepts)(parsed);
        const conceptMap = new Map();
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
        const chapterIdMap = new Map();
        for (const code of chaptersByDepth) {
            const concept = conceptMap.get(code);
            if (!concept)
                continue;
            const parentBC3Code = classified.chapterParent.get(code);
            const parentId = parentBC3Code && !classified.rootCodes.includes(parentBC3Code)
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
            if (strategy === "overwrite" || strategy === "keep_newer") {
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
                chapters_created++;
            }
            else {
                // keep_existing or merge_components: insert only, skip existing
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
        const itemChapterMap = new Map();
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
        const itemIdMap = new Map();
        const confidence = getConfidence(options.source);
        for (const itemCode of allItemCodes) {
            const concept = conceptMap.get(itemCode);
            if (!concept)
                continue;
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
            const longText = parsed.longTexts.find((lt) => lt.code === itemCode)?.text || "";
            // Pre-calculate cost breakdown from components if this item has decomposition
            let laborCost = 0;
            let materialCost = 0;
            let machineryCost = 0;
            let indirectCost = 0;
            const children = classified.parentChildMap.get(itemCode) || [];
            for (const child of children) {
                const childConcept = conceptMap.get(child.childCode);
                if (!childConcept)
                    continue;
                const componentType = (0, bc3_parser_1.inferComponentType)(childConcept);
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
            const unitPrice = concept.price > 0
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
            // Check duplicate action map
            const dupeInfo = dupeActionMap.get(itemCode);
            if (dupeInfo) {
                // This item already exists in DB
                if (dupeInfo.action === "skip") {
                    // keep_existing: just get the existing ID
                    const { data: existing } = await supabase
                        .from("technical_price_items")
                        .select("id")
                        .eq("item_code", itemCode)
                        .eq("source", options.source)
                        .eq("region", options.region)
                        .maybeSingle();
                    if (existing) {
                        itemIdMap.set(itemCode, existing.id);
                    }
                    items_skipped++;
                    duplicates_resolved.push(dupeInfo);
                    continue;
                }
                if (dupeInfo.action === "overwrite") {
                    // Upsert: replace the existing record
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
                    items_updated++;
                    duplicates_resolved.push(dupeInfo);
                    continue;
                }
                if (dupeInfo.action === "merge") {
                    // merge_components: keep item data, will merge components in step 5
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
                    }
                    duplicates_resolved.push(dupeInfo);
                    continue;
                }
            }
            // No duplicate — fresh insert
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
        // ── 5. Insert components ──
        // For each item that has decomposition, insert its children as components
        for (const itemCode of classified.itemCodes) {
            const itemId = itemIdMap.get(itemCode);
            if (!itemId)
                continue;
            const children = classified.parentChildMap.get(itemCode) || [];
            const dupeInfo = dupeActionMap.get(itemCode);
            const shouldMerge = dupeInfo?.action === "merge";
            const shouldOverwrite = dupeInfo?.action === "overwrite" || strategy === "overwrite";
            // For merge strategy, fetch existing component codes to avoid duplicates
            let existingComponentCodes = new Set();
            if (shouldMerge) {
                const { data: existingComponents } = await supabase
                    .from("technical_price_components")
                    .select("code")
                    .eq("price_item_id", itemId);
                if (existingComponents) {
                    existingComponentCodes = new Set(existingComponents.map((c) => c.code));
                }
            }
            // If overwriting (not merging), delete existing components first
            if (shouldOverwrite && !shouldMerge) {
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
                // Skip if merge mode and component already exists
                if (shouldMerge && existingComponentCodes.has(child.childCode)) {
                    continue;
                }
                const componentType = (0, bc3_parser_1.inferComponentType)(childConcept);
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
                }
                else {
                    components_created++;
                }
            }
        }
        // ── 6. Update import log ──
        const finalStatus = errors.length === 0
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
            metadata: {
                fiebdc_version: parsed.metadata.fiebdcVersion,
                generated_by: parsed.metadata.generatedBy,
                stats: parsed.stats,
                parser_warnings: parsed.warnings.length,
                merge_strategy: strategy,
                duplicates_found,
                duplicates_resolved: duplicates_resolved.length,
            },
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
            duplicates_found,
            duplicates_resolved,
            errors,
            warnings: parsed.warnings.length,
        };
    }
    catch (err) {
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
            duplicates_found,
            duplicates_resolved,
            errors,
            warnings: parsed.warnings.length,
        };
    }
}
