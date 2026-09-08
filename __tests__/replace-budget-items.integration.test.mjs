import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * BANCO CONDUCTUAL DE `public.replace_budget_items(uuid, jsonb)` — FASE 2F-1DB
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ PRUEBA ESTO QUE NO PRUEBE YA LA SUITE ESTÁTICA
 * ───────────────────────────────────────────────────────────────────────────
 * `__tests__/replace-budget-items-migration.test.mjs` inspecciona el TEXTO de
 * la migración: 27 verificadores y 34 mutaciones que demuestran que cada
 * afirmación se agarra a algo. Es una prueba sobre lo que el fichero DICE.
 *
 * Este banco es una prueba sobre lo que PostgreSQL HACE. Ninguna inspección
 * textual puede demostrar que el DELETE se revierte, que `for update` serializa
 * dos llamadas concurrentes, o que un `revoke` escrito en el fichero acabó
 * realmente en `pg_proc.proacl`. Eso sólo lo demuestra ejecutarlo.
 *
 * Por eso los controles negativos significativos aquí NO son mutaciones del
 * texto —eso ya está cubierto, y repetirlo sería decorativo—. Son dos, y cada
 * uno responde a una pregunta distinta sobre si el banco mide algo:
 *
 *   · Un elemento que SUPERA la validación previa de la RPC y revienta DENTRO
 *     del INSERT, es decir, después del DELETE (prueba 1). Es el único fallo que
 *     distingue «atómica» de «validada antes de borrar».
 *   · La RPC ANTERIOR puesta en su sitio a propósito, para exigir que la
 *     cobertura de costes falle contra ella (prueba 8). Sin eso, unas
 *     comprobaciones que pasan con las dos versiones no dirían nada sobre lo que
 *     la migración de costes añade.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ SE APLICA SOBRE EL ESQUEMA, Y EN QUÉ ORDEN
 * ───────────────────────────────────────────────────────────────────────────
 * El bootstrap, y después DOS migraciones, en este orden:
 *
 *   1. `20260904120000_replace_budget_items.sql` — crea la función, y con ella
 *      la autorización manual, el bloqueo, la sustitución atómica y la ACL.
 *   2. `20260908111706_replace_budget_items_persist_cost.sql` — la redefine para
 *      transportar `unit_price_cost` y `subtotal_cost`.
 *
 * Las dos hacen `create or replace` sobre la misma firma, así que el orden
 * decide cuál queda en pie. Aplicar sólo la primera —que es lo que este banco
 * hacía— dejaba probada una función que en producción ya no existe.
 *
 * El estado final que se ejercita es el de producción, y de ahí sale también la
 * definición de las dos columnas de coste en el bootstrap: del catálogo real, no
 * del fichero de migración, que las nombra pero no las crea.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * CÓMO EJECUTARLO — Y POR QUÉ CUESTA TANTO
 * ───────────────────────────────────────────────────────────────────────────
 * El banco BORRA los esquemas `public` y `auth` enteros, y además CREA Y MODIFICA
 * ROLES. Y ahí está el motivo de todo lo que sigue: los esquemas viven dentro de
 * una base, pero los roles pertenecen al CLÚSTER entero y existen para todas sus
 * bases a la vez. Comprobar el nombre de la base, por tanto, no protege a los
 * demás proyectos que compartan el mismo servidor: el daño que este banco puede
 * hacerles no ocurre dentro de ninguna base. Por eso lo que se exige no es una
 * base desechable, sino un CLÚSTER desechable.
 *
 * Se exige un contenedor dedicado. No una base nueva dentro del PostgreSQL de
 * siempre: un proceso aparte, levantado para esto y tirado después.
 *
 *   docker run --rm -d --name enlaze-replace-items-test \
 *     -p 127.0.0.1:55432:5432 \
 *     -e POSTGRES_PASSWORD=postgres \
 *     -e POSTGRES_DB=enlaze_replace_items_test \
 *     postgres:17 \
 *     -c enlaze.test_cluster_marker=replace_items_2f1db
 *
 * La base se crea en la INICIALIZACIÓN, con `POSTGRES_DB`, y no después con un
 * `docker exec ... createdb`. La diferencia importa: el `createdb` posterior es
 * una carrera contra el arranque del servidor y falla de forma intermitente si se
 * lanza demasiado pronto. Con `POSTGRES_DB` la base existe cuando el contenedor
 * está listo, sin paso adicional que pueda salir mal.
 *
 * Hay que ESPERAR a que PostgreSQL acepte conexiones antes de lanzar el test. La
 * imagen ejecuta su secuencia de inicialización —que incluye un arranque interno
 * temporal— antes de abrir el puerto publicado, así que `docker run` devuelve
 * bastante antes de que el servidor esté disponible. Lanzar el banco en ese hueco
 * produce un fallo de conexión que no dice nada útil sobre la RPC:
 *
 *   until docker exec enlaze-replace-items-test \
 *           pg_isready -U postgres -d enlaze_replace_items_test -q; do sleep 1; done
 *
 *   RUN_REPLACE_ITEMS_INTEGRATION_TESTS=1 \
 *   REPLACE_ITEMS_TEST_DB_ACK=DISPOSABLE_ONLY \
 *   REPLACE_ITEMS_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER \
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/enlaze_replace_items_test \
 *   npm run test:replace-budget-items-integration
 *
 * Las dos confirmaciones son dos, y no una, porque afirman cosas distintas:
 * `REPLACE_ITEMS_TEST_DB_ACK=DISPOSABLE_ONLY` dice que la BASE es prescindible;
 * `REPLACE_ITEMS_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER` dice que lo es el SERVIDOR
 * COMPLETO, con todo lo que contenga. Quien sólo pensó en la primera no ha
 * consentido la segunda, y el banco no da por supuesto ese consentimiento.
 *
 * QUÉ VALE Y QUÉ NO VALE EL MARCADOR `enlaze.test_cluster_marker`
 *
 * El banco lo lee ya conectado, antes de tocar nada, y se niega a seguir si falta
 * o difiere. Es útil: si alguien apunta el banco a un PostgreSQL cualquiera que
 * resulte estar escuchando en 127.0.0.1:55432 —un reenvío de puertos hecho sin
 * pensar, un contenedor de otro proyecto—, ese servidor no llevará el marcador y
 * el banco se detendrá. Ese es el caso que cubre, y no es un caso raro.
 *
 * Lo que NO es, y conviene decirlo porque una versión anterior de este comentario
 * lo afirmaba y era falso: NO es prueba de que el clúster sea desechable, ni un
 * ajuste que sólo pueda fijarse al arrancar el servidor. `enlaze.test_cluster_marker`
 * es un parámetro personalizado de dos partes, de los que PostgreSQL admite sin
 * declararlos, y esos parámetros pueden fijarse también POR SESIÓN desde el lado
 * del cliente: con `SET`, con la opción de conexión `options`, o exportando
 * `PGOPTIONS=-c enlaze.test_cluster_marker=replace_items_2f1db` antes de lanzar
 * el test. Cualquiera de esas tres cosas haría que el PostgreSQL de trabajo de
 * toda la vida se presentara ante el banco con el marcador correcto.
 *
 * De ahí que el marcador sea una SEÑAL SECUNDARIA, no una garantía: descarta
 * confusiones, no engaños ni descuidos deliberados. Contra el vector más obvio
 * —`PGOPTIONS` heredado del entorno— hay una guarda aparte, que rechaza esa
 * variable y sus hermanas antes incluso de importar el driver. Lo único que de
 * verdad autoriza la ejecución sigue siendo el consentimiento humano de los dos
 * ACK; el marcador reduce la probabilidad de que ese consentimiento se aplique
 * por error al servidor equivocado.
 *
 * Sin `RUN_REPLACE_ITEMS_INTEGRATION_TESTS=1` el banco se marca SKIP y no abre
 * ninguna conexión. Con esa variable puesta pero cualquier otra guarda
 * incumplida, FALLA en voz alta antes de conectar: quien pidió ejecutar esto se
 * merece un error, no un silencio que parezca un éxito.
 *
 * LO QUE NO LEE, DELIBERADAMENTE: `.env.local`, `SUPABASE_DB_URL`,
 * `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` ni
 * ninguna otra credencial del proyecto. La única fuente de conexión es
 * `TEST_DATABASE_URL`, y sólo se acepta si apunta a `127.0.0.1`, al puerto
 * `55432` y a una base llamada exactamente `enlaze_replace_items_test`. Un
 * fichero de entorno del proyecto no puede, por construcción, colarse aquí.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * HASTA DÓNDE LLEGA LO QUE ESTE BANCO DEMUESTRA SOBRE AUTORIZACIÓN
 * ───────────────────────────────────────────────────────────────────────────
 * Demuestra dos cosas, y conviene no confundirlas con una tercera:
 *
 *   1. La AUTORIZACIÓN MANUAL del cuerpo de la RPC. Como es `security definer`,
 *      RLS no la gobierna, así que la comprobación de propiedad la hace la
 *      función a mano contra `auth.uid()`. La prueba 3 la ejercita.
 *   2. La ACL EFECTIVA de la función tal como queda en `pg_proc.proacl` después
 *      de aplicar la migración, incluida la ausencia de la concesión implícita a
 *      PUBLIC. La prueba 6 la ejercita.
 *
 * Lo que NO hace, y no debe atribuírsele: reproducir ni verificar la cadena
 * JWT/PostgREST de Supabase. Aquí no hay GoTrue emitiendo tokens ni PostgREST
 * validando firma, caducidad o `role`; `auth.uid()` es una función del bootstrap
 * que lee `request.jwt.claim.sub` de `current_setting`, fijado a mano con `set
 * local`. Que una petición real llegue a la RPC con el `sub` y el rol que dice
 * traer depende de esa cadena, y eso queda fuera de este banco.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_BOOTSTRAP = resolve(AQUI, "support", "bootstrap-budget-schema.sql");
