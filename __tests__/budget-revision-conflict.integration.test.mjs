import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * BANCO DESECHABLE DEL CONTRATO DE CONFLICTO PT409 — FASE 2F-2, LOTE 0
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ DEMUESTRA, Y QUÉ NO
 * ───────────────────────────────────────────────────────────────────────────
 * Demuestra UNA cosa, de extremo a extremo y sobre la pila real: que un
 * SQLSTATE `PT409` lanzado dentro de una función de PostgreSQL llega al cliente
 * como HTTP 409, con `code = "PT409"` en el cuerpo, en UNA sola petición, sin
 * reintento automático, y SIN HABER MODIFICADO NADA.
 *
 * NO demuestra que el diseño de 2F-2 sea correcto. NO prueba ninguna RPC de
 * producción: todo lo que toca vive en tablas y funciones inventadas con el
 * prefijo `pt409_bench_`. La pregunta que responde es de mecanismo, no de
 * diseño: ¿se puede confiar en que ese canal de señalización funciona antes de
 * construir sobre él? Si la respuesta hubiera sido «no», el diseño entero de
 * 2F-2 se cae, y más vale saberlo con un banco desechable que con una migración
 * aplicada.
 *
 * La razón de fondo es la que motiva toda la fase: PostgREST envuelve cada
 * petición HTTP en UNA transacción, así que varias idas y vueltas no pueden ser
 * atómicas y sólo una llamada RPC puede serlo. Ese hecho se AFIRMA en el
 * informe; aquí se COMPRUEBA, con el mutante C.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ CUESTA TANTO EJECUTARLO
 * ───────────────────────────────────────────────────────────────────────────
 * El bootstrap BORRA los esquemas `public` y `auth` enteros, y además CREA Y
 * MODIFICA ROLES. Los esquemas viven dentro de una base; los roles pertenecen al
 * CLÚSTER y existen para todas sus bases a la vez. Comprobar el nombre de la
 * base, por tanto, no protege a los demás proyectos que compartan servidor: el
 * daño que este banco puede hacerles no ocurre dentro de ninguna base. Por eso
 * lo que se exige no es una base desechable, sino un CLÚSTER desechable, y por
 * eso hay dos acuses de recibo distintos y no uno.
 *
 * Para ejecutarlo:
 *
 *   RUN_REVISION_CONFLICT_INTEGRATION_TESTS=1 \
 *   REVISION_CONFLICT_TEST_DB_ACK=DISPOSABLE_ONLY \
 *   REVISION_CONFLICT_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER \
 *   TEST_DATABASE_URL=postgres://postgres:...@127.0.0.1:55433/enlaze_revision_conflict_test \
 *   TEST_POSTGREST_URL=http://127.0.0.1:53001 \
 *   TEST_JWT_SECRET=... \
 *   TEST_PGRST_AUTHENTICATOR_PASSWORD=... \
 *   npm run test:budget-revision-conflict-integration
 *
 * Sin `RUN_REVISION_CONFLICT_INTEGRATION_TESTS=1` el banco se marca SKIP y no
 * abre ni una conexión. Con el opt-in puesto pero alguna guarda incumplida,
 * ABORTA con un fallo ruidoso: callar ahí sería lo peligroso, porque significa
 * que alguien quiso ejecutarlo y el entorno no es el que cree.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * QUÉ SE COMPRUEBA SIEMPRE, INCLUSO EN MODO NORMAL
 * ───────────────────────────────────────────────────────────────────────────
 * El primer bloque de este fichero comprueba LAS GUARDAS Y LOS COMPARADORES, no
 * la base de datos. Son funciones puras: no abren conexiones, no hacen red y no
 * tocan nada. Se ejecutan siempre, también en modo normal, y son las que
 * demuestran que las afirmaciones del banco agarran. Un banco cuyas guardas
 * nunca se prueban es un banco que un día dejará de tenerlas sin que nadie se
 * entere.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RUTA_BOOTSTRAP = resolve(AQUI, "support/bootstrap-budget-revision-conflict.sql");
const RUTA_FIXTURE_ECONOMICO = resolve(AQUI, "fixtures/budget-economic-golden-vectors.json");
const RUTA_FIXTURE_ACL = resolve(AQUI, "fixtures/budget-acl-baseline.json");

const HOSTS_PERMITIDOS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const PROTOCOLOS_DB_PERMITIDOS = new Set(["postgres:", "postgresql:"]);

// `https:` NO está admitido, y conviene decir por qué en vez de dejarlo como una
// omisión. El PostgREST de este banco es un contenedor sin TLS que escucha en
// texto claro en 127.0.0.1. Si TEST_POSTGREST_URL trajera `https:`, la conexión
// no llegaría a ese contenedor: iría a otro sitio, o fallaría el saludo TLS. Un
// esquema `https:` en esta variable no es una preferencia de seguridad, es la
// señal de que se está apuntando a algo que NO es el banco desechable. Se
// rechaza por eso, no a pesar de ser el esquema más seguro.
const PROTOCOLO_PGRST_EXIGIDO = "http:";
const PUERTO_PGRST_EXIGIDO = "53001";

const PUERTO_DB_EXIGIDO = "55433";
const BASE_EXIGIDA = "enlaze_revision_conflict_test";
const AJUSTE_MARCADOR = "enlaze.test_cluster_marker";
const MARCADOR_EXIGIDO = "revision_conflict_2f2";

const TESTIGO_PASSWORD = ":'pt409_bench_authenticator_password'";

// `pg` toma de estas variables lo que la cadena de conexión no fije, así que su
// mera presencia hace que la URL inspeccionada por las guardas deje de describir
// del todo a dónde va a conectarse el driver. PGOPTIONS además permite fijar
// `enlaze.test_cluster_marker` por sesión, es decir, FALSIFICAR el marcador que
// este banco comprueba después de conectar. Se rechazan por estar presentes, sea
// cual sea su valor, y nunca se imprimen los valores: PGPASSWORD es una
// credencial y estos mensajes acaban en registros de CI.
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

const MENSAJE_SKIP =
  "NO SE HA EJECUTADO NINGUNA PRUEBA DE CONFLICTO. Este banco necesita un " +
  "clúster PostgreSQL dedicado y desechable más un PostgREST local, y no se ha " +
  "pedido su ejecución. Nada de lo que contiene ha sido verificado: ni la " +
  "traducción de PT409 a HTTP 409, ni la forma del cuerpo de error, ni la " +
  "ausencia de reintento, ni la ausencia de efectos tras el conflicto, ni el " +
  "incremento exacto de la revisión. NO se afirma que pase. Para ejecutarlo " +
  "hacen falta RUN_REVISION_CONFLICT_INTEGRATION_TESTS=1 y DOS confirmaciones, " +
  "porque el banco destruye cosas en dos ámbitos: " +
  "REVISION_CONFLICT_TEST_DB_ACK=DISPOSABLE_ONLY (la BASE es desechable: se le " +
  "borran los esquemas public y auth) y " +
  "REVISION_CONFLICT_TEST_CLUSTER_ACK=DISPOSABLE_CLUSTER (el CLÚSTER ENTERO lo " +
  "es: se le crean y modifican roles, que no pertenecen a ninguna base en " +
  `particular). Además TEST_DATABASE_URL debe apuntar a 127.0.0.1:${PUERTO_DB_EXIGIDO} ` +
  `y a la base ${BASE_EXIGIDA}, TEST_POSTGREST_URL debe ser exactamente ` +
  `${PROTOCOLO_PGRST_EXIGIDO}//<bucle local>:${PUERTO_PGRST_EXIGIDO}/ sin ruta, ` +
  `consulta ni fragmento, y el clúster debe haberse arrancado con ` +
  `-c ${AJUSTE_MARCADOR}=${MARCADOR_EXIGIDO}.`;

const OPT_IN = process.env.RUN_REVISION_CONFLICT_INTEGRATION_TESTS === "1";

// ═══════════════════════════════════════════════════════════════════════════
// GUARDAS — funciones puras, comprobables sin infraestructura
// ═══════════════════════════════════════════════════════════════════════════

function componerFallo(fallos) {
  return (
    "GUARDAS DE SEGURIDAD INCUMPLIDAS. El banco se ha detenido ANTES de abrir " +
    "ninguna conexión y ANTES de ejecutar ninguna sentencia. No se ha " +
    "modificado nada.\n\n  · " +
    fallos.join("\n  · ")
  );
}

/**
 * Valida la URL de PostgREST. Se comprueba ANTES de conectar, no después: una
 * guarda que se comprueba después de la primera petición no es una guarda.
 */
export function validarUrlPostgrest(bruta) {
  const fallos = [];

  if (typeof bruta !== "string" || bruta.trim() === "") {
    throw new Error(componerFallo(["TEST_POSTGREST_URL no está definida."]));
  }

  let url;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error(componerFallo(["TEST_POSTGREST_URL no es una URL válida."]));
  }

  if (url.protocol !== PROTOCOLO_PGRST_EXIGIDO) {
    fallos.push(
      `TEST_POSTGREST_URL usa el protocolo '${url.protocol}' y el banco exige ` +
        `exactamente '${PROTOCOLO_PGRST_EXIGIDO}'. El PostgREST de este banco es un ` +
        "contenedor sin TLS en bucle local; cualquier otro esquema, 'https:' " +
        "incluido, significa que se está apuntando a algo que no es él."
    );
  }

  // Ésta es la guarda que impide que el banco dispare contra un PostgREST real.
  // No se acepta ningún nombre de host que haya que resolver: un nombre resuelve
  // a lo que diga el DNS del momento, y eso es exactamente lo que no puede
  // decidir a qué base se le manda un RPC que escribe.
  if (!HOSTS_PERMITIDOS.has(url.hostname)) {
    fallos.push(
      `TEST_POSTGREST_URL apunta al host '${url.hostname}'. Sólo se admiten ` +
        `${[...HOSTS_PERMITIDOS].join(", ")}. Este banco llama a funciones que ` +
        "escriben, y un host que no sea de bucle local puede ser cualquier cosa, " +
        "incluida una instalación real."
    );
  }

  if (url.username !== "" || url.password !== "") {
    fallos.push(
      "TEST_POSTGREST_URL no debe llevar credenciales incrustadas: la " +
        "autorización va en el JWT, y una credencial en la URL acaba en los " +
        "registros de CI."
    );
  }

  if (url.port !== PUERTO_PGRST_EXIGIDO) {
    fallos.push(
      `TEST_POSTGREST_URL usa el puerto '${url.port || "<ninguno>"}' y el banco ` +
        `exige exactamente ${PUERTO_PGRST_EXIGIDO}. Sin puerto explícito la URL ` +
        "caería en el 80, que es donde suele haber un proxy o un servidor de " +
        "verdad, no el contenedor desechable de esta ejecución."
    );
  }

  // El banco compone sus rutas a partir de `url.origin`, así que cualquier
  // prefijo escrito aquí se perdería en silencio. Un `/rest/v1` en esta variable
  // suele significar que alguien ha puesto la URL de un Supabase real; que el
  // prefijo se ignore sin decir nada sería la peor manera de tratarlo.
  if (url.pathname !== "/") {
    fallos.push(
      `TEST_POSTGREST_URL lleva la ruta '${url.pathname}' y el banco exige la raíz ` +
        "'/'. El PostgREST desechable se sirve en la raíz; una ruta con prefijo " +
        "sugiere que se ha copiado la URL de una instalación real."
    );
  }

  if (url.search !== "") {
    fallos.push("TEST_POSTGREST_URL no admite parámetros de consulta.");
  }

  if (url.hash !== "") {
    fallos.push(
      "TEST_POSTGREST_URL no admite fragmento. Un '#' no viaja en la petición " +
        "HTTP, así que la URL efectiva no sería la que se está leyendo aquí, y " +
        "una guarda que valida algo distinto de lo que se envía no vale nada."
    );
  }

  if (fallos.length > 0) throw new Error(componerFallo(fallos));
  return url;
}

/**
 * Valida la URL de PostgreSQL. El banco borra esquemas: aquí no se admite nada
 * que no sea el contenedor desechable, identificado por host, puerto y nombre de
 * base a la vez.
 */
export function validarUrlBaseDatos(bruta) {
  const fallos = [];

  if (typeof bruta !== "string" || bruta.trim() === "") {
    throw new Error(componerFallo(["TEST_DATABASE_URL no está definida."]));
  }

  let url;
  try {
    url = new URL(bruta);
  } catch {
    throw new Error(componerFallo(["TEST_DATABASE_URL no es una URL válida."]));
  }

  if (!PROTOCOLOS_DB_PERMITIDOS.has(url.protocol)) {
    fallos.push(
      `El protocolo '${url.protocol}' no está permitido. Sólo 'postgres:' y 'postgresql:'.`
    );
  }

  if (url.username === "") {
    fallos.push(
      "TEST_DATABASE_URL no lleva usuario. Sin él, el driver caería en el " +
        "usuario del sistema operativo, que suele ser la cuenta con acceso a todo."
    );
  }

  if (url.password === "") {
    fallos.push(
      "TEST_DATABASE_URL no lleva contraseña explícita. Sin ella, el driver " +
        "podría autenticarse por confianza local o por .pgpass contra un " +
        "servidor que no es éste."
    );
  }

  if (!HOSTS_PERMITIDOS.has(url.hostname)) {
    fallos.push(
      `TEST_DATABASE_URL apunta al host '${url.hostname}'. Sólo se admiten ` +
        `${[...HOSTS_PERMITIDOS].join(", ")}.`
    );
  }

  // El 5432 está descartado a propósito: es justo donde escucha lo que no hay
  // que tocar en cualquier máquina de desarrollo.
  if (url.port !== PUERTO_DB_EXIGIDO) {
    fallos.push(
      `TEST_DATABASE_URL usa el puerto '${url.port || "<ninguno>"}' y el banco ` +
        `exige ${PUERTO_DB_EXIGIDO}. El 5432 está descartado por ser donde ` +
        "escucha el PostgreSQL de trabajo."
    );
  }

  const base = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (base !== BASE_EXIGIDA) {
    fallos.push(
      `TEST_DATABASE_URL apunta a la base '${base || "<ninguna>"}' y el banco ` +
        `exige exactamente '${BASE_EXIGIDA}'.`
    );
  }

  if (url.search !== "") {
    fallos.push(
      "TEST_DATABASE_URL no admite parámetros de consulta. `pg` acepta " +
        "parámetros que redefinen destino y modo de conexión —host, dbname, " +
        "sslmode, options, service...—, de modo que una cadena cuyo hostname es " +
        "127.0.0.1 puede acabar hablando con otra máquina. No se enumeran los " +
        "peligrosos: se rechaza cualquiera."
    );
  }

  if (fallos.length > 0) throw new Error(componerFallo(fallos));
  return url;
}

