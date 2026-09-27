# `maquinaria`, categoría válida de `budget_items`

Fecha: 2026-09-27. Estado: **en rama, sin fusionar ni aplicar**.
Rama: `codex/budget-items-maquinaria-category`, desde `origin/main` `ec4958e`.
Migración: `20260927120000_budget_items_allow_maquinaria.sql`, **no aplicada**.

## El defecto

El prompt del generador vivo, `app/api/agent/budget-analysis/route.ts:326`,
ofrece al modelo cuatro categorías:

```
- category: "mano_obra", "material", "maquinaria", "otros"
```

El CHECK de la base admite tres:

```sql
CHECK (category = ANY (ARRAY['material', 'mano_obra', 'otros']))
```

Y nada las reconcilia por el camino. `BudgetGenerateProvider.tsx:186` aplica
`text(row.category, "otros")`, donde ese `"otros"` es el valor por defecto para
cadenas vacías, **no** una normalización; y la RPC de escritura hace
`coalesce(nullif(item->>'category',''), 'otros')`, que transporta igual. Una
partida clasificada como `maquinaria` llega intacta y muere con `23514`.

Comprobado en producción: de **911 partidas, 0 son `maquinaria`**
(583 material, 310 mano_obra, 18 otros). Coherente con el rechazo.

`maquinaria` sí es legítima en otro sitio: es un `business_subsector` del banco
de precios (`pb_products`), con su propio vocabulario más amplio. El defecto
nació de que el prompt de partidas tomó prestada esa lista.

## La decisión

Se amplía el vocabulario en vez de quitarla del prompt. El generador de PDF ya
la trata como etiqueta propia (`lib/pdf-generator.ts:110`), así que el resto del
sistema ya asumía que existe; lo que faltaba era que la tabla la admitiera.

## Qué cambia, y qué no

La migración **solo amplía**: de tres valores a cuatro. No toca ninguna de las
911 filas, no relaja la restricción —cualquier categoría fuera de las cuatro se
sigue rechazando— y no mira el vocabulario del banco de precios.

El guard exige encontrar el CHECK con **exactamente** el vocabulario de tres y
aborta si no; y cuenta las filas que quedarían fuera del vocabulario nuevo antes
de tocar nada, para decir cuántas son en vez de dejar que reviente sin contexto.

Nota de procedencia: el CHECK existe en producción pero **ninguna migración de
este repositorio lo creó** —el bootstrap de pruebas ya lo documentaba así—. Por
eso el guard verifica su definición literal en lugar de darla por conocida.

## Los cuatro sitios que duplicaban el vocabulario

| Sitio | Antes | Ahora |
|---|---|---|
| CHECK de la base | 3 | 4, vía migración |
| `__tests__/support/bootstrap-budget-schema.sql` | 3 | 4 |
| Prompt del generador | **4** (el defecto) | 4, ya correcto |
| `budget-form.tsx`, desplegable manual | **3** | 4 |

Los cuatro se comparan entre sí en `budget-item-categories.test.mjs`, y la
comparación es cruzada: cambiar la constante de la prueba y un solo sitio no
basta para que pase.

Que el desplegable manual tuviera tres era la otra mitad del mismo problema:
quien clasificaba a mano no podía marcar maquinaria aunque el generador sí.

## Lo que NO se cambió, a propósito

`__tests__/budget-revision-conflict.integration.test.mjs:1093` define
`CATEGORIAS_PERMITIDAS` con tres valores. **Se deja como está.** Ese conjunto no
describe el esquema sino el contenido del fixture dorado, y su propio comentario
lo dice: «si mañana aparece una `category` nueva, el fixture ha cambiado de
contenido y hay que mirarlo, no absorberlo en silencio». Ampliarlo destruiría su
propósito. Verificado: el fixture no contiene ninguna `maquinaria`.

## Pruebas

| Suite | |
|---|---|
| `budget-items-maquinaria.integration` | **8/8**, PostgreSQL 17 desechable |
| `budget-item-categories` | **6/6**, estática |

La de integración comprueba: antes de la migración `maquinaria` se rechaza —el
defecto, reproducido—; el guard aborta sin el CHECK y con otro vocabulario; tras
aplicar, las filas quedan **idénticas byte a byte**; `maquinaria` entra por
inserción directa **y por `save_budget`**, que es el camino real del generador;
el vocabulario sigue cerrado frente a `logistica`, `transporte`, `residuos`,
`MAQUINARIA`, cadena vacía e inventos; y la definición resultante es exactamente
la esperada.

**Control negativo**: una migración que en vez de ampliar *quitara* el CHECK
dejaría entrar `maquinaria` igual y la primera mitad de la suite seguiría verde.
Lo que la delata es comprobar que `logistica` se sigue rechazando.

## Despliegue futuro

1. `CHECK_MAQUINARIA_PRECHECK` → `veredicto = OK`.
2. `supabase migration list`: la única pendiente debe ser `20260927120000`.
3. Un solo `supabase db push`.
4. `CHECK_MAQUINARIA_AUDIT` → `veredicto = OK`, con el mismo número de partidas.

### Compensación

`ROLLBACK_MAQUINARIA` exige el reconocimiento
`enlaze.allow_maquinaria_rollback = 'narrow_back_to_three_categories'` y cuenta
las partidas `maquinaria`. Si hay una sola, **aborta sin tocar nada**: estrechar
el vocabulario obligaría a reclasificar el trabajo de otro, y esa decisión no
cabe en un rollback.

**El bloque se ejecuta entero, con su `begin`/`commit`.** Probándolo se vio por
qué: al extraerlo sin ellos y correrlo sin `ON_ERROR_STOP`, el guard falla, psql
continúa, el `drop constraint` se ejecuta y el `add` posterior no puede recrearlo
porque ya hay una fila `maquinaria` — y la tabla se queda **sin ninguna
restricción**. Dentro de su transacción eso no puede pasar.

## Riesgos

- **La agrupación del PDF no distingue maquinaria.** `lib/pdf-generator.ts:918`
  agrupa en material / mano de obra / **todo lo demás**, así que una partida de
  maquinaria suma en «otros» aunque tenga etiqueta propia. No rompe nada y la
  migración no lo empeora, pero si el objetivo era ver la maquinaria separada en
  el presupuesto, falta ese paso. Decisión de producto, fuera de este lote.
- **Estrechar deja de ser posible con la primera partida.** Inherente; el
  rollback lo detecta y se niega.
- **El CHECK sigue sin nacer de una migración**: esta lo sustituye, así que a
  partir de ahora sí queda registrado su origen.
