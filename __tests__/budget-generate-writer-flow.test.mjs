// FASE 2F-1APP · BLOQUE B — banco estructural del flujo de guardado.
//
// El Provider es un componente de React y el proyecto no tiene jsdom ni
// testing-library, así que no se puede montar ni ejecutar aquí. Lo que sí se
// puede fijar es su *forma*: qué función captura errores y cuál no, en qué
// orden ocurren los efectos irreversibles de la finalización, y que el único
// camino hacia `budget_items` sea la sustitución atómica.
//
// Las afirmaciones se hacen sobre bloques delimitados por llaves, no sobre el
// fichero entero, para que un `catch` legítimo de otra función no dé por buena
// —ni por mala— la función que se está examinando.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUTA_PROVIDER = "app/dashboard/budgets/generate/_components/BudgetGenerateProvider.tsx";
const PROVIDER = readFileSync(join(RAIZ, RUTA_PROVIDER), "utf8");

/**
 * Devuelve una copia de `texto` de la misma longitud en la que el contenido de
 * comentarios y literales de cadena se ha sustituido por espacios. Sirve para
 * contar llaves sin que una llave dentro de un comentario o de una cadena
 * desequilibre el recuento; al conservar longitud y saltos de línea, los
 * índices siguen siendo válidos sobre el texto original.
 */
function enmascarar(texto) {
  const salida = texto.split("");
  let i = 0;
  const blanquear = (desde, hasta) => {
    for (let k = desde; k < hasta && k < texto.length; k++) {
      if (texto[k] !== "\n") salida[k] = " ";
    }
  };
  while (i < texto.length) {
    const c = texto[i];
    const siguiente = texto[i + 1];
    if (c === "/" && siguiente === "/") {
      let fin = texto.indexOf("\n", i);
      if (fin === -1) fin = texto.length;
      blanquear(i, fin);
      i = fin;
    } else if (c === "/" && siguiente === "*") {
      let fin = texto.indexOf("*/", i + 2);
      fin = fin === -1 ? texto.length : fin + 2;
      blanquear(i, fin);
      i = fin;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === "\\") { j += 2; continue; }
        if (texto[j] === c) break;
        j++;
      }
      blanquear(i, Math.min(j + 1, texto.length));
      i = Math.min(j + 1, texto.length);
    } else {
      i++;
    }
  }
  return salida.join("");
}

const PROVIDER_MASCARA = enmascarar(PROVIDER);

/**
 * Extrae el cuerpo (llaves incluidas) que sigue al primer `{` posterior a
 * `marcador`. El emparejamiento se hace sobre la máscara y el recorte sobre el
 * texto original, de modo que el bloque devuelto es código real.
 */
function bloqueTras(marcador) {
  const inicioMarcador = PROVIDER.indexOf(marcador);
  assert.notEqual(inicioMarcador, -1, `no se encontró el marcador: ${marcador}`);
  const abre = PROVIDER_MASCARA.indexOf("{", inicioMarcador + marcador.length - 1);
  assert.notEqual(abre, -1, `no se encontró la llave de apertura tras: ${marcador}`);
  let profundidad = 0;
  for (let k = abre; k < PROVIDER_MASCARA.length; k++) {
    if (PROVIDER_MASCARA[k] === "{") profundidad++;
    else if (PROVIDER_MASCARA[k] === "}") {
      profundidad--;
      if (profundidad === 0) return PROVIDER.slice(abre, k + 1);
    }
  }
  assert.fail(`bloque sin cerrar tras: ${marcador}`);
}

function cuenta(texto, aguja) {
  return texto.split(aguja).length - 1;
}

const FIRMA_INTERNA = "const saveDraftOrThrow = async (manual = false): Promise<SaveDraftOutcome> => {";
const FIRMA_PUBLICA = "const saveDraft = async (manual = false): Promise<string | null> => {";
const FIRMA_FINALIZE = "const finalizeBudget = async (): Promise<string | null> => {";

const INTERNA = bloqueTras(FIRMA_INTERNA);
const PUBLICA = bloqueTras(FIRMA_PUBLICA);
const FINALIZE = bloqueTras(FIRMA_FINALIZE);
const AUTOGUARDADO = bloqueTras("const runAutosave = async () => {");

