# Bloque siguiente del portal — auditoría y diseño, 2026-09-16

Preparado sobre el PR #14 (Draft, 6/6 checks, commit `4761016`). **No se aplicó
nada**: ni migraciones, ni cambios de visibilidad, ni permisos de clientes, ni
merge. Todas las cifras son lecturas de `dsgnymebkxxkslyeotee` del 2026-09-16.

---

## 0. Bloqueante de seguridad encontrado durante la auditoría

Esto no estaba en el encargo y no es una decisión de producto. Es un fallo de
aislamiento entre inquilinos que **la migración `20260915150000` activaría**.

### Qué pasa

`portal_tokens` tiene dos políticas `FOR ALL` —`"Users manage their portal
tokens"` y `portal_tokens_user`— con este `USING` y **sin `WITH CHECK`**:

```sql
created_by = auth.uid() OR project_id IN (select id from projects where user_id = auth.uid())
```

Cuando una política `FOR ALL` no declara `WITH CHECK`, PostgreSQL usa el `USING`
también como comprobación de INSERT. Y `authenticated` tiene
`INSERT/UPDATE/DELETE` sobre la tabla. Como la condición es un **OR**, basta con
poner `created_by = auth.uid()` para insertar una fila con el `project_id` de
**otro propietario**, con los permisos que uno quiera y sin caducidad.

Hoy es inocuo porque `anon` no puede leer `projects` y `portal_read_snapshot` no
existe. En cuanto se aplique `150000`, esa función es SECURITY DEFINER y entrega
el proyecto entero a quien presente el token.

### Reproducido, no deducido

Ejecutado en el banco desechable, aplicando la migración tal cual la lleva la
rama. Un segundo usuario autenticado inserta un token para el proyecto ajeno y
después, como `anon`, obtiene:

```
PASO 1 — el atacante INSERTA un token para el proyecto ajeno: LOGRADO
PASO 2 — snapshot devuelto para un proyecto ajeno:
   proyecto: Obra confidencial | Calle secreta 1
   cliente : Cliente privado | privado@ejemplo.es
   budgets : Presupuesto privado 123456.78
```

El primer intento falló con «permission denied»: **el esquema desechable concede
menos que producción** (solo `select` sobre `portal_tokens`). Con los `grant` que
producción sí tiene, el ataque funciona. Es el mismo defecto de fidelidad que ya
apareció con `budgets`: el banco no puede detectar lo que no modela.

### Y con E2 aplicada, también escritura

`portal_respond_to_budget` no mira `created_by` en ningún momento. Deriva
`v_owner` del propio proyecto (`select user_id into v_owner from public.projects
where id = t.project_id`), así que su comprobación posterior
`where id = t.project_id and user_id = v_owner` es tautológica. La función confía
en que una fila de `portal_tokens` la emitió el dueño del proyecto, y la política
RLS no lo garantiza. Un token acuñado con `approve_budgets` permitiría aceptar o
rechazar presupuestos ajenos. *(Esta mitad es análisis del texto de la función; la
mitad de lectura sí está reproducida.)*

### Atenuante y por qué no basta

Hace falta conocer el UUID del proyecto, y `projects` sí restringe el SELECT a su
dueño. Pero un UUID de proyecto aparece en la URL del panel, en capturas y en
tickets de soporte; no es un secreto. Y la política pública que `150000` elimina
permitía justamente enumerar `portal_tokens` —con su `project_id`— a cualquier
rol, así que hoy la única razón por la que no se pueden enumerar es que la tabla
está vacía.

### Corrección propuesta

Mínimo imprescindible, dentro de la propia `150000` porque es la migración que
activa el riesgo y aún no se ha aplicado:

```sql
drop policy if exists "Users manage their portal tokens" on public.portal_tokens;
drop policy if exists portal_tokens_user on public.portal_tokens;
create policy portal_tokens_owner on public.portal_tokens
  for all to authenticated
  using      (project_id in (select id from public.projects where user_id = auth.uid()))
  with check (project_id in (select id from public.projects where user_id = auth.uid()));
```

Desaparece la rama `created_by = auth.uid()`, que es la que rompe el aislamiento,
y el `WITH CHECK` se hace explícito en lugar de heredado.

