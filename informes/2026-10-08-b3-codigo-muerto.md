# b3-codigo-muerto: rutas que no usa nadie

Rama `auto/b3-codigo-muerto`. **El borrado está pendiente:** el sistema de permisos de Claude Code bloqueó `git rm` por ser una acción irreversible, y no lo he intentado por otra vía. Esta rama solo lleva este informe.

## Qué he comprobado

Las cinco candidatas **no tienen ningún llamante**. He buscado en todo el repositorio, excepto `node_modules`, `.next` y `.git`:

| Ruta | Llamadas literales | URL montada por partes | Imports del fichero |
|---|---|---|---|
| `/api/budgets/generate-v2` | ninguna | ninguna | ninguno |
| `/api/budgets/reprice` | ninguna | ninguna | ninguno |
| `/api/pb/providers` | ninguna | ninguna | ninguno |
| `/api/pb/providers/[id]` | ninguna | ninguna | ninguno |
| `/api/pb/products` | ninguna | ninguna | ninguno |

- **Dónde he mirado:** la app y los componentes, los workflows de `n8n-workflows/` (incluidas las copias de `backups/`) y `n8n/workflows/`, `scripts/`, `__tests__/` y `services/` (worker de Python).
- **Cómo:** busqué la ruta como texto y también formas dinámicas (``/api/${…}``, `"/api/" + …`, `/api/pb/${…}`). No hay ningún `fetch` genérico que pueda montarlas.
- **Únicas menciones:** documentación (`docs/architecture-budget-v2.md`, `docs/fase3/G1-PRECIOS-DETERMINISTAS.md`, `PENDIENTES.md`) y un comentario en `lib/plans.ts`.

**Librerías que quedarían sin uso al borrar:** solo `lib/budget-generator-v2.ts`. `lib/budget-analysis.ts` y `lib/types/budget-v2.ts` los sigue usando `/api/budgets/analyze`, y `lib/price-resolver-v2.ts` los usa `/api/prices/resolve`. No he borrado `lib/budget-generator-v2.ts` porque no estaba en la lista del bloque.

## Qué tiene que decidir o aprobar Daniil

1. **Lanzar el borrado**, o darme permiso para hacerlo. Desde la raíz del repo, en esta rama:

   ```
   git switch auto/b3-codigo-muerto
   git rm -r app/api/budgets/generate-v2 app/api/budgets/reprice app/api/pb/providers app/api/pb/products
   npx tsc --noEmit && npm run lint && npx next build
   git commit -m "chore: borra rutas sin llamantes (b3)" && git push
   ```

   Para que Claude Code pueda borrar en el futuro sin bloquearse, añade un permiso para `git rm` en la configuración del proyecto.

2. **Choque con b1.** La rama `auto/b1-mi-precio` modifica `reprice` y `generate-v2`: cambia `is_locked` por `is_manual_override` para que compilen. Si se fusionan las dos, git dará un conflicto de "modificado frente a borrado". La solución es quedarse con el borrado. Si fusionas b3 primero, b1 lo resuelve en un minuto.
3. **¿Borramos también `lib/budget-generator-v2.ts`?** Y, si quieres, actualizo los documentos que citan estas rutas.

## Revisar con tus ojos en 10 minutos

- Que ninguna pantalla que uses a diario cargue proveedores o productos del banco de precios desde `/api/pb/providers` o `/api/pb/products`. En el código no lo hace ninguna; las pantallas leen Supabase directamente.