describe("FASE 2F-1APP · BLOQUE B — extracción de bloques", () => {
  // Si el emparejamiento de llaves se descuadrase, todo lo demás afirmaría
  // sobre trozos de fichero equivocados y podría pasar por accidente. Estas
  // comprobaciones son la red de seguridad del propio banco.
  test("cada bloque contiene su final y no invade al siguiente", () => {
    assert.ok(INTERNA.includes("return { skipped: false, budgetId: draftId };"));
    assert.equal(INTERNA.includes(FIRMA_PUBLICA), false, "el bloque interno no debe incluir el wrapper");

    assert.ok(PUBLICA.includes("return outcome.skipped ? null : outcome.budgetId;"));
    assert.equal(PUBLICA.includes(FIRMA_FINALIZE), false, "el wrapper no debe incluir finalizeBudget");

    assert.ok(FINALIZE.includes("Error al finalizar: "));
    assert.equal(FINALIZE.includes("const loadDraft"), false, "finalizeBudget no debe invadir loadDraft");

    assert.ok(AUTOGUARDADO.includes("isAutosaving.current = false;"));
  });
});

describe("FASE 2F-1APP · BLOQUE B — separación entre el guardado y su gestión de errores", () => {
  test("el resultado interno distingue la omisión del éxito", () => {
    // Antes, omitir un autoguardado vacío y fallar producían el mismo `null`.
    assert.ok(
      PROVIDER.includes("type SaveDraftOutcome =") &&
        PROVIDER.includes("| { skipped: true; budgetId: null }") &&
        PROVIDER.includes("| { skipped: false; budgetId: string };"),
      "debe existir el tipo discriminado con sus dos variantes",
    );
    assert.equal(
      cuenta(INTERNA, "return { skipped: true, budgetId: null };"),
      1,
      "la omisión legítima debe ser única y explícita",
    );
    assert.equal(
      cuenta(INTERNA, "return { skipped: false, budgetId: draftId };"),
      1,
      "el éxito debe ser único y llevar el identificador",
    );
  });

  test("la rama sin usuario lanza en vez de devolver un valor benigno", () => {
    assert.match(
      INTERNA,
      /if \(!user\) \{\s*throw new Error\("No hay usuario autenticado"\);\s*\}/,
      "la ausencia de usuario debe lanzar",
    );
    assert.ok(INTERNA.includes("if (userError) throw userError;"), "el error de getUser debe propagarse");
    assert.equal(cuenta(INTERNA, "return null"), 0, "el guardado interno no debe devolver null en ningún caso");
  });

  test("el guardado interno no captura nada", () => {
    const interna = enmascarar(INTERNA);
    assert.equal(cuenta(interna, "catch"), 0, "saveDraftOrThrow no debe contener ningún catch");
    assert.equal(cuenta(interna, "toast.error"), 0, "no debe mostrar errores: eso es del llamante");
    assert.equal(cuenta(interna, "saveError: errorMsg"), 0, "no debe fijar el estado de error");
  });

  test("el envoltorio público es el único que captura, y conserva su contrato", () => {
    assert.ok(PUBLICA.includes("try {"), "el wrapper debe abrir un try");
    assert.match(PUBLICA, /catch \(err: any\) \{/, "el wrapper debe capturar");
    assert.ok(PUBLICA.includes("const outcome = await saveDraftOrThrow(manual);"));
    assert.ok(PUBLICA.includes("setState(prev => ({ ...prev, isSavingDraft: false, saveError: errorMsg }));"));
    assert.ok(PUBLICA.includes('if (manual) toast.error("Error al guardar: " + errorMsg);'));
    assert.match(
      PROVIDER,
      /const saveDraft = async \(manual = false\): Promise<string \| null> =>/,
      "el contrato público histórico (manual?) => Promise<string | null> no debe cambiar",
    );
  });
});

describe("FASE 2F-1APP · BLOQUE B — finalización", () => {
  test("finalizeBudget llama a la función interna, no al envoltorio", () => {
    assert.ok(FINALIZE.includes("const saved = await saveDraftOrThrow(false);"));
    assert.equal(
      cuenta(FINALIZE, "await saveDraft(false)"),
      0,
      "finalizar con el wrapper enterraría el fallo en un null",
    );
    assert.ok(
      FINALIZE.includes("const budgetId = saved.skipped ? state.draftId : saved.budgetId;"),
      "el fallback a state.draftId solo puede usarse en la omisión legítima",
    );
  });

  test("finalizar limpia el canal de error del guardado y no lo reabre", () => {
    // Durante la finalización el canal del fallo es `finalizeError`. Si un
    // `saveError` anterior siguiera vivo, la interfaz mostraría dos errores a
    // la vez y el usuario no sabría cuál corresponde a lo que acaba de hacer.
    const limpieza =
      "setState(prev => ({ ...prev, isFinalizing: true, finalizeError: null, saveError: null }));";
    assert.ok(FINALIZE.includes(limpieza), "finalizeBudget debe limpiar también saveError al arrancar");
    assert.ok(
      FINALIZE.indexOf(limpieza) < FINALIZE.indexOf("await saveDraftOrThrow(false);"),
      "la limpieza debe preceder al guardado interno",
    );

    // Y el guardado interno no puede reabrir ese canal: solo se le permite
    // limpiarlo. Escribir un mensaje en `saveError` es privilegio exclusivo
    // del envoltorio público, que en la finalización no interviene.
    const escrituras = [...INTERNA.matchAll(/saveError:\s*([^,\n}]+)/g)].map((m) => m[1].trim());
    assert.ok(escrituras.length > 0, "no se encontró ninguna referencia a saveError en el guardado interno");
    for (const valor of escrituras) {
      assert.equal(valor, "null", `el guardado interno asigna «saveError: ${valor}»: solo puede limpiarlo`);
    }
    assert.equal(
      cuenta(FINALIZE, "saveError: errorMsg"),
      0,
      "el catch de la finalización debe escribir finalizeError, no saveError",
    );
    assert.ok(
      PUBLICA.includes("saveError: errorMsg"),
      "el mensaje de error de guardado solo puede nacer en el envoltorio público",
    );
  });

  test("nada irreversible ocurre antes del guardado", () => {
    const guardado = FINALIZE.indexOf("await saveDraftOrThrow(false);");
    assert.notEqual(guardado, -1);

    const posteriores = [
      "const supabase = createClient();",
      "await getNextVersion(",
      "await replaceBudgetItems(",
      'status: "pendiente"',
      "saveDocumentVersion(",
      "logActivity(",
      "setState(prev => ({ ...prev, isFinalizing: false, finalizeError: null }));",
      'toast.success("Presupuesto finalizado correctamente")',
      "analytics.budgetFinalized(",
      "return budgetId;",
    ];
    for (const efecto of posteriores) {
      const donde = FINALIZE.indexOf(efecto);
      assert.notEqual(donde, -1, `no se encontró el efecto posterior: ${efecto}`);
      assert.ok(
        guardado < donde,
        `el guardado debe preceder a «${efecto}»: si lanza, ese efecto no debe alcanzarse`,
      );
    }
  });
});