Recomendado además, y ya en el bloque de emisión (§2): retirar
`INSERT/UPDATE/DELETE` a `authenticated` y dejar la RPC como único escritor. La
política sola impide cruzar de inquilino, pero no impide que el propio dueño se
conceda `approve_budgets` sin caducidad desde el navegador.

### Pruebas

1. Regresión del cruce de inquilinos: el guion reproducido arriba, como subtest.
2. Fidelidad del banco: añadir a `portal-token-access-schema.sql` los `grant`
   reales de producción sobre `portal_tokens`
   (`select,insert,update,delete` a `authenticated`). Sin eso, la regresión pasa
   por el motivo equivocado.
3. Caso positivo: el dueño sí puede insertar un token de su propio proyecto.

---

## 1. Presupuestos sin `project_id` repartidos por `client_id`

### Inventario

De 12 presupuestos vivos, **10 no tienen `project_id`**:

| Veredicto | N.º | Presupuestos |
|---|---:|---|
| No asignable: sin cliente | 5 | PRE-2026-21695, 32309, 63983, 71515, 87767 |
| Candidato único (el cliente tiene 1 solo proyecto) | 2 | PRE-2026-53806 → «reforma», PRE-2026-19087 → «reforma local» |
| Ambiguo (el cliente tiene varios proyectos) | 3 | PRE-2026-18088 (2 proyectos), PRE-2026-47770 y 98502 (3 proyectos) |

Los 5 «sin cliente» **nunca llegan al portal**: la vía de reparto exige coincidencia
de cliente. El problema real son 5 presupuestos, no 10.

### No hay evidencia para reconstruir el proyecto

Buscada explícitamente, y **no existe ninguna**:

| Fuente | Registros útiles |
|---|---:|
| `budgets.wizard_state->>'projectId'` | 0 |
| `document_versions.snapshot->>'project_id'` | 0 |
| Facturas que enlacen proyecto y cliente | 0 |

Cualquier asignación por parecido de nombre o cercanía de fechas sería una
conjetura. No la propongo.

### Impacto de restringir cada enlace a su proyecto

Con el filtro de borradores que ya lleva la rama:

| Proyecto | Hoy en la rama | Si solo proyecto | Perdería |
|---|---:|---:|---|
| Pintura casa María López | 1 | 0 | PRE-2026-18088 (pendiente) |
| prueba | 1 | 0 | PRE-2026-18088 (pendiente) |
| reforma | 1 | 0 | PRE-2026-53806 (aceptado) |
| reforma local | 2 | 1 | PRE-2026-19087 (aceptado) |
| prueba 2 / prueba 3 / Reforma vivienda integral | 0 | 0 | — |

Restringir sin asignar antes deja **4 de los 5 pares visibles en nada** y vacía
tres portales, uno de ellos el de una clienta real.

### El reparto cruzado ya casi no existe

Tras ocultar borradores, el único presupuesto que se ve desde **dos** enlaces
distintos es **PRE-2026-18088** (pendiente, 6.771,94 €), en los dos proyectos de
la clienta «Maria». Los otros dos que se repartían a tres enlaces —PRE-2026-47770
y PRE-2026-98502— son borradores y ya están ocultos.

### Opciones

- **A — Dejarlo como está.** Cero cambios. El reparto cruzado sigue, hoy en un
  solo presupuesto de una clienta real.
- **B — Solo presupuestos del proyecto.** Elimina el reparto, pero vacía tres
  portales y esconde dos presupuestos *aceptados*. Inaceptable sin asignar antes.
- **C — Regla del «cliente con un único proyecto»:** mostrar un presupuesto sin
  proyecto solo si el cliente del enlace tiene exactamente un proyecto. Cuando
  tiene varios, no hay forma de saber a cuál corresponde, así que no se muestra.
  **Coste medido: un único par** (PRE-2026-18088 en los dos enlaces de «Maria»).
  Todo lo demás se conserva. El reparto cruzado pasa a ser imposible por
  construcción, sin tocar un solo dato.
- **D — Asignar datos y luego B.** El destino final, pero depende de §1.5.

