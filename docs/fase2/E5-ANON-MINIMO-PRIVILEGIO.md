# E5 — `anon` deja de tener privilegios de tabla

Fecha: 2026-09-30. Estado: **diseño. Sin migración, sin código.**
Rama: `codex/e5-anon-least-privilege-design`, desde `origin/main` `c22404a`.

Generaliza lo que `20260925110000_portal_tokens_least_privilege.sql` hizo para
una tabla. La auditoría de permisos que cerró el lote 3 encontró que hacía falta
para otras ochenta y ocho.

## Lo que hay hoy, medido en producción

```
projects      →  anon=arwdDxtm
budgets       →  anon=arwdDxtm
clients       →  anon=arwdDxtm
sync_api_keys →  anon=arwdDxtm
```

`arwdDxtm` es INSERT, SELECT, UPDATE, DELETE, **TRUNCATE**, REFERENCES, TRIGGER
y MAINTAIN.

| Nivel | Tablas |
|---|---|
| **Total (`arwdDxtm`)** | **88** |
| Parcial (`rxtm`, solo lectura) | 3 — `plan_catalog`, `subscriptions`, `usage_events` |
| Ninguno | 2 — `portal_tokens`, `stripe_events` |

`portal_tokens` es la única que se cerró, con `20260925110000`. Una de noventa y
tres.

## Esto no es una fuga. Es un margen de un solo error de ancho

Hay que decirlo con precisión, porque exagerar cuesta tanto como minimizar.

**Hoy no se filtra nada.** RLS está activo en las noventa y tres tablas y las
políticas se apoyan en `auth.uid() = user_id`. Para un visitante anónimo
`auth.uid()` es `NULL`, la comparación da `NULL`, y no devuelve ni una fila. Las
tablas sin ninguna política —`sync_api_keys`, `account_write_leases`,
`n8n_updates`, `account_deletion_locks`— quedan denegadas por completo, que es
el comportamiento correcto de RLS sin políticas.

**Lo que sí ocurre es que toda la protección descansa en una sola capa.** Una
única política escrita `USING (true)` en cualquiera de esas ochenta y ocho
tablas la abre entera a internet.

Y ese error exacto **ya se cometió en este repositorio**: las políticas
`"Public portal token read"`, `"Public update budget status"` y
`"Public update change approval"` existieron y `20260915150000` tuvo que
eliminarlas. Con los privilegios retirados, la misma equivocación no expondría
nada, porque no habría permiso debajo de la política.

Dos matices técnicos que conviene tener escritos:

- **RLS no se aplica a `TRUNCATE`.** Solo cubre SELECT, INSERT, UPDATE y DELETE.
  El permiso `D` que tiene `anon` sobre las ochenta y ocho tablas no está
  mitigado por ninguna política.
- **No es alcanzable con la clave anónima.** PostgREST no expone `TRUNCATE`, y
  la clave `anon` solo llega a la base a través de PostgREST. Explotarlo exigiría
  una conexión directa a PostgreSQL como `anon`, que necesita la contraseña de la
  base, no la clave pública.

Resumiendo la severidad sin adornos: **no explotable hoy, y a la vez una tabla a
la que le falta una capa de defensa que sus vecinas de `portal_tokens` ya
tienen.**

## La causa raíz: los privilegios por defecto

Nadie concedió esos permisos. Son el comportamiento de fábrica:

```
tablas nuevas en public, concedidas por postgres       →  anon=arwdDxtm
tablas nuevas en public, concedidas por supabase_admin →  anon=arwdDxtm
```

**Por eso un revoke a secas no es un arreglo.** La siguiente migración que cree
una tabla vuelve a conceder todo a `anon`, y en unos meses estaríamos donde
estamos hoy sin que nadie hubiera hecho nada mal.

E5 tiene que cambiar las dos cosas: los permisos actuales y el defecto.

## Por qué ahora sí se puede, y la semana pasada no

Hasta el lote 3 el portal era anónimo y **leía tablas directamente**. Retirar
los privilegios de `anon` lo habría roto.

Ya no. El portal habla con la base por **exactamente tres RPC**:
`portal_read_snapshot`, `portal_respond_to_change` y `portal_respond_to_budget`.
Las tres son `SECURITY DEFINER`, así que se ejecutan como su propietario y **no
necesitan que `anon` tenga ningún permiso de tabla**.

Comprobado además que no hay ninguna otra superficie anónima que consulte la
base:

