// FASE 2D-5b — La migración canónica no puede llevar control de transacción.
//
// POR QUÉ EXISTE ESTE TEST
// ------------------------
// El runner del CLI de Supabase agrupa por defecto todos los statements de una
// migración en un único lote e incluye en ESE MISMO lote el INSERT en
// `supabase_migrations.schema_migrations`. Resultado: transacción implícita,
// cambio de esquema y registro histórico entran o no entran juntos.
//
// En cuanto UN solo statement del fichero es control de transacción (`BEGIN`,
// `START TRANSACTION`, `COMMIT`, `END`, `ABORT`, `ROLLBACK`, `PREPARE
// TRANSACTION`), el runner cae a la ruta serie: ejecuta statement a statement y
// registra el historial DESPUÉS, ya fuera del `commit;` del fichero. Un
// `begin;`/`commit;` explícito, que intuitivamente parece "más seguro", en
// realidad rompe la atomicidad entre el DDL y su registro.
//
// El otro modo de perder la transacción es la directiva `-- pg-delta:
// transaction=false` como primera línea del fichero, que fuerza
// `transactionMode = "none"`. Tampoco debe estar.
//
// QUÉ NO ES ESTE TEST
// -------------------
// No es un grep. Los `begin` / `end` de los bloques plpgsql viven dentro del
// cuerpo `$$ ... $$` de la función y son legítimos: un grep ingenuo los
// confundiría con control de transacción. Por eso el fichero se tokeniza de
// verdad (comentarios de línea y de bloque, literales, identificadores
// entrecomillados y dollar-quoting con etiqueta) y sólo se juzgan los statements
// de NIVEL SUPERIOR. El propio tokenizador se somete a casos de control al final
// del fichero, para que un parser roto no haga pasar el test por vacío.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const RAIZ = process.cwd();
const MIGRACION = path.join(
  RAIZ,
  'supabase/migrations/20260826103500_update_budget_with_items_canonical.sql',
);

const DIRECTIVA_SIN_TRANSACCION = '-- pg-delta: transaction=false';

// El tokenizador vive en `__tests__/lib/sql-toplevel.mjs` desde la FASE 2E-2, porque
// la suite de la migración de `sort_order` también lo necesita e importar un fichero
// de test desde otro registraría estos casos dos veces en el mismo proceso. Se
// re-exporta para no romper a nadie que ya lo importase de aquí, y los casos de
// control del propio tokenizador siguen ejecutándose más abajo.
export {
  trocearStatements,
  detectarControlTransaccion,
  CONTROL_TRANSACCION,
} from './lib/sql-toplevel.mjs';

import { detectarControlTransaccion, trocearStatements } from './lib/sql-toplevel.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Casos de control del tokenizador: si el parser se rompe y deja de ver nada,
// estos tests fallan antes de que el test principal pase por vacío.
// ─────────────────────────────────────────────────────────────────────────────

test('el tokenizador SÍ detecta begin/commit de nivel superior', () => {
  const sql = "begin;\ncreate table t(a int);\ncommit;\n";
  const encontrados = detectarControlTransaccion(sql);
  assert.deepEqual(
    encontrados.map((s) => s.toLowerCase()),
    ['begin', 'commit'],
  );
});

test('el tokenizador NO confunde los begin/end de un cuerpo plpgsql', () => {
  const sql = [
    'create or replace function f() returns void language plpgsql as $$',
    'begin',
    '  if true then',
    '    begin',
    '      raise notice \'hola; con punto y coma y un -- comentario falso\';',
    '    end;',
    '  end if;',
    'end;',
    '$$;',
    "notify pgrst, 'reload schema';",
  ].join('\n');
  assert.deepEqual(detectarControlTransaccion(sql), []);
  assert.equal(trocearStatements(sql).length, 2);
});

test('el tokenizador ignora control de transacción escrito dentro de comentarios y literales', () => {
  const sql = [
    '-- commit;',
    '/* begin; rollback; */',
    "select 'commit;' as texto;",
  ].join('\n');
  assert.deepEqual(detectarControlTransaccion(sql), []);
});