/**
 * Comprueba TODAS las guardas de entorno. Recibe el entorno como argumento —y no
 * lee `process.env` por dentro— precisamente para poder probarla.
 */
export function exigirGuardas(entorno) {
  const fallos = [];

  const heredadas = VARIABLES_PG_PROHIBIDAS.filter((n) => entorno[n] !== undefined);
  if (heredadas.length > 0) {
    fallos.push(
      "El entorno trae variables de PostgreSQL que pueden alterar la conexión: " +
        `${heredadas.join(", ")}. Se rechazan por estar presentes, sea cual sea ` +
        "su valor (que no se imprime). Ejecuta con el entorno limpio: " +
        `env -u ${heredadas.join(" -u ")} npm run ...`
    );
  }

  if (entorno.REVISION_CONFLICT_TEST_DB_ACK !== "DISPOSABLE_ONLY") {
    fallos.push(
      "REVISION_CONFLICT_TEST_DB_ACK debe valer exactamente 'DISPOSABLE_ONLY'. " +
        "Es el acuse de recibo de que la base indicada es desechable y de que el " +
        "bootstrap va a borrar sus esquemas public y auth enteros."
    );
  }

  if (entorno.REVISION_CONFLICT_TEST_CLUSTER_ACK !== "DISPOSABLE_CLUSTER") {
    fallos.push(
      "REVISION_CONFLICT_TEST_CLUSTER_ACK debe valer exactamente " +
        "'DISPOSABLE_CLUSTER'. El bootstrap crea los roles anon, authenticated y " +
        "authenticator y les concede membresías, y los roles son objetos del " +
        "CLÚSTER, no de una base. Comprobar el nombre de la base no protege a los " +
        "demás proyectos que compartan servidor porque el daño no ocurre dentro " +
        "de la base."
    );
  }

  const secreto = entorno.TEST_JWT_SECRET;
  if (typeof secreto !== "string" || secreto.length < 32) {
    fallos.push(
      "TEST_JWT_SECRET debe existir y tener al menos 32 caracteres. Se genera " +
        "dentro de la propia ejecución; no se toma de ningún secreto del " +
        "repositorio ni de la organización."
    );
  }

  const password = entorno.TEST_PGRST_AUTHENTICATOR_PASSWORD;
  // Se restringe el alfabeto en vez de escapar y confiar: la contraseña se
  // interpola en un literal SQL, y un alfabeto cerrado hace la interpolación
  // trivialmente segura en lugar de meramente cuidadosa.
  if (typeof password !== "string" || !/^[A-Za-z0-9_-]{24,}$/.test(password)) {
    fallos.push(
      "TEST_PGRST_AUTHENTICATOR_PASSWORD debe existir, tener al menos 24 " +
        "caracteres y usar sólo [A-Za-z0-9_-]. Se genera dentro de la ejecución."
    );
  }

  if (fallos.length > 0) throw new Error(componerFallo(fallos));

  return {
    urlDb: validarUrlBaseDatos(entorno.TEST_DATABASE_URL),
    urlPgrst: validarUrlPostgrest(entorno.TEST_POSTGREST_URL),
    secretoJwt: secreto,
    passwordAuthenticator: password,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARADORES — también puros, también comprobables
// ═══════════════════════════════════════════════════════════════════════════

const CAMPOS_OBSERVABLES = ["revision", "observable_state", "mutation_count", "last_mutated_at"];

/**
 * Exige que el registro no haya cambiado en NINGUNO de sus cuatro campos
 * observables. Los cuatro, y no sólo la revisión: un conflicto que dejase la
 * revisión quieta pero tocase la fecha ya habría escrito, y «no ha modificado
 * nada» dejaría de ser cierto.
 */
export function assertEstadoIdentico(antes, despues, contexto) {
  const cambiados = CAMPOS_OBSERVABLES.filter((c) => antes[c] !== despues[c]);
  if (cambiados.length > 0) {
    const detalle = cambiados
      .map((c) => `${c}: ${JSON.stringify(antes[c])} -> ${JSON.stringify(despues[c])}`)
      .join("; ");
    throw new assert.AssertionError({
      message:
        `${contexto}: el conflicto ha modificado el registro, y no debía tocar ` +
        `absolutamente nada. Campos alterados -> ${detalle}`,
      actual: despues,
      expected: antes,
      operator: "assertEstadoIdentico",
    });
  }
}

/**
 * Exige la forma EXACTA del conflicto. Cada línea de aquí cubre una degradación
 * concreta y ninguna es adorno:
 *
 *   · `status === 409` y no `status >= 400`: un 400 diría al cliente que su
 *     petición está mal formada y le llevaría a corregir el cuerpo, cuando lo
 *     que tiene que hacer es releer y repetir sobre la revisión nueva.
 *   · `code === "PT409"`: el estado HTTP solo no basta, porque 409 lo puede
 *     producir también una violación de UNIQUE (23505), que ya ocurre hoy en
 *     `document_versions` y significa otra cosa completamente distinta.
 *   · una sola petición: si el cliente reintentase solo, el control de
 *     concurrencia optimista dejaría de serlo.
 */
export function assertConflictoPt409(respuesta, cuerpo, peticiones, contexto) {
  assert.equal(
    respuesta.status,
    409,
    `${contexto}: se esperaba HTTP 409 exacto y se obtuvo ${respuesta.status}. ` +
      "No vale «algún 4xx»: el código concreto es el contrato."
  );
  assert.equal(
    cuerpo?.code,
    "PT409",
    `${contexto}: se esperaba code === "PT409" en el cuerpo y se obtuvo ` +
      `${JSON.stringify(cuerpo?.code)}. El cuerpo recibido fue ${JSON.stringify(cuerpo)}.`
  );
  // No basta con que `message` sea del tipo correcto. `""` y `"   "` son cadenas
  // perfectamente válidas y no dicen nada a quien lea el registro. Lo que este
  // banco quiere fijar como contrato es que el conflicto llegue EXPLICADO, así
  // que se exige contenido después de `trim()`.
  assert.equal(
    typeof cuerpo?.message,
    "string",
    `${contexto}: el cuerpo del error debe traer un mensaje legible y se recibió ` +
      `${JSON.stringify(cuerpo?.message)} (${typeof cuerpo?.message}).`
  );
  assert.notEqual(
    cuerpo.message.trim(),
    "",
    `${contexto}: el mensaje del error está vacío o es sólo espacios ` +
      `(${JSON.stringify(cuerpo.message)}). Un 409 sin explicación obliga a quien ` +
      "lo lea a adivinar por qué falló, que es justo lo que este contrato evita."
  );
  assert.equal(
    peticiones,
    1,
    `${contexto}: se esperaba UNA sola petición HTTP y se contaron ${peticiones}. ` +
      "Un reintento automático destruiría la semántica del conflicto."
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICADOR ESTÁTICO DE LAS GUARDAS DEL BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════
//
// Por qué existe esto. El bootstrap borra los esquemas `public` y `auth` de la
// base a la que se aplique. Lo único que impide que eso ocurra sobre la base
// equivocada son cuatro negativas dentro de su primer bloque `DO $guard$`, y de
// esas cuatro hay dos que ningún otro test puede observar sin ejecutar el
// fichero: la del nombre de la base y la de la versión del servidor. Ejecutarlo
// para comprobarlas es justamente lo que no se puede hacer —haría falta el
// clúster desechable, y si la guarda estuviera rota lo comprobaríamos
// destruyendo algo—. Así que se comprueban leyendo el texto.
//
// Y no basta con que las dos líneas EXISTAN: tienen que estar dentro del bloque
// de guardas y el bloque tiene que CERRARSE antes de la primera sentencia que
// muta algo. Una guarda correcta colocada después del primer `create role` no
// es una guarda: es un comentario con sintaxis de SQL, y su mensaje «no se ha
// modificado nada» sería mentira.
//
// Este verificador es puro: recibe texto y devuelve fallos. No lee ficheros, no
// abre conexiones y no ejecuta SQL. Eso es lo que permite alimentarlo con
// versiones mutadas del bootstrap y exigir que las rechace.

/**
 * Sustituye por espacios los comentarios SQL —`--` de línea y los de bloque,
 * que en PostgreSQL anidan— SIN cambiar la longitud del texto, de forma que los
 * índices del resultado siguen valiendo sobre el original.
 *
 * ENTRA EN LOS CUERPOS ENTRECOMILLADOS POR DÓLAR, y ésa es la diferencia que
 * importa. Para el analizador de PostgreSQL, `$guard$ ... $guard$` es una cadena
 * opaca; para esta auditoría no puede serlo, porque lo que se audita está DENTRO
 * de ese cuerpo. Tratarlo como cadena dejaba pasar el mutante más barato de
 * todos: comentar la guarda entera línea por línea. El texto seguía ahí, el
 * patrón seguía casando, y el verificador bendecía un bloque que ya no
 * comprobaba nada.
 *
 * Las cadenas `'...'` sí se saltan, con `''` como escape: dentro de ellas un
 * `--` no abre comentario. Su CONTENIDO se conserva o se blanquea según
 * `blanquearCadenas`, porque hacen falta las dos vistas:
 *
 *   · con el contenido intacto, para poder exigir el literal exacto
 *     'enlaze_revision_conflict_test' dentro de la guarda;
 *   · con el contenido blanqueado, para buscar instrucciones mutantes sin que un
 *     `raise exception` que menciona «crear roles» cuente como un `create`.
 */
export function despojarComentariosSql(sql, { blanquearCadenas = false } = {}) {
  const salida = sql.split("");
  const n = sql.length;
  let i = 0;

  // Etiquetas de los cuerpos `$tag$` en los que estamos dentro. Es una pila
  // porque el bootstrap define funciones cuyo cuerpo lleva su propia etiqueta.
  const pilaDolar = [];

  const blanquear = (desde, hasta) => {
    for (let k = desde; k < hasta; k += 1) {
      if (salida[k] !== "\n") salida[k] = " ";
    }
  };

  const RE_DOLAR = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/y;

  while (i < n) {
    // Cerrar el cuerpo actual tiene prioridad sobre abrir otro: si no, el `$$`
    // de cierre se leería como una apertura nueva y nunca se cerraría nada.
    if (pilaDolar.length && sql.startsWith(pilaDolar[pilaDolar.length - 1], i)) {
      i += pilaDolar.pop().length;
      continue;
    }

    if (sql[i] === "-" && sql[i + 1] === "-") {
      let fin = sql.indexOf("\n", i);
      if (fin === -1) fin = n;
      blanquear(i, fin);
      i = fin;
      continue;
    }

    if (sql[i] === "/" && sql[i + 1] === "*") {
      let profundidad = 1;
      let j = i + 2;
      while (j < n && profundidad > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          profundidad += 1;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          profundidad -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      blanquear(i, j);
      i = j;
      continue;
    }

    if (sql[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2;
        else if (sql[j] === "'") {
          j += 1;
          break;
        } else j += 1;
      }
      if (blanquearCadenas) blanquear(i + 1, Math.max(i + 1, j - 1));
      i = j;
      continue;
    }

    RE_DOLAR.lastIndex = i;
    const dolar = RE_DOLAR.exec(sql);
    if (dolar) {
      pilaDolar.push(dolar[0]);
      i += dolar[0].length;
      continue;
    }

    i += 1;
  }

  return salida.join("");
}

// ── Las dos guardas, exigidas por SEMÁNTICA y no por vecindad ────────────────
//
// El operador forma parte de la guarda tanto como el literal.
// `current_database() = 'enlaze_revision_conflict_test'` contiene exactamente las
// mismas palabras que la guarda correcta y hace exactamente lo contrario: aborta
// en la base buena y deja pasar todas las demás. Lo mismo con `>= 170000`, que
// rechazaría PostgreSQL 17 y aceptaría el 14. Por eso aquí sólo se admiten
// `<>`/`!=` y `<`, y por eso las formas invertidas tienen su propio patrón: para
// poder decir en el mensaje que la guarda está DEL REVÉS, que es un diagnóstico
// distinto —y más alarmante— de que falte.
const PATRON_GUARDA_BASE =
  /current_database\s*\(\s*\)\s*(?:<>|!=)\s*'enlaze_revision_conflict_test'/i;
const PATRON_BASE_INVERTIDA =
  /current_database\s*\(\s*\)\s*=\s*'enlaze_revision_conflict_test'/i;

const TIPO_ENTERO = "(?:integer|int|int4|int8|bigint|numeric)";
const PATRON_GUARDA_VERSION = new RegExp(
  `current_setting\\s*\\(\\s*'server_version_num'\\s*\\)\\s*::\\s*${TIPO_ENTERO}\\s*<\\s*170000`,
  "i"
);
const PATRON_VERSION_INVERTIDA = new RegExp(
  `current_setting\\s*\\(\\s*'server_version_num'\\s*\\)\\s*::\\s*${TIPO_ENTERO}\\s*(?:>=|>|<=)\\s*170000`,
  "i"
);

// Instrucciones que modifican la base o el clúster. Esta lista ya NO decide
// dónde empieza la parte peligrosa del fichero —para eso está la invariante de
// que `do $guard$` sea la PRIMERA instrucción, que no depende de ninguna lista y
// por tanto no puede quedarse corta—. Se usa sólo para vigilar el interior del
// bloque protector, donde el vocabulario legítimo es diminuto y conocido: `if`,
// `raise`, `select`, `coalesce`, `exists`. Cualquier cosa de esta lista ahí
// dentro sobra.
const RE_MUTANTE_EN_GUARDA =
  /\b(create|alter|drop|truncate|grant|revoke|insert|update|delete|reindex|refresh|copy|call|perform|execute|comment\s+on|security\s+label)\b/i;

// ── Las condiciones COMPLETAS, ancladas de `IF` a `THEN` ────────────────────
//
// Los patrones de arriba buscan una SUBCADENA, y con eso basta para detectar que
// una guarda falta o está del revés. No basta para nada más, porque una subcadena
// correcta puede vivir dentro de una condición que ya no lo es: añadir `and false`
// deja el patrón casando y la guarda inservible, y lo mismo haría `or true`.
//
// Por eso la condición se compara ANCLADA con `^…$` sobre el texto normalizado
// de espacios: lo que se exige no es que la condición contenga lo autorizado,
// sino que sea exactamente lo autorizado y nada más.
const COND_BASE_OK =
  /^current_database\s*\(\s*\)\s*(?:<>|!=)\s*'enlaze_revision_conflict_test'$/i;
const COND_BASE_INVERTIDA =
  /^current_database\s*\(\s*\)\s*=\s*'enlaze_revision_conflict_test'$/i;
const COND_VERSION_OK = new RegExp(
  `^current_setting\\s*\\(\\s*'server_version_num'\\s*\\)\\s*::\\s*${TIPO_ENTERO}\\s*<\\s*170000$`,
  "i"
);
const COND_VERSION_INVERTIDA = new RegExp(
  `^current_setting\\s*\\(\\s*'server_version_num'\\s*\\)\\s*::\\s*${TIPO_ENTERO}\\s*(?:>=|>|<=)\\s*170000$`,
  "i"
);

// El cuerpo del `THEN` tiene que EMPEZAR por `raise exception`. Anclado al
// principio, no buscado por ahí dentro: un `raise exception` que aparezca
// después de otra cosa ya no es lo primero que ocurre, y un `raise exception`
// que esté en el bloque pero fuera de este `IF` no se ejecuta cuando esta
// condición se cumple, que es justo cuando tiene que ejecutarse.
const CUERPO_DEBE_ABORTAR = /^raise\s+exception\b/i;

/**
 * Trocea un fragmento de PL/pgSQL en sus sentencias `IF … THEN … END IF;`.
 *
 * Recibe las dos vistas alineadas: `texto` conserva el contenido de las cadenas
 * —hace falta para leer la condición, que lleva el literal del nombre de la
 * base— y `textoSinCadenas` lo tiene blanqueado, que es lo que permite localizar
 * palabras clave sin que un mensaje de error las simule.
 *
 * La búsqueda de `if`, `then` y `end if` se hace siempre sobre `textoSinCadenas`,
 * de modo que ni los comentarios (ya blanqueados) ni los mensajes cuentan.
 */
function extraerBloquesIf(texto, textoSinCadenas) {
  const bloques = [];
  const RE_IF = /\bif\b/gi;
  let encontrado;

  while ((encontrado = RE_IF.exec(textoSinCadenas)) !== null) {
    // `end if` también contiene un `if`; no abre nada.
    if (/\bend\s+$/i.test(textoSinCadenas.slice(Math.max(0, encontrado.index - 6), encontrado.index))) {
      continue;
    }

    const RE_THEN = /\bthen\b/gi;
    RE_THEN.lastIndex = encontrado.index;
    const then = RE_THEN.exec(textoSinCadenas);
    if (!then) continue;

    const inicioCond = encontrado.index + encontrado[0].length;
    const finCond = then.index;
    const inicioCuerpo = then.index + then[0].length;

    // Cierre correspondiente, contando anidamiento.
    const RE_TOKEN = /\bif\b|\bend\s+if\b/gi;
    RE_TOKEN.lastIndex = inicioCuerpo;
    let profundidad = 1;
    let finCuerpo = textoSinCadenas.length;
    let token;
    while ((token = RE_TOKEN.exec(textoSinCadenas)) !== null) {
      if (/^end/i.test(token[0])) {
        profundidad -= 1;
        if (profundidad === 0) {
          finCuerpo = token.index;
          break;
        }
      } else {
        profundidad += 1;
      }
    }

    bloques.push({
      condicion: texto.slice(inicioCond, finCond).replace(/\s+/g, " ").trim(),
      cuerpo: textoSinCadenas.slice(inicioCuerpo, finCuerpo).trim(),
      indice: encontrado.index,
    });
  }

  return bloques;
}

/**
 * Audita UNA guarda completa: que exista como `IF` ejecutable, que su condición
 * sea exactamente la autorizada y que lo primero que haga su `THEN` sea abortar.
 */
function revisarGuarda({
  etiqueta,
  bloques,
  reconocedor,
  condicionOk,
  condicionInvertida,
  patronSuelto,
  codigo,
  canonica,
  consecuencia,
}) {
  const fallos = [];
  const bloque = bloques.find((b) => reconocedor.test(b.condicion));

  if (!bloque) {
    if (patronSuelto.test(codigo)) {
      fallos.push(
        `GUARDA DE ${etiqueta} FUERA DEL BLOQUE: la comprobación existe en el fichero ` +
          "pero no como un `if` ejecutable dentro del primer `do $guard$`. Fuera de él " +
          "deja de ser una negativa previa."
      );
    } else {
      fallos.push(
        `GUARDA DE ${etiqueta} AUSENTE: no hay ningún \`if\` ejecutable con la ` +
          `comprobación \`${canonica}\` dentro del bloque. Si el texto sigue en el ` +
          "fichero pero comentado, es texto muerto: " +
          consecuencia
      );
    }
    return fallos;
  }

  if (!condicionOk.test(bloque.condicion)) {
    if (condicionInvertida.test(bloque.condicion)) {
      fallos.push(
        `GUARDA DE ${etiqueta} INVERTIDA: la comparación está del revés ` +
          `(«${bloque.condicion}»). Invertida, la negativa se dispara justo en el caso ` +
          "bueno y deja pasar todos los malos."
      );
    } else {
      fallos.push(
        `CONDICIÓN DE ${etiqueta} ALTERADA: la condición del \`if\` es ` +
          `«${bloque.condicion}» y tiene que ser exactamente «${canonica}». Un añadido ` +
          "booleano como `and false` —o cualquier término de más— deja el texto " +
          "reconocible y la guarda inservible, que es la forma más silenciosa de " +
          "desactivarla."
      );
    }
    return fallos;
  }

  if (!CUERPO_DEBE_ABORTAR.test(bloque.cuerpo)) {
    const visto =
      bloque.cuerpo.trim() === ""
        ? "(cuerpo vacío)"
        : `«${bloque.cuerpo.replace(/\s+/g, " ").slice(0, 60)}…»`;
    fallos.push(
      `GUARDA DE ${etiqueta} SIN RAISE EXCEPTION: la condición es correcta, pero lo ` +
        `primero que ejecuta su \`then\` es ${visto}. Una condición que detecta el ` +
        "problema y no aborta no es una guarda: el fichero continúa y borra los " +
        "esquemas igual. Que haya un `raise exception` en otra parte del bloque no " +
        "sirve, porque no es el que se ejecuta cuando esta condición se cumple."
    );
  }

  return fallos;
}

/**
 * Comprueba sobre el TEXTO del bootstrap que sus dos guardas críticas siguen
 * existiendo, siguen dentro del primer bloque `DO $guard$` y que ese bloque
 * cierra antes de la primera sentencia mutante.
 *
 * Devuelve un array de fallos legibles; vacío significa correcto. Se devuelven
 * en vez de lanzarse para que los controles negativos puedan exigir no sólo que
 * algo falle, sino QUÉ falla.
 */
export function verificarGuardasBootstrap(sql) {
  const fallos = [];

  // Dos vistas del mismo texto, ambas con los índices alineados con el original.
  const codigo = despojarComentariosSql(sql);
  const codigoSinCadenas = despojarComentariosSql(sql, { blanquearCadenas: true });

  const apertura = /\bdo\s+\$guard\$/i.exec(codigo);
  if (!apertura) {
    fallos.push(
      "BLOQUE DE GUARDAS AUSENTE: no se encuentra `do $guard$` en el bootstrap. Sin " +
        "él no hay ninguna negativa previa al borrado de esquemas."
    );
    return fallos;
  }

  const inicioCuerpo = apertura.index + apertura[0].length;
  const cierre = codigo.indexOf("$guard$", inicioCuerpo);
  if (cierre === -1) {
    fallos.push(
      "BLOQUE DE GUARDAS SIN CERRAR: falta el `$guard$` final del primer bloque."
    );
    return fallos;
  }
  const cuerpo = codigo.slice(inicioCuerpo, cierre);
  const cuerpoSinCadenas = codigoSinCadenas.slice(inicioCuerpo, cierre);

  // ── Invariante de colocación: el bloque es lo PRIMERO que se ejecuta ───────
  //
  // Esto sustituye a la antigua lista de «sentencias mutantes conocidas», que era
  // una carrera perdida de antemano: bastaba con usar un DDL que no estuviera en
  // la lista —un `create table`, por ejemplo— para colar código ejecutable por
  // delante de las guardas. La pregunta correcta no es «¿qué instrucciones
  // peligrosas hay antes?», que exige enumerar el peligro, sino «¿hay ALGO antes?»,
  // que no exige enumerar nada.
  const preludio = codigo.slice(0, apertura.index).trim();
  if (preludio !== "") {
    const fragmento = preludio.replace(/\s+/g, " ").slice(0, 60);
    fallos.push(
      `EL BLOQUE DE GUARDAS NO ES LA PRIMERA INSTRUCCIÓN: antes de \`do $guard$\` hay ` +
        `código ejecutable («${fragmento}…»). Descontando espacios y comentarios, este ` +
        "fichero no puede ejecutar absolutamente nada antes de haber comprobado sobre " +
        "qué base y qué servidor está actuando."
    );
  }

  // ── Las dos guardas, como sentencias completas ────────────────────────────
  //
  // Se auditan como `IF … THEN … END IF;` enteros y no como texto suelto. La
  // versión anterior comprobaba subcadenas, y una subcadena correcta cabe dentro
  // de una guarda rota de al menos cuatro maneras: con `and false` pegado a la
  // condición, con el `raise exception` sustituido por `raise notice`, con el
  // cuerpo reducido a `null;` o con el `raise` comentado. En los cuatro casos el
  // texto reconocible sigue ahí y la guarda ha dejado de guardar.
  const bloques = extraerBloquesIf(cuerpo, cuerpoSinCadenas);

  fallos.push(
    ...revisarGuarda({
      etiqueta: "BASE",
      bloques,
      reconocedor: /current_database\s*\(\s*\)/i,
      condicionOk: COND_BASE_OK,
      condicionInvertida: COND_BASE_INVERTIDA,
      patronSuelto: PATRON_GUARDA_BASE,
      codigo,
      canonica: "current_database() <> 'enlaze_revision_conflict_test'",
      consecuencia:
        "este fichero borraría los esquemas `public` y `auth` de la base a la que se " +
        "le apunte, sea cual sea.",
    })
  );

  fallos.push(
    ...revisarGuarda({
      etiqueta: "VERSIÓN",
      bloques,
      reconocedor: /server_version_num/i,
      condicionOk: COND_VERSION_OK,
      condicionInvertida: COND_VERSION_INVERTIDA,
      patronSuelto: PATRON_GUARDA_VERSION,
      codigo,
      canonica: "current_setting('server_version_num')::integer < 170000",
      consecuencia:
        "el banco documenta PostgreSQL 17 como requisito y se aplicaría sobre " +
        "versiones en las que no se ha comprobado nada.",
    })
  );

  // ── El bloque protector no puede capturar sus propias excepciones ─────────
  //
  // Esta es la mutación que no toca ni una letra de las guardas: las cuatro
  // condiciones siguen ahí, sus `raise exception` siguen ahí y siguen
  // ejecutándose, y un `exception when others then null;` al final del bloque se
  // los traga. El `do` termina sin error y el fichero continúa hasta el
  // `drop schema`. Auditar las guardas una por una no la ve, porque no le ocurre
  // nada a ninguna guarda: le ocurre al bloque que las contiene.
  //
  // Un manejador se distingue de un `raise exception` por lo que lleva DELANTE:
  // es un `exception` que no cuelga de un `raise`. Se busca sobre la vista con
  // comentarios y cadenas blanqueados, de modo que la frase escrita en la
  // documentación del fichero o dentro de un mensaje de error es inerte.
  const RE_TOKEN_EXCEPTION = /\bexception\b/gi;
  let tokenExcepcion;
  while ((tokenExcepcion = RE_TOKEN_EXCEPTION.exec(cuerpoSinCadenas)) !== null) {
    const precedente = cuerpoSinCadenas.slice(
      Math.max(0, tokenExcepcion.index - 16),
      tokenExcepcion.index
    );
    if (/\braise\s+$/i.test(precedente)) continue;

    const fragmento = cuerpoSinCadenas
      .slice(tokenExcepcion.index, tokenExcepcion.index + 60)
      .replace(/\s+/g, " ")
      .trim();
    fallos.push(
      "BLOQUE DE GUARDAS CAPTURA EXCEPCIONES: el bloque protector abre una sección " +
        `manejadora («${fragmento}…»). Capturar no desactiva ninguna condición ni ` +
        "borra ningún `raise`: los deja ejecutarse y se los traga, con lo que las " +
        "negativas se degradan a nada y el fichero sigue adelante hasta borrar los " +
        "esquemas. El bloque tiene que poder abortar, luego no puede capturar."
    );
    break;
  }

  // ── El bloque protector no puede modificar nada él mismo ──────────────────
  //
  // Se mira sobre la vista sin cadenas: los `raise exception` del bloque hablan
  // en castellano de crear roles y de borrar esquemas, y esas menciones son
  // inertes. Lo que no puede haber es la instrucción de verdad.
  const mutanteDentro = RE_MUTANTE_EN_GUARDA.exec(cuerpoSinCadenas);
  if (mutanteDentro) {
    const fragmento = cuerpoSinCadenas
      .slice(mutanteDentro.index, mutanteDentro.index + 50)
      .replace(/\s+/g, " ")
      .trim();
    fallos.push(
      `INSTRUCCIÓN MUTANTE DENTRO DEL BLOQUE: el bloque protector contiene ` +
        `«${fragmento}…». El bloque sólo puede comprobar y negarse; en cuanto modifica ` +
        "algo, su propio mensaje «no se ha modificado nada» pasa a ser falso."
    );
  }

  return fallos;
}

// Extractores del texto literal de cada guarda, usados por los controles
// negativos para mutarlas. Van aquí y no dentro de cada test porque los tres
// mutantes que las tocan tienen que partir EXACTAMENTE del mismo fragmento; si
// cada uno recortara por su cuenta, dos de ellos podrían estar mutando cosas
// distintas sin que se notara.
function extraerGuardaBase(sql) {
  const encontrada =
    /[ \t]*if current_database\(\) <> 'enlaze_revision_conflict_test' then[\s\S]*?end if;\n/.exec(sql);
  assert.ok(
    encontrada,
    "No se pudo extraer la guarda de base del bootstrap: su forma ha cambiado y estos " +
      "controles negativos estarían mutando otra cosa."
  );
  return encontrada[0];
}

function extraerGuardaVersion(sql) {
  const encontrada =
    /[ \t]*if current_setting\('server_version_num'\)::integer < 170000 then[\s\S]*?end if;\n/.exec(sql);
  assert.ok(
    encontrada,
    "No se pudo extraer la guarda de versión del bootstrap: su forma ha cambiado y estos " +
      "controles negativos estarían mutando otra cosa."
  );
  return encontrada[0];
}

// Parte una guarda ya extraída en sus tres piezas —cabecera `if … then`, cuerpo
// y cierre `end if;`— para que los mutantes puedan sustituir exactamente una de
// ellas dejando las otras dos intactas. Sin esto, cada control negativo tendría
// que recortar a ojo y una mutación mal cortada se confundiría con un acierto
// del verificador.
function partirGuarda(guarda) {
  const partes = /^([ \t]*if [^\n]*then\n)([\s\S]*?)([ \t]*end if;\n)$/.exec(guarda);
  assert.ok(
    partes,
    "No se pudo partir la guarda en cabecera, cuerpo y cierre: su forma ha cambiado."
  );
  return { cabecera: partes[1], cuerpo: partes[2], cierre: partes[3] };
}

// Cuenta los `raise exception` EJECUTABLES del primer bloque protector. Lo usan
// los controles del manejador de excepciones para acreditar lo que hace
// peligrosa a esa mutación: que no toca ninguna negativa. Sin esta cuenta, un
// control que capturase excepciones y de paso borrase un `raise` pasaría por
// bueno sin demostrar nada.
function contarRaiseExceptionEnBloque(sql) {
  const codigo = despojarComentariosSql(sql, { blanquearCadenas: true });
  const apertura = /\bdo\s+\$guard\$/i.exec(codigo);
  assert.ok(apertura, "No se encuentra el bloque `do $guard$` que había que medir.");
  const inicio = apertura.index + apertura[0].length;
  const fin = codigo.indexOf("$guard$", inicio);
  assert.ok(fin !== -1, "El bloque `do $guard$` no cierra.");
  return (codigo.slice(inicio, fin).match(/\braise\s+exception\b/gi) ?? []).length;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

function base64url(objeto) {
  return Buffer.from(JSON.stringify(objeto)).toString("base64url");
}

/**
 * Firma un JWT HS256 con las primitivas del núcleo de Node. No se añade ninguna
 * dependencia: el banco necesita firmar un token, no una librería.
 */
export function firmarJwtHs256(claims, secreto) {
  const cabecera = base64url({ alg: "HS256", typ: "JWT" });
  const cuerpo = base64url(claims);
  const firma = createHmac("sha256", secreto).update(`${cabecera}.${cuerpo}`).digest("base64url");
  return `${cabecera}.${cuerpo}.${firma}`;
}

function tokenAutenticado(sub, secreto) {
  const ahora = Math.floor(Date.now() / 1000);
  return firmarJwtHs256({ role: "authenticated", sub, iat: ahora, exp: ahora + 3600 }, secreto);
}

/**
 * Envuelve `fetch` contando peticiones. El contador es el instrumento que prueba
 * «una sola petición y sin reintento»; sin él esa afirmación no sería
 * comprobable, sólo declarativa.
 */
function crearFetchContado(reescribir) {
  const estado = { peticiones: 0 };
  const envoltura = async (entrada, opciones) => {
    estado.peticiones += 1;
    const url = typeof entrada === "string" ? entrada : entrada.url;
    return globalThis.fetch(reescribir ? reescribir(url) : url, opciones);
  };
  return { fetch: envoltura, estado, reiniciar: () => (estado.peticiones = 0) };
}

async function llamarRpcCrudo(base, nombre, argumentos, token, contador) {
  const respuesta = await contador.fetch(`${base}/rpc/${nombre}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(argumentos),
  });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto === "" ? null : JSON.parse(texto);
  } catch {
    cuerpo = { _texto_sin_parsear: texto };
  }
  return { respuesta, cuerpo };
}

async function esperar(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLES DE LAS LÍNEAS BASE CONGELADAS
// ═══════════════════════════════════════════════════════════════════════════
//
// Los dos ficheros de `__tests__/fixtures/` no se ejecutan: son el patrón contra
// el que la FASE 2F-2 tendrá que demostrar que no mueve ni un céntimo ni un
// privilegio. Un patrón que nadie comprueba deja de ser un patrón en cuanto
// alguien lo edita, y el modo en que se rompería es silencioso: bastaría con
// reescribir un importe para que la comparación futura pasara sin decir nada.
//
// De ahí que estas comprobaciones vivan aquí, en el bloque que se ejecuta
// SIEMPRE, y no tras el `opt-in` de la infraestructura. No necesitan base de
// datos: leen dos ficheros del repositorio.
//
// LO QUE ESTAS PRUEBAS NO HACEN. No verifican que los datos capturados sean
// correctos: nadie puede hacerlo sin volver a consultar producción, y este banco
// no habla con producción. Verifican que el fichero sigue siendo EL MISMO
// fichero, con la misma forma, el mismo vocabulario y sin PII. Es una guarda de
// integridad, no de veracidad.

// Huellas congeladas el 2026-09-07. Están escritas aquí, en el test, y no sólo
// dentro del fixture, a propósito: si vivieran únicamente en el JSON, quien
// editase un importe podría recalcular la huella en el mismo gesto y todo
// seguiría en verde. Con la huella duplicada en un fichero distinto, esa edición
// tiene que hacerse por partida doble, que es justo el momento en el que alguien
// se pregunta si debería estar haciéndola.
const HUELLAS_CONGELADAS = Object.freeze({
  "classic_form-01": "6623382affb461fee1d233c42e144dc8665f4dd29a7a72c7b816bba7f4ed7479",
  "wizard-01": "dcb5ddb7d5139bc8da33577cfd3f07595c9ae61e38dd0aa2085896088ecea081",
  "wizard-02": "f8f628acdcd008e76521add0f5e63d7a1de81bfd72def40869a69b08804d4e9e",
  "wizard-03": "05271419a6219e258271e65c4f05dbc0c985798e6faa200a056a7f5ebccc8c6f",
});

const CAMPO_HUELLA = "content_fingerprint_sha256";
const CASOS_ESPERADOS = ["classic_form-01", "wizard-01", "wizard-02", "wizard-03"];

// Vocabularios cerrados. Se comprueban por igualdad de conjunto y no por
// inclusión: si mañana aparece una `category` nueva, el fixture ha cambiado de
// contenido y hay que mirarlo, no absorberlo en silencio.
const CATEGORIAS_PERMITIDAS = new Set(["material", "mano_obra", "otros"]);
const UNIDADES_PERMITIDAS = new Set([
  "ud", "m2", "pa", "ml", "punto", "lote", "sacos", "rollos", "cubos",
]);
const ESTADOS_PARTIDA_PERMITIDOS = new Set(["incluida"]);
const ESTADOS_CABECERA_PERMITIDOS = new Set(["pendiente", "borrador"]);
const TIPOS_DESCUENTO_PERMITIDOS = new Set(["percent"]);
const CLASES_CASO_PERMITIDAS = new Set(["classic_form", "wizard"]);

// Las únicas rutas del fixture económico donde se admite un `number` de JSON.
// Todo lo demás —cantidades, precios, subtotales, IVA, totales— va como cadena,
// porque un decimal en coma flotante no puede representar 0,10 exactamente y
// esto es una línea base de dinero.
const RUTAS_NUMERICAS_PERMITIDAS = new Set([
  "$.schema_version",
  "$.cases[].header.n_items",
  "$.cases[].wizard_state_economics.n_partidas",
  "$.cases[].wizard_state_economics.n_materials",
  "$.cases[].observed_aggregates.persisted_rows_where_subtotal_differs_from_qty_times_price",
  "$.cases[].persisted_items[][]", // sort_order, un entero de posición
]);

// Claves estructurales que identificarían un registro o a una persona. Se
// buscan por NOMBRE en todo el árbol: lo que importa es que no exista el campo,
// no que su valor de hoy parezca inocuo.
const CLAVES_ESTRUCTURALES_PROHIBIDAS = [
  "budget_id", "budget_item_id", "item_id", "user_id", "owner_id", "client_id",
  "customer_id", "created_by", "updated_by", "organization_id", "project_id",
  "title", "concept", "description", "notes", "name", "client_name",
  "customer_name", "email", "client_email", "phone", "client_phone", "address",
  "client_address", "reference", "budget_reference", "nombre", "titulo",
  "concepto", "descripcion", "notas", "cliente", "telefono", "direccion",
  "referencia",
];

const PATRONES_PII = [
  ["UUID", /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/],
  ["dirección de correo", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["URL http(s)", /https?:\/\//],
  ["cadena de conexión PostgreSQL", /postgres(?:ql)?:\/\//],
  ["JWT", /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/],
  ["asignación de secreto", /\b(?:password|passwd|secret|api[_-]?key|token|bearer|anon[_-]?key)\b\s*[:=]\s*["'][^"']{4,}["']/i],
];

/**
 * JSON canónico: claves ordenadas, sin espacios, con un campo excluible. Es el
 * algoritmo que el propio fixture declara en `provenance.fingerprint_algorithm`,
 * reimplementado aquí para poder recalcular la huella sin confiar en la
 * herramienta que la calculó.
 */
export function jsonCanonico(valor, campoExcluido) {
  if (Array.isArray(valor)) return `[${valor.map((v) => jsonCanonico(v, campoExcluido)).join(",")}]`;
  if (valor && typeof valor === "object") {
    const cuerpo = Object.keys(valor)
      .sort()
      .filter((k) => k !== campoExcluido)
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(valor[k], campoExcluido)}`)
      .join(",");
    return `{${cuerpo}}`;
  }
  return JSON.stringify(valor);
}

export function huellaCanonica(objeto, campoExcluido = CAMPO_HUELLA) {
  return createHash("sha256").update(jsonCanonico(objeto, campoExcluido)).digest("hex");
}

/** Recorre el árbol devolviendo [rutaConIndicesColapsados, clave, valor]. */
function* recorrer(valor, ruta = "$", clave = null) {
  yield [ruta, clave, valor];
  if (Array.isArray(valor)) {
    for (const hijo of valor) yield* recorrer(hijo, `${ruta}[]`, null);
  } else if (valor && typeof valor === "object") {
    for (const [k, v] of Object.entries(valor)) yield* recorrer(v, `${ruta}.${k}`, k);
  }
}

function assertSinPii(texto, datos, etiqueta) {
  for (const [nombre, patron] of PATRONES_PII) {
    const encontrado = texto.match(patron);
    assert.equal(
      encontrado,
      null,
      `${etiqueta}: aparece algo que parece ${nombre} (${JSON.stringify(
        encontrado?.[0]
      )}). Estas líneas base se comparten y se revisan; no pueden llevar datos de nadie.`
    );
  }

  const encontradas = [];
  for (const [ruta, clave] of recorrer(datos)) {
    if (clave && CLAVES_ESTRUCTURALES_PROHIBIDAS.includes(clave.toLowerCase())) {
      encontradas.push(`${ruta} (clave '${clave}')`);
    }
  }
  assert.deepEqual(
    encontradas,
    [],
    `${etiqueta}: hay claves estructurales prohibidas. Identifican un registro o a ` +
      `una persona y no hacen ninguna falta para comparar importes o privilegios: ` +
      `${encontradas.join(", ")}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUE 1 — Controles de las guardas y los comparadores. SIEMPRE se ejecutan.
// ═══════════════════════════════════════════════════════════════════════════

test("guardas y comparadores del banco PT409 (puros, sin infraestructura)", async (t) => {
  const entornoValido = {
    REVISION_CONFLICT_TEST_DB_ACK: "DISPOSABLE_ONLY",
    REVISION_CONFLICT_TEST_CLUSTER_ACK: "DISPOSABLE_CLUSTER",
    TEST_DATABASE_URL: `postgres://postgres:pw@127.0.0.1:${PUERTO_DB_EXIGIDO}/${BASE_EXIGIDA}`,
    TEST_POSTGREST_URL: "http://127.0.0.1:53001",
    TEST_JWT_SECRET: "x".repeat(48),
    TEST_PGRST_AUTHENTICATOR_PASSWORD: "a".repeat(32),
  };

  await t.test("el entorno de referencia pasa todas las guardas", () => {
    const resultado = exigirGuardas({ ...entornoValido });
    assert.equal(resultado.urlDb.hostname, "127.0.0.1");
    assert.equal(resultado.urlPgrst.hostname, "127.0.0.1");
  });

  await t.test("aborta si falta el acuse de recibo de la BASE", () => {
    const { REVISION_CONFLICT_TEST_DB_ACK, ...sinAck } = entornoValido;
    assert.throws(() => exigirGuardas(sinAck), /DISPOSABLE_ONLY/);
  });

  await t.test("aborta si falta el acuse de recibo del CLÚSTER", () => {
    const { REVISION_CONFLICT_TEST_CLUSTER_ACK, ...sinAck } = entornoValido;
    assert.throws(() => exigirGuardas(sinAck), /DISPOSABLE_CLUSTER/);
  });

  await t.test("aborta si el acuse tiene el valor casi correcto", () => {
    assert.throws(
      () => exigirGuardas({ ...entornoValido, REVISION_CONFLICT_TEST_DB_ACK: "disposable_only" }),
      /DISPOSABLE_ONLY/,
      "La comparación debe ser exacta: aceptar variantes convierte el acuse en un trámite."
    );
  });

  await t.test("aborta si la URL de PostgreSQL no es de bucle local", () => {
    for (const host of ["db.example.com", "10.0.0.5", "0.0.0.0", "127.0.0.2"]) {
      assert.throws(
        () =>
          validarUrlBaseDatos(`postgres://postgres:pw@${host}:${PUERTO_DB_EXIGIDO}/${BASE_EXIGIDA}`),
        /host/,
        `El host '${host}' debería haberse rechazado.`
      );
    }
  });

  await t.test("aborta si la URL de PostgREST no es de bucle local", () => {
    for (const host of ["api.example.com", "10.0.0.5", "0.0.0.0", "127.0.0.2"]) {
      assert.throws(
        () => validarUrlPostgrest(`http://${host}:${PUERTO_PGRST_EXIGIDO}`),
        /host/,
        `El host '${host}' debería haberse rechazado.`
      );
    }
  });

  // Los cuatro rechazos siguientes van en pruebas SEPARADAS y no en un bucle
  // sobre una lista de URLs malas. La razón es que un bucle sólo demuestra que
  // cada URL se rechaza por ALGO, y aquí lo que hay que demostrar es que cada
  // una se rechaza por SU motivo: si un día la guarda del puerto desapareciera,
  // una URL con puerto raro seguiría fallando por el host y el bucle seguiría en
  // verde. Cada aserción fija el motivo con su propia expresión regular, y cada
  // URL es por lo demás perfectamente válida salvo en el punto que se prueba.

  await t.test("aborta si la URL de PostgREST usa https en vez de http", () => {
    assert.throws(
      () => validarUrlPostgrest(`https://127.0.0.1:${PUERTO_PGRST_EXIGIDO}/`),
      /protocolo/,
      "El PostgREST del banco no habla TLS: un 'https:' aquí significa que se " +
        "está apuntando a otra cosa, y eso debe abortar aunque el esquema sea el " +
        "más seguro de los dos."
    );
  });

  await t.test("aborta si la URL de PostgREST no usa el puerto exacto del banco", () => {
    for (const url of [
      "http://127.0.0.1/", // sin puerto: caería en el 80
      "http://127.0.0.1:3000/",
      "http://127.0.0.1:53002/",
      "http://127.0.0.1:8080/",
    ]) {
      assert.throws(
        () => validarUrlPostgrest(url),
        /puerto/,
        `'${url}' debería haberse rechazado por el puerto.`
      );
    }
  });

  await t.test("aborta si la URL de PostgREST lleva una ruta distinta de la raíz", () => {
    for (const ruta of ["/rest/v1", "/rest/v1/", "/postgrest", "//"]) {
      assert.throws(
        () => validarUrlPostgrest(`http://127.0.0.1:${PUERTO_PGRST_EXIGIDO}${ruta}`),
        /ruta/,
        `La ruta '${ruta}' debería haberse rechazado. '/rest/v1' en particular es ` +
          "la forma de una URL de Supabase real copiada por descuido."
      );
    }
  });

  await t.test("aborta si la URL de PostgREST lleva fragmento", () => {
    assert.throws(
      () => validarUrlPostgrest(`http://127.0.0.1:${PUERTO_PGRST_EXIGIDO}/#algo`),
      /fragmento/,
      "El fragmento no viaja en la petición HTTP, así que la guarda estaría " +
        "validando una URL distinta de la que se envía."
    );
  });

  await t.test("aborta si la URL de PostgREST lleva credenciales o consulta", () => {
    assert.throws(
      () => validarUrlPostgrest(`http://usuario:clave@127.0.0.1:${PUERTO_PGRST_EXIGIDO}/`),
      /credenciales/
    );
    assert.throws(
      () => validarUrlPostgrest(`http://127.0.0.1:${PUERTO_PGRST_EXIGIDO}/?apikey=x`),
      /consulta/
    );
  });

  await t.test("la URL de referencia de PostgREST sí pasa, con y sin barra final", () => {
    // El complemento de los cinco rechazos anteriores. Sin esto, una guarda que
    // rechazase absolutamente todo también pondría en verde las pruebas de
    // arriba.
    for (const url of [
      `http://127.0.0.1:${PUERTO_PGRST_EXIGIDO}`,
      `http://127.0.0.1:${PUERTO_PGRST_EXIGIDO}/`,
      `http://localhost:${PUERTO_PGRST_EXIGIDO}/`,
    ]) {
      const validada = validarUrlPostgrest(url);
      assert.equal(validada.port, PUERTO_PGRST_EXIGIDO);
      assert.equal(validada.pathname, "/");
    }
  });

  await t.test("aborta si la base o el puerto no son los del contenedor desechable", () => {
    assert.throws(
      () => validarUrlBaseDatos(`postgres://postgres:pw@127.0.0.1:5432/${BASE_EXIGIDA}`),
      /puerto/
    );
    assert.throws(
      () => validarUrlBaseDatos(`postgres://postgres:pw@127.0.0.1:${PUERTO_DB_EXIGIDO}/postgres`),
      /base/
    );
  });

  await t.test("aborta si la URL de PostgreSQL trae parámetros de consulta", () => {
    assert.throws(
      () =>
        validarUrlBaseDatos(
          `postgres://postgres:pw@127.0.0.1:${PUERTO_DB_EXIGIDO}/${BASE_EXIGIDA}?host=otra`
        ),
      /parámetros de consulta/
    );
  });

  await t.test("aborta si el entorno trae variables de libpq heredadas", () => {
    for (const variable of VARIABLES_PG_PROHIBIDAS) {
      assert.throws(
        () => exigirGuardas({ ...entornoValido, [variable]: "loquesea" }),
        new RegExp(variable),
        `${variable} debería haberse rechazado por estar presente.`
      );
    }
  });

  await t.test("aborta si el secreto del JWT es corto o inexistente", () => {
    assert.throws(() => exigirGuardas({ ...entornoValido, TEST_JWT_SECRET: "corto" }), /32/);
  });

  await t.test("aborta si la contraseña de authenticator sale del alfabeto permitido", () => {
    assert.throws(
      () => exigirGuardas({ ...entornoValido, TEST_PGRST_AUTHENTICATOR_PASSWORD: "a'; drop--" }),
      /A-Za-z0-9/
    );
  });

  // Éste es el control que sustituye a lo que no se puede construir: no hay
  // forma portable de que una escritura sobreviva a una excepción dentro de la
  // misma transacción, así que la afirmación «si el conflicto modificase estado,
  // fecha o revisión el banco fallaría» se demuestra perturbando la instantánea
  // campo a campo y exigiendo que el comparador salte en los cuatro casos.
  await t.test("el comparador de estado agarra en los cuatro campos", () => {
    const base = {
      revision: 3,
      observable_state: "estable",
      mutation_count: 2,
      last_mutated_at: "2026-09-07 10:00:00+00",
    };
    const perturbaciones = {
      revision: 4,
      observable_state: "estable ",
      mutation_count: 3,
      last_mutated_at: "2026-09-07 10:00:00.000001+00",
    };

    assert.doesNotThrow(() => assertEstadoIdentico(base, { ...base }, "control"));

    for (const campo of CAMPOS_OBSERVABLES) {
      assert.throws(
        () => assertEstadoIdentico(base, { ...base, [campo]: perturbaciones[campo] }, "control"),
        new RegExp(campo),
        `El comparador no detecta un cambio en '${campo}', así que la afirmación ` +
          "«el conflicto no modificó nada» no estaría respaldada para ese campo."
      );
    }
  });

  await t.test("el comparador de conflicto no acepta cualquier 4xx ni cualquier código", () => {
    const ok = { status: 409 };
    assert.doesNotThrow(() =>
      assertConflictoPt409(ok, { code: "PT409", message: "conflicto" }, 1, "control")
    );

    assert.throws(
      () => assertConflictoPt409({ status: 400 }, { code: "PT400", message: "x" }, 1, "control"),
      /409/
    );
    assert.throws(
      () => assertConflictoPt409({ status: 409 }, { code: "23505", message: "x" }, 1, "control"),
      /PT409/,
      "Un 409 producido por una violación de UNIQUE no es un conflicto de revisión."
    );
    assert.throws(
      () => assertConflictoPt409(ok, { code: "PT409", message: "x" }, 2, "control"),
      /UNA sola petición/
    );
  });

  await t.test("el comparador de conflicto exige un mensaje con contenido", () => {
    const ok = { status: 409 };

    // Los tres cuerpos de abajo tienen `code === "PT409"`, status 409 y una sola
    // petición: pasarían todo lo demás. Lo único que les falta es decir qué ha
    // pasado. Un 409 mudo obliga a quien lee el registro a adivinar, y ese es
    // exactamente el estado que este banco existe para no dejar pasar.
    for (const mensaje of ["", "   ", "\n\t "]) {
      assert.throws(
        () => assertConflictoPt409(ok, { code: "PT409", message: mensaje }, 1, "control"),
        /vacío o es sólo espacios/,
        `El mensaje ${JSON.stringify(mensaje)} debería haberse rechazado.`
      );
    }

    for (const mensaje of [undefined, null, 42, { texto: "x" }]) {
      assert.throws(
        () => assertConflictoPt409(ok, { code: "PT409", message: mensaje }, 1, "control"),
        /mensaje legible/,
        `El mensaje ${JSON.stringify(mensaje)} no es una cadena y debería haberse rechazado.`
      );
    }

    // Y el complemento: un mensaje con espacios alrededor pero con contenido sí
    // pasa. `trim()` decide sobre el contenido, no sobre el formato.
    assert.doesNotThrow(() =>
      assertConflictoPt409(ok, { code: "PT409", message: "  conflicto de revisión  " }, 1, "control")
    );
  });

  await t.test("la línea base económica sigue congelada, tipada y sin PII", async () => {
    const texto = await readFile(RUTA_FIXTURE_ECONOMICO, "utf8");
    const d = JSON.parse(texto);
    const etiqueta = "budget-economic-golden-vectors.json";

    // ── Los cuatro casos, ni uno más ni uno menos ──────────────────────────
    assert.deepEqual(
      d.cases.map((c) => c.case_id),
      CASOS_ESPERADOS,
      `${etiqueta}: la lista de casos ha cambiado. La regla de selección documentada ` +
        "produce exactamente tres 'wizard' y uno 'classic_form', en ese orden."
    );

    for (const caso of d.cases) {
      assert.ok(
        CLASES_CASO_PERMITIDAS.has(caso.case_class),
        `${etiqueta}/${caso.case_id}: clase de caso desconocida '${caso.case_class}'.`
      );

      // ── Huella: recalculada Y contrastada con la constante congelada ─────
      // Las dos comprobaciones no sobran la una a la otra. La primera dice que
      // el campo del fichero describe el contenido del fichero; la segunda dice
      // que ese contenido es el mismo de siempre. Sin la segunda, recalcular la
      // huella tras editar un importe bastaría para pasar.
      const recalculada = huellaCanonica(caso);
      assert.equal(
        recalculada,
        caso[CAMPO_HUELLA],
        `${etiqueta}/${caso.case_id}: el campo ${CAMPO_HUELLA} no describe el ` +
          "contenido del caso. O se editó el contenido sin recalcular, o se " +
          "recalculó con otro algoritmo."
      );
      assert.equal(
        recalculada,
        HUELLAS_CONGELADAS[caso.case_id],
        `${etiqueta}/${caso.case_id}: el caso ha cambiado respecto de la línea base ` +
          "congelada el 2026-09-07. Si el cambio es intencionado hay que decir por " +
          "qué y actualizar HUELLAS_CONGELADAS a mano; no se actualiza para que " +
          "vuelva el verde."
      );

      // ── Los importes son cadenas ────────────────────────────────────────
      for (const campo of ["subtotal", "iva_percent", "iva_amount", "discount_percent",
                           "discount_amount", "deposit_percent", "total"]) {
        assert.equal(
          typeof caso.header[campo],
          "string",
          `${etiqueta}/${caso.case_id}: header.${campo} debe ser cadena y es ` +
            `${typeof caso.header[campo]}. Un decimal en coma flotante no puede ` +
            "representar 0,10 exactamente."
        );
      }

      assert.ok(
        ESTADOS_CABECERA_PERMITIDOS.has(caso.header.status),
        `${etiqueta}/${caso.case_id}: estado de cabecera desconocido '${caso.header.status}'.`
      );
      assert.ok(
        TIPOS_DESCUENTO_PERMITIDOS.has(caso.header.discount_type),
        `${etiqueta}/${caso.case_id}: discount_type desconocido '${caso.header.discount_type}'.`
      );

      // ── Filas persistidas: tipos por columna y vocabularios cerrados ─────
      assert.equal(
        caso.persisted_items.length,
        caso.header.n_items,
        `${etiqueta}/${caso.case_id}: n_items no coincide con las filas capturadas.`
      );

      const [I_SORT, I_QTY, I_PRECIO, I_SUB, I_CAT, I_UNIDAD] = [0, 1, 2, 3, 4, 5];
      assert.deepEqual(d.columns.persisted_items, [
        "sort_order", "quantity", "unit_price", "subtotal", "category", "unit",
      ]);

      for (const [i, fila] of caso.persisted_items.entries()) {
        assert.equal(typeof fila[I_SORT], "number", `${caso.case_id}[${i}]: sort_order debe ser entero.`);
        assert.ok(Number.isInteger(fila[I_SORT]), `${caso.case_id}[${i}]: sort_order no es entero.`);
        for (const col of [I_QTY, I_PRECIO, I_SUB]) {
          assert.equal(
            typeof fila[col],
            "string",
            `${etiqueta}/${caso.case_id}[${i}]: la columna ` +
              `'${d.columns.persisted_items[col]}' debe ser cadena y es ${typeof fila[col]}.`
          );
        }
        assert.ok(
          CATEGORIAS_PERMITIDAS.has(fila[I_CAT]),
          `${etiqueta}/${caso.case_id}[${i}]: category '${fila[I_CAT]}' fuera del vocabulario.`
        );
        assert.ok(
          UNIDADES_PERMITIDAS.has(fila[I_UNIDAD]),
          `${etiqueta}/${caso.case_id}[${i}]: unit '${fila[I_UNIDAD]}' fuera del vocabulario. ` +
            "Si es una unidad nueva, alguien ha recapturado el fixture."
        );
      }

      // ── Partidas y materiales del wizard ─────────────────────────────────
      const eco = caso.wizard_state_economics;
      if (caso.case_class === "classic_form") {
        assert.equal(
          eco,
          null,
          `${etiqueta}/${caso.case_id}: un caso 'classic_form' no tiene wizard_state.`
        );
        continue;
      }

      for (const [i, p] of eco.partidas.entries()) {
        for (const col of [0, 1, 2, 3, 4]) {
          assert.equal(
            typeof p[col],
            "string",
            `${etiqueta}/${caso.case_id}: partida[${i}].${d.columns.wizard_partidas[col]} ` +
              `debe ser cadena y es ${typeof p[col]}.`
          );
        }
        assert.ok(
          ESTADOS_PARTIDA_PERMITIDOS.has(p[5]),
          `${etiqueta}/${caso.case_id}: estado de partida '${p[5]}' fuera del vocabulario.`
        );
      }

      for (const [i, m] of eco.materials.entries()) {
        for (const col of [0, 1, 2]) {
          assert.equal(
            typeof m[col],
            "string",
            `${etiqueta}/${caso.case_id}: material[${i}].${d.columns.wizard_materials[col]} ` +
              `debe ser cadena y es ${typeof m[col]}.`
          );
        }
        assert.equal(
          typeof m[3],
          "boolean",
          `${etiqueta}/${caso.case_id}: material[${i}].included debe ser booleano y es ` +
            `${typeof m[3]}. 'true'/'false' como cadena o 0/1 como número serían ` +
            "vocabularios distintos disfrazados del mismo."
        );
      }

      assert.equal(eco.partidas.length, eco.n_partidas);
      assert.equal(eco.materials.length, eco.n_materials);
    }

    // ── Ningún `number` fuera de las rutas autorizadas ─────────────────────
    const numerosIndebidos = [];
    for (const [ruta, , valor] of recorrer(d)) {
      if (typeof valor !== "number") continue;
      if (!RUTAS_NUMERICAS_PERMITIDAS.has(ruta)) numerosIndebidos.push(`${ruta}=${valor}`);
      else if (!Number.isInteger(valor)) numerosIndebidos.push(`${ruta}=${valor} (no es entero)`);
    }
    assert.deepEqual(
      numerosIndebidos,
      [],
      `${etiqueta}: hay valores JSON 'number' fuera de contadores, schema_version y ` +
        `sort_order: ${numerosIndebidos.join(", ")}. Cualquier importe tiene que ir ` +
        "como cadena."
    );

    // ── Sin PII ───────────────────────────────────────────────────────────
    assertSinPii(texto, d, etiqueta);
  });

  await t.test("la línea base de privilegios sigue completa, sin duplicados y sin secretos", async () => {
    const texto = await readFile(RUTA_FIXTURE_ACL, "utf8");
    const d = JSON.parse(texto);
    const etiqueta = "budget-acl-baseline.json";

    assert.deepEqual(
      d.tables.map((t2) => t2.table),
      ["activity_log", "budget_items", "budget_snapshots", "budgets", "document_versions"],
      `${etiqueta}: las cinco tablas del ciclo de vida de un presupuesto y del borrado ` +
        "de cuenta son exactamente esas. Si falta una, la compensación futura dejaría " +
        "un agujero justo donde no se mira."
    );

    assert.deepEqual(
      d.roles.map((r) => r.role),
      ["anon", "authenticated", "authenticator", "postgres", "service_role"],
      `${etiqueta}: la lista de roles ha cambiado.`
    );

    // ── Ninguna entrada (tabla, beneficiario, otorgante) repetida ──────────
    // Un duplicado no es cosmético: la receta de reversión documentada consiste
    // en reejecutar estos GRANT, y reejecutar dos veces la misma línea oculta
    // que una de las dos venía de otro sitio.
    const vistas = new Map();
    const duplicadas = [];
    for (const g of d.effective_table_privileges.grants) {
      const clave = `${g.table}|${g.grantee}|${g.grantor}`;
      if (vistas.has(clave)) duplicadas.push(clave);
      vistas.set(clave, true);
    }
    assert.deepEqual(
      duplicadas,
      [],
      `${etiqueta}: hay entradas repetidas de (tabla, beneficiario, otorgante): ` +
        `${duplicadas.join(", ")}.`
    );

    // ── PUBLIC sin privilegios de tabla ───────────────────────────────────
    // Se comprueba de dos maneras: que el campo que lo declara siga ahí y que
    // ninguna entrada de la matriz lo contradiga. Un GRANT ... TO PUBLIC en una
    // futura «restauración» sería una escalada, no una restauración.
    assert.ok(
      d.effective_table_privileges.public_pseudo_role,
      `${etiqueta}: ha desaparecido la constancia de que PUBLIC no tiene privilegios.`
    );
    const conPublic = d.effective_table_privileges.grants.filter((g) =>
      ["public", "PUBLIC", ""].includes(g.grantee)
    );
    assert.deepEqual(
      conPublic,
      [],
      `${etiqueta}: la matriz contiene privilegios de tabla concedidos a PUBLIC: ` +
        `${JSON.stringify(conPublic)}.`
    );

    // ── Los dos otorgantes de privilegios por defecto ─────────────────────
    // `ALTER DEFAULT PRIVILEGES` sólo afecta a las entradas del rol que lo
    // ejecuta. Que existan dos otorgantes distintos es el hecho que hace que la
    // reversión no sea trivial: restaurar los de `supabase_admin` exige actuar
    // COMO `supabase_admin`, cosa que la CLI de migraciones normalmente no
    // puede. Si esta comprobación desapareciera, ese obstáculo se perdería de
    // vista justo cuando hiciera falta.
    const otorgantes = [...new Set(d.default_privileges.entries.map((e) => e.grantor_role))].sort();
    assert.deepEqual(
      otorgantes,
      ["postgres", "supabase_admin"],
      `${etiqueta}: los otorgantes de privilegios por defecto han cambiado. Se esperaban ` +
        "'postgres' y 'supabase_admin'."
    );

    assertSinPii(texto, d, etiqueta);
  });

  await t.test("el fichero de bootstrap sigue exigiendo la contraseña por testigo", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    assert.ok(
      sql.includes(TESTIGO_PASSWORD),
      "El testigo de la contraseña ha desaparecido del bootstrap. Si se ha " +
        "sustituido por una contraseña literal, hay una credencial en el repositorio."
    );
    assert.ok(
      sql.includes(`enlaze.test_cluster_marker`) && sql.includes(MARCADOR_EXIGIDO),
      "El bootstrap ha perdido su propia guarda de marcador de clúster."
    );
    assert.ok(
      /drop schema if exists public cascade/i.test(sql),
      "El bootstrap ya no borra el esquema public: o ha cambiado de naturaleza o " +
        "está incompleto, y en ambos casos el resto de este banco deja de significar lo que dice."
    );

    // Las dos guardas que sólo se pueden comprobar leyendo, más su colocación.
    // El verificador devuelve los fallos ya redactados; aquí sólo se exige que
    // no haya ninguno y se imprimen todos si los hay, porque diagnosticar esto
    // con un booleano sería innecesariamente cruel.
    const fallos = verificarGuardasBootstrap(sql);
    assert.deepEqual(
      fallos,
      [],
      "El bootstrap ha perdido o ha desplazado alguna de sus guardas previas:\n  · " +
        fallos.join("\n  · ")
    );
  });

  // ── Controles negativos del verificador ─────────────────────────────────────
  //
  // El subtest de arriba sólo demuestra que el bootstrap ACTUAL pasa. Eso lo
  // cumpliría igual un verificador que no comprobase nada, que es el modo más
  // habitual en que una guarda de este tipo se pudre sin que nadie se entere.
  // Lo que sigue son mutaciones del texto —en memoria, sobre una copia; el
  // fichero no se toca y el SQL no se ejecuta— y cada una exige que el
  // verificador falle POR SU MOTIVO, no por uno cualquiera.

  await t.test("el verificador rechaza un bootstrap sin la guarda del nombre de base", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      /if current_database\(\) <> 'enlaze_revision_conflict_test' then[\s\S]*?end if;\n/,
      ""
    );
    assert.notEqual(mutado, sql, "La mutación no se aplicó: el patrón de la guarda ha cambiado.");
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /GUARDA DE BASE AUSENTE/.test(f)),
      `Se esperaba que el verificador detectase la ausencia de la guarda de base y devolvió: ${JSON.stringify(fallos)}`
    );
  });

  await t.test("el verificador rechaza un bootstrap sin la guarda de versión", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      /if current_setting\('server_version_num'\)::integer < 170000 then[\s\S]*?end if;\n/,
      ""
    );
    assert.notEqual(mutado, sql, "La mutación no se aplicó: el patrón de la guarda ha cambiado.");
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /GUARDA DE VERSIÓN AUSENTE/.test(f)),
      `Se esperaba que el verificador detectase la ausencia de la guarda de versión y devolvió: ${JSON.stringify(fallos)}`
    );
  });

  await t.test("el verificador rechaza que una guarda quede después del primer DDL", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");

    // Se extrae la guarda de la base de su bloque y se vuelve a insertar, ya
    // envuelta en su propio `do`, DESPUÉS de la primera sentencia mutante. El
    // texto resultante sigue conteniendo la comprobación palabra por palabra:
    // ésta es exactamente la mutación que un verificador ingenuo basado en
    // `includes()` daría por buena, y es la que más importa detectar.
    const guarda =
      /  if current_database\(\) <> 'enlaze_revision_conflict_test' then[\s\S]*?  end if;\n/.exec(sql);
    assert.ok(guarda, "No se pudo extraer la guarda de base para la mutación.");

    const sinGuarda = sql.replace(guarda[0], "");
    const codigo = despojarComentariosSql(sinGuarda);
    const mutante = /\b(create\s+role|alter\s+role|drop\s+schema|grant)\b/i.exec(codigo);
    assert.ok(mutante, "No se encontró ninguna sentencia mutante tras la que reinsertar la guarda.");

    const corte = sinGuarda.indexOf("\n", mutante.index);
    const mutado =
      sinGuarda.slice(0, corte + 1) +
      `do $tarde$\nbegin\n${guarda[0]}end;\n$tarde$;\n` +
      sinGuarda.slice(corte + 1);

    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      mutado.includes("current_database() <> 'enlaze_revision_conflict_test'"),
      "La mutación debía CONSERVAR el texto de la guarda, sólo moverlo."
    );
    assert.ok(
      fallos.some((f) => /GUARDA DE BASE FUERA DEL BLOQUE/.test(f)),
      `Se esperaba que el verificador detectase la guarda desplazada fuera del bloque y devolvió: ${JSON.stringify(fallos)}`
    );
  });

  // ── Guardas comentadas: texto presente, comprobación ausente ───────────────
  //
  // Éste es el mutante más barato de todos y el que más tiempo pasó sin
  // detectarse. Comentar la guarda línea por línea deja el texto intacto en el
  // fichero —`grep` la encuentra, el patrón casa, la revisión visual la ve— pero
  // PostgreSQL no ejecuta nada. Un verificador que trate el cuerpo `$guard$` como
  // una cadena opaca da luz verde a esto.

  await t.test("el verificador rechaza la guarda de base COMENTADA por completo", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaBase(sql);
    const comentada = guarda
      .split("\n")
      .map((l) => (l.trim() === "" ? l : `-- ${l}`))
      .join("\n");
    const mutado = sql.replace(guarda, comentada);

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("current_database() <> 'enlaze_revision_conflict_test'"),
      "La mutación debía CONSERVAR el texto de la guarda, sólo comentarlo."
    );
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE BASE AUSENTE/.test(f)),
      `Una guarda comentada no comprueba nada y debe rechazarse. Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza la guarda de versión COMENTADA por completo", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaVersion(sql);
    const comentada = guarda
      .split("\n")
      .map((l) => (l.trim() === "" ? l : `-- ${l}`))
      .join("\n");
    const mutado = sql.replace(guarda, comentada);

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("server_version_num"),
      "La mutación debía CONSERVAR el texto de la guarda, sólo comentarlo."
    );
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE VERSIÓN AUSENTE/.test(f)),
      `Una guarda comentada no comprueba nada y debe rechazarse. Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  // ── Guardas invertidas: mismas palabras, sentido opuesto ───────────────────

  await t.test("el verificador rechaza `=` en lugar de `<>` en la guarda de base", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      "current_database() <> 'enlaze_revision_conflict_test'",
      "current_database() = 'enlaze_revision_conflict_test'"
    );

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      /current_database\(\) = 'enlaze_revision_conflict_test'/.test(mutado),
      "La mutación debía dejar la comparación con `=`."
    );
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE BASE INVERTIDA/.test(f)),
      `Con \`=\` la negativa se dispara en la base correcta y deja pasar el resto. Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  for (const operador of [">", ">=", "<="]) {
    await t.test(`el verificador rechaza \`${operador} 170000\` en la guarda de versión`, async () => {
      const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
      const mutado = sql.replace("::integer < 170000", `::integer ${operador} 170000`);

      assert.notEqual(mutado, sql, "La mutación no se aplicó.");
      assert.ok(
        mutado.includes(`::integer ${operador} 170000`),
        "La mutación debía dejar el operador cambiado."
      );
      assert.ok(
        verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE VERSIÓN INVERTIDA/.test(f)),
        `Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
      );
    });
  }

  // ── Colocación: nada ejecutable antes del bloque ───────────────────────────

  await t.test("el verificador rechaza un CREATE TABLE antes de `do $guard$`", async () => {
    // `create table` no estaba en ninguna lista de «sentencias peligrosas», y ése
    // era justamente el problema de tener una lista. La invariante actual no
    // enumera peligros: exige que no haya NADA por delante.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = "create table unsafe_probe(id integer);\n" + sql;

    assert.ok(mutado.startsWith("create table unsafe_probe"), "La mutación no se aplicó.");
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) =>
        /EL BLOQUE DE GUARDAS NO ES LA PRIMERA INSTRUCCIÓN/.test(f)
      ),
      `Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza una instrucción mutante DENTRO del bloque", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      "do $guard$\nbegin\n",
      "do $guard$\nbegin\n  create role colado nologin;\n"
    );

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) =>
        /INSTRUCCIÓN MUTANTE DENTRO DEL BLOQUE/.test(f)
      ),
      `Un bloque que modifica el clúster no puede seguir diciendo «no se ha modificado nada». Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  // ── Guardas que conservan la condición pero han dejado de abortar ──────────
  //
  // Toda esta familia comparte una propiedad incómoda: el `grep` sigue
  // encontrando la guarda, la revisión visual la ve, y el fichero ya no está
  // protegido. Son las mutaciones que sobreviven a cualquier verificador que
  // mire subcadenas en vez de sentencias.

  await t.test("el verificador rechaza una guarda cuyo cuerpo es `null;`", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaBase(sql);
    const { cabecera, cierre } = partirGuarda(guarda);
    const mutado = sql.replace(guarda, `${cabecera}    null;\n${cierre}`);

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("current_database() <> 'enlaze_revision_conflict_test'"),
      "La mutación debía conservar intacta la CONDICIÓN."
    );
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE BASE SIN RAISE EXCEPTION/.test(f)),
      `Detectar el problema y no abortar no es guardar. Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza `raise notice` en lugar de `raise exception`", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaBase(sql);
    const mutado = sql.replace(guarda, guarda.replace("raise exception", "raise notice"));

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(mutado.includes("raise notice"), "La mutación debía dejar un `raise notice`.");
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /GUARDA DE BASE SIN RAISE EXCEPTION/.test(f) && /raise notice/i.test(f)),
      `Un \`notice\` escribe en el log y deja continuar el fichero. Fallos: ${JSON.stringify(fallos)}`
    );
  });

  await t.test("el verificador rechaza `and false` en la condición de base", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      "'enlaze_revision_conflict_test' then",
      "'enlaze_revision_conflict_test' and false then"
    );

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(mutado.includes("and false then"), "La mutación debía añadir el `and false`.");
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /CONDICIÓN DE BASE ALTERADA/.test(f)),
      `Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza `and false` en la condición de versión", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace("::integer < 170000 then", "::integer < 170000 and false then");

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(mutado.includes("and false then"), "La mutación debía añadir el `and false`.");
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /CONDICIÓN DE VERSIÓN ALTERADA/.test(f)),
      `Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza un `raise exception` sacado de su propio IF", async () => {
    // El `raise exception` SIGUE en el bloque `$guard$`, sólo que ya no cuelga de
    // la condición que debía dispararlo. Buscarlo «en alguna parte» daría verde;
    // por eso se exige que sea lo primero del `then` de ESA guarda.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaBase(sql);
    const { cabecera, cuerpo, cierre } = partirGuarda(guarda);
    const mutado = sql.replace(guarda, `${cabecera}    null;\n${cierre}${cuerpo}`);

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      /raise exception/i.test(mutado.slice(mutado.indexOf("do $guard$"), mutado.indexOf("$guard$;"))),
      "La mutación debía CONSERVAR el `raise exception` dentro del bloque protector."
    );
    assert.ok(
      verificarGuardasBootstrap(mutado).some((f) => /GUARDA DE BASE SIN RAISE EXCEPTION/.test(f)),
      `Fallos: ${JSON.stringify(verificarGuardasBootstrap(mutado))}`
    );
  });

  await t.test("el verificador rechaza una guarda con SÓLO el `raise exception` comentado", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const guarda = extraerGuardaBase(sql);
    const { cabecera, cuerpo, cierre } = partirGuarda(guarda);
    const comentado = cuerpo
      .split("\n")
      .map((l) => (l.trim() === "" ? l : `-- ${l}`))
      .join("\n");
    const mutado = sql.replace(guarda, `${cabecera}${comentado}${cierre}`);

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("current_database() <> 'enlaze_revision_conflict_test' then"),
      "La mutación debía dejar la condición SIN comentar y comentar sólo el cuerpo."
    );
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /GUARDA DE BASE SIN RAISE EXCEPTION/.test(f) && /cuerpo vacío/.test(f)),
      `Un \`if\` con el cuerpo comentado no aborta. Fallos: ${JSON.stringify(fallos)}`
    );
  });

  // ── El bloque que se traga sus propias negativas ───────────────────────────
  //
  // Distinta en naturaleza a las seis anteriores: no le pasa nada a ninguna
  // guarda. Las cuatro condiciones quedan intactas, los cuatro `raise exception`
  // quedan intactos y se ejecutan; lo que cambia es que el bloque que los
  // contiene deja de propagarlos. Un verificador que audite guardas una a una
  // las encuentra todas correctas y da verde sobre un fichero desprotegido.

  await t.test("el verificador rechaza `exception when others then null;` en el bloque", async () => {
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      "end;\n$guard$;",
      "exception when others then\n  null;\nend;\n$guard$;"
    );

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("exception when others then"),
      "La mutación debía añadir una sección manejadora."
    );
    assert.equal(
      contarRaiseExceptionEnBloque(mutado),
      contarRaiseExceptionEnBloque(sql),
      "La mutación NO debía tocar ningún `raise exception`: ahí está la gracia, en que " +
        "siguen todos y aun así el fichero deja de estar protegido."
    );
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /BLOQUE DE GUARDAS CAPTURA EXCEPCIONES/.test(f)),
      `Negarse y tragarse la negativa es no negarse. Fallos: ${JSON.stringify(fallos)}`
    );
  });

  await t.test("el verificador rechaza `exception when raise_exception then null;`", async () => {
    // Variante estrecha: en vez de `others`, captura exactamente la condición que
    // levantan los `raise exception` de las guardas. Es más quirúrgica y por eso
    // más creíble a la vista; el efecto sobre las cuatro negativas es el mismo.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");
    const mutado = sql.replace(
      "end;\n$guard$;",
      "exception when raise_exception then\n  null;\nend;\n$guard$;"
    );

    assert.notEqual(mutado, sql, "La mutación no se aplicó.");
    assert.ok(
      mutado.includes("exception when raise_exception then"),
      "La mutación debía añadir una sección manejadora."
    );
    assert.equal(
      contarRaiseExceptionEnBloque(mutado),
      contarRaiseExceptionEnBloque(sql),
      "La mutación NO debía tocar ningún `raise exception`."
    );
    const fallos = verificarGuardasBootstrap(mutado);
    assert.ok(
      fallos.some((f) => /BLOQUE DE GUARDAS CAPTURA EXCEPCIONES/.test(f)),
      `Fallos: ${JSON.stringify(fallos)}`
    );
  });

  await t.test("un manejador escrito en un comentario o en un mensaje no cuenta", async () => {
    // Si esta comprobación se hubiera hecho sobre el texto crudo, el precio no lo
    // pagarían los mutantes sino el fichero real: bastaría documentar por qué no
    // se captura para que el verificador se quejara, y el arreglo natural sería
    // apagarlo.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");

    assert.deepEqual(
      verificarGuardasBootstrap(sql),
      [],
      "El bootstrap real, con sus cuatro `raise exception`, no captura nada y debe pasar."
    );

    const enComentario = sql.replace(
      "end;\n$guard$;",
      "-- Aquí NO va un `exception when others then null;`, y este comentario lo dice.\nend;\n$guard$;"
    );
    assert.notEqual(enComentario, sql, "La mutación no se aplicó.");
    assert.ok(
      enComentario.includes("exception when others then null;"),
      "La frase debía quedar escrita en el fichero, sólo que comentada."
    );
    assert.deepEqual(
      verificarGuardasBootstrap(enComentario),
      [],
      "Un manejador COMENTADO no se ejecuta: describir la trampa no es caer en ella."
    );

    const enMensaje = sql.replace(
      "No se ha modificado nada.',",
      "No se ha modificado nada. Y no, no hay exception when others then null; aquí.',"
    );
    assert.notEqual(enMensaje, sql, "La mutación no se aplicó.");
    assert.ok(
      enMensaje.includes("exception when others then null;"),
      "La frase debía quedar dentro del literal del mensaje."
    );
    assert.deepEqual(
      verificarGuardasBootstrap(enMensaje),
      [],
      "Texto dentro de una cadena es dato, no código."
    );
  });

  await t.test("los `raise exception` legítimos no se confunden con un manejador", async () => {
    // La comprobación anterior podría satisfacerse con un verificador que se
    // limitara a no mirar nada. Esta fija el otro extremo: el bloque real tiene
    // cuatro `raise exception`, ninguno es un manejador, y el criterio que los
    // distingue —lo que llevan delante— tiene que seguir distinguiéndolos.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");

    assert.equal(
      contarRaiseExceptionEnBloque(sql),
      4,
      "El bloque protector debe seguir teniendo sus cuatro negativas; si son menos, " +
        "este control estaría midiendo otra cosa."
    );
    assert.ok(
      !verificarGuardasBootstrap(sql).some((f) => /CAPTURA EXCEPCIONES/.test(f)),
      "Ningún `raise exception` puede contarse como sección manejadora."
    );

    // Y un `raise exception` de más, tampoco: sigue siendo un `raise`.
    const conRaiseExtra = sql.replace(
      "end;\n$guard$;",
      "  if false then\n    raise exception 'inalcanzable';\n  end if;\nend;\n$guard$;"
    );
    assert.notEqual(conRaiseExtra, sql, "La mutación no se aplicó.");
    assert.equal(
      contarRaiseExceptionEnBloque(conRaiseExtra),
      5,
      "La mutación debía añadir un quinto `raise exception`."
    );
    assert.ok(
      !verificarGuardasBootstrap(conRaiseExtra).some((f) => /CAPTURA EXCEPCIONES/.test(f)),
      `Un \`raise\` de más no abre ninguna sección manejadora. Fallos: ${JSON.stringify(verificarGuardasBootstrap(conRaiseExtra))}`
    );
  });

  // ── Control positivo: las menciones inertes siguen siendo inertes ──────────

  await t.test("el verificador no confunde comentarios ni mensajes con instrucciones", async () => {
    // El reverso de todo lo anterior. Si al endurecer el verificador se hubiera
    // vuelto susceptible a la palabra escrita, el bootstrap —que está muy
    // comentado y cuyos `raise exception` hablan en castellano de crear roles y
    // borrar esquemas— empezaría a fallar por su propia documentación, y la
    // reacción natural sería desactivar la comprobación.
    const sql = await readFile(RUTA_BOOTSTRAP, "utf8");

    const comentarioDelante =
      "-- create table x(i int); create role anon; drop schema public cascade; grant all;\n" + sql;
    assert.deepEqual(
      verificarGuardasBootstrap(comentarioDelante),
      [],
      "Una línea de COMENTARIO que menciona DDL no debe contar como instrucción."
    );

    const bloqueDelante = "/* create table x(i int);\n   drop schema public cascade; */\n" + sql;
    assert.deepEqual(
      verificarGuardasBootstrap(bloqueDelante),
      [],
      "Un comentario de BLOQUE que menciona DDL no debe contar como instrucción."
    );

    const mensajeDentro = sql.replace(
      "'NEGATIVA: se requiere un usuario superusuario",
      "'NEGATIVA: aquí no se hace create role ni drop schema; se requiere un usuario superusuario"
    );
    assert.notEqual(mensajeDentro, sql, "La mutación del mensaje no se aplicó.");
    assert.deepEqual(
      verificarGuardasBootstrap(mensajeDentro),
      [],
      "Un `raise exception` que MENCIONA `create role` no ejecuta ningún `create role`."
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUE 2 — El banco de verdad. Requiere clúster desechable + PostgREST local.
// ═══════════════════════════════════════════════════════════════════════════

test("contrato de conflicto PT409 de extremo a extremo", async (t) => {
  if (!OPT_IN) {
    t.skip(MENSAJE_SKIP);
    return;
  }

  const { urlDb, urlPgrst, secretoJwt, passwordAuthenticator } = exigirGuardas(process.env);
  const base = urlPgrst.origin;

  const { default: pg } = await import("pg");
  const cliente = new pg.Client({ connectionString: urlDb.toString() });
  await cliente.connect();

  try {
    // ── Comprobaciones ya conectados, ANTES de tocar nada ────────────────────
    // Van aquí y no después porque una negativa que llegase con los esquemas ya
    // borrados sería inútil.
    const identidad = await cliente.query(
      `select current_database() as base,
              current_user      as usuario,
              (select rolsuper from pg_roles where rolname = current_user) as es_super,
              current_setting($1, true) as marcador,
              current_setting('server_version_num')::int as version_num`,
      [AJUSTE_MARCADOR]
    );
    const info = identidad.rows[0];

    assert.equal(
      info.base,
      BASE_EXIGIDA,
      `Ya conectados, current_database() dice '${info.base}' y no '${BASE_EXIGIDA}'. ` +
        "La cadena de conexión no describía a dónde se iba realmente."
    );
    assert.equal(
      info.es_super,
      true,
      "El usuario de conexión debe ser superusuario: el bootstrap crea roles y una " +
        "función SECURITY DEFINER."
    );
    assert.equal(
      info.marcador,
      MARCADOR_EXIGIDO,
      `El clúster no presenta ${AJUSTE_MARCADOR}=${MARCADOR_EXIGIDO}. Es una señal ` +
        "secundaria y falsificable por sesión, no una prueba de que el clúster sea " +
        "desechable, pero detecta el descuido de apuntar a otro PostgreSQL."
    );
    assert.ok(
      info.version_num >= 170000,
      `El banco exige PostgreSQL 17 o superior y el servidor dice ${info.version_num}.`
    );

    // ── Bootstrap ────────────────────────────────────────────────────────────
    const plantilla = await readFile(RUTA_BOOTSTRAP, "utf8");
    assert.ok(
      plantilla.includes(TESTIGO_PASSWORD),
      "El bootstrap no contiene el testigo de la contraseña."
    );
    // La contraseña ya ha pasado por un alfabeto cerrado en las guardas, así que
    // esta interpolación no puede escapar del literal. Se duplica la comilla
    // simple igualmente por si el alfabeto se relajase algún día sin que nadie
    // recuerde que hay una interpolación aquí abajo.
    const sql = plantilla.split(TESTIGO_PASSWORD).join(`'${passwordAuthenticator.replace(/'/g, "''")}'`);
    await cliente.query(sql);

    // ── Esperar a que PostgREST vea el esquema nuevo ─────────────────────────
    // El bootstrap borra y recrea `public`, así que la caché de esquema de
    // PostgREST queda obsoleta. El propio bootstrap lanza NOTIFY al terminar;
    // aquí se espera a que el efecto sea observable en lugar de suponerlo.
    let visible = false;
    for (let intento = 0; intento < 60 && !visible; intento += 1) {
      try {
        const r = await globalThis.fetch(`${base}/`, { headers: { Accept: "application/openapi+json" } });
        if (r.ok) {
          const texto = await r.text();
          visible = texto.includes("pt409_bench_apply_change");
        } else {
          await r.text();
        }
      } catch {
        // PostgREST aún no escucha. Se reintenta.
      }
      if (!visible) {
        await cliente.query(`notify pgrst, 'reload schema'`);
        await esperar(1000);
      }
    }
    assert.ok(
      visible,
      `PostgREST no ha llegado a exponer pt409_bench_apply_change en ${base} tras ` +
        "60 intentos. Sin eso, cualquier 404 posterior sería ambiguo entre «la " +
        "función no existe» y «el contrato no se cumple»."
    );

    // ── Semilla ──────────────────────────────────────────────────────────────
    const propietario = randomUUID();
    const ajeno = randomUUID();
    const token = tokenAutenticado(propietario, secretoJwt);
    const tokenAjeno = tokenAutenticado(ajeno, secretoJwt);

    const CAMPOS = "revision, observable_state, mutation_count, last_mutated_at::text as last_mutated_at";

    async function sembrar(estado = "estado-inicial") {
      const r = await cliente.query(
        `insert into public.pt409_bench_record (owner_id, observable_state)
         values ($1, $2) returning id`,
        [propietario, estado]
      );
      return r.rows[0].id;
    }

    async function leer(id) {
      const r = await cliente.query(
        `select ${CAMPOS} from public.pt409_bench_record where id = $1`,
        [id]
      );
      assert.equal(r.rowCount, 1, "El registro sembrado ha desaparecido.");
      return r.rows[0];
    }

    // ── 1. CONTROL POSITIVO ──────────────────────────────────────────────────
    await t.test("con la revisión correcta: éxito, estado cambiado, revisión +1 exacto", async () => {
      const id = await sembrar();
      const antes = await leer(id);

      const contador = crearFetchContado();
      const { respuesta, cuerpo } = await llamarRpcCrudo(
        base,
        "pt409_bench_apply_change",
        { p_record_id: id, p_expected_revision: antes.revision, p_new_state: "estado-nuevo" },
        token,
        contador
      );

      assert.equal(respuesta.status, 200, `Cuerpo recibido: ${JSON.stringify(cuerpo)}`);
      assert.equal(contador.estado.peticiones, 1);

      const despues = await leer(id);
      assert.equal(despues.observable_state, "estado-nuevo");
      assert.equal(
        despues.revision,
        antes.revision + 1,
        "La revisión debe incrementarse EXACTAMENTE en uno."
      );
      assert.equal(
        despues.mutation_count,
        antes.mutation_count + 1,
        "El contador independiente de escrituras debe subir exactamente uno. Si " +
          "subiera dos con la revisión subiendo uno, habría una escritura de más " +
          "que la revisión no delataría."
      );
      assert.notEqual(despues.last_mutated_at, antes.last_mutated_at);
      assert.equal(cuerpo.revision, despues.revision, "La respuesta debe declarar la revisión nueva.");
    });

    // ── 2. CONFLICTO CON fetch CRUDO ─────────────────────────────────────────
    await t.test("con la revisión obsoleta y fetch crudo: 409, PT409, una petición, nada tocado", async () => {
      const id = await sembrar();
      // Se avanza la revisión una vez para que la que traerá el cliente quede
      // obsoleta de verdad, en lugar de ser un número inventado.
      await cliente.query(
        `update public.pt409_bench_record
            set revision = revision + 1, mutation_count = mutation_count + 1,
                observable_state = 'avanzado-por-otro', last_mutated_at = clock_timestamp()
          where id = $1`,
        [id]
      );
      const antes = await leer(id);
      const revisionObsoleta = antes.revision - 1;

      const contador = crearFetchContado();
      const { respuesta, cuerpo } = await llamarRpcCrudo(
        base,
        "pt409_bench_apply_change",
        { p_record_id: id, p_expected_revision: revisionObsoleta, p_new_state: "no-deberia-escribirse" },
        token,
        contador
      );

      assertConflictoPt409(respuesta, cuerpo, contador.estado.peticiones, "fetch crudo");
      assert.match(
        String(cuerpo.details ?? ""),
        new RegExp(`revision_actual=${antes.revision}`),
        "El detalle debe decir cuál es la revisión actual: sin eso el cliente no " +
          "puede reconstruir su estado y sólo puede reintentar a ciegas."
      );

      assertEstadoIdentico(antes, await leer(id), "fetch crudo");
    });

    // ── 3. CONFLICTO CON supabase-js ─────────────────────────────────────────
    await t.test("con la revisión obsoleta y supabase-js: data null, error PT409, sin reintento", async () => {
      const id = await sembrar();
      await cliente.query(
        `update public.pt409_bench_record set revision = revision + 1, mutation_count = mutation_count + 1
          where id = $1`,
        [id]
      );
      const antes = await leer(id);

      // supabase-js compone las rutas como `${url}/rest/v1/...` porque habla con
      // una instalación de Supabase, no con un PostgREST pelado. Se reescribe ese
      // prefijo en el `fetch` inyectado en vez de usar postgrest-js directamente,
      // para que el camino de código que da forma al error —que es exactamente lo
      // que se está probando— sea el real y no uno equivalente.
      const contador = crearFetchContado((url) => url.replace("/rest/v1/", "/"));
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(base, token, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: contador.fetch },
      });

      const { data, error } = await supabase.rpc("pt409_bench_apply_change", {
        p_record_id: id,
        p_expected_revision: antes.revision - 1,
        p_new_state: "no-deberia-escribirse",
      });

      assert.equal(data, null, "En un conflicto, supabase-js debe devolver data === null.");
      assert.ok(error, "supabase-js debe devolver un error.");
      assert.equal(
        error.code,
        "PT409",
        `El código debe ser distinguible como PT409. Error recibido: ${JSON.stringify(error)}`
      );
      assert.equal(
        contador.estado.peticiones,
        1,
        "supabase-js no debe reintentar por su cuenta: se contaron " +
          `${contador.estado.peticiones} peticiones.`
      );

      assertEstadoIdentico(antes, await leer(id), "supabase-js");
    });

    // ── 4. MUTANTE A: deja de lanzar PT409 ───────────────────────────────────
    await t.test("control negativo: si la función deja de lanzar PT409, el banco falla", async () => {
      const id = await sembrar();
      await cliente.query(
        `update public.pt409_bench_record set revision = revision + 1 where id = $1`,
        [id]
      );
      const antes = await leer(id);

      const contador = crearFetchContado();
      const { respuesta, cuerpo } = await llamarRpcCrudo(
        base,
        "pt409_bench_mutante_siempre_exito",
        { p_record_id: id, p_expected_revision: antes.revision - 1, p_new_state: "mutado" },
        token,
        contador
      );

      assert.equal(respuesta.status, 200, "El mutante A debía tener éxito pese al conflicto.");
      assert.throws(
        () => assertConflictoPt409(respuesta, cuerpo, contador.estado.peticiones, "mutante A"),
        /409/,
        "Las aserciones de conflicto no agarran: pasarían con una función que ya no señala el conflicto."
      );
      assert.throws(
        () => assertEstadoIdentico(antes, { ...antes, revision: antes.revision + 1 }, "mutante A"),
        /revision/
      );
    });

    // ── 5. MUTANTE B: señala con PT400 ───────────────────────────────────────
    await t.test("control negativo: aceptar «cualquier 4xx» haría pasar un PT400", async () => {
      const id = await sembrar();
      await cliente.query(
        `update public.pt409_bench_record set revision = revision + 1 where id = $1`,
        [id]
      );
      const antes = await leer(id);

      const contador = crearFetchContado();
      const { respuesta, cuerpo } = await llamarRpcCrudo(
        base,
        "pt409_bench_mutante_pt400",
        { p_record_id: id, p_expected_revision: antes.revision - 1, p_new_state: "mutado" },
        token,
        contador
      );

      assert.equal(respuesta.status, 400, "El mutante B debía responder 400.");
      assert.ok(
        respuesta.status >= 400 && respuesta.status < 500,
        "Es un 4xx: un banco que sólo comprobase el rango pasaría aquí."
      );
      assert.throws(
        () => assertConflictoPt409(respuesta, cuerpo, contador.estado.peticiones, "mutante B"),
        /409/,
        "El banco acepta cualquier 4xx, que es exactamente lo que no debe hacer."
      );
      assertEstadoIdentico(antes, await leer(id), "mutante B");
    });

    // ── 6. MUTANTE C: escribe y luego lanza ──────────────────────────────────
    await t.test("una transacción por petición: escribir y luego lanzar PT409 no deja rastro", async () => {
      const id = await sembrar();
      await cliente.query(
        `update public.pt409_bench_record set revision = revision + 1 where id = $1`,
        [id]
      );
      const antes = await leer(id);

      const contador = crearFetchContado();
      const { respuesta, cuerpo } = await llamarRpcCrudo(
        base,
        "pt409_bench_mutante_escribe_y_luego_lanza",
        { p_record_id: id, p_expected_revision: antes.revision - 1, p_new_state: "mutado" },
        token,
        contador
      );

      assertConflictoPt409(respuesta, cuerpo, contador.estado.peticiones, "mutante C");
      assertEstadoIdentico(
        antes,
        await leer(id),
        "mutante C — si esto falla, PostgREST NO envuelve cada petición en una " +
          "transacción y el diseño entero de 2F-2 se apoya en algo falso"
      );
    });

    // ── 7. La puerta de escritura es única ───────────────────────────────────
    await t.test("authenticated no puede escribir la tabla por la vía directa", async () => {
      const id = await sembrar();
      const antes = await leer(id);

      const contador = crearFetchContado();
      const respuesta = await contador.fetch(`${base}/pt409_bench_record?id=eq.${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          Prefer: "return=representation",
        },
        body: JSON.stringify({ observable_state: "escritura-directa" }),
      });
      await respuesta.text();

      assert.notEqual(
        respuesta.status,
        200,
        "La tabla no tiene política de UPDATE: una escritura directa no puede " +
          "prosperar. Si prosperase, ninguna afirmación de este banco sobre " +
          "«nada más pudo tocar la fila» se sostendría."
      );
      assertEstadoIdentico(antes, await leer(id), "escritura directa");
    });

    // ── 8. Autorización ──────────────────────────────────────────────────────
    await t.test("un tercero no puede aplicar cambios ni descubrir el registro", async () => {
      const id = await sembrar();
      const antes = await leer(id);

      const contador = crearFetchContado();
      const { respuesta } = await llamarRpcCrudo(
        base,
        "pt409_bench_apply_change",
        { p_record_id: id, p_expected_revision: antes.revision, p_new_state: "ajeno" },
        tokenAjeno,
        contador
      );

      assert.notEqual(respuesta.status, 200, "Un tercero no debe poder aplicar cambios.");
      assert.notEqual(
        respuesta.status,
        409,
        "Y tampoco debe recibir 409: un conflicto revelaría que el registro existe " +
          "y cuál es su revisión."
      );
      assertEstadoIdentico(antes, await leer(id), "tercero");
    });

    await t.test("anon no puede ejecutar la función", async () => {
      const id = await sembrar();
      const antes = await leer(id);

      const contador = crearFetchContado();
      const respuesta = await contador.fetch(`${base}/rpc/pt409_bench_apply_change`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          p_record_id: id,
          p_expected_revision: antes.revision,
          p_new_state: "anonimo",
        }),
      });
      await respuesta.text();

      assert.notEqual(respuesta.status, 200, "anon no tiene EXECUTE sobre la función.");
      assertEstadoIdentico(antes, await leer(id), "anon");
    });
  } finally {
    await cliente.end();
  }
});