| Superficie | Qué hace |
|---|---|
| `app/page.tsx` (landing) | cero consultas; ningún componente de `components/landing/` toca tablas |
| `app/pricing/page.tsx` | cero consultas. Los planes van compilados en `lib/plans.ts` y se sincronizan con `npm run plans:sync` |
| `app/login/page.tsx` | consulta `profiles`, pero **después** de autenticar: en ese momento el cliente ya es `authenticated` |
| `app/register`, `forgot-password`, `reset-password` | endpoints de autenticación, no tablas |
| `app/portal/[token]` | las tres RPC y nada más |

Cerrar el lote 3 es literalmente lo que desbloquea E5.

## Las funciones ya están bien

De 41 funciones `SECURITY DEFINER` en `public`, **37 no son ejecutables por
`anon`**. Las 4 que sí son las tres del portal —correcto, es su vía de acceso— y
`handle_new_user`.

Esa última es un disparador: llamada directamente recibiría `NEW` nulo y
fallaría, así que el riesgo es mínimo. Aun así no tiene motivo para ser
ejecutable por un anónimo y entra en el alcance como línea menor.

El defecto de funciones (`anon=X` en cada función nueva) **se deja como está**:
es la vía por la que el portal obtiene acceso, y cambiarlo exigiría conceder
explícitamente en cada RPC futura. Queda anotado como riesgo: una función
`SECURITY DEFINER` nueva es invocable por cualquiera desde el momento en que se
crea, y eso salta RLS por completo. Merece su propia revisión, no este lote.

## Alcance

**Dentro:**

1. `revoke all privileges` de `anon` sobre las 88 tablas con permisos totales.
2. Lo mismo sobre las 3 parciales. Nada anónimo las lee: los planes van
   compilados, y `subscriptions` y `usage_events` se consultan por
   `billing_usage_summary`, que es `SECURITY DEFINER`.
3. `alter default privileges` para que las tablas nuevas **no** concedan a `anon`.
4. `revoke execute on function handle_new_user from anon`.

**Fuera, y es deliberado:**

- **`authenticated` no se toca.** Buena parte del panel consulta tablas
  directamente con el JWT del usuario, y ahí RLS sí hace su trabajo con
  `auth.uid()` real. Revocarle privilegios rompería el producto. Merece un
  análisis tabla por tabla y su propio lote; mezclarlo aquí convertiría una
  migración segura en una arriesgada.
- **Las secuencias.** `anon=rwU` sobre secuencias nuevas. Sin `INSERT` en las
  tablas no sirve de nada, pero conviene limpiarlo después.
- **El defecto de funciones**, por lo dicho arriba.

## Una limitación que no puedo resolver desde una migración

Los privilegios por defecto están declarados **dos veces**: por `postgres` y por
`supabase_admin`. Nuestras migraciones corren como `postgres`, y en PostgreSQL
solo se pueden alterar los privilegios por defecto propios, o los de otro rol
siendo superusuario.

Así que E5 puede arreglar el defecto de `postgres` —que es el que aplica a todo
lo que creemos nosotros— pero probablemente **no** el de `supabase_admin`, que
aplica a lo que cree la plataforma: tablas hechas desde el panel de Supabase, o
por sus propias herramientas.

La consecuencia práctica: una tabla creada **desde el panel** seguirá naciendo
con `anon=arwdDxtm`. Hay que asumirlo y comprobarlo, y de ahí sale la
comprobación periódica de más abajo. Si el `db push` se ejecuta con credenciales
de `supabase_admin`, la migración debería intentar también ese segundo
`alter default privileges`, tolerando el fallo si no tiene permiso.

## Forma de la migración

```sql
set local lock_timeout = '5s';

do $guard$ ... $guard$;   -- comprobaciones previas

-- Una sola pasada, generada del catálogo: nada de listas escritas a mano que
-- se queden viejas.
do $revoke$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relkind='r'
              and array_to_string(c.relacl,' ') like '%anon=%'
  loop
    execute format('revoke all privileges on table public.%I from anon', t.relname);
  end loop;
end $revoke$;

alter default privileges in schema public revoke all on tables from anon;
revoke execute on function public.handle_new_user() from anon;

notify pgrst, 'reload schema';
```

Generar la lista del catálogo y no escribirla a mano es deliberado: una lista de
ochenta y ocho nombres se queda obsoleta a la primera tabla nueva, y quien la
lea creerá que está completa.

### El guard

1. Que las tres RPC del portal existan y sigan siendo `SECURITY DEFINER` con
   `anon` pudiendo ejecutarlas. **Si no, abortar**: retirar los privilegios de
   tabla sin esa vía dejaría el portal incomunicado.