describe("FASE 2F-1APP · BLOQUE B — el único camino hacia budget_items", () => {
  test("el Provider invoca el helper exactamente dos veces", () => {
    assert.equal(cuenta(PROVIDER, "replaceBudgetItems("), 2);
    assert.equal(cuenta(INTERNA, "await replaceBudgetItems(supabase, draftId, itemsToInsert);"), 1);
    assert.equal(cuenta(FINALIZE, "await replaceBudgetItems(supabase, budgetId, itemsToInsert);"), 1);
    assert.ok(
      PROVIDER.includes('import { replaceBudgetItems } from "@/lib/budget-items-writer";'),
      "debe importarse del helper, no reimplementarse",
    );
  });

  test("no queda ningún escritor directo de budget_items", () => {
    assert.equal(
      /\.from\(\s*["'`]budget_items["'`]\s*\)/.test(PROVIDER),
      false,
      "el Provider ya no debe tocar la tabla directamente",
    );
    assert.equal(cuenta(PROVIDER, ".delete()"), 0, "el DELETE suelto desaparece dentro de la transacción");
    assert.equal(
      cuenta(PROVIDER, "replace_budget_items"),
      0,
      "el nombre de la RPC solo debe existir en el helper",
    );
  });

  test("el estado visual de éxito llega después de sincronizar las partidas", () => {
    const sincronizacion = INTERNA.indexOf("await replaceBudgetItems(");
    const exito = INTERNA.indexOf("lastSavedAt: new Date().toLocaleTimeString");
    const brindis = INTERNA.indexOf('toast.success("Borrador guardado correctamente")');

    assert.notEqual(sincronizacion, -1);
    assert.equal(cuenta(INTERNA, "lastSavedAt:"), 1, "solo debe haber un punto que declare el guardado completo");
    assert.ok(sincronizacion < exito, "lastSavedAt no puede anunciarse antes de que las partidas estén escritas");
    assert.ok(sincronizacion < brindis, "el toast de éxito tampoco puede adelantarse a la escritura");
    assert.ok(exito < INTERNA.indexOf("return { skipped: false"), "el éxito se fija antes de devolver");
  });

  test("la firma sincronizada solo avanza tras confirmar el recuento", () => {
    const llamada = INTERNA.indexOf("await replaceBudgetItems(");
    const firma = INTERNA.indexOf("lastSyncedItemsSignature.current = itemsSignature;");
    assert.notEqual(firma, -1);
    assert.ok(llamada < firma, "si la RPC lanza, la firma no debe darse por sincronizada");
    assert.equal(cuenta(INTERNA, "lastSyncedItemsSignature.current = itemsSignature;"), 1);
  });
});

describe("FASE 2F-1APP · BLOQUE B — cabecera retenida y estado visual", () => {
  test("la rama INSERT retiene el identificador ANTES de todo lo que puede fallar", () => {
    // Comprobar solo que el setState existe no dice nada: colocado después del
    // UPDATE del snapshot, un fallo de ese UPDATE dejaría una cabecera huérfana
    // en la base y el siguiente intento insertaría otra. Lo que hay que fijar
    // es la POSICIÓN, y eso se demuestra con índices sobre el fuente.
    const hitos = {
      "asignación del id devuelto": INTERNA.indexOf("draftId = data.id;"),
      "retención en estado": INTERNA.indexOf("setState(prev => ({ ...prev, draftId }));"),
      "UPDATE del snapshot": INTERNA.indexOf(".update({ wizard_state: { ...snapshot, draftId } })"),
      "comprobación de snapshotError": INTERNA.indexOf("if (snapshotError) throw snapshotError;"),
      "sincronización de partidas": INTERNA.indexOf("await replaceBudgetItems("),
    };
    for (const [nombre, i] of Object.entries(hitos)) {
      assert.notEqual(i, -1, `no se localizó el hito: ${nombre}`);
    }

    const orden = Object.entries(hitos);
    for (let k = 1; k < orden.length; k++) {
      const [anterior, iAnterior] = orden[k - 1];
      const [actual, iActual] = orden[k];
      assert.ok(
        iAnterior < iActual,
        `«${anterior}» debe preceder a «${actual}»: cualquier otro orden deja la cabecera sin retener frente a un fallo`,
      );
    }

    // Una sola asignación y una sola retención: nada de repetir el id más
    // abajo «por si acaso», que es como se cuelan las cabeceras duplicadas.
    assert.equal(cuenta(INTERNA, "draftId = data.id;"), 1);
    assert.equal(cuenta(INTERNA, "setState(prev => ({ ...prev, draftId }));"), 1);

    // Y solo el id. La ventana entre la asignación y el primer punto que puede
    // fallar se examina sin comentarios, porque el comentario que hay ahí
    // nombra precisamente esas tres señales para explicar por qué NO se fijan.
    const ventana = enmascarar(INTERNA.slice(hitos["asignación del id devuelto"], hitos["UPDATE del snapshot"]));
    for (const senal of ["isSavingDraft", "saveError", "lastSavedAt"]) {
      assert.equal(
        cuenta(ventana, senal),
        0,
        `la rama INSERT no debe anunciar «${senal}»: el guardado aún no ha terminado`,
      );
    }
  });

  test("la rama UPDATE no anuncia nada por su cuenta", () => {
    const actualizacion = INTERNA.slice(
      INTERNA.indexOf("} else {"),
      INTERNA.indexOf("// A estas alturas la cabecera existe"),
    );
    assert.ok(actualizacion.includes("if (error) throw error;"));
    assert.equal(cuenta(actualizacion, "setState("), 0, "el éxito se declara una sola vez, más abajo");
  });

  test("existe la invariante de cabecera antes de tocar las partidas", () => {
    const guarda = INTERNA.indexOf("if (!draftId) {");
    const partidas = INTERNA.indexOf("// Also sync budget_items");
    assert.notEqual(guarda, -1, "debe comprobarse que la cabecera existe");
    assert.ok(guarda < partidas, "la comprobación va antes de la sincronización");
    assert.ok(INTERNA.includes('throw new Error("No se pudo determinar el borrador tras guardar la cabecera");'));
  });
});

describe("FASE 2F-1APP · BLOQUE B — autoguardado", () => {
  test("la firma solo avanza con un identificador no nulo", () => {
    assert.ok(AUTOGUARDADO.includes("const savedDraftId = await saveDraft(false);"));
    assert.match(
      AUTOGUARDADO,
      /if \(savedDraftId\) \{\s*lastSavedSignature\.current = signatureBeingSaved;\s*\}/,
      "omitir y fallar devuelven null: en ninguno de los dos casos hay nada guardado",
    );
    assert.equal(
      cuenta(AUTOGUARDADO, "lastSavedSignature.current = signatureBeingSaved;"),
      1,
      "no debe existir ninguna asignación incondicional de la firma",
    );
    assert.ok(
      AUTOGUARDADO.indexOf("if (savedDraftId)") <
        AUTOGUARDADO.indexOf("lastSavedSignature.current = signatureBeingSaved;"),
      "la asignación debe estar dentro de la condición",
    );
  });
});

describe("FASE 2F-1APP · BLOQUE B — los cinco casos de conjunto vacío y no vacío", () => {
  // 1 y 2 describen el guardado de borrador; 3 y 4, la finalización; 5 es el
  // límite que el helper impone y que ya se ejecuta en el banco del BLOQUE A.
  test("CASO 1 — sin partidas ni materiales incluidos, el borrador no llama a la RPC", () => {
    // Invariante histórica conservada tal cual: el autoguardado de un borrador
    // que aún no tiene líneas no dispara ninguna sustitución.
    assert.ok(
      INTERNA.includes(
        "if (draftId && (state.partidas.length > 0 || state.materials.some(m => m.included))) {",
      ),
      "la guarda exterior del guardado de borrador no debe alterarse",
    );
  });

  test("CASO 2 — dentro de la guarda, un conjunto vacío sí se envía", () => {
    // Todas las partidas «opcional» y ningún material incluido producen [].
    // Enviarlo es correcto: vacía las líneas en lugar de dejar las anteriores.
    const desdeLaFirma = INTERNA.slice(INTERNA.indexOf("const itemsSignature ="));
    const hastaLaLlamada = desdeLaFirma.slice(0, desdeLaFirma.indexOf("await replaceBudgetItems("));
    assert.equal(
      /itemsToInsert\.length\s*[>=!]/.test(hastaLaLlamada),
      false,
      "no debe haber ninguna condición sobre el tamaño del conjunto",
    );
    assert.ok(
      hastaLaLlamada.includes("if (itemsSignature !== lastSyncedItemsSignature.current) {"),
      "la única condición legítima es que la firma haya cambiado",
    );
  });

  test("CASO 3 — con líneas, el borrador envía exactamente las filas construidas", () => {
    assert.ok(
      INTERNA.includes(
        "const itemsToInsert = [...partidasToInsert, ...materialsToInsert]\n        .map((row, idx) => ({ ...row, sort_order: idx }));",
      ),
      "el orden y la numeración del asistente deben conservarse",
    );
    assert.ok(INTERNA.includes("const itemsSignature = `${draftId}:${JSON.stringify(itemsToInsert)}`;"));
  });

  test("CASO 4 — finalizar sin líneas sustituye igualmente", () => {
    const previo = FINALIZE.slice(
      FINALIZE.indexOf("const itemsToInsert ="),
      FINALIZE.indexOf("await replaceBudgetItems("),
    );
    assert.ok(previo.length > 0);
    assert.equal(
      /\bif\s*\(/.test(enmascarar(previo)),
      false,
      "la finalización no debe condicionar la sustitución: sin líneas debe quedarse sin líneas",
    );
  });

  test("CASO 5 — el recuento devuelto es el que decide, y lo comprueba el helper", () => {
    const helper = readFileSync(join(RAIZ, "lib/budget-items-writer.ts"), "utf8");
    assert.ok(helper.includes("if (data !== items.length) {"), "recuento distinto es un fallo, no un éxito");
    assert.ok(helper.includes("return data;"));
    assert.equal(
      cuenta(enmascarar(helper), "catch"),
      0,
      "el helper tampoco captura: el llamante decide qué hacer con el fallo",
    );
  });
});
