# 2F-2 / E1 — base de revisión técnica

Actualizado: 2026-09-14. **Informe de verificación local previo a publicación.**

Rama: `fix/budget-revision-foundation-2f2`.
Base comprobada contra GitHub antes y después del trabajo:
`0c05a9e831d6102b574b249d451914fc7dbea01f`.
La rama limpia se adelantó hasta esa base sin crear un commit.
Los cambios posteriores al PR #10 corresponden al agente/n8n, no a este contrato.

## Qué queda preparado

- `20260914090000_budgets_lock_version.sql`: añade únicamente
  `budgets.lock_version integer NOT NULL DEFAULT 1`, con CHECK >= 1.
- Espera de bloqueo limitada a cinco segundos, dentro de la transacción del runner.
- Sin `IF NOT EXISTS`: una definición inesperada obliga a detener el despliegue.
- Recarga de caché de PostgREST al confirmar.
- Compensación protegida en `ROLLBACK.sql`, bloque `ROLLBACK_2F2_E1`.
- Comprobaciones PRE/POST sólo SELECT en `CHECKS.sql`, bloque 12.
- Banco real aislado, controles negativos y workflow específico para PR/ejecución manual.

**Esto todavía NO evita sobrescrituras.** E1 crea la columna; no incrementa revisiones,
no compara revisiones enviadas por clientes y no modifica los guardados existentes.
No cambia `status`, `version` documental, importes, partidas, funciones ni permisos.

## Evidencia local

| Comprobación | Resultado |
|---|---|
| Nueve suites de regresión (incluyen los 25 casos nuevos estáticos/de seguridad) | 207/207 PASS, cero skips |
| PostgreSQL real: expansión, datos, restricciones, compatibilidad, bloqueo, reversión y mutantes | 16/16 PASS, cero skips (15 casos + contenedor de pruebas de Node) |
| TypeScript `tsc --noEmit` | PASS |
| YAML del workflow y opt-in de integración | PASS |
| SQL del bootstrap compartido frente a HEAD | Idéntico; sólo se amplió su comentario de uso |
| Volcado completo `pg_dump --schema-only`, antes y tras revertir | PASS, incluidas ACL |

PostgreSQL **17.6**, compilado desde el archivo oficial con SHA-256 verificado,
en una carpeta temporal. Clúster propio, exclusivamente localhost, base
`enlaze_lock_version_test`, sin credenciales del proyecto. No se instaló un servicio.
Node local: 25.8.2. El workflow usa Node 22 y `postgres:17` y **aún no se ha ejecutado
para este lote en GitHub Actions**; la prueba local no sustituye esa ejecución.

En la comparación de `pg_dump` se excluyeron únicamente las líneas `\restrict` y
`\unrestrict`, cuyos tokens se generan aleatoriamente. El esquema expandido sí
difería del PRE; la compensación lo devolvió al PRE. En el banco se comparan además
los catálogos relevantes y hashes de filas completas. La expansión conservó `ctid`,
`xmin` y el fichero físico de la tabla: no se observó reescritura de las filas del fixture.

Los controles negativos se ejecutan contra PostgreSQL: sin NOT NULL y sin CHECK,
las pruebas detectan que una entrada inválida fue aceptada. Sin DEFAULT, añadir
NOT NULL a una tabla poblada falla ya durante la migración con 23502; se comprueba
ese fallo concreto y la ausencia de efectos parciales. Cada control se contrasta
después con la migración correcta, que pasa.

Las restricciones de seguridad del banco rechazan destinos no autorizados antes de
conectar y verifican después base, versión, superusuario, marcador y ausencia de
otras bases de trabajo. El marcador no prueba por sí solo que un clúster sea
desechable: siguen siendo obligatorios los dos ACK. El fixture amplía el bootstrap
existente para modelar el status nullable/default `pending` documentado en la auditoría
del 8 de septiembre, **no una nueva lectura de producción**. No reproduce todo Supabase.

## Antes de publicar o aplicar

1. Revisar y confirmar estos archivos; ejecutar el workflow del PR sobre el commit exacto.
2. Revalidar el esquema y el historial actuales de producción sólo en lectura. No se
   consultó Supabase en este turno. La migración de otro trabajo
   `20260912093000_agent_briefing_idempotency_activity_and_cache.sql` existe en la base
   actual del repositorio: **no se presume que esté aplicada ni se autoriza aplicarla**.
3. El nuevo dry-run debe mostrar exactamente la migración E1 autorizada. Si muestra
   otra, detenerse y coordinar ese trabajo; no aplicar todo el conjunto por defecto.
4. Capturar PRE, aplicar E1 sólo con autorización específica de producción y comprobar
   POST (datos inalterados, columna/restricciones correctas, clientes legados operativos).

La reversión sólo es admisible antes de publicar clientes de revisión. Exige una
confirmación operativa explícita y además se niega si hay revisiones usadas o RPC
nuevas detectables. No cambia el historial de Supabase: si se revierte en un entorno
real, se debe registrar el procedimiento y planificar la siguiente migración; no
editar ni reparar el historial a escondidas. Después de publicar clientes nuevos,
corregir hacia delante.

## Siguiente trabajo y paralelización

| Trabajo | Dependencia / paralelo posible |
|---|---|
| E2: RPC transaccionales con revisión esperada, autorización y auditoría | Se construyen sobre E1 y conservan las fórmulas/importes vigentes. Confirmar la evidencia PT409/PostgREST del lote 0; este banco no prueba HTTP. |
| E3: barrera de carga del asistente y comparación wizard/partidas | Puede prepararse en paralelo a E2 en una rama separada, con casos de carga lenta, discrepancia y autoguardado. No reparar divergencias silenciosamente. |
| E4: conectar todos los guardados y mostrar conflictos sin reintentos automáticos | Integrar después de estabilizar E2/E3 y verificar sus contratos juntos. |
| Observación en preview/producción y compatibilidad | Antes de cerrar los clientes antiguos. |
| Cierre de escrituras antiguas y permisos | Una única transición transaccional, con compensación y regresión de borrado de cuenta. |

El vocabulario de estados, la convergencia económica y las invariantes diferidas
siguen separados. No se mezclan con esta expansión. Este documento sigue 2F-2;
no afirma que las fases posteriores del producto estén implementadas.

Al cerrar esta verificación local todavía no se habían realizado commit, push,
PR, merge, despliegue ni operaciones contra Supabase. La ejecución posterior de
CI debe acreditarse con el commit y el enlace del PR; este informe no la presupone.