2. Que no quede ninguna función en `public` que lea tablas siendo `INVOKER` y
   ejecutable por `anon`, porque esa sí dependería de los privilegios que se van
   a retirar.

   **Comprobado ya:** hay ocho, y ninguna es una vía de lectura. Tres son
   funciones puras —`canonical_normalize`, `portal_token_default_lifetime`,
   `portal_token_max_lifetime`— más un validador,
   `portal_token_permissions_valid`. Las otras cuatro son funciones de
   disparador sin argumentos —`clients_normalize_tags`, `fn_log_price_change`,
   `fn_set_updated_at`, `sync_budget_item_name`—: invocadas directamente
   reciben `NEW` nulo y fallan, y como disparadores solo se ejecutan dentro de
   una escritura que `anon` ya no podrá hacer. El guard se mantiene de todas
   formas, para que siga siendo cierto mañana.

## Criterios de terminado

1. Ninguna tabla de `public` con `anon=` en su ACL.
2. Los privilegios por defecto de `postgres` sobre tablas ya no incluyen `anon`.
3. Una tabla creada después de la migración nace sin permisos para `anon`.
4. El portal sigue funcionando: las tres RPC responden igual para un enlace
   moderno, con la misma huella.
5. El panel sigue funcionando: `authenticated` conserva sus privilegios
   íntegros, y hay una prueba que falla si la migración se los toca.
6. La línea base estática no empeora.

## Matriz de pruebas

| Área | Casos |
|---|---|
| **Revocación** | cero tablas con `anon=` tras aplicar; `authenticated` conserva `arwdDxtm` en todas, comprobado ACL a ACL |
| **Defecto** | crear una tabla después de la migración y verificar que nace sin `anon`; **control negativo**: sin el `alter default privileges`, esa misma tabla nace con `anon=arwdDxtm` y la prueba debe fallar |
| **Portal** | el snapshot de un enlace moderno da la misma huella md5 antes y después; responder a un cambio sigue funcionando; un token inválido sigue devolviendo `null` |
| **Bajo el rol `anon`** | `set local role anon` y comprobar que un `select` directo sobre `projects`, `budgets` y `clients` falla por **permiso denegado**, no por RLS sin filas. Son errores distintos y solo el primero demuestra que el privilegio se fue |
| **`authenticated` intacto** | bajo ese rol, una consulta con `auth.uid()` de un dueño sigue devolviendo sus filas |
| **Guard** | con una de las tres RPC ausente o sin `execute` para `anon`, la migración se niega |
| **Mutantes** | quitar el `alter default privileges` → debe fallar; revocar también de `authenticated` → debe fallar; dejar una tabla fuera del bucle → debe fallar |

La prueba bajo el rol `anon` es la que de verdad cierra el asunto: hoy un
`select` desde `anon` devuelve cero filas por RLS, y después tiene que devolver
**error de permisos**. Si la prueba solo comprobara «cero filas», pasaría igual
antes y después sin medir nada.

## Comprobación periódica

Como el defecto de `supabase_admin` puede seguir concediendo, hace falta un
centinela: un bloque en `CHECKS.sql` que liste cualquier tabla de `public` con
`anon=` en su ACL. Igual que `migraciones-check.yml` vigila la divergencia entre
repositorio y base, esto vigila que no reaparezcan privilegios.

Si se ejecuta en CI con periodicidad, hay que recordar la lección del
detector de migraciones: un centinela que lleve días en rojo por otra causa no
avisa del siguiente problema.

## Riesgos

- **Romper una superficie anónima no inventariada.** He revisado landing,
  precios, login, registro, recuperación de contraseña y portal. Si existiera
  otra —una página nueva, un webhook que use la clave `anon`— fallaría por
  permisos. El rollback es inmediato y no pierde datos: se vuelven a conceder.
- **El defecto de `supabase_admin`.** Documentado arriba: una tabla creada desde
  el panel seguirá naciendo abierta. Es la razón del centinela.
- **Falsa sensación de cierre.** E5 retira una capa de exposición, no arregla
  ninguna política. Si una política está mal escrita, sigue estando mal escrita
  para `authenticated`. Esto es defensa en profundidad, no un sustituto de
  revisar las políticas.
- **`authenticated` sigue con `arwdDxtm` en las noventa y tres tablas.** Es el
  siguiente lote y es más delicado, porque ahí sí hay que distinguir qué
  consulta el panel de verdad.