test('el tokenizador detecta las variantes largas', () => {
  assert.equal(detectarControlTransaccion('start transaction;').length, 1);
  assert.equal(detectarControlTransaccion('ROLLBACK;').length, 1);
  assert.equal(detectarControlTransaccion('End;').length, 1);
  assert.equal(detectarControlTransaccion('abort;').length, 1);
  assert.equal(detectarControlTransaccion('prepare transaction \'x\';').length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// El test que importa
// ─────────────────────────────────────────────────────────────────────────────

test('la migración 20260826103500 existe', () => {
  assert.ok(
    existsSync(MIGRACION),
    `No se encuentra ${MIGRACION}. Si se ha renombrado, actualiza este test.`,
  );
});

test('la migración 20260826103500 no contiene control de transacción de nivel superior', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  const encontrados = detectarControlTransaccion(sql);
  assert.deepEqual(
    encontrados,
    [],
    'Control de transacción prohibido en esta migración: ' +
      JSON.stringify(encontrados) +
      '. Rompe la atomicidad entre el cambio de esquema y su registro en ' +
      'supabase_migrations.schema_migrations (el runner cae a la ruta serie).',
  );
});

test('la migración 20260826103500 no lleva la directiva -- pg-delta: transaction=false', () => {
  const sql = readFileSync(MIGRACION, 'utf8');

  // El CLI sólo la reconoce como PRIMERA línea del fichero; ésa es la
  // comprobación que decide el comportamiento real.
  assert.notEqual(
    sql.split('\n')[0].trim(),
    DIRECTIVA_SIN_TRANSACCION,
    'La primera línea no puede ser la directiva que desactiva el modo transaccional.',
  );

  // Y, por higiene, tampoco debe aparecer suelta en ninguna otra línea: alguien
  // podría moverla arriba sin darse cuenta de lo que hace. Mencionarla dentro de
  // una frase en prosa (entre comillas o backticks) sí está permitido, que es
  // justo como la documenta la cabecera de la migración.
  const lineasDirectiva = sql
    .split('\n')
    .map((l, i) => ({ n: i + 1, l: l.trim() }))
    .filter(({ l }) => l === DIRECTIVA_SIN_TRANSACCION);

  assert.deepEqual(
    lineasDirectiva,
    [],
    'La directiva pg-delta transaction=false aparece como línea suelta en: ' +
      JSON.stringify(lineasDirectiva),
  );
});

test('el cuerpo plpgsql sigue estando ahí (el parser no está tragándose el fichero)', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  const statements = trocearStatements(sql);
  assert.ok(
    statements.length >= 5,
    `Se esperaban al menos 5 statements de nivel superior, hay ${statements.length}.`,
  );
  const creacion = statements.find((s) =>
    /create\s+or\s+replace\s+function\s+public\.update_budget_with_items/i.test(s),
  );
  assert.ok(creacion, 'No se encuentra el CREATE OR REPLACE FUNCTION en la migración.');
  assert.ok(
    /\$\$[\s\S]*\bbegin\b[\s\S]*\bend\b[\s\S]*\$\$/i.test(creacion),
    'El cuerpo $$ ... $$ debería seguir conteniendo su bloque begin/end plpgsql.',
  );
});

test('el último statement de la migración es el NOTIFY a PostgREST', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  const statements = trocearStatements(sql);
  const ultimo = statements[statements.length - 1].replace(/\s+/g, ' ').trim().toLowerCase();
  assert.equal(ultimo, "notify pgrst, 'reload schema'");
});

test('la ACL de update_budget_with_items se declara de forma absoluta', () => {
  const sql = readFileSync(MIGRACION, 'utf8');
  const statements = trocearStatements(sql).map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase());
  const firma = 'public.update_budget_with_items(uuid, jsonb, jsonb)';
  for (const rol of ['public', 'anon', 'service_role']) {
    assert.ok(
      statements.some((s) => s === `revoke all on function ${firma} from ${rol}`),
      `Falta el REVOKE ALL ... FROM ${rol}.`,
    );
  }
  assert.ok(
    statements.some((s) => s === `grant execute on function ${firma} to authenticated`),
    'Falta el GRANT EXECUTE ... TO authenticated.',
  );
  assert.ok(
    !statements.some((s) => /^grant\b/.test(s) && / to (anon|service_role|public)$/.test(s)),
    'No debe concederse EXECUTE a anon, service_role ni PUBLIC.',
  );
});
