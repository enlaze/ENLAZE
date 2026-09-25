# 2F-2 / E4 lote 2 — gestión de enlaces del portal

Fecha: 2026-09-25. Estado: **interfaz fusionada y desplegada; corte 100000 aplicado**.
Merge de PR #21: `f9cc187262ceee3d645680c705ca3825b34407fe`.

## Objetivo

La ficha de proyecto deja de consultar `portal_tokens.token` y
`projects.access_token`. En su lugar abre un gestor que:

- lista únicamente metadatos mediante `portal_list_tokens`;
- emite mediante `portal_issue_token`;
- renueva atómicamente mediante `portal_rotate_token`;
- revoca mediante `portal_revoke_token`;
- muestra el secreto solo en la respuesta de emisión o renovación;
- no guarda el secreto en almacenamiento local, estado persistente, analítica,
  URL de la ficha, errores ni consola.

El gestor permite conceder `approve_changes` y `approve_budgets` de forma
explícita. `read` es obligatorio. Ningún permiso se concede automáticamente.
Los plazos ofrecidos son 30, 90, 180 y 360 días; 90 usa el valor por defecto del
servidor. Renovar crea siempre un plazo nuevo de 90 días.

## Corte de seguridad

`20260925100000_portal_token_ui_cutover.sql` retira `SELECT` sobre
`public.portal_tokens` a `authenticated`. No toca filas, políticas, enlaces
heredados ni los permisos de `service_role`. Lleva guardas que exigen que las
cuatro RPC existan antes de efectuar el corte.

El orden controlado es:

1. aplicar y auditar `20260925090000_portal_token_listing.sql`;
2. fusionar esta interfaz y esperar al despliegue de Vercel;
3. ejecutar `CHECK_E4_L2_CUTOVER_PRECHECK`;
4. con autorización independiente, aplicar únicamente `20260925100000`;
5. ejecutar `CHECK_E4_L2_CUTOVER_AUDIT`.

Así la interfaz nueva nunca depende de una RPC ausente y la antigua nunca se
queda sin su lectura antes de ser sustituida. La garantía de copia única empieza
en el paso 4, no antes.

La auditoría posterior detectó una deuda histórica adicional: `anon` aún tenía
`SELECT`, `REFERENCES`, `TRIGGER` y `TRUNCATE`, y `authenticated` conservaba los
tres últimos. RLS impedía a `anon` ver filas y no existían tokens modernos, por
lo que no hubo exposición observada, pero la ACL no cumplía mínimo privilegio.
`20260925110000_portal_tokens_least_privilege.sql` cierra absolutamente el
acceso directo para `PUBLIC`, `anon` y `authenticated`, sin alterar filas,
políticas, `service_role` ni los ocho enlaces heredados.
Esta corrección está preparada y probada en la rama
`codex/portal-token-acl-closure-20260925`; aún no está aplicada en producción.

## Pruebas

- `portal-token-management.test.mjs`: contrato estático y ausencia de caminos
  directos o persistencia.
- `portal-token-management.browser.test.mjs`: Chromium real; listar, emitir,
  copiar, cerrar, reabrir sin secreto, renovar y revocar.
- `portal-token-ui-cutover.integration.test.mjs`: PostgreSQL 17 desechable;
  privilegios directos cerrados y las cuatro RPC operativas.
- La suite de listado y ciclo de vida existente sigue en el workflow para evitar
  regresiones del contrato subyacente.

## Fuera de alcance

Los ocho enlaces heredados siguen funcionando y no se muestran ni administran
desde esta pantalla. Su sustitución es E4 lote 3: inventario solo lectura,
emisión individual con permisos decididos, entrega al destinatario, observación
y retirada explícita. No se convertirán ni recibirán permisos en lote.
