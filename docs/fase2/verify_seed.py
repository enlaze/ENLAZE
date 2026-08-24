#!/usr/bin/env python3
"""
Validación local del seed de Fase 2. NO toca Supabase.

Parsea 20260824120500_canonical_seed_paint_waste.sql con la gramática real de
PostgreSQL (pglast / libpg_query) y comprueba, contra el archivo en disco, las mismas
invariantes que la base de datos impondría al aplicarlo.

La gracia de hacerlo así es que un fallo se ve ANTES de escribir nada, y sin depender
de que la base de datos esté disponible.
"""

import re
import sys
import unicodedata
from pathlib import Path

from pglast import parse_sql
from pglast.stream import RawStream

SEED = Path(__file__).resolve().parents[2] / "supabase" / "migrations" / \
    "20260824120500_canonical_seed_paint_waste.sql"

# Los 20 dominios ya presentes en canonical_domains (migración 1).
DOMINIOS = {
    "CEILING", "CLADDING", "CLEANING", "DEMO", "ELECTRIC", "FLOORING", "HVAC",
    "JOINERY_EXT", "JOINERY_INT", "KITCHEN", "MASONRY", "OTHER", "PAINT",
    "PLUMBING", "PROTECT", "SAFETY", "SANITARY", "SKIRTING", "WASTE", "WATERPROOF",
}

GRAMATICA = re.compile(r"^(WORK|MAT|SRV)(\.[A-Z0-9][A-Z0-9_]*){3,4}$")
PRICE_TYPES = {"LABOR_ONLY", "MATERIAL_ONLY", "LABOR_AND_MATERIAL", "SERVICE"}
RELATION_TYPES = {"includes", "provides", "variant_of"}
SOURCE_REF_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

fallos: list[str] = []
avisos: list[str] = []


def falla(msg: str) -> None:
    fallos.append(msg)


def canonical_normalize(txt: str) -> str:
    """Réplica exacta de public.canonical_normalize(text).

    translate() de acentos -> lower() -> [^a-z0-9]+ a espacio -> colapsar -> btrim.
    """
    origen = "áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ"
    destino = "aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC"
    tabla = str.maketrans(origen, destino)
    s = txt.translate(tabla).lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


# ── Extracción ────────────────────────────────────────────────────────────────

def literal(node):
    """Devuelve el valor Python de un nodo de constante o expresión simple."""
    cls = node.__class__.__name__
    if cls == "A_Const":
        if getattr(node, "isnull", False):
            return None
        val = node.val
        vcls = val.__class__.__name__
        if vcls == "String":
            return val.sval
        if vcls == "Integer":
            return val.ival
        if vcls == "Float":
            return float(val.fval)
        if vcls == "Boolean":
            return val.boolval
        return None
    if cls == "TypeCast":
        return literal(node.arg)
    if cls == "A_ArrayExpr":
        return [literal(e) for e in (node.elements or ())]
    # Cualquier otra cosa (funciones, operadores) se devuelve como SQL crudo: si
    # aparece donde esperamos un literal, es en sí mismo un hallazgo.
    return RawStream()(node)


def extraer_inserts(sql: str):
    """Devuelve [(tabla, [columnas], [[valores]])] en orden de aparición."""
    salida = []
    for raw in parse_sql(sql):
        stmt = raw.stmt
        if stmt.__class__.__name__ != "InsertStmt":
            continue
        tabla = stmt.relation.relname
        cols = [c.name for c in (stmt.cols or ())]
        sel = stmt.selectStmt
        filas = []
        for fila in (sel.valuesLists or ()):
            filas.append([literal(n) for n in fila])
        salida.append((tabla, cols, filas))
    return salida


def como_dicts(cols, filas):
    return [dict(zip(cols, f)) for f in filas]


# ── Programa ──────────────────────────────────────────────────────────────────

