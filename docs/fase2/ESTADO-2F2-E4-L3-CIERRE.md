# 2F-2 / E4 lote 3 — cierre: pasos (b) y (c)

Fecha: 2026-09-29.
Estado: **(b) aplicada en producción. (c) en rama, sin fusionar ni aplicar.**
Rama de (c): `codex/legacy-token-s33c-drop-column`, desde `origin/main` `99b5c94`.
Continúa [ESTADO-2F2-E4-L3.md](ESTADO-2F2-E4-L3.md) y
[ESTADO-2F2-E4-L3-S33A.md](ESTADO-2F2-E4-L3-S33A.md).

## Dónde estábamos

`projects.access_token` nació como `uuid not null default gen_random_uuid()`.
Cada proyecto recibía, sin pedirlo, un enlace portador del portal: sin
caducidad, sin permisos, sin forma de revocarlo y sin registro de uso.

- **S3.1** (`20260927100000`) quitó el `DEFAULT` y el `NOT NULL`: dejó de
  emitirse uno en cada alta.
- **S3.2** retiró del portal público el lector alternativo que leía la columna.
- **S3.3 (a)** (`20260928120000`) vació los ocho que quedaban. Aplicada el
  2026-09-28: ocho proyectos antes, ocho después, cero enlaces.

Quedaba que las RPC dejaran de aceptarlos, y que la columna desapareciera.

## S3.3 (b) · Las RPC dejan de aceptar enlaces heredados

`20260929100000_portal_rpcs_drop_legacy_token.sql`. **Aplicada y auditada.**

`portal_read_snapshot` y `portal_respond_to_change` buscaban el token en
`portal_tokens` y, si no estaba, en `projects.access_token`. Con la columna
vacía ese camino ya no llevaba a ninguna parte: lo único que aportaba era
superficie.

Lo que cambió:

| | |
|---|---|
| La rama `else` que consultaba `projects.access_token` | retirada |
| `v_modern`, discriminador entre los dos caminos | retirado |
| Un enlace heredado concedía `approve_changes` **por defecto** | ahora ambas capacidades salen de `permissions`; nada por omisión |
| La contabilidad de acceso era condicional | ahora siempre |

Esa tercera fila es la que más importa en seguridad: el camino heredado
concedía un permiso sin que nadie se lo hubiera dado, porque era anterior al
modelo de permisos.

**El cuerpo se generó a partir del texto de `20260915150000`** aplicando solo
esos cambios, de modo que todo lo demás quedó idéntico. La prueba lo verifica
por huella: el `md5` del snapshot de un enlace moderno es el mismo antes y
después.

## S3.3 (c) · Desaparece la columna

`20260929140000_projects_drop_access_token.sql`. **En rama, sin aplicar.**

### Dependencias, inventariadas antes de escribirla

| Dependencia | Qué se hace |
|---|---|
| `projects_access_token_key` — restricción UNIQUE con su índice | cae con el `drop column` |
| `idx_projects_access_token` — índice suelto, redundante | cae con el `drop column` |
| comentario de la columna | cae con ella |
| vistas, políticas, disparadores | **ninguno** la referencia |
| funciones | **ninguna**, desde (b) |
| `app/`, `lib/`, `components/` | **ninguna referencia**. Los `access_token` del código son los de Google OAuth y WhatsApp, que son otra cosa |

Por eso el statement es un `drop column` a secas: no hay nada que retirar a
mano ni ningún orden que respetar.

### Sí es reversible, al revés que (a)

Conviene decirlo porque parece lo contrario. El paso (a) **no** tenía
compensación: destruía ocho secretos que no se guardaban en ninguna parte. El
(c) elimina una columna que ya está vacía, así que reponerla —con su
restricción única, su índice y su comentario— devuelve el estado exacto:
ocho filas con el valor a `NULL`.

`ROLLBACK_E4_L3_S33C` lo hace, exige reconocimiento explícito y **repone la
columna sin `DEFAULT`**: reponerlo volvería a emitir un enlace en cada alta,
que es justo lo que S3.1 vino a cortar.

Si se quisiera volver al comportamiento completo de antes del lote, hay que
ejecutar después `ROLLBACK_E4_L3_S33B`, que reabre el camino heredado en las
RPC. Ese orden no es intercambiable: las funciones antiguas no compilan sin la
columna.

### El guard

Comprueba dos cosas, **y en este orden**:

1. **Que la columna esté vacía.** Es el que de verdad importa: sobre una
   columna vacía el drop es reversible; sobre una con valores destruye secretos
   irrecuperables. Va primero a propósito, para que sea lo primero que lea
   quien despliega.
2. Que ninguna función la nombre, es decir, que (b) haya terminado.

Si la columna ya no existe, no hace nada y volver a ejecutarla no rompe.

## Pruebas

| Suite | |
|---|---|
| `portal-rpcs-legacy-removed.integration` | **11/11**, PostgreSQL 17 desechable |
| `access-token-column-dropped.integration` | **11/11**, PostgreSQL 17 desechable |

Las dos llevan **control negativo obligatorio**. En (b): antes de aplicar la
migración, un `access_token` **sí** abre el portal —sin comprobar eso,
verificar después que devuelve `null` no mediría nada—. En (c): con enlaces
vivos la migración se niega, y con `(b)` sin aplicar también.

(c) comprueba además que no se pierde ni una fila, que el resto del esquema
queda con la misma huella excluyendo la columna objetivo, y que el portal
moderno responde exactamente igual.

## Un defecto que apareció al probar los gates

El primer `CHECK_E4_L3_S33C_PRECHECK` **daba error** en vez de veredicto cuando
se ejecutaba con la columna ya eliminada: referenciaba `access_token`
directamente y eso es un error de análisis, no un resultado. Un operador lo
habría leído como «algo está roto» en lugar de «ya está hecho».

Corregido con `to_jsonb(p) ->> 'access_token'`, que devuelve `NULL` cuando la
columna no existe en lugar de fallar. Ahora el bloque responde `NADA QUE HACER`
en ese caso, que es la verdad.

## Despliegue de (c)

1. `CHECK_E4_L3_S33C_PRECHECK` → `OK`. Anotar el valor de `proyectos`.
2. `supabase migration list`: la única pendiente debe ser `20260929140000`.
3. Un solo `supabase db push`.
4. `CHECK_E4_L3_S33C_AUDIT` → `OK`, y contrastar `proyectos` con el del
   precheck: igual o mayor, nunca menor.

La auditoría avisa además, con `REVISAR`, si no queda ningún enlace moderno
vigente: en ese caso el portal se quedaría sin ninguna vía de acceso, y eso hay
que saberlo aunque la migración esté bien.

## Lo que queda después

El lote 3 se cierra con (c). Sigue abierto, fuera de su alcance:

- **`anon` conserva `SELECT` de tabla sobre `projects` y `budgets`** sin ninguna
  política que le dé filas. Mismo patrón que se cerró en `portal_tokens` con
  `20260925110000`, misma solución.
- Los enlaces modernos son la única vía de acceso al portal, con caducidad
  máxima de 365 días y cinco vigentes por proyecto.
