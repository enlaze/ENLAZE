#!/bin/bash
# ─────────────────────────────────────────────────────────────
# Arranca n8n con la clave de Claude (ANTHROPIC_API_KEY) y la
# URL base de ENLAZE ya cargadas.
#
# Cómo usar:
#   En la Terminal, escribe (todo en una línea):
#     bash ~/Desktop/enlaze/arrancar-n8n.sh
#
# Ya está. n8n arranca con todo configurado.
# ─────────────────────────────────────────────────────────────

ENV_FILE="$(dirname "$0")/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ No encuentro el archivo $ENV_FILE"
  echo "  Comprueba que existe ~/Desktop/enlaze/.env.local"
  exit 1
fi

read_env_var() {
  grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '[:space:]'
}

# Clave de Claude (Anthropic)
ANTHROPIC_API_KEY="$(read_env_var ANTHROPIC_API_KEY)"
export ANTHROPIC_API_KEY

# Clave de tu propio backend de ENLAZE (en .env.local se llama AGENT_API_KEY,
# el workflow la busca como ENLAZE_API_KEY — exportamos ambos nombres)
AGENT_API_KEY="$(read_env_var AGENT_API_KEY)"
export AGENT_API_KEY
export ENLAZE_API_KEY="$AGENT_API_KEY"

# URL base de tu Next.js en local
export ENLAZE_BASE_URL="http://localhost:3000"

# Permitir que las expresiones del editor lean variables de entorno
# (n8n lo bloquea por defecto; en local es seguro habilitarlo)
export N8N_BLOCK_ENV_ACCESS_IN_NODE="false"

if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "✗ No he encontrado ANTHROPIC_API_KEY en $ENV_FILE"
  exit 1
fi
if [ -z "$AGENT_API_KEY" ]; then
  echo "✗ No he encontrado AGENT_API_KEY en $ENV_FILE"
  exit 1
fi

echo "✓ Clave de Claude cargada      (empieza por ${ANTHROPIC_API_KEY:0:14}...)"
echo "✓ Clave de ENLAZE cargada      (empieza por ${AGENT_API_KEY:0:8}...)"
echo "✓ URL de ENLAZE:               $ENLAZE_BASE_URL"
echo ""
echo "Arrancando n8n... abre http://localhost:5678 en el navegador cuando esté listo."
echo ""

n8n start
