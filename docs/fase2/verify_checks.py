#!/usr/bin/env python3
"""
Fase 2 - Verificacion de los CHECK compuestos SIN tocar la base de datos.

Modela la logica trivaluada de PostgreSQL (true / false / NULL) y la regla que hace
peligrosos los CHECK escritos con OR:

    UN CHECK QUE EVALUA A NULL SE CONSIDERA SATISFECHO.

Se comprueban:
  1. ck_origin_source_ref, en la forma CASE que va en la migracion, contra los 8 casos
     exigidos y contra el producto cartesiano completo (6 origenes x 3 source_ref).
  2. La forma OR que se propuso originalmente, para dejar por escrito exactamente que
     fila deja pasar y por que hubo que cambiarla.
  3. ck_canonical_coherence, contra su matriz de estados.

Uso:  python3 docs/fase2/verify_checks.py
Salida: tabla de resultados y codigo de salida 0 si todo cuadra.
"""

from itertools import product

NULL = None


# ---------------------------------------------------------------------------------
# Logica trivaluada de SQL
# ---------------------------------------------------------------------------------
def sql_in(value, allowed):
    """value IN (...) -> NULL si value es NULL."""
    if value is NULL:
        return NULL
    return value in allowed


def sql_or(*terms):
    """OR: true gana sobre NULL; NULL gana sobre false."""
    if any(t is True for t in terms):
        return True
    if any(t is NULL for t in terms):
        return NULL
    return False


def sql_and(*terms):
    if any(t is False for t in terms):
        return False
    if any(t is NULL for t in terms):
        return NULL
    return True


def check_passes(result):
    """La regla de PostgreSQL: NULL cuenta como satisfecho."""
    return result is not False


# ---------------------------------------------------------------------------------
# 1. ck_origin_source_ref -- forma CASE (la que va en la migracion)
# ---------------------------------------------------------------------------------
def ck_origin_source_ref_case(origin, ref):
    if origin in ("import", "provider"):
        return ref is not NULL
    if origin in ("engine", "free_text", "legacy"):
        return ref is NULL
    if origin is NULL:
        return ref is NULL
    return False  # ELSE false


# ---------------------------------------------------------------------------------
# 2. ck_origin_source_ref -- forma OR (la propuesta original)
# ---------------------------------------------------------------------------------
def ck_origin_source_ref_or(origin, ref):
    return sql_or(
        sql_and(sql_in(origin, ("import", "provider")), ref is not NULL),
        sql_and(sql_in(origin, ("engine", "free_text", "legacy")), ref is NULL),
        sql_and(origin is NULL, ref is NULL),
    )


# ---------------------------------------------------------------------------------
# 3. ck_canonical_coherence -- forma CASE
# ---------------------------------------------------------------------------------
EXACTAS = ("override", "generator", "exact_manual", "exact_curated",
           "exact_engine", "exact_import", "exact_provider")
DIFUSAS = ("synonym", "fingerprint")


def ck_canonical_coherence_case(status, cid, conf, source):
    if status == "unmatched":
        return cid is NULL and conf is NULL and source is NULL
    if status == "resolved":
        return (cid is not NULL and conf is not NULL and conf == 1.00
                and source is not NULL and source in EXACTAS)
    if status == "review":
        return (cid is not NULL and conf is not NULL
                and 0.50 <= conf < 0.85
                and source is not NULL and source in DIFUSAS)
    if status == "ambiguous":
        return (cid is NULL and conf is NULL
                and source is not NULL and source in (DIFUSAS + EXACTAS[2:]))
    return False  # ELSE false  (cubre tambien status NULL, imposible por NOT NULL)


# =================================================================================
# Pruebas
# =================================================================================
fallos = []


def linea(*cols, ancho=(4, 11, 10, 12, 12, 8)):
    print("  ".join(str(c).ljust(w) for c, w in zip(cols, ancho)))


print("=" * 78)
print("1. ck_origin_source_ref -- LOS 8 CASOS EXIGIDOS (forma CASE, la de la migracion)")
print("=" * 78)
linea("N", "origin", "source_ref", "esperado", "obtenido", "veredicto")
print("-" * 78)

CASOS_8 = [
    (1, "import",    "cype",    "VALIDO"),
    (2, "provider",  "obramat", "VALIDO"),
    (3, "import",    NULL,      "RECHAZADO"),
    (4, "provider",  NULL,      "RECHAZADO"),
    (5, "engine",    "cype",    "RECHAZADO"),
    (6, "free_text", "obramat", "RECHAZADO"),
    (7, "legacy",    "cype",    "RECHAZADO"),
    (8, NULL,        NULL,      "VALIDO"),
]

for n, origin, ref, esperado in CASOS_8:
    obtenido = "VALIDO" if check_passes(ck_origin_source_ref_case(origin, ref)) else "RECHAZADO"
    ok = obtenido == esperado
    if not ok:
        fallos.append(f"caso {n} de ck_origin_source_ref")
    linea(n, origin or "NULL", ref or "NULL", esperado, obtenido, "OK" if ok else "FALLO")

print()
print("=" * 78)
print("2. ck_origin_source_ref -- PRODUCTO CARTESIANO COMPLETO (6 origenes x 3 refs)")
print("   Solo se listan las combinaciones ACEPTADAS. Cualquier otra queda rechazada.")
print("=" * 78)

ORIGENES = ["engine", "import", "provider", "free_text", "legacy", NULL]
REFS = ["cype", "obramat", NULL]

