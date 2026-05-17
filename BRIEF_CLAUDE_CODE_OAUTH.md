# Brief para Claude Code — Setup de Google OAuth en localhost

## Contexto

El usuario tiene Google OAuth (Gmail/Calendar/Sheets) funcionando en producción (`enlaze.vercel.app`) pero no en local (`localhost:3000`). El endpoint `/api/auth/google?module=gmail` devuelve `{"error":"Missing GOOGLE_CLIENT_ID"}` porque las variables `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` están sólo en las env vars de Vercel, no en `.env.local`.

El código de OAuth (`app/api/auth/google/route.ts`) ya detecta automáticamente el entorno (localhost vs prod) y construye el redirect URI correcto. **No hay que tocar código**. Sólo configuración.

El usuario quiere que tú hagas todo el trabajo posible. Su único papel será:
1. Aprobar una autenticación de Vercel CLI (se abre navegador, un clic).
2. Hacer 5 clics en Google Cloud Console al final (esto NO se puede automatizar — Google no tiene API para gestionar redirect URIs de OAuth clients ni Test Users de la consent screen).

## Lo que tienes que hacer tú (Claude Code)

### 1. Instalar Vercel CLI si no está

```bash
which vercel || npm install -g vercel
```

### 2. Comprobar si ya hay sesión de Vercel

```bash
vercel whoami 2>&1
```

Si no hay sesión, pídele al usuario que ejecute `vercel login` (esto abre el navegador y el usuario aprueba). **No intentes hacer login tú: requiere interacción del usuario.**

### 3. Linkear el directorio al proyecto Vercel

Si no hay `.vercel/project.json` en `~/Desktop/enlaze`:

```bash
cd ~/Desktop/enlaze && vercel link --yes
```

Esto puede pedir confirmación del proyecto: cógelo del scope `enlaze's projects` (Hobby).

### 4. Pull env vars de Vercel a un fichero separado

**NO pulles directamente a `.env.local`** — sobrescribiría las variables que el usuario ya tiene ahí (Supabase, Anthropic, AGENT_API_KEY, etc.). Pull a un fichero temporal:

```bash
cd ~/Desktop/enlaze && vercel env pull .env.vercel.full --environment=production --yes
```

### 5. Merge selectivo en `.env.local`

Sólo necesitamos añadir las variables relacionadas con Google (y cualquier otra que tu inspección del código identifique como necesaria para los módulos del agente). Inspecciona el código:

```bash
grep -rhEo 'process\.env\.[A-Z_]+' app/api/auth/ | sort -u
```

Para CADA variable que aparezca en el código pero NO en `.env.local`, añádela desde `.env.vercel.full` a `.env.local`. Pista: las que casi seguro faltan son:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Pero comprueba si hay más (por ejemplo si el código usa `GOOGLE_REDIRECT_URI` como override, etc.). Si las hay y están en `.env.vercel.full`, traélas también.

**Mecánica recomendada** (no sobrescribir lo que el usuario ya tiene):

```bash
# Por cada variable a copiar, comprueba si ya existe en .env.local antes de añadirla
for var in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  if ! grep -q "^$var=" .env.local; then
    grep "^$var=" .env.vercel.full >> .env.local
    echo "  + Añadida $var a .env.local"
  else
    echo "  = $var ya existe en .env.local, no la toco"
  fi
done
```

### 6. Borrar el fichero temporal

`.env.vercel.full` contiene TODAS las env vars de producción y NO debe quedarse en disco ni acabar en git.

```bash
rm .env.vercel.full
```

Comprueba también que `.env.local` y `.env.vercel*` están en `.gitignore`. Si no lo están, añádelos.

### 7. Verificación

```bash
echo "Variables de Google en .env.local:"
grep -E "^GOOGLE_CLIENT" .env.local | sed -E 's/=(.{10}).*/=\1...[REDACTED]/'
```

Debe mostrar las dos variables con sus primeros caracteres.

### 8. Reiniciar el dev server si está corriendo

Comprueba si hay un proceso `next dev` o `npm run dev` en marcha:

```bash
ps aux | grep -E "next dev|npm run dev" | grep -v grep
```

Si lo hay: avisa al usuario que tiene que parar (`Ctrl+C` en su terminal) y volver a arrancar `npm run dev` para que Next.js cargue las nuevas variables. **No mates el proceso tú** — el usuario podría tener trabajo en otra terminal.

### 9. Test rápido (sin afectar nada)

Una vez el usuario haya reiniciado `npm run dev`, este `curl` debe devolver un redirect (302) en lugar del error JSON:

```bash
curl -I http://localhost:3000/api/auth/google?module=gmail
```

Si devuelve `HTTP/1.1 302` con un `Location:` apuntando a `accounts.google.com`, el setup de env vars está bien.

Si devuelve `200` con `{"error":"Missing GOOGLE_CLIENT_ID"}`, el dev server no recogió las nuevas vars (asegúrate de que se reinició) o las vars no están bien escritas en `.env.local`.

## Lo que el usuario tiene que hacer manualmente

Después de tu trabajo, el usuario tiene que hacer 5 clics en Google Cloud Console. Dáselos al final como checklist breve. Esto **no se puede automatizar** salvo con Google Cloud Identity Platform admin SDK, que requiere permisos de admin de Google Workspace y montar más infraestructura.

**Checklist para él:**

```
A) En https://console.cloud.google.com → proyecto "enlaze":
   1. Menú → APIs & Services → Credentials
   2. Click en el OAuth 2.0 Client ID que se usa para la app
   3. "Authorized redirect URIs" → "+ Add URI" → pegar:
      http://localhost:3000/api/auth/google/callback
   4. Save

B) En el mismo proyecto:
   5. APIs & Services → OAuth consent screen → Test users → "+ Add users"
   6. Añadir: idkdu37@gmail.com (su cuenta personal)
   7. Save
```

(Son 5 clics + 1 paste + 1 email tecleado.)

## Criterios de aceptación

- [ ] `.env.local` contiene `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` (sin sobrescribir lo que ya había).
- [ ] El fichero temporal `.env.vercel.full` está borrado.
- [ ] `.gitignore` ignora `.env.local` y `.env.vercel*`.
- [ ] El usuario sabe que tiene que reiniciar `npm run dev`.
- [ ] El usuario tiene un checklist breve de 5 clics para Google Cloud Console.
- [ ] Cuando termine los 5 clics y reinicie el dev, podrá conectar Gmail con su cuenta personal desde `http://localhost:3000/dashboard/settings/integrations`.

## Estilo

- Castellano peninsular, directo.
- Comenta sólo cuando hagas algo destructivo o que el usuario tenga que aprobar.
- Si encuentras algo inesperado (por ejemplo, no hay `.env.local`, o Vercel CLI no auth), explícalo y pide instrucciones — no asumas.
- No imprimas valores de claves en stdout (excepto el primer prefijo como mucho, ya redactado).