| Opción | Pares visibles | Reparto cruzado | Migra datos |
|---|---:|---|---|
| A (hoy) | 5 | sí (1 presupuesto) | no |
| B | 1 | no | no |
| **C** | **4** | **no** | **no** |
| D | 5 tras asignar | no | sí |

### Recomendación: C ahora, D como destino

C es la única que elimina el reparto sin pérdida material y sin migrar datos. Es
una línea en el snapshot y es comprobable en el banco.

### Asignación verificable de los registros existentes

Como no hay evidencia en la base, **ninguna asignación automática es verificable**.
Propongo tres niveles, y solo el primero podría ser una migración:

- **Nivel 1 — determinista (2 registros).** Si el cliente tiene exactamente un
  proyecto, solo hay un destino posible. Sigue siendo una suposición: que el
  presupuesto pertenezca a *algún* proyecto. Si se aprueba, hacerlo con migración
  reversible que registre el valor anterior (`null`) en una tabla de auditoría,
  con `dry-run` que liste las filas exactas antes de escribir.
- **Nivel 2 — ambiguo (3 registros).** Decide una persona. Requiere una acción
  «Asignar a proyecto» en la ficha del presupuesto, que registre quién y cuándo.
  No hay atajo automático honesto.
- **Nivel 3 — sin cliente (5 registros).** No se tocan. No llegan al portal y
  «sin proyecto» es un estado legítimo para un presupuesto suelto.

Con el Nivel 1 hecho, C y D convergen salvo en PRE-2026-18088.

---

## 2. Emisión y rotación de `portal_tokens`

### La tabla ya sirve

No hace falta cambiar el esquema: `portal_tokens` ya tiene `label`, `permissions`
jsonb (default `["read"]`), `is_active`, `expires_at`, `revoked_at`, `created_by`,
`created_at`, `last_accessed_at` y `access_count`. Lo que falta es **quién puede
escribirla y con qué valores**.

### Diseño propuesto

Tres RPC SECURITY DEFINER, solo `authenticated`, con `search_path` vacío, en la
línea de E2:

| RPC | Comprueba | Devuelve |
|---|---|---|
| `portal_issue_token(p_project_id, p_permissions text[], p_expires_at, p_label)` | el proyecto es del llamante; permisos dentro del vocabulario cerrado; caducidad obligatoria y dentro del máximo | token nuevo |
| `portal_rotate_token(p_token_id)` | la fila es de un proyecto del llamante | revoca la anterior y emite una con los mismos permisos y caducidad nueva |
| `portal_revoke_token(p_token_id)` | ídem | marca `revoked_at`, `is_active=false` |

Acompañado de:

- `CHECK` sobre `permissions`: array de un vocabulario cerrado
  (`read`, `approve_changes`, `approve_budgets`), sin duplicados.
- `revoke insert, update, delete on public.portal_tokens from authenticated`, para
  que las RPC sean el único escritor y nadie se autoconceda capacidades desde el
  navegador.
- La política corregida de §0 como defensa en profundidad.

### Enlaces legacy

- **No se migran a `portal_tokens`.** Siguen funcionando por la rama heredada del
  lector, en **solo lectura de presupuestos**, exactamente como ahora.
- **Nunca se les concede `approve_budgets`**, ni por migración ni por defecto. Un
  `access_token` no caduca, no se puede revocar sin romper la URL y ha circulado
  por correo y WhatsApp; convertirlo en poder de firma retroactivo no es
  aceptable.
- Emitir un token moderno para un proyecto **no** revoca su `access_token`: son
  mecanismos distintos y revocarlo dejaría al cliente sin portal sin avisar. Si se
  quiere retirar el legacy, que sea una acción explícita y posterior al reenvío.

### Asimetría que conviene decidir

Hoy, en la rama, un enlace heredado **sí puede aprobar cambios de obra**
(`respond_changes` es cierto porque el enlace es anterior al modelo de permisos).
Es el comportamiento previo, conservado a propósito. Pero si el criterio es que un
secreto de higiene desconocida no debe tener poder de escritura, entonces también
habría que quitarle esto, y eso deja a los siete enlaces vivos sin capacidad de
aprobar extras hasta que se emitan tokens modernos. **Es una decisión de producto.**

