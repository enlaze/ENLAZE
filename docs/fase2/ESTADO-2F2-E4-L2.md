# 2F-2 / E4 lote 2 — gestión de enlaces del portal

Fecha: 2026-09-24. Estado: **implementación local, no fusionada y migración no aplicada**.
Rama: `codex/portal-token-management-e4-l2`, basada en el merge del PR #20
`43887790a914191437fa397da4e56f1eaa3daf16`.

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