// LAS DOS MIGRACIONES QUE DEFINEN LA RPC, EN EL ORDEN EN QUE SE APLICAN.
//
// El orden no es una preferencia de estilo: las dos hacen `create or replace` de
// la MISMA función, así que la última en aplicarse es la que queda. Invertirlas
// dejaría en pie la versión sin `unit_price_cost` y el banco estaría probando la
// RPC anterior mientras cree probar la actual —y las pruebas de coste fallarían
// con un mensaje que no señalaría la causa—. Por eso se aplican recorriendo este
// array y por eso el array está declarado como constante ordenada y no como
// conjunto.
//
// La segunda lleva el nombre RECONCILIADO. En el repositorio se llamó un tiempo
// `20260908160000_...`, pero producción la registró como `20260908111706_...`, y
// el fichero se ha renombrado para que el repositorio reproduzca lo que de
// verdad se aplicó. Si esta ruta dejara de existir, el banco falla al leerla, que
// es el comportamiento correcto: no hay una versión «por defecto» aceptable.
const RUTAS_MIGRACIONES = [
  "20260904120000_replace_budget_items.sql",
  "20260908111706_replace_budget_items_persist_cost.sql",
].map((nombre) => resolve(AQUI, "..", "supabase", "migrations", nombre));

// La original, por separado: el control negativo del final la reaplica a
// propósito para demostrar que la cobertura de costes la detecta.
const [RUTA_MIGRACION_ORIGINAL, RUTA_MIGRACION_COSTES] = RUTAS_MIGRACIONES;

// El destino no se «prefiere» local: se exige un ÚNICO destino posible. Ni
// `localhost` (que puede resolver a cualquier cosa, y en algunos sistemas al
// socket unix del PostgreSQL de siempre) ni `::1`: sólo la forma literal
// 127.0.0.1, y sólo en un puerto que ningún PostgreSQL instalado a la manera
// habitual ocupa.
const HOST_EXIGIDO = "127.0.0.1";
const PUERTO_EXIGIDO = "55432";
const PROTOCOLOS_PERMITIDOS = new Set(["postgres:", "postgresql:"]);
const BASE_EXIGIDA = "enlaze_replace_items_test";

// Parámetro personalizado de dos partes. Se pide en el arranque del contenedor,
// pero PostgreSQL permite fijar estos parámetros también por sesión —`SET`, la
// opción de conexión `options`, `PGOPTIONS`—, así que su presencia NO demuestra
// que el clúster se levantara para este banco. Es una señal secundaria: descarta
// apuntar por descuido a otro servidor, no a un servidor preparado a propósito.
const AJUSTE_MARCADOR = "enlaze.test_cluster_marker";
const MARCADOR_EXIGIDO = "replace_items_2f1db";

// Variables de entorno de libpq que pueden aportar o cambiar parámetros de
// conexión a espaldas de `TEST_DATABASE_URL`. `pg` las respeta para todo lo que
// la cadena no fije, de modo que las guardas podrían estar validando una URL y el
// driver conectándose a otro sitio. `PGOPTIONS`, además, es el camino directo
// para falsificar el marcador. Se rechazan por presencia, sin mirar su valor.
const VARIABLES_PG_PROHIBIDAS = [
  "PGOPTIONS",
  "PGHOST",
  "PGHOSTADDR",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGSSLMODE",
];

// El opt-in es UNA sola variable. Todo lo demás son guardas: si falta el opt-in
// el banco calla, pero si el opt-in está y falta una guarda, el banco grita.
const OPT_IN = process.env.RUN_REPLACE_ITEMS_INTEGRATION_TESTS === "1";

const MENSAJE_SKIP =
  "NO SE HA EJECUTADO NINGUNA PRUEBA CONDUCTUAL. Este banco necesita un clúster " +
  "PostgreSQL dedicado y desechable, y no se ha pedido su ejecución. Nada de lo " +
  "que contiene ha sido verificado en esta ejecución: ni la atomicidad, ni la " +
  "autorización, ni el orden, ni la concurrencia, ni la ACL. No se afirma que " +
  "pase. Para ejecutarlo hacen falta el opt-in " +
  "RUN_REPLACE_ITEMS_INTEGRATION_TESTS=1 y DOS confirmaciones distintas, porque " +
  "el banco destruye cosas en dos ámbitos distintos: " +
  "REPLACE_ITEMS_TEST_DB_ACK=DISPOSABLE_ONLY (la BASE es desechable: se le " +
  "borran los esquemas public y auth) y " +
  "REPLACE_ITEMS_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER (el CLÚSTER ENTERO es " +
  "desechable: se le crean y modifican roles, que no pertenecen a ninguna base " +
  `en particular). Además, TEST_DATABASE_URL debe apuntar a ${HOST_EXIGIDO}:` +
  `${PUERTO_EXIGIDO} y a la base ${BASE_EXIGIDA}, y ese clúster debe haberse ` +
  `arrancado con -c ${AJUSTE_MARCADOR}=${MARCADOR_EXIGIDO}.`;

/**
 * Comprueba TODAS las guardas y devuelve la URL validada, o lanza.
 *
 * Se ejecuta antes de importar `pg`, antes de conectar y, por tanto, antes de
 * cualquier DDL, DELETE o INSERT. Es un requisito de diseño, no un detalle de
 * implementación: una guarda que se comprueba después de borrar no es una
 * guarda.
 */