---

## 3. Coordinación de `20260915150000` y E2 `20260915160000`

### Estado

`main` está íntegramente aplicada: su última migración, `20260914090000` (E1), es
la última registrada en producción. Cada rama aporta exactamente una migración y
ambas parten de `c475ec6`, así que ninguna necesita rebase. El orden por nombre ya
es el correcto.

### Secuencia recomendada

1. **Corregir la política de `portal_tokens` dentro de `150000`** (§0) y añadir la
   regresión de cruce de inquilinos y los `grant` de fidelidad al banco. Sin esto,
   aplicar `150000` abre el agujero descrito.
2. **Decidir §1 (opción C) y §2 (asimetría de `approve_changes`)**, porque ambas
   se tocan en la misma migración y es preferible una sola ventana.
3. **Aplicar `150000`.** El portal vuelve en lectura, con respuesta a cambios, y
   con los presupuestos bloqueados y avisados.
4. **Aplicar E2 `160000`.** La respuesta a presupuestos se habilita sola gracias a
   la sonda `to_regprocedure`, sin desplegar aplicación. No cambia nada visible
   todavía: no hay tokens modernos ni presupuestos en `enviado`.
5. **Emisión (§2)** como migración aparte, con sus RPC y el `revoke`.
6. **Asignación de proyecto (§1.5)**, Nivel 1 por migración reversible si se
   aprueba, Nivel 2 por interfaz.

Aplicar **solo** `150000` es seguro y es el orden si hay que separarlas. Aplicar
**solo** E2 deja el portal caído y el `USING(true)` de `project_changes` abierto.

### Preflight

El de `PREFLIGHT-E2-20260916.md` sigue vigente, con dos añadidos:

- [ ] Verificar que las políticas `FOR ALL` de `portal_tokens` ya están corregidas
      **antes** de aplicar `150000`, no después.
- [ ] Confirmar `portal_tokens` vacía en el momento de aplicar. Si dejara de
      estarlo, revisar `created_by` de cada fila contra el dueño del proyecto
      antes de seguir.

### Rollback

- **`150000`:** su compensación literal recrearía las políticas públicas que
  elimina, es decir **reabriría** el `USING(true)` de `project_changes` y la
  enumeración de `portal_tokens`. No es un rollback aceptable. La compensación
  real es hacia delante: si el snapshot falla, basta con `drop function
  portal_read_snapshot` / `portal_respond_to_change` — el portal vuelve a estar
  caído, que es el estado de hoy, pero sin reabrir ninguna escritura pública.
- **E2:** `ROLLBACK_2F2_E2` en `docs/fase2/ROLLBACK.sql`, que exige el
  reconocimiento `before_revision_clients`, elimina solo esas funciones y su
  esquema, sin `CASCADE`. Si `150000` ya está aplicada, retirar E2 devuelve el
  portal al estado «respuesta a presupuestos no disponible», que está contemplado
  y avisado. No hay acoplamiento que impida retirar E2 sola.

---

## Decisiones que necesito de vosotros

| # | Decisión | Bloquea |
|---|---|---|
| 1 | ¿Aplico la corrección de la política de `portal_tokens` (§0) dentro de `150000`? Es seguridad, no producto, pero toca permisos y pedisteis no tocarlos. | Aplicar `150000` |
| 2 | ¿Adopto la regla «cliente con un único proyecto» (§1, opción C)? Cuesta un presupuesto pendiente en los dos enlaces de «Maria». | El reparto cruzado |
| 3 | ¿Autorizáis la asignación de Nivel 1 (2 presupuestos, cliente con un único proyecto) por migración reversible? | Convergencia hacia D |
| 4 | ¿Un enlace heredado debe seguir pudiendo **aprobar cambios de obra**? (§2) | Alcance de `150000` |
| 5 | Caducidad de los tokens nuevos: ¿valor por defecto y máximo? | Emisión (§2) |

Nada de lo anterior se ha implementado. No se ha hecho merge, no se ha pulsado
Ready for review, no se ha aplicado ninguna migración y no se ha modificado ningún
permiso.
