# E2E del asistente: procedencia del precio hasta budget_items

**Rama:** `codex/budget-wizard-provenance`, nueva desde `origin/main` (`10788b1`). Sin PR; queda local. No se modifica código de producción, migraciones, importes ni datos de ENLAZE. Todas las escrituras de prueba se hicieron en un clúster PostgreSQL 17 propio y eliminado al terminar.

Se extiende **el E2E existente** `__tests__/budget-wizard-full-page.browser.integration.test.mjs`. El caso nuevo abre un borrador sin partidas ni procedencia, pulsa «Siguiente paso», ejecuta las API reales de análisis y resolución y guarda desde el asistente mediante `save_budget` y PostgREST. La fuente es una tarifa privada sintética marcada como manual para cinco partidas y ocho materiales; sus campos de procedencia nunca se siembran en el borrador, payload o `budget_items`. La API produce `manual_locked`, un nivel del resolutor.

Para **cada una de las 13 filas guardadas**, comprueba que `price_source_type`, `price_confidence` y `price_checked_at` no son NULL, que el tipo pertenece a los niveles leídos del resolutor y que los tres valores coinciden con la respuesta real de la API para ese concepto. Captura además la petición RPC efectiva y verifica que transporta las 13 líneas. No se acepta un conjunto vacío ni una única fila afortunada.

Después modifica el coste en el input visible de `ItemsStep` usando `Puppeteer.locator.fill`; ese cambio ejecuta el `onChange` y el actualizador real del proveedor de estado. Pulsa «Guardar borrador» y consulta la base: importe editado, `user_edited`, confianza **0.95** y fecha dentro del intervalo de edición. Las otras doce líneas conservan importe y procedencia. También siguen pasando los casos anteriores de hidratación sin escritura, autoguardado, conflicto entre pestañas, finalización y conservación de partidas antiguas.

**Resultado reproducible:**

```text
PASS G3 GENERATED: 13 budget_items preserve source, confidence and timestamp from real resolver API
PASS G3 USER_EDITED: actual price input -> real save_budget -> user_edited / 0.95 / edit timestamp
PASS: wizard hydrates without writing, autosaves, rejects a stale tab, finalizes through PostgREST and keeps a legacy budget items
KILLED no-provenance-transport
KILLED no-partida-provenance
KILLED no-material-provenance
3/3 mutants killed; provider unchanged; disposable services removed on exit.
```

**Mutación requerida:** elimina los dos `...evidenceForSave(...)` de `BudgetGenerateProvider` en una copia temporal. Falla por una aserción sobre la base, no por compilación/arranque:

```text
AssertionError: G3 TRANSPORT: Protección de superficies y mobiliario source must reach budget_items
actual: null
operator: notStrictEqual
```

Las mutaciones separadas también detectan la pérdida solo de partidas y solo de materiales. El fichero original permanece intacto. Salidas completas: `informes/evidencias/budget-wizard-provenance/{baseline,no-provenance-transport,no-partida-provenance,no-material-provenance}.log` y `resumen.txt`.

**Pila y controles:** PostgreSQL **17.11**, PostgREST local **16.4**, Next real y Chrome local. Se aplican únicamente en el banco las migraciones originales de G3 1a/1b y facturación; no se simula la RPC de guardado. Sesión/JWT sintéticos, fuentes de precio sintéticas y motor determinista de análisis sin clave de IA. El gateway rechaza destinos fuera del PostgREST local y redirecciones; el navegador intercepta salidas externas y Next rechaza sockets externos antes de conectar. Las fuentes de Google usan el hook de pruebas de Next para evitar red. No se cargan `.env` ni credenciales reales. Se amplían los filtros del workflow existente para que cambios en estas fixtures, resolutor o procedencia vuelvan a ejecutar el E2E; no se lanzó el workflow remoto.

**Otras comprobaciones:** 23/23 pruebas relacionadas de procedencia, precios manuales y writer; TypeScript, ESLint de archivos modificados y `git diff --check`: correctos. La instalación local disponible contiene Next **16.2.1**, frente a **16.3.8** en el lockfile; no se descargaron dependencias ni se ejecutó el build con su prebuild externo. La validación con versiones exactas queda para el workflow autorizado; no se afirma validación de producción.

**Repetir todo localmente:** `npm run test:budget-wizard-provenance-local` inicia, verifica y elimina su propio PG17/PostgREST y ejecuta E2E más mutaciones. Exige binarios ya instalados, puertos libres 55435/53002/53003/53004 y Chrome de Puppeteer disponible; no descarga nada. En otro sistema, indicar `WIZARD_TEST_PG_BIN` y `WIZARD_TEST_POSTGREST_BIN`. El comando original `npm run test:budget-wizard-full-page-browser` sigue funcionando sobre la pila marcada que prepara el workflow existente.
