// Tokenizador de SQL a nivel de statement, compartido por las suites que auditan
// ficheros de migración.
//
// POR QUÉ VIVE AQUÍ Y NO DENTRO DE UN TEST
// ----------------------------------------
// Lo estrenó \`__tests__/migration-transaction-control.test.mjs\` (FASE 2D-5b) y lo
// necesita también \`__tests__/budget-items-sort-order-migration.test.mjs\` (FASE 2E-2).
// Importar un fichero de test desde otro registraría sus casos dos veces en el mismo
// proceso del runner, así que el tokenizador se extrae y las dos suites lo importan.
//
// Los CASOS DE CONTROL del propio tokenizador —que sí detecta un begin/commit de nivel
// superior, que no confunde los begin/end de un cuerpo plpgsql, que ignora el control
// de transacción escrito dentro de comentarios y literales— siguen viviendo en
// \`migration-transaction-control.test.mjs\`. Sin ellos, un parser roto haría pasar por
// vacío a cualquiera de las dos suites.

// Palabras que el runner del CLI de Supabase trata como control de transacción. \`END\`
// está incluido porque a nivel superior es sinónimo de COMMIT; dentro de plpgsql es el
// cierre de un bloque, y por eso sólo se evalúan statements de NIVEL SUPERIOR.
export const CONTROL_TRANSACCION = [
  'begin',
  'start transaction',
  'commit',
  'end',
  'abort',
  'rollback',
  'prepare transaction',
];

/**
 * Trocea SQL en statements de nivel superior respetando:
 *   - comentarios de línea  `-- ...`
 *   - comentarios de bloque `/* ... *\/` (anidables, como en PostgreSQL)
 *   - literales             `'...'` con `''` y `\'` como escapes
 *   - identificadores       `"..."` con `""` como escape
 *   - dollar quoting        `$$ ... $$` y `$tag$ ... $tag$`
 * Devuelve los statements con el texto original (sin el `;` final).
 */
export function trocearStatements(sql) {
  const statements = [];
  let actual = '';
  let i = 0;

  const esInicioEtiquetaDolar = (pos) => {
    if (sql[pos] !== '$') return null;
    let j = pos + 1;
    while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
    if (sql[j] !== '$') return null;
    return sql.slice(pos, j + 1); // p.ej. "$$" o "$body$"
  };

  while (i < sql.length) {
    const c = sql[i];
    const dos = sql.slice(i, i + 2);

    if (dos === '--') {
      const fin = sql.indexOf('\n', i);
      const hasta = fin === -1 ? sql.length : fin;
      actual += sql.slice(i, hasta);
      i = hasta;
      continue;
    }

    if (dos === '/*') {
      let profundidad = 0;
      const inicio = i;
      while (i < sql.length) {
        if (sql.slice(i, i + 2) === '/*') {
          profundidad++;
          i += 2;
        } else if (sql.slice(i, i + 2) === '*/') {
          profundidad--;
          i += 2;
          if (profundidad === 0) break;
        } else {
          i++;
        }
      }
      actual += sql.slice(inicio, i);
      continue;
    }

    if (c === "'") {
      const inicio = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      actual += sql.slice(inicio, i);
      continue;
    }

    if (c === '"') {
      const inicio = i;
      i++;
      while (i < sql.length) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      actual += sql.slice(inicio, i);
      continue;
    }

    const etiqueta = esInicioEtiquetaDolar(i);
    if (etiqueta) {
      const inicio = i;
      const cierre = sql.indexOf(etiqueta, i + etiqueta.length);
      i = cierre === -1 ? sql.length : cierre + etiqueta.length;
      actual += sql.slice(inicio, i);
      continue;
    }

    if (c === ';') {
      statements.push(actual);
      actual = '';
      i++;
      continue;
    }

    actual += c;
    i++;
  }

  if (actual.trim() !== '') statements.push(actual);

  return statements
    .map((s) => quitarComentarios(s).trim())
    .filter((s) => s !== '');
}

/** Elimina comentarios de un statement ya troceado, respetando literales y dollar quotes. */
function quitarComentarios(sql) {
  let salida = '';
  let i = 0;
  const esInicioEtiquetaDolar = (pos) => {
    if (sql[pos] !== '$') return null;
    let j = pos + 1;
    while (j < sql.length && /[A-Za-z0-9_]/.test(sql[j])) j++;
    if (sql[j] !== '$') return null;
    return sql.slice(pos, j + 1);
  };

  while (i < sql.length) {
    const dos = sql.slice(i, i + 2);

    if (dos === '--') {
      const fin = sql.indexOf('\n', i);
      i = fin === -1 ? sql.length : fin;
      continue;
    }
    if (dos === '/*') {
      let profundidad = 0;
      while (i < sql.length) {
        if (sql.slice(i, i + 2) === '/*') {
          profundidad++;
          i += 2;
        } else if (sql.slice(i, i + 2) === '*/') {
          profundidad--;
          i += 2;
          if (profundidad === 0) break;
        } else {
          i++;
        }
      }
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const comilla = sql[i];
      const inicio = i;
      i++;
      while (i < sql.length) {
        if (comilla === "'" && sql[i] === '\\') {
          i += 2;
          continue;
        }
        if (sql[i] === comilla) {
          if (sql[i + 1] === comilla) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      salida += sql.slice(inicio, i);
      continue;
    }
    const etiqueta = esInicioEtiquetaDolar(i);
    if (etiqueta) {
      const inicio = i;
      const cierre = sql.indexOf(etiqueta, i + etiqueta.length);
      i = cierre === -1 ? sql.length : cierre + etiqueta.length;
      salida += sql.slice(inicio, i);
      continue;
    }
    salida += sql[i];
    i++;
  }
  return salida;
}

/** Devuelve los statements de nivel superior que son control de transacción. */
export function detectarControlTransaccion(sql) {
  return trocearStatements(sql).filter((st) => {
    const cabeza = st.replace(/\s+/g, ' ').trim().toLowerCase();
    return CONTROL_TRANSACCION.some(
      (p) => cabeza === p || cabeza.startsWith(p + ' ') || cabeza.startsWith(p + '\t'),
    );
  });
}