def main() -> int:
    if not SEED.exists():
        print(f"No encuentro el seed en {SEED}")
        return 2

    sql = SEED.read_text(encoding="utf-8")
    bloques = extraer_inserts(sql)

    conceptos, alias, relaciones = [], [], []
    for tabla, cols, filas in bloques:
        d = como_dicts(cols, filas)
        if tabla == "canonical_concepts":
            conceptos += d
        elif tabla == "canonical_aliases":
            alias += d
        elif tabla == "canonical_concept_relations":
            relaciones += d
        else:
            falla(f"INSERT inesperado sobre la tabla {tabla}")

    print("=" * 78)
    print("VALIDACIÓN LOCAL DEL SEED · sin Supabase")
    print(f"Archivo: {SEED.name}")
    print("=" * 78)

    # 1 · Recuentos ------------------------------------------------------------
    print(f"\n[1] Recuentos")
    for etiqueta, real, esperado in (
        ("conceptos", len(conceptos), 20),
        ("alias", len(alias), 37),
        ("relaciones", len(relaciones), 12),
    ):
        ok = real == esperado
        print(f"    {etiqueta:12} {real:3}  (esperado {esperado})  {'OK' if ok else 'FALLO'}")
        if not ok:
            falla(f"{etiqueta}: {real} != {esperado}")

    ids = [c["canonical_id"] for c in conceptos]
    conjunto_ids = set(ids)

    # 2 · Gramática y unicidad de canonical_id ---------------------------------
    print(f"\n[2] Gramática e identidad de los canonical_id")
    malos = [i for i in ids if not GRAMATICA.match(i)]
    print(f"    gramática congelada        {'OK' if not malos else 'FALLO ' + str(malos)}")
    if malos:
        falla(f"canonical_id fuera de gramática: {malos}")

    dups = sorted({i for i in ids if ids.count(i) > 1})
    print(f"    sin duplicados             {'OK' if not dups else 'FALLO ' + str(dups)}")
    if dups:
        falla(f"canonical_id duplicados: {dups}")

    # ck_canonical_parts: el id debe reconstruirse desde sus partes.
    rotos = []
    for c in conceptos:
        esperado = ".".join([c["kind"], c["domain"], c["family"], c["concept"]])
        if c.get("variant") is not None:
            esperado += "." + c["variant"]
        if esperado != c["canonical_id"]:
            rotos.append((c["canonical_id"], esperado))
    print(f"    ck_canonical_parts         {'OK' if not rotos else 'FALLO ' + str(rotos)}")
    if rotos:
        falla(f"canonical_id no reconstruible desde sus partes: {rotos}")

    # 3 · Dominios y ámbitos económicos ----------------------------------------
    print(f"\n[3] Dominios y ámbitos económicos")
    fuera = sorted({c["domain"] for c in conceptos if c["domain"] not in DOMINIOS})
    print(f"    dominios existentes        {'OK' if not fuera else 'FALLO ' + str(fuera)}")
    if fuera:
        falla(f"dominios inexistentes: {fuera}")

    pt_malos = [c["canonical_id"] for c in conceptos
                if c["default_price_type"] not in (c["allowed_price_types"] or [])]
    print(f"    default en allowed         {'OK' if not pt_malos else 'FALLO ' + str(pt_malos)}")
    if pt_malos:
        falla(f"default_price_type fuera de allowed_price_types: {pt_malos}")

    vocab = [c["canonical_id"] for c in conceptos
             if c["default_price_type"] not in PRICE_TYPES
             or any(p not in PRICE_TYPES for p in (c["allowed_price_types"] or []))]
    print(f"    vocabulario de price_type  {'OK' if not vocab else 'FALLO ' + str(vocab)}")
    if vocab:
        falla(f"price_type fuera de vocabulario: {vocab}")

    kind_malos = [c["canonical_id"] for c in conceptos if c["kind"] not in ("WORK", "MAT", "SRV")]
    if kind_malos:
        falla(f"kind fuera de vocabulario: {kind_malos}")

    # 4 · Alias: procedencia, ámbito y confianza -------------------------------
    print(f"\n[4] Alias")
    por_source = {}
    for a in alias:
        clave = (a["source"], a["alias_kind"])
        por_source[clave] = por_source.get(clave, 0) + 1
    for clave in sorted(por_source):
        print(f"    {clave[0]:8} {clave[1]:8} {por_source[clave]:3}")

    huerfanos = sorted({a["canonical_id"] for a in alias if a["canonical_id"] not in conjunto_ids})
    print(f"    canonical_id existente     {'OK' if not huerfanos else 'FALLO ' + str(huerfanos)}")
    if huerfanos:
        falla(f"alias hacia conceptos que el seed no crea: {huerfanos}")

    con_ref = [a["alias_value"] for a in alias
               if a["source"] in ("engine", "curated") and a["source_ref"] is not None]
    print(f"    engine/curated ref NULL    {'OK' if not con_ref else 'FALLO ' + str(con_ref)}")
    if con_ref:
        falla(f"engine/curated con source_ref: {con_ref}")

    con_cmp = [a["alias_value"] for a in alias if a["company_id"] is not None]
    print(f"    company_id NULL            {'OK' if not con_cmp else 'FALLO ' + str(con_cmp)}")
    if con_cmp:
        falla(f"alias del seed con company_id: {con_cmp}")

    src_malos = sorted({a["source"] for a in alias
                        if a["source"] not in ("manual", "curated", "engine", "import", "provider")})
    if src_malos:
        falla(f"source fuera de vocabulario: {src_malos}")

    kind_alias = sorted({a["alias_kind"] for a in alias
                         if a["alias_kind"] not in ("exact", "synonym")})
    if kind_alias:
        falla(f"alias_kind fuera de vocabulario: {kind_alias}")

    ex_malos = [(a["alias_value"], a["confidence"]) for a in alias
                if a["alias_kind"] == "exact" and float(a["confidence"]) != 1.00]
    print(f"    exact confidence = 1.00    {'OK' if not ex_malos else 'FALLO ' + str(ex_malos)}")
    if ex_malos:
        falla(f"exact con confidence != 1.00: {ex_malos}")

    sy_malos = [(a["alias_value"], a["confidence"]) for a in alias
                if a["alias_kind"] == "synonym"
                and not (0.50 <= float(a["confidence"]) < 0.85)]
    print(f"    synonym en [0.50, 0.85)    {'OK' if not sy_malos else 'FALLO ' + str(sy_malos)}")
    if sy_malos:
        falla(f"synonym fuera de banda: {sy_malos}")

    vacios = [a["canonical_id"] for a in alias if not a["alias_value"].strip()]
    if vacios:
        falla(f"alias_value en blanco: {vacios}")

    # 5 · Índices únicos, con la misma semántica que la base de datos ----------
    #     uq_alias_exact   -> (company_id, source, source_ref, alias_norm)          NULLS NOT DISTINCT
    #     uq_alias_synonym -> (company_id, source, source_ref, alias_norm, canonical_id)
    print(f"\n[5] Índices únicos (NULLS NOT DISTINCT)")
    vistos_ex, choques_ex = {}, []
    for a in alias:
        if a["alias_kind"] != "exact":
            continue
        clave = (a["company_id"], a["source"], a["source_ref"],
                 canonical_normalize(a["alias_value"]))
        if clave in vistos_ex:
            choques_ex.append((clave[3], vistos_ex[clave], a["canonical_id"]))
        vistos_ex[clave] = a["canonical_id"]
    print(f"    uq_alias_exact             {'OK' if not choques_ex else 'FALLO'}")
    for ch in choques_ex:
        print(f"        colisión '{ch[0]}' entre {ch[1]} y {ch[2]}")
        falla(f"uq_alias_exact: '{ch[0]}' colisiona entre {ch[1]} y {ch[2]}")

    vistos_sy, choques_sy = set(), []
    for a in alias:
        if a["alias_kind"] != "synonym":
            continue
        clave = (a["company_id"], a["source"], a["source_ref"],
                 canonical_normalize(a["alias_value"]), a["canonical_id"])
        if clave in vistos_sy:
            choques_sy.append(clave)
        vistos_sy.add(clave)
    print(f"    uq_alias_synonym           {'OK' if not choques_sy else 'FALLO'}")
    for ch in choques_sy:
        falla(f"uq_alias_synonym duplicado: '{ch[3]}' -> {ch[4]}")

    # 6 · Relaciones -----------------------------------------------------------
    print(f"\n[6] Relaciones")
    rt_malos = sorted({r["relation_type"] for r in relaciones
                       if r["relation_type"] not in RELATION_TYPES})
    print(f"    relation_type cerrado      {'OK' if not rt_malos else 'FALLO ' + str(rt_malos)}")
    if rt_malos:
        falla(f"relation_type fuera de vocabulario: {rt_malos}")

    ref_malos = [(r["from_canonical"], r["to_canonical"]) for r in relaciones
                 if r["from_canonical"] not in conjunto_ids
                 or r["to_canonical"] not in conjunto_ids]
    print(f"    ambos extremos existen     {'OK' if not ref_malos else 'FALLO ' + str(ref_malos)}")
    if ref_malos:
        falla(f"relaciones hacia conceptos inexistentes: {ref_malos}")

    self_rel = [r["from_canonical"] for r in relaciones
                if r["from_canonical"] == r["to_canonical"]]
    print(f"    sin autorrelaciones        {'OK' if not self_rel else 'FALLO ' + str(self_rel)}")
    if self_rel:
        falla(f"autorrelaciones: {self_rel}")

    triples = [(r["from_canonical"], r["to_canonical"], r["relation_type"]) for r in relaciones]
    rdups = sorted({t for t in triples if triples.count(t) > 1})
    print(f"    sin duplicados             {'OK' if not rdups else 'FALLO ' + str(rdups)}")
    if rdups:
        falla(f"relaciones duplicadas: {rdups}")

    # Ciclos de variant_of: no los prohíbe ninguna restricción, pero un ciclo haría
    # que "¿cuál es el concepto base?" no tuviera respuesta.
    padres = {r["from_canonical"]: r["to_canonical"]
              for r in relaciones if r["relation_type"] == "variant_of"}
    for inicio in padres:
        visto, actual = set(), inicio
        while actual in padres:
            if actual in visto:
                avisos.append(f"ciclo variant_of que incluye {inicio}")
                falla(f"ciclo variant_of: {inicio}")
                break
            visto.add(actual)
            actual = padres[actual]

    # 7 · Cobertura ------------------------------------------------------------
    print(f"\n[7] Cobertura")
    con_alias = {a["canonical_id"] for a in alias}
    sin_alias = sorted(conjunto_ids - con_alias)
    print(f"    conceptos con al menos 1 alias  {len(con_alias)}/20")
    if sin_alias:
        for i in sin_alias:
            print(f"        SIN ALIAS: {i}")
            avisos.append(f"{i} no tiene ningún alias: será inalcanzable para el resolver")

    con_engine = {a["canonical_id"] for a in alias if a["source"] == "engine"}
    sin_engine = sorted(conjunto_ids - con_engine)
    print(f"    conceptos con alias engine      {len(con_engine)}/20")
    for i in sin_engine:
        print(f"        sin engine: {i}")

    # 8 · Ambigüedades ---------------------------------------------------------
    print(f"\n[8] Ambigüedades deliberadas (mismo alias_norm -> varios conceptos)")
    por_norm = {}
    for a in alias:
        n = canonical_normalize(a["alias_value"])
        por_norm.setdefault(n, []).append(a)
    hay = False
    for n, grupo in sorted(por_norm.items()):
        destinos = {g["canonical_id"] for g in grupo}
        if len(destinos) > 1:
            hay = True
            print(f"    '{n}'")
            for g in grupo:
                print(f"        -> {g['canonical_id']:36} {g['alias_kind']:8} "
                      f"{g['source']:8} conf={g['confidence']}")
            if any(g["alias_kind"] == "exact" for g in grupo):
                falla(f"ambigüedad sobre un alias EXACT: '{n}' -> {sorted(destinos)}")
    if not hay:
        print("    (ninguna)")

    # ── Veredicto ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    if fallos:
        print(f"RESULTADO: {len(fallos)} FALLO(S)")
        for f in fallos:
            print(f"  · {f}")
    else:
        print("RESULTADO: todas las invariantes se cumplen.")
    if avisos:
        print(f"\nAvisos ({len(avisos)}):")
        for a in avisos:
            print(f"  · {a}")
    print("=" * 78)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main())