function exigirGuardas() {
  const fallos = [];

  // ── Entorno libpq heredado ─────────────────────────────────────────────────
  // Va lo primero porque invalida el resto del razonamiento: si el entorno puede
  // aportar parámetros de conexión, entonces las guardas de host, puerto y base
  // están inspeccionando una URL que no describe del todo a dónde va a conectarse
  // el driver. `pg` toma de estas variables lo que la cadena no fije.
  //
  // No se borran, se RECHAZAN. Borrarlas dejaría seguir a quien las tenía puestas
  // sin saberlo, y ese es precisamente el caso preocupante: un entorno preparado
  // para otra base que nadie recuerda haber exportado. Un aborto obliga a mirar.
  //
  // Se listan los NOMBRES encontrados y nunca los valores: PGPASSWORD contiene
  // una credencial, y este mensaje acaba en logs de CI.
  const heredadas = VARIABLES_PG_PROHIBIDAS.filter(
    (nombre) => process.env[nombre] !== undefined
  );
  if (heredadas.length > 0) {
    fallos.push(
      `El entorno trae variables de PostgreSQL que pueden alterar la conexión: ` +
        `${heredadas.join(", ")}. Se rechazan por estar presentes, sea cual sea su ` +
        `valor (que no se imprime). Dos motivos: cualquiera de ellas puede ` +
        `redirigir al driver a un servidor distinto del que estas guardas han ` +
        `validado, y PGOPTIONS en concreto permite fijar ` +
        `${AJUSTE_MARCADOR} por sesión, es decir, falsificar el marcador que este ` +
        `banco comprueba después de conectar. Ejecuta el banco con el entorno ` +
        `limpio: env -u ${heredadas.join(" -u ")} npm run ...`
    );
  }

  // ── Los dos acuses de recibo ───────────────────────────────────────────────
  // Son dos y no uno porque el daño potencial ocurre en dos ámbitos distintos, y
  // confirmar el primero no informa sobre el segundo.
  if (process.env.REPLACE_ITEMS_TEST_DB_ACK !== "DISPOSABLE_ONLY") {
    fallos.push(
      "REPLACE_ITEMS_TEST_DB_ACK debe valer exactamente 'DISPOSABLE_ONLY'. Es un " +
        "acuse de recibo explícito de que la base indicada es desechable y de que " +
        "este banco va a borrar sus esquemas public y auth enteros."
    );
  }

  if (process.env.REPLACE_ITEMS_TEST_CLUSTER_ACK !== "DISPOSABLE_CLUSTER") {
    fallos.push(
      "REPLACE_ITEMS_TEST_CLUSTER_ACK debe valer exactamente " +
        "'DISPOSABLE_CLUSTER'. El bootstrap crea los roles anon, authenticated y " +
        "service_role y les concede membresías, y los roles son objetos del " +
        "CLÚSTER, no de una base: existen para todas las bases a la vez. " +
        "Comprobar el nombre de la base no protege a los demás proyectos que " +
        "compartan servidor, porque el daño no ocurre dentro de la base. Este " +
        "acuse afirma que el clúster ENTERO es desechable."
    );
  }

  const bruta = process.env.TEST_DATABASE_URL;
  if (typeof bruta !== "string" || bruta.trim() === "") {
    fallos.push("TEST_DATABASE_URL no está definida.");
    throw new Error(componerFallo(fallos));
  }

  let url;
  try {
    url = new URL(bruta);
  } catch {
    fallos.push("TEST_DATABASE_URL no es una URL válida.");
    throw new Error(componerFallo(fallos));
  }

  // ── Forma de la URL ────────────────────────────────────────────────────────
  // Estas cuatro comprobaciones existen para cerrar una brecha concreta: que la
  // URL que INSPECCIONAN las guardas y la configuración que finalmente
  // INTERPRETA el cliente de PostgreSQL no sean la misma cosa. `pg` acepta
  // parámetros de consulta que redefinen el destino y el modo de conexión
  // —`host`, `dbname`, `sslmode`, `options`, `service`...—, de modo que una
  // cadena cuyo `hostname` es `127.0.0.1` puede acabar hablando con otra
  // máquina. Aquí no se intenta enumerar cuáles son peligrosos: se rechaza
  // cualquiera. Este banco es local y no necesita ni uno solo.
  if (!PROTOCOLOS_PERMITIDOS.has(url.protocol)) {
    fallos.push(
      `El protocolo '${url.protocol}' no está permitido. Sólo se aceptan ` +
        "'postgres:' y 'postgresql:'."
    );
  }

  if (url.username === "") {
    fallos.push(
      "TEST_DATABASE_URL no lleva usuario. El banco exige uno explícito: sin él, " +
        "el driver caería en el usuario del sistema operativo, que es " +
        "precisamente la cuenta que suele tener acceso a todo."
    );
  }

  // La contraseña se exige en la URL por la misma razón que se rechaza
  // PGPASSWORD: si la cadena no la lleva, el driver la busca en el entorno o en
  // ~/.pgpass, y esas dos fuentes son justamente las que guardan las credenciales
  // de las bases de verdad. Una URL sin contraseña es una URL que sólo funciona
  // si hay credenciales ajenas al alcance, y ese es el caso que no queremos.
  // El contenedor documentado usa una contraseña trivial y conocida: aquí eso es
  // una virtud, porque significa que la cadena no sirve para nada más.
  if (url.password === "") {
    fallos.push(
      "TEST_DATABASE_URL no lleva contraseña explícita. Debe llevarla, con la " +
        "forma postgres://usuario:contraseña@host:puerto/base. Sin ella el driver " +
        "recurriría a PGPASSWORD o a ~/.pgpass, que es donde están las claves de " +
        "las bases que no hay que tocar; y como PGPASSWORD además está prohibida " +
        "aquí, la conexión sólo podría completarse con credenciales que este banco " +
        "no controla."
    );
  }

  if (url.search !== "") {
    fallos.push(
      `La URL lleva parámetros de consulta ('${url.search}') y no se admite ` +
        "ninguno. Un parámetro puede redefinir el host o la base DESPUÉS de que " +
        "estas guardas los hayan dado por buenos, y entonces la guarda estaría " +
        "validando una cosa y el cliente conectándose a otra."
    );
  }

  if (url.hash !== "") {
    fallos.push(
      `La URL lleva un fragmento ('${url.hash}'). No tiene ningún significado en ` +
        "una cadena de conexión, así que su presencia sólo puede indicar una URL " +
        "malformada o manipulada."
    );
  }

  // `new URL` devuelve el IPv6 entre corchetes: '[::1]'. Se normaliza para que el
  // mensaje de error diga lo que el usuario escribió, no la sintaxis de la URL.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host !== HOST_EXIGIDO) {
    fallos.push(
      `El host '${host}' no está permitido: se exige exactamente ` +
        `'${HOST_EXIGIDO}'. Ni siquiera 'localhost', que es un nombre y depende de ` +
        "la resolución del sistema —puede acabar en ::1, en otra interfaz o en el " +
        "socket unix del PostgreSQL de siempre—, ni '::1' por lo mismo. La " +
        "dirección literal no delega en nadie."
    );
  }

  // El puerto es la guarda que de verdad separa el contenedor desechable del
  // PostgreSQL habitual del usuario. 5432 es el puerto por defecto y es
  // exactamente donde vive lo que no se debe tocar; 55432 hay que haberlo pedido
  // a propósito. Se exige explícito: una URL sin puerto se resolvería al 5432 por
  // defecto, que es justo el caso que hay que impedir.
  if (url.port !== PUERTO_EXIGIDO) {
    fallos.push(
      url.port === ""
        ? `La URL no lleva puerto, y omitirlo significa el 5432 por defecto, que ` +
            `es donde suele escuchar el PostgreSQL de trabajo. El puerto debe ` +
            `escribirse y debe ser ${PUERTO_EXIGIDO}.`
        : `El puerto '${url.port}' no está permitido: se exige exactamente ` +
            `${PUERTO_EXIGIDO}. El contenedor desechable de este banco se publica ` +
            `ahí precisamente para no poder confundirse con ninguna instalación ` +
            `normal.`
    );
  }

  const base = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (base !== BASE_EXIGIDA) {
    fallos.push(
      `La base de datos se llama '${base}' y debe llamarse exactamente ` +
        `'${BASE_EXIGIDA}'. El nombre es la última defensa: una base local puede ` +
        "ser perfectamente una copia de trabajo que alguien aprecia."
    );
  }

  if (fallos.length > 0) throw new Error(componerFallo(fallos));

  return { cadena: bruta, host, puerto: url.port, base };
}

