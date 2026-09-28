# S3.3 paso (a) — retirada de los ocho enlaces heredados

Fecha: 2026-09-28. Estado: **en rama, sin fusionar ni aplicar**.
Rama: `codex/legacy-token-s33-empty-links`, desde `origin/main` `bc63c52`.
Migración: `20260928120000_retire_legacy_portal_links.sql`, **no aplicada**.

## Lo que desbloqueó este paso

La pregunta que bloqueaba S3.3 era si alguno de los ocho enlaces había llegado
a un cliente. La respuesta, confirmada por los propietarios el 2026-09-28:
**los tres son el equipo que construye la plataforma, y ningún enlace se envió
nunca a nadie.**

Eso retira el plan original —sustituir uno a uno, comunicar al cliente y
observar treinta días—, que estaba diseñado para un escenario que no existe.
No hay ningún cliente al que dejar fuera, así que el paso (a) es una sola
operación.

También retira la «ventana de observación»: servía para detectar si alguien
seguía usando su enlace, y no hay nadie a quien observar. Da igual que no
hubiera telemetría para hacerlo.

## Qué hace la migración

**Escribe datos.** Es la primera de la serie que lo hace; las anteriores solo
tocaban esquema o privilegios. Pone `access_token` a `NULL` en los proyectos
que todavía lo tienen.

No borra ninguna fila, no toca `portal_tokens`, no retira la compatibilidad
heredada de las RPC —paso (b)— y no elimina la columna —paso (c)—.

El guard exige el estado revisado y aborta si no cuadra: S3.1 aplicada
(columna nullable y sin default), **exactamente ocho** enlaces en proyectos
vivos y **ninguno** en proyectos borrados. Si alguien creó o borró proyectos
después de la conversación con los propietarios, el número no cuadra y la
migración se detiene para que esa conversación se repita.

## No tiene compensación, y es deliberado

El valor de cada token no se guarda en ninguna parte. Guardarlo sería conservar
justo el secreto que se retira. Restaurar «el» enlace es imposible; lo único
posible sería emitir uno nuevo, que no es lo mismo.

Si alguna vez hace falta dar acceso por el portal a uno de esos proyectos, el
camino es `portal_issue_token`: enlace moderno, con caducidad, revocable y
atribuido a su dueño. Eso es lo que persigue todo E4.

`ROLLBACK.sql` lleva el bloque escrito y **vacío a propósito**, para que nadie
busque una compensación que no existe y acabe improvisándola.

## Pruebas

`legacy-links-retired.integration.test.mjs` — **9/9** en PostgreSQL 17
desechable, sobre la cadena completa hasta S3.1 incluida:

- el estado de partida es el de producción: ocho enlaces, columna nullable y
  sin default;
- el guard aborta con nueve enlaces, con siete, con uno en proyecto borrado y
  con el default repuesto;
- vacía los ocho y **no borra ni una fila**: los ocho proyectos siguen ahí;
- **ningún otro campo cambia** — id, dueño, nombre, estado, borrado y alta
  quedan byte a byte iguales, comprobado por huella;
- un enlace retirado ya no abre el portal y responde «no encontrado» en vez de
  reventar;
- el portal moderno sigue entero: se emite por `portal_issue_token` y abre;
- **control negativo**: sin el `update`, los ocho enlaces siguen ahí, que es lo
  que demuestra que la aserción anterior mide algo;
- la migración no lleva control de transacción propio, no borra filas y no
  retira la columna.

## Despliegue futuro

1. `CHECK_E4_L3_S33A_PRECHECK` → `veredicto = OK`.
2. `supabase migration list`: la única pendiente debe ser `20260928120000`.
3. Un solo `supabase db push`.
4. `CHECK_E4_L3_S33A_AUDIT` → `veredicto = OK`: registrada, cero enlaces y los
   ocho proyectos intactos.

Después de esto, el precheck del paso (b) —`CHECK_E4_L3_S33_PASO_B_PRECHECK`,
en la rama `codex/legacy-token-s33-prep`— pasará de `ESPERAR` a `OK`, y se
podrá escribir la migración que retira la compatibilidad heredada de
`portal_read_snapshot` y `portal_respond_to_change`.

## Riesgos

- **Irreversible.** Está dicho arriba y conviene repetirlo: los ocho enlaces
  dejan de existir y no se pueden recuperar.
- **La columna sigue ahí y las RPC la siguen aceptando.** Un proyecto al que
  alguien le pusiera un `access_token` a mano volvería a tener enlace heredado.
  Eso se cierra en el paso (b).
- **El guard se apoya en el número ocho**, que es la línea base revisada. Es
  una salvaguarda, no una verdad eterna: si el despliegue se retrasa y se crean
  proyectos, habrá que revisar y ajustar antes de aplicar.