aceptadas = []
for origin, ref in product(ORIGENES, REFS):
    if check_passes(ck_origin_source_ref_case(origin, ref)):
        aceptadas.append((origin or "NULL", ref or "NULL"))

for o, r in aceptadas:
    print(f"   ACEPTA  origin={o:<10} source_ref={r}")

ESPERADAS = {
    ("import", "cype"), ("import", "obramat"),
    ("provider", "cype"), ("provider", "obramat"),
    ("engine", "NULL"), ("free_text", "NULL"), ("legacy", "NULL"),
    ("NULL", "NULL"),
}
if set(aceptadas) != ESPERADAS:
    fallos.append("el conjunto de combinaciones aceptadas no es el esperado")
    print(f"   FALLO: sobran {set(aceptadas) - ESPERADAS}, faltan {ESPERADAS - set(aceptadas)}")
else:
    print(f"\n   OK: exactamente {len(ESPERADAS)} combinaciones aceptadas, las previstas.")

print()
print("=" * 78)
print("3. POR QUE LA FORMA 'OR' NO SIRVE")
print("   Se evalua la misma restriccion escrita con OR encadenados y se busca alguna")
print("   fila que la forma OR acepte y la forma CASE rechace.")
print("=" * 78)

divergencias = []
for origin, ref in product(ORIGENES, REFS):
    con_or = check_passes(ck_origin_source_ref_or(origin, ref))
    con_case = check_passes(ck_origin_source_ref_case(origin, ref))
    if con_or != con_case:
        divergencias.append((origin or "NULL", ref or "NULL", con_or, con_case))

if divergencias:
    for o, r, a, b in divergencias:
        print(f"   origin={o:<10} source_ref={r:<10} OR->{'ACEPTA' if a else 'RECHAZA'}"
              f"   CASE->{'ACEPTA' if b else 'RECHAZA'}")
    print("\n   Motivo: con origin NULL las tres ramas del OR evaluan a NULL o false, el")
    print("   OR global da NULL, y PostgreSQL considera SATISFECHO un CHECK que da NULL.")
    print("   Por eso la migracion usa CASE ... ELSE false. Estas divergencias son la")
    print("   JUSTIFICACION del cambio, no un fallo.")
else:
    fallos.append("no se reproduce la divergencia OR/CASE: revisar el modelo")
    print("   INESPERADO: no hay divergencia. Revisar el modelo de logica trivaluada.")

print()
print("=" * 78)
print("4. ck_canonical_coherence -- MATRIZ DE ESTADOS")
print("=" * 78)

CASOS_COHERENCIA = [
    # (status, canonical_id, confidence, source, esperado)
    ("unmatched", NULL,   NULL, NULL,            "VALIDO"),
    ("unmatched", "X",    NULL, NULL,            "RECHAZADO"),
    ("unmatched", NULL,   1.00, NULL,            "RECHAZADO"),
    ("resolved",  "X",    1.00, "exact_engine",  "VALIDO"),
    ("resolved",  "X",    1.00, "override",      "VALIDO"),
    ("resolved",  "X",    1.00, NULL,            "RECHAZADO"),
    ("resolved",  NULL,   1.00, "exact_engine",  "RECHAZADO"),
    ("resolved",  "X",    0.90, "exact_engine",  "RECHAZADO"),
    ("resolved",  "X",    1.00, "synonym",       "RECHAZADO"),
    ("review",    "X",    0.70, "synonym",       "VALIDO"),
    ("review",    "X",    0.50, "fingerprint",   "VALIDO"),
    ("review",    "X",    0.85, "synonym",       "RECHAZADO"),
    ("review",    "X",    0.49, "synonym",       "RECHAZADO"),
    ("review",    "X",    0.70, "exact_engine",  "RECHAZADO"),
    ("review",    NULL,   0.70, "synonym",       "RECHAZADO"),
    ("ambiguous", NULL,   NULL, "synonym",       "VALIDO"),
    ("ambiguous", NULL,   NULL, "exact_engine",  "VALIDO"),
    ("ambiguous", "X",    NULL, "synonym",       "RECHAZADO"),
    ("ambiguous", NULL,   0.70, "synonym",       "RECHAZADO"),
    ("ambiguous", NULL,   NULL, NULL,            "RECHAZADO"),
    ("otro",      NULL,   NULL, NULL,            "RECHAZADO"),
]

anchos = (11, 6, 6, 15, 11, 11, 8)
print("  ".join(s.ljust(w) for s, w in zip(
    ("status", "id", "conf", "source", "esperado", "obtenido", "veredicto"), anchos)))
print("-" * 78)

for status, cid, conf, source, esperado in CASOS_COHERENCIA:
    obtenido = ("VALIDO" if check_passes(ck_canonical_coherence_case(status, cid, conf, source))
                else "RECHAZADO")
    ok = obtenido == esperado
    if not ok:
        fallos.append(f"coherencia {status}/{cid}/{conf}/{source}")
    fila = (status, cid or "NULL", str(conf) if conf is not NULL else "NULL",
            source or "NULL", esperado, obtenido, "OK" if ok else "FALLO")
    print("  ".join(str(c).ljust(w) for c, w in zip(fila, anchos)))

print()
print("=" * 78)
if fallos:
    print(f"RESULTADO: {len(fallos)} FALLO(S)")
    for f in fallos:
        print(f"  - {f}")
    raise SystemExit(1)

print("RESULTADO: TODO CORRECTO.")
print("Los CHECK de la migracion se comportan exactamente como exige el diseno v5.")
print("=" * 78)