function componerFallo(fallos) {
  return (
    "BANCO CONDUCTUAL ABORTADO ANTES DE CONECTAR. Se pidió ejecutarlo " +
    "(RUN_REPLACE_ITEMS_INTEGRATION_TESTS=1) pero no se cumplen las condiciones " +
    "de seguridad. No se ha abierto ninguna conexión ni se ha ejecutado ningún " +
    "DDL, DELETE o INSERT.\n  - " +
    fallos.join("\n  - ")
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades del banco
// ─────────────────────────────────────────────────────────────────────────────

/** Ejecuta `fn` y devuelve el error que lanza. Falla si NO lanza. */
async function capturar(fn, queSeEsperaba) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail(`Se esperaba un error (${queSeEsperaba}) y la llamada terminó con éxito.`);
}

const PAYLOAD_VALIDO = (concept, extra = {}) => ({
  concept,
  quantity: "1",
  unit_price: "10.00",
  ...extra,
});

test("banco conductual de public.replace_budget_items", async (t) => {
  if (!OPT_IN) {
    t.skip(MENSAJE_SKIP);
    return;
  }

  // Guardas ANTES de importar `pg`. El orden importa por dos razones: la
  // primera es que ninguna guarda debe comprobarse después de conectar; la
  // segunda es que así, sin opt-in, este fichero se marca SKIP aunque `pg` no
  // esté todavía instalado en node_modules.
  const destino = exigirGuardas();

  const { default: pg } = await import("pg");
  const { Client } = pg;

  const abiertas = [];

  // EL REGISTRO DE LIMPIEZA VA AQUÍ, antes de que exista una sola conexión y
  // mucho antes del primer SQL. Estaba al final, después del bootstrap, y era un
  // error real: si fallaba la conexión, la guarda posterior, el bootstrap, la
  // migración o la siembra, la línea del `t.after` no llegaba a ejecutarse nunca
  // y el proceso se quedaba con sockets abiertos justo en el caso en que algo ha
  // ido mal. Registrar la limpieza antes de crear lo que hay que limpiar es lo
  // que hace que el orden de los fallos deje de importar.
  t.after(async () => {
    for (const cliente of abiertas) {
      try {
        await cliente.end();
      } catch {
        // Cerrar es cortesía; si una conexión ya murió, no hay nada que salvar.
      }
    }
  });

  async function conectar() {
    const cliente = new Client({ connectionString: destino.cadena });
    try {
      await cliente.connect();
    } catch (error) {
      // `connect()` puede fallar DESPUÉS de abrir el socket —autenticación
      // rechazada, base inexistente— y entonces el cliente no está en `abiertas`
      // y nadie lo cerraría. Se cierra aquí y se propaga el error original.
      try {
        await cliente.end();
      } catch {
        // Un cierre fallido no debe enmascarar la causa real.
      }
      throw error;
    }
    abiertas.push(cliente);
    return cliente;
  }

  const admin = await conectar();

  // ── ÚLTIMAS GUARDAS: lo que dice la propia sesión abierta ───────────────────
  // Una URL puede mentir sobre a qué base apunta —un fichero de servicio, un
  // alias en pg_hba, una redirección de puerto—; `current_database()` no.
  //
  // EL MARCADOR DE CLÚSTER estrecha —no cierra— el hueco que dejan las guardas de
  // forma. Host y puerto describen a dónde se envía el socket, no qué hay al otro
  // lado: alguien puede publicar su PostgreSQL de trabajo en 127.0.0.1:55432 con
  // un reenvío de puertos, sin mala intención y sin enterarse, y entonces todas
  // las guardas anteriores darían el visto bueno a destruirle los roles. Ese
  // servidor no llevará el marcador, y aquí es donde se le para.
  //
  // Pero el marcador no PRUEBA que el clúster sea desechable, y describirlo así
  // sería mentir sobre PostgreSQL: `enlaze.test_cluster_marker` es un parámetro
  // personalizado de dos partes, y esos se pueden fijar por sesión con `SET`, con
  // la opción de conexión `options` o con `PGOPTIONS`. Un PostgreSQL cualquiera
  // puede presentarse con el marcador correcto si alguien se lo pide. La guarda
  // de entorno de arriba tapa el camino más fácil —PGOPTIONS heredado—, pero no
  // convierte esto en una garantía. Es una señal secundaria y así hay que leerla:
  // atrapa el descuido, no el empeño.
  //
  // Se añade aquí la exigencia de SUPERUSUARIO, y no es celo: el bootstrap crea
  // `service_role` con BYPASSRLS, y BYPASSRLS sólo lo puede conceder un
  // superusuario. Con CREATEROLE a secas el bootstrap fallaría a medias, después
  // de haber borrado los esquemas. Comprobarlo antes de leer siquiera el fichero
  // convierte ese fallo a mitad de faena en una negativa limpia.
  //
  // La versión no bloquea, pero se registra: la ejecución real se hará
  // preferentemente sobre PostgreSQL 17 y la evidencia debe decir sobre qué
  // versión se obtuvo.
  const {
    rows: [sesion],
  } = await admin.query(
    `select current_database()                as base,
            current_user                      as usuario,
            (select r.rolsuper
               from pg_roles r
              where r.rolname = current_user) as superusuario,
            current_setting($1, true)         as marcador,
            current_setting('server_version') as version,
            version()                         as version_larga`,
    [AJUSTE_MARCADOR]
  );

  t.diagnostic(
    `sesión observada: base=${sesion.base} usuario=${sesion.usuario} ` +
      `superusuario=${sesion.superusuario} server_version=${sesion.version} ` +
      `${AJUSTE_MARCADOR}=${sesion.marcador === null ? "(ausente)" : sesion.marcador}`
  );
  t.diagnostic(`version(): ${sesion.version_larga}`);

  const impedimentos = [];
  if (sesion.base !== BASE_EXIGIDA) {
    impedimentos.push(
      `la conexión dice estar en '${sesion.base}' y no en '${BASE_EXIGIDA}'`
    );
  }
  if (sesion.marcador !== MARCADOR_EXIGIDO) {
    impedimentos.push(
      `el servidor no presenta el marcador esperado: ${AJUSTE_MARCADOR} vale ` +
        `${sesion.marcador === null ? "(ausente)" : `'${sesion.marcador}'`} y debe ` +
        `valer '${MARCADOR_EXIGIDO}'. El contenedor documentado lo recibe al ` +
        `arrancar, con -c ${AJUSTE_MARCADOR}=${MARCADOR_EXIGIDO}. Que no esté ` +
        `indica que al otro lado de ${HOST_EXIGIDO}:${PUERTO_EXIGIDO} hay un ` +
        `PostgreSQL distinto del que se preparó para este banco, y a ese no se le ` +
        `tocan los roles`
    );
  }
  if (sesion.superusuario !== true) {
    impedimentos.push(
      `'${sesion.usuario}' no es superusuario, y el bootstrap necesita serlo para ` +
        "crear service_role con BYPASSRLS"
    );
  }
  if (impedimentos.length > 0) {
    throw new Error(
      "BANCO CONDUCTUAL ABORTADO DESPUÉS DE CONECTAR Y ANTES DE TODO DDL. No se " +
        "ha leído ni ejecutado el bootstrap, y no se ha ejecutado ningún DDL, " +
        "DELETE ni INSERT.\n  - " +
        impedimentos.join("\n  - ")
    );
  }

  const bootstrap = await readFile(RUTA_BOOTSTRAP, "utf8");

  // Se leen las DOS antes de ejecutar ninguna, para que una ruta equivocada se
  // note antes de tocar la base y no a mitad de la secuencia.
  const migraciones = [];
  for (const ruta of RUTAS_MIGRACIONES) {
    migraciones.push({ ruta, sql: await readFile(ruta, "utf8") });
  }

  await admin.query(bootstrap);
  for (const { ruta, sql } of migraciones) {
    await admin.query(sql);
    t.diagnostic(`migración aplicada: ${basename(ruta)}`);
  }
  await admin.query("insert into public.canonical_concepts (canonical_id) values ('cc-banco-001')");

  // ── Fixtures ───────────────────────────────────────────────────────────────
  // Todos los identificadores son uuid aleatorios: ningún valor de este fichero
  // coincide con un dato real, ni siquiera por accidente.
  async function nuevoUsuario() {
    const id = randomUUID();
    await admin.query("insert into auth.users (id) values ($1)", [id]);
    return id;
  }

  async function nuevoPresupuesto(userId, { borrado = false, titulo = "banco" } = {}) {
    const { rows } = await admin.query(
      `insert into public.budgets (user_id, title, deleted_at)
       values ($1, $2, case when $3 then now() else null end)
       returning id`,
      [userId, titulo, borrado]
    );
    return rows[0].id;
  }

  // Los costes sembrados son DISTINTOS DE CERO y distintos entre sí a propósito.
  // Cero es el default de las columnas, así que sembrar ceros haría indistinguible
  // «la fila vieja sigue ahí» de «alguien la reescribió sin costes»: las dos fotos
  // saldrían iguales. Con 3.00 y 6.00 esa confusión ya no es posible.
  async function sembrarPartidas(budgetId, conceptos) {
    for (const [indice, concepto] of conceptos.entries()) {
      await admin.query(
        `insert into public.budget_items
           (budget_id, sort_order, concept, description, quantity, unit, category,
            unit_price, subtotal, unit_price_cost, subtotal_cost)
         values ($1, $2, $3, 'sembrada por el banco', 2, 'ud', 'otros', 5.00, 10.00,
                 3.00, 6.00)`,
        [budgetId, indice, concepto]
      );
    }
  }

  /**
   * Conjunto completo y comparable de las partidas de un presupuesto.
   *
   * Incluye `id` y las DOS columnas de coste a propósito, porque de esta función
   * salen las dos fotos que comparan las pruebas de «nada ha cambiado». El `id`
   * es lo que distingue «no se tocó» de «se borró y se volvió a insertar algo
   * idéntico»: sin él, un DELETE seguido de un INSERT con los mismos valores
   * pasaría por intacto. Y los costes están porque desde
   * `20260908111706_replace_budget_items_persist_cost.sql` la RPC los escribe;
   * dejarlos fuera de la foto haría que una escritura de coste indebida tras un
   * error autorizado pasase desapercibida.
   */
  async function partidas(budgetId, cliente = admin) {
    const { rows } = await cliente.query(
      `select id, budget_id, sort_order, concept, description, quantity, unit,
              category, chapter, unit_price, subtotal,
              unit_price_cost, subtotal_cost, canonical_id,
              canonical_status, canonical_confidence, canonical_source,
              canonical_origin, canonical_source_ref, price_type
         from public.budget_items
        where budget_id = $1
        order by sort_order, id`,
      [budgetId]
    );
    return rows;
  }

  async function cabecera(budgetId) {
    const { rows } = await admin.query(
      "select to_jsonb(b) as fila from public.budgets b where b.id = $1",
      [budgetId]
    );
    return rows[0].fila;
  }

  async function comoUsuario(cliente, userId) {
    await cliente.query("select set_config('request.jwt.claim.sub', $1, false)", [
      userId ?? "",
    ]);
  }

  function llamar(cliente, budgetId, items) {
    return cliente.query("select public.replace_budget_items($1, $2::jsonb) as n", [
      budgetId,
      JSON.stringify(items),
    ]);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 0. EL BANCO SE COMPRUEBA A SÍ MISMO
  // ═══════════════════════════════════════════════════════════════════════════
  // Todas las pruebas que siguen dan por hecho que el bootstrap dejó en pie las
  // restricciones de las que dependen. Si una faltase, varias pasarían sin
  // demostrar nada: sin la UNIQUE, un `sort_order` repetido enviado por el
  // cliente se guardaría tan campante y la prueba de orden sería decorativa.
  //
  // Esto NO afirma que el bootstrap reproduzca todas las restricciones de
  // producción —no lo hace, y no lo pretende: reproduce las relevantes para esta
  // RPC—. Afirma que las cuatro de las que este banco depende están realmente
  // creadas, preguntándoselo al catálogo en vez de suponerlo del fichero.
  await t.test(
    "0. el bootstrap ha creado las restricciones de las que depende este banco",
    async () => {
      const EXIGIDAS = [
        "budget_items_category_check",
        "budget_items_unit_check",
        "ck_budget_items_sort_order_non_negative",
        "uq_budget_items_budget_id_sort_order",
      ];

      const { rows } = await admin.query(
        `select c.conname, c.contype
           from pg_constraint c
          where c.conrelid = 'public.budget_items'::regclass
            and c.conname = any($1::text[])`,
        [EXIGIDAS]
      );

      const presentes = rows.map((f) => f.conname).sort();
      assert.deepEqual(
        presentes,
        [...EXIGIDAS].sort(),
        "faltan restricciones que el banco necesita para no ser vacío"
      );

      const porNombre = new Map(rows.map((f) => [f.conname, f.contype]));
      assert.equal(porNombre.get("budget_items_category_check"), "c", "CHECK");
      assert.equal(porNombre.get("budget_items_unit_check"), "c", "CHECK");
      assert.equal(porNombre.get("ck_budget_items_sort_order_non_negative"), "c", "CHECK");
      assert.equal(
        porNombre.get("uq_budget_items_budget_id_sort_order"),
        "u",
        "UNIQUE, no un CHECK con nombre parecido"
      );
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. ATOMICIDAD REAL: el fallo ocurre DESPUÉS del DELETE
  // ═══════════════════════════════════════════════════════════════════════════
  await t.test(
    "1. un elemento que revienta durante el INSERT revierte también el DELETE",
    async () => {
      const usuario = await nuevoUsuario();
      const presupuesto = await nuevoPresupuesto(usuario);
      await sembrarPartidas(presupuesto, [
        "vieja 0",
        "vieja 1",
        "vieja 2",
        "vieja 3",
        "vieja 4",
      ]);

      const antes = await partidas(presupuesto);
      assert.equal(antes.length, 5, "precondición: cinco partidas sembradas");

      // El TERCER elemento (índice 2) trae `concept`, `quantity` y `unit_price`
      // impecables, así que atraviesa entera la validación previa de la RPC. Lo
      // que lleva envenenado es `canonical_status`, que la RPC TRANSPORTA
      // literalmente sin mirarlo. El fallo, por tanto, no puede ocurrir antes
      // del DELETE: ocurre dentro del INSERT, con las cinco filas viejas ya
      // borradas dentro de la transacción.
      const payload = [
        PAYLOAD_VALIDO("nueva 0"),
        PAYLOAD_VALIDO("nueva 1"),
        PAYLOAD_VALIDO("nueva 2", { canonical_status: "estado_que_no_existe" }),
        PAYLOAD_VALIDO("nueva 3"),
        PAYLOAD_VALIDO("nueva 4"),
      ];

      await comoUsuario(admin, usuario);
      const error = await capturar(
        () => llamar(admin, presupuesto, payload),
        "violación de ck_budget_items_canonical_status"
      );

      assert.equal(
        error.code,
        "23514",
        "el SQLSTATE de la restricción debe PROPAGARSE al llamador, no quedar tragado"
      );
      assert.equal(
        error.constraint,
        "ck_budget_items_canonical_status",
        "y debe identificar exactamente qué restricción se violó"
      );

      // ESTA es la aserción que distingue atomicidad de validación previa. Si la
      // RPC hubiese rechazado el elemento en su bucle de validación, el mensaje
      // empezaría por 'replace_budget_items:' y el DELETE nunca se habría
      // ejecutado: la prueba pasaría sin demostrar nada.
      assert.ok(
        !error.message.startsWith("replace_budget_items:"),
        "el fallo debe venir de la restricción durante el INSERT, no de la " +
          `validación previa de la RPC. Mensaje recibido: ${error.message}`
      );

      const despues = await partidas(presupuesto);
      assert.deepEqual(
        despues,
        antes,
        "las cinco filas viejas deben conservar EXACTAMENTE los mismos ids y el " +
          "mismo contenido: eso es lo que prueba que el DELETE se revirtió"
      );
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. CONJUNTO VACÍO
  // ═══════════════════════════════════════════════════════════════════════════
  await t.test("2. `[]` devuelve 0 y deja el presupuesto sin partidas", async () => {
    const usuario = await nuevoUsuario();
    const presupuesto = await nuevoPresupuesto(usuario);
    await sembrarPartidas(presupuesto, ["a", "b", "c"]);

    await comoUsuario(admin, usuario);
    const { rows } = await llamar(admin, presupuesto, []);

    assert.equal(rows[0].n, 0, "el array vacío es un resultado válido, no un error");
    assert.deepEqual(
      await partidas(presupuesto),
      [],
      "y el borrado se mantiene: el conjunto vacío es un conjunto"
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. AUTORIZACIÓN INDISTINGUIBLE
  // ═══════════════════════════════════════════════════════════════════════════
  await t.test(
    "3. ajeno, borrado e inexistente devuelven el MISMO 42501 y el mismo mensaje",
    async () => {
      const usuario = await nuevoUsuario();
      const otro = await nuevoUsuario();

      const ajeno = await nuevoPresupuesto(otro, { titulo: "de otro" });
      await sembrarPartidas(ajeno, ["ajena 0", "ajena 1"]);

      const borrado = await nuevoPresupuesto(usuario, { borrado: true });
      await sembrarPartidas(borrado, ["borrada 0"]);

      const inexistente = randomUUID();

      const ajenoAntes = await partidas(ajeno);
      const borradoAntes = await partidas(borrado);

      await comoUsuario(admin, usuario);

      const payload = [PAYLOAD_VALIDO("intrusa")];
      const errores = [];
      for (const objetivo of [ajeno, borrado, inexistente]) {
        errores.push(
          await capturar(() => llamar(admin, objetivo, payload), "42501 de disponibilidad")
        );
      }

      const ESPERADO = "replace_budget_items: el presupuesto no está disponible";
      for (const [indice, error] of errores.entries()) {
        assert.equal(error.code, "42501", `caso ${indice}: SQLSTATE`);
        assert.equal(error.message, ESPERADO, `caso ${indice}: mensaje`);
      }

      // La afirmación fuerte no es que los tres fallen, sino que fallan de forma
      // INDISTINGUIBLE. Si difiriesen en una coma, la función sería un oráculo:
      // permitiría averiguar qué presupuestos existen probando uuids.
      assert.equal(
        new Set(errores.map((e) => `${e.code}|${e.message}`)).size,
        1,
        "los tres casos deben ser indistinguibles desde fuera"
      );

      assert.deepEqual(await partidas(ajeno), ajenoAntes, "el ajeno no se toca");
      assert.deepEqual(await partidas(borrado), borradoAntes, "el borrado no se toca");
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ORDEN Y TRANSPORTE
  // ═══════════════════════════════════════════════════════════════════════════
  await t.test(
    "4. el orden lo fija el array, `budget_id` del JSON se ignora y el subtotal se transporta",
    async () => {
      const usuario = await nuevoUsuario();
      const otro = await nuevoUsuario();
      const presupuesto = await nuevoPresupuesto(usuario);
      const ajeno = await nuevoPresupuesto(otro, { titulo: "objetivo del secuestro" });
      await sembrarPartidas(ajeno, ["ajena intacta"]);

      const ajenoAntes = await partidas(ajeno);
      const cabeceraAntes = await cabecera(presupuesto);

      const payload = [
        // sort_order repetido y absurdo; `unit` y `category` vacías para que se
        // apliquen los defaults del INSERT; `subtotal` ausente para que se
        // calcule: 2.50 × 1.11 = 2.775 -> round(,2) -> 2.78.
        {
          concept: "  primera con espacios  ",
          quantity: "2.5",
          unit_price: "1.11",
          unit: "",
          category: "",
          sort_order: 7,
        },
        // El `budget_id` del JSON apunta al presupuesto de OTRO usuario. Debe
        // ignorarse: aceptarlo convertiría una llamada autorizada para este
        // presupuesto en una escritura sobre el de un tercero.
        {
          concept: "segunda",
          quantity: "1",
          unit_price: "10.00",
          subtotal: "999.99",
          sort_order: 7,
          budget_id: ajeno,
        },
        // Transporte canónico completo, en una combinación que las restricciones
        // de coherencia aceptan: resolved exige id, confianza 1.00 y fuente
        // exacta; origin 'import' exige source_ref.
        {
          concept: "tercera",
          quantity: "3",
          unit_price: "2.00",
          description: "descripción propia",
          chapter: "capitulo-1",
          canonical_id: "cc-banco-001",
          canonical_status: "resolved",
          canonical_confidence: "1.00",
          canonical_source: "exact_curated",
          canonical_origin: "import",
          canonical_source_ref: "obramat",
          price_type: "MATERIAL_ONLY",
          sort_order: -3,
        },
      ];

      await comoUsuario(admin, usuario);
      const { rows } = await llamar(admin, presupuesto, payload);
      assert.equal(rows[0].n, 3, "devuelve el número REAL de filas insertadas");

      const filas = await partidas(presupuesto);
      assert.equal(filas.length, 3);

      // Orden: 0..N-1 en el orden del array, pese a los 7, 7 y -3 enviados.
      assert.deepEqual(
        filas.map((f) => f.sort_order),
        [0, 1, 2],
        "`with ordinality` manda; el sort_order del JSON no se lee"
      );
      assert.deepEqual(
        filas.map((f) => f.concept),
        ["primera con espacios", "segunda", "tercera"],
        "y el orden persistido es el del array, con el concept ya recortado"
      );

      // `budget_id`: el del parámetro, siempre.
      for (const fila of filas) {
        assert.equal(fila.budget_id, presupuesto, "el budget_id sale del parámetro");
      }
      assert.deepEqual(
        await partidas(ajeno),
        ajenoAntes,
        "el presupuesto ajeno nombrado en el JSON queda intacto"
      );

      // Defaults del INSERT para unit y category vacías.
      assert.equal(filas[0].unit, "ud");
      assert.equal(filas[0].category, "otros");
      assert.equal(filas[0].description, "", "description ausente -> cadena vacía");

      // Subtotal: calculado y redondeado cuando falta.
      assert.equal(
        filas[0].subtotal,
        "2.78",
        "2.50 × 1.11 = 2.775, redondeado a 2.78"
      );

      // Subtotal: transportado literalmente cuando viene, aunque NO coincida con
      // quantity × unit_price. Es la divergencia deliberada con
      // update_budget_with_items, que siempre recalcula.
      assert.equal(filas[1].subtotal, "999.99", "el subtotal enviado se transporta");
      assert.notEqual(
        filas[1].subtotal,
        "10.00",
        "y NO se recalcula como quantity × unit_price"
      );

      // Campos canónicos: transporte literal, sin clasificar ni corregir.
      assert.equal(filas[2].canonical_id, "cc-banco-001");
      assert.equal(filas[2].canonical_status, "resolved");
      assert.equal(filas[2].canonical_confidence, "1.00");
      assert.equal(filas[2].canonical_source, "exact_curated");
      assert.equal(filas[2].canonical_origin, "import");
      assert.equal(filas[2].canonical_source_ref, "obramat");
      assert.equal(filas[2].price_type, "MATERIAL_ONLY");
      assert.equal(filas[2].chapter, "capitulo-1");

      // Réplica del default de la columna para las que no lo traen.
      assert.equal(filas[0].canonical_status, "unmatched");
      assert.equal(filas[0].canonical_id, null);

      // La cabecera no se toca. Se compara la fila ENTERA, no sólo updated_at:
      // así la aserción no envejece si mañana alguien añade una columna.
      assert.deepEqual(
        await cabecera(presupuesto),
        cabeceraAntes,
        "la RPC sólo bloquea la cabecera con FOR UPDATE; no escribe en ella"
      );
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CONCURRENCIA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sondea `pg_stat_activity` hasta ver el backend indicado esperando un Lock.
   * Devuelve la fila observada o lanza al agotarse el plazo.
   */
  async function esperarBloqueo(observador, pid, plazoMs) {
    const limite = Date.now() + plazoMs;
    let ultima = null;
    while (Date.now() < limite) {
      const { rows } = await observador.query(
        `select state, wait_event_type, wait_event, query
           from pg_stat_activity
          where pid = $1`,
        [pid]
      );
      ultima = rows[0] ?? null;
      if (ultima && ultima.wait_event_type === "Lock") return ultima;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(
      `El backend ${pid} no llegó a esperar en un Lock en ${plazoMs} ms. ` +
        `Último estado observado: ${JSON.stringify(ultima)}. Si la RPC no bloquease ` +
        "la cabecera, las dos sustituciones podrían entrelazarse."
    );
  }

  await t.test(
    "5. dos sustituciones simultáneas se serializan en el bloqueo de la cabecera",
    async () => {
      const usuario = await nuevoUsuario();
      const presupuesto = await nuevoPresupuesto(usuario);
      await sembrarPartidas(presupuesto, ["inicial"]);

      const a = await conectar();
      const b = await conectar();

      const { rows: pidRows } = await b.query("select pg_backend_pid() as pid");
      const pidB = pidRows[0].pid;

      const payloadA = [PAYLOAD_VALIDO("de A 0"), PAYLOAD_VALIDO("de A 1")];
      const payloadB = [
        PAYLOAD_VALIDO("de B 0"),
        PAYLOAD_VALIDO("de B 1"),
        PAYLOAD_VALIDO("de B 2"),
      ];

      // Esta prueba deja a propósito una transacción abierta reteniendo un
      // bloqueo y otra esperándolo. Si una aserción falla en ese intervalo, sin
      // un `finally` quedarían una promesa colgada para siempre y dos
      // transacciones abiertas: el banco no informaría de la regresión, se
      // quedaría clavado. El orden del desmontaje no es arbitrario —hay que
      // deshacer A para que se libere el bloqueo y B pueda terminar— y por eso
      // va explicado paso a paso abajo.
      let promesaB = null;
      let confirmadoA = false;
      let confirmadoB = false;

      try {
        await a.query("begin");
        await comoUsuario(a, usuario);
        const { rows: filasA } = await llamar(a, presupuesto, payloadA);
        assert.equal(filasA[0].n, 2);
        // A NO confirma todavía: mantiene el FOR UPDATE sobre la cabecera.

        await b.query("begin");
        await comoUsuario(b, usuario);

        let terminadoB = false;
        let errorB = null;
        promesaB = llamar(b, presupuesto, payloadB).then(
          (resultado) => {
            terminadoB = true;
            return resultado;
          },
          (error) => {
            terminadoB = true;
            errorB = error;
            return null;
          }
        );

        // ── La comprobación determinista ──────────────────────────────────────
        // No se afirma «B espera» porque haya pasado un rato: eso sólo probaría
        // que el ordenador estaba ocupado. Se le PREGUNTA a PostgreSQL, desde una
        // tercera conexión, en qué está esperando el backend de B. El sondeo
        // tiene un tope y falla si se agota: un banco que se cuelga no informa de
        // nada.
        const espera = await esperarBloqueo(admin, pidB, 15000);
        assert.equal(
          espera.wait_event_type,
          "Lock",
          "el backend de B debe estar esperando un LOCK, no simplemente tardando"
        );
        assert.equal(
          terminadoB,
          false,
          "y no puede haber terminado mientras A mantiene su transacción abierta"
        );

        await a.query("commit");
        confirmadoA = true;

        const resultadoB = await promesaB;
        assert.equal(errorB, null, "B no falla: espera y luego procede");
        assert.equal(resultadoB.rows[0].n, 3);
        await b.query("commit");
        confirmadoB = true;

        const finales = await partidas(presupuesto);
        assert.deepEqual(
          finales.map((f) => f.concept),
          ["de B 0", "de B 1", "de B 2"],
          "el conjunto final es EXACTAMENTE el de B: FOR UPDATE ordena por llegada"
        );
        assert.deepEqual(
          finales.map((f) => f.sort_order),
          [0, 1, 2],
          "sin mezcla de ambos conjuntos, y con el orden intacto"
        );
      } finally {
        // 1. Deshacer A primero. Es lo que LIBERA el bloqueo de la cabecera; sin
        //    esto, la llamada de B seguiría esperando y el `await` de abajo no
        //    volvería nunca.
        if (!confirmadoA) {
          try {
            await a.query("rollback");
          } catch {
            // La conexión puede estar ya inservible; no hay nada que rescatar.
          }
        }

        // 2. Liberado el bloqueo, la llamada de B termina de una forma u otra.
        //    `promesaB` ya tiene manejador de rechazo, así que este `await` no
        //    puede lanzar; el `catch` es cinturón sobre tirantes.
        if (promesaB) {
          try {
            await promesaB;
          } catch {
            // Ignorado: el fallo real ya viene propagándose desde el `try`.
          }
        }

        // 3. Y sólo entonces se puede cerrar la transacción de B.
        if (!confirmadoB) {
          try {
            await b.query("rollback");
          } catch {
            // Ídem.
          }
        }
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. ACL EFECTIVA
  // ═══════════════════════════════════════════════════════════════════════════
  await t.test("6. sólo `authenticated` puede ejecutar la función", async () => {
    const FIRMA = "public.replace_budget_items(uuid, jsonb)";

    // ── Catálogo ──────────────────────────────────────────────────────────────
    const { rows: privilegios } = await admin.query(
      `select has_function_privilege('authenticated', $1, 'EXECUTE') as autenticado,
              has_function_privilege('anon',          $1, 'EXECUTE') as anonimo,
              has_function_privilege('service_role',  $1, 'EXECUTE') as servicio`,
      [FIRMA]
    );
    assert.equal(privilegios[0].autenticado, true, "authenticated: EXECUTE");
    assert.equal(privilegios[0].anonimo, false, "anon: sin EXECUTE");
    assert.equal(privilegios[0].servicio, false, "service_role: sin EXECUTE");

    // PUBLIC no es un rol y `has_function_privilege` no lo admite: hay que leer
    // la ACL. En el texto de un aclitem, la concesión a PUBLIC se escribe con el
    // concesionario VACÍO, es decir, la entrada empieza por '='. Esto es lo que
    // demuestra que los `revoke ... from public` de la migración surtieron
    // efecto, y no es cosmético: PostgreSQL concede EXECUTE a PUBLIC por defecto
    // en toda función nueva.
    const { rows: acl } = await admin.query(
      `select coalesce(p.proacl::text[], '{}') as acl
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'replace_budget_items'`
    );
    assert.equal(acl.length, 1, "la función existe y una sola vez");
    assert.ok(
      acl[0].acl.length > 0,
      "la ACL no puede estar vacía: una ACL nula significa 'los defaults', y el " +
        "default de PostgreSQL incluye EXECUTE para PUBLIC"
    );
    assert.deepEqual(
      acl[0].acl.filter((entrada) => entrada.startsWith("=")),
      [],
      "no puede quedar ninguna concesión a PUBLIC"
    );

    // ── Llamadas reales ───────────────────────────────────────────────────────
    // El catálogo dice lo que PostgreSQL cree; esto comprueba lo que PostgreSQL
    // hace. No es redundante: un privilegio puede existir y una llamada fallar
    // igualmente, y al revés.
    const usuario = await nuevoUsuario();
    const presupuesto = await nuevoPresupuesto(usuario);
    await comoUsuario(admin, usuario);

    for (const rol of ["anon", "service_role"]) {
      await admin.query(`set role ${rol}`);
      const error = await capturar(
        () => llamar(admin, presupuesto, [PAYLOAD_VALIDO("desde un rol sin permiso")]),
        `42501 de privilegio para ${rol}`
      );
      await admin.query("reset role");

      assert.equal(error.code, "42501", `${rol}: SQLSTATE de privilegio insuficiente`);
      assert.match(
        error.message,
        /function/i,
        `${rol}: el mensaje del rechazo debe identificar la FUNCIÓN, que es el ` +
          `objeto cuyo EXECUTE está revocado`
      );
    }

    assert.deepEqual(
      await partidas(presupuesto),
      [],
      "ninguna de las llamadas denegadas ha escrito nada"
    );

    await admin.query("set role authenticated");
    const { rows } = await llamar(admin, presupuesto, [PAYLOAD_VALIDO("desde authenticated")]);
    await admin.query("reset role");

    assert.equal(rows[0].n, 1, "authenticated sí puede ejecutarla");
    assert.equal((await partidas(presupuesto)).length, 1);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. PERSISTENCIA DEL COSTE
  // ═══════════════════════════════════════════════════════════════════════════
  // Lo que añade `20260908111706_replace_budget_items_persist_cost.sql`, y nada
  // más: transporte de `unit_price_cost` y `subtotal_cost`, derivación del
  // segundo cuando falta, y rechazo de los dos cuando no son números.
  //
  // ESTA COBERTURA ESTÁ EN UNA FUNCIÓN, Y NO INLINE EN EL `t.test`, PORQUE SE
  // EJECUTA DOS VECES. La prueba 7 la ejecuta contra la RPC actual y espera que
  // pase; el control negativo de la prueba 8 la ejecuta contra la RPC ANTERIOR y
  // espera que FALLE. Escribirla dos veces habría permitido que las dos copias
  // divergieran, y entonces el control negativo dejaría de hablar de esta
  // cobertura para hablar de otra parecida. Al ser el mismo código, «la RPC
  // antigua no pasa estas comprobaciones» es literal.
  //
  // Crea sus propias fixtures en cada llamada: las dos ejecuciones no pueden
  // compartir filas ni presupuestos.
  async function ejercerCoberturaDeCostes() {
    const usuario = await nuevoUsuario();
    await comoUsuario(admin, usuario);

    // ── 7.1 Coste ausente, coste explícito y coste derivado, en una llamada ───
    const presupuesto = await nuevoPresupuesto(usuario);
    const { rows: escritas } = await llamar(admin, presupuesto, [
      // (0) Sin ninguna columna de coste. La RPC nombra las dos columnas en su
      //     INSERT, lo que DESACTIVA su DEFAULT, así que el 0 que debe quedar
      //     aquí es el `coalesce(..., 0)` de la función y no el default de la
      //     tabla. Los dos valen 0 y por eso el banco no puede distinguirlos por
      //     el resultado; lo que sí comprueba es que el hueco no acabe en NULL,
      //     que es lo que pasaría si la RPC nombrase la columna sin coalesce.
      { concept: "sin coste", quantity: "2", unit_price: "10.00" },
      // (1) Los dos costes explícitos, y deliberadamente INCOHERENTES entre sí:
      //     4.00 × 2 = 8.00, pero se envía 99.99. Si la RPC recalculase en vez
      //     de transportar, saldría 8.00 y el envío se habría perdido en
      //     silencio. Dos decimales en la entrada porque numeric(12,2) redondea
      //     al almacenar y un tercer decimal impediría distinguir transporte de
      //     recálculo.
      {
        concept: "coste explícito",
        quantity: "2",
        unit_price: "10.00",
        unit_price_cost: "4.00",
        subtotal_cost: "99.99",
      },
      // (2) Sólo el unitario: el total se deriva. 3.33 × 1.11 = 3.6963 -> 3.70.
      {
        concept: "coste derivado",
        quantity: "3.33",
        unit_price: "10.00",
        unit_price_cost: "1.11",
      },
      // (3) Cadenas vacías. El `nullif(..., '')` de la RPC las trata como
      //     ausencia, no como cero textual ni como error de conversión. Sin ese
      //     nullif, `''::numeric` reventaría con 22P02 y este elemento sería un
      //     fallo, no un cero.
      {
        concept: "coste vacío",
        quantity: "2",
        unit_price: "10.00",
        unit_price_cost: "",
        subtotal_cost: "",
      },
    ]);
    assert.equal(escritas[0].n, 4);

    const filas = await partidas(presupuesto);
    assert.equal(filas.length, 4);

    assert.equal(filas[0].unit_price_cost, "0.00", "coste unitario ausente -> 0");
    assert.equal(filas[0].subtotal_cost, "0.00", "coste total ausente -> 0");
    assert.notEqual(filas[0].unit_price_cost, null, "ausente es 0, nunca NULL");
    assert.notEqual(filas[0].subtotal_cost, null, "ausente es 0, nunca NULL");

    assert.equal(filas[1].unit_price_cost, "4.00", "el coste unitario se transporta");
    assert.equal(filas[1].subtotal_cost, "99.99", "el coste total se transporta");
    assert.notEqual(
      filas[1].subtotal_cost,
      "8.00",
      "y NO se recalcula como quantity × unit_price_cost cuando viene dado"
    );

    // DERIVACIÓN, no redondeo. Esta aserción demuestra que el total sale de
    // `quantity × unit_price_cost`; NO demuestra quién redondeó. El `round(..., 2)`
    // de la RPC y el redondeo de numeric(12,2) al almacenar producen el mismo
    // valor para cualquier entrada, así que el banco no puede separarlos y no se
    // afirma que lo haga.
    assert.equal(
      filas[2].subtotal_cost,
      "3.70",
      "3.33 × 1.11 = 3.6963, a dos decimales 3.70"
    );
    assert.equal(filas[2].unit_price_cost, "1.11");

    assert.equal(filas[3].unit_price_cost, "0.00", "cadena vacía = ausente");
    assert.equal(filas[3].subtotal_cost, "0.00", "cadena vacía = ausente");

    // Lo que la migración de costes NO cambia sigue en pie en la misma llamada.
    assert.deepEqual(
      filas.map((f) => f.sort_order),
      [0, 1, 2, 3],
      "el orden lo sigue fijando el array"
    );
    assert.equal(filas[0].subtotal, "20.00", "el subtotal de venta no lo toca el coste");

    // ── 7.2 Rechazo de valores que no son números ─────────────────────────────
    // Cuatro casos: no numérico y NaN, en cada uno de los dos campos. El NaN
    // merece caso propio porque `'NaN'::numeric` NO lanza: es un valor numérico
    // legítimo para PostgreSQL. Sin la comprobación explícita entraría en la
    // tabla y falsearía el margen del PDF interno en vez de fallar.
    const CASOS = [
      { campo: "unit_price_cost", valor: "cuatro euros", cola: "un unit_price_cost no numérico" },
      { campo: "unit_price_cost", valor: "NaN", cola: "unit_price_cost = NaN" },
      { campo: "subtotal_cost", valor: "doce", cola: "un subtotal_cost no numérico" },
      { campo: "subtotal_cost", valor: "NaN", cola: "subtotal_cost = NaN" },
    ];

    for (const { campo, valor, cola } of CASOS) {
      const objetivo = await nuevoPresupuesto(usuario, { titulo: `rechazo ${campo}` });
      await sembrarPartidas(objetivo, ["previa 0", "previa 1"]);
      const antes = await partidas(objetivo);
      assert.equal(antes.length, 2, "precondición del caso de rechazo");

      // El elemento envenenado va en la POSICIÓN 1, no en la 0, para que el
      // índice del mensaje pueda equivocarse y notarse. Con el veneno en la 0,
      // un error de desplazamiento daría 0 igualmente.
      const error = await capturar(
        () =>
          llamar(admin, objetivo, [
            PAYLOAD_VALIDO("buena"),
            PAYLOAD_VALIDO("envenenada", { [campo]: valor }),
          ]),
        `22023 por ${campo} = ${JSON.stringify(valor)}`
      );

      assert.equal(error.code, "22023", `${campo}=${valor}: SQLSTATE`);
      assert.equal(
        error.message,
        `replace_budget_items: el elemento 1 tiene ${cola}`,
        `${campo}=${valor}: el mensaje debe nombrar el campo y el índice base 0`
      );

      // La validación es previa al DELETE, así que aquí no basta con que las
      // filas «sigan estando»: deben ser LAS MISMAS, con los mismos ids y los
      // mismos costes sembrados. `partidas()` incluye ambas cosas.
      assert.deepEqual(
        await partidas(objetivo),
        antes,
        `${campo}=${valor}: un payload rechazado no puede haber tocado nada`
      );
    }
  }

  await t.test(
    "7. la RPC persiste el coste: ausente, explícito, derivado y rechazado",
    async () => {
      await ejercerCoberturaDeCostes();
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. CONTROL NEGATIVO: la RPC ANTERIOR no supera la cobertura de costes
  // ═══════════════════════════════════════════════════════════════════════════
  // Una prueba que pasa no dice si prueba algo. Esta responde a esa pregunta:
  // sustituye la función por la de la migración original —`create or replace`
  // sobre la misma firma, que es exactamente lo que hace la de costes— y exige
  // que la MISMA cobertura de la prueba 7 falle.
  //
  // Se ejecuta la última a propósito, porque deja la base en un estado
  // intermedio mientras dura. La restauración va en un `finally` y se COMPRUEBA
  // después: reaplicar y no verificarlo sería confiar en que el SQL hizo lo que
  // se esperaba justo en el sitio donde el banco está demostrando que no hay que
  // confiar.
  await t.test(
    "8. la RPC anterior a la persistencia de costes NO pasa la prueba 7",
    async () => {
      const sqlOriginal = await readFile(RUTA_MIGRACION_ORIGINAL, "utf8");
      const sqlCostes = await readFile(RUTA_MIGRACION_COSTES, "utf8");

      let fallo = null;
      try {
        await admin.query(sqlOriginal);
        await ejercerCoberturaDeCostes();
      } catch (error) {
        fallo = error;
      } finally {
        // Pase lo que pase, la RPC vuelve a ser la actual.
        await admin.query(sqlCostes);
      }

      assert.ok(
        fallo,
        "la cobertura de costes ha pasado contra la RPC ANTERIOR, que no nombra " +
          "unit_price_cost ni subtotal_cost en su INSERT. Si pasa con las dos " +
          "versiones, no está midiendo lo que la migración de costes añade."
      );
      assert.ok(
        fallo instanceof assert.AssertionError,
        "el fallo debe ser una aserción de la cobertura, no un error de conexión " +
          `o de SQL ajeno a lo que se mide. Recibido: ${fallo?.stack ?? fallo}`
      );

      // El punto EXACTO en que cae importa. La RPC anterior no nombra las
      // columnas de coste, así que su INSERT deja actuar al DEFAULT 0: el caso
      // «coste ausente -> 0» lo pasa igual que la actual, y por eso no puede ser
      // ése el que detecte la diferencia. Lo que no puede hacer de ninguna
      // manera es TRANSPORTAR un coste enviado, y ahí es donde se la espera.
      assert.match(
        String(fallo.message),
        /el coste unitario se transporta/,
        "el control debe caer en el TRANSPORTE del coste, que es lo que la " +
          "migración añade, y no en cualquier otra aserción"
      );
      t.diagnostic(`control negativo: la RPC anterior falla en «${fallo.message.split("\n")[0]}»`);

      // ── La restauración se comprueba, no se supone ────────────────────────
      const { rows: definicion } = await admin.query(
        `select p.prosrc like '%unit_price_cost%' as nombra_el_coste
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'replace_budget_items'`
      );
      assert.equal(definicion.length, 1, "sigue habiendo una sola función");
      assert.equal(
        definicion[0].nombra_el_coste,
        true,
        "tras el control negativo debe quedar restaurada la RPC CON persistencia " +
          "de costes"
      );

      // Y se vuelve a ejercer entera: que el texto mencione la columna no prueba
      // que la función se comporte.
      await ejercerCoberturaDeCostes();
    }
  );
});
