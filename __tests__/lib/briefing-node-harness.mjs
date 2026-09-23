/**
 * Ejecuta el nodo Code "Build Claude Prompt" fuera de n8n, con `$json` y `$()`
 * simulados, para poder medir tokens y comparar prompts sin tocar el workflow
 * en producción.
 *
 * Sirve tanto para el nodo actual como para una versión anterior guardada en
 * otro fichero de workflow (así se compara el briefing viejo con el nuevo).
 */
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..", "..");
export const WORKFLOW_PATH = path.join(ROOT, "n8n-workflow-comercio-local-v6.3.json");
export const FIXTURE_PATH = path.join(ROOT, "__tests__/fixtures/briefing-dia-completo.json");

/**
 * Carga .env.local si existe, para que los scripts de medida y comparación
 * encuentren ANTHROPIC_API_KEY sin pedir que se exporte a mano.
 */
export function cargarEnvLocal() {
  const ruta = path.join(ROOT, ".env.local");
  if (!fs.existsSync(ruta)) return false;
  try {
    process.loadEnvFile(ruta);
    return true;
  } catch {
    // Node antiguo o fichero con una línea rara: se lee a mano lo imprescindible.
    for (const linea of fs.readFileSync(ruta, "utf8").split("\n")) {
      const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
    return true;
  }
}

export function loadNodeCode(nodeName, workflowPath = WORKFLOW_PATH) {
  const parsed = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  const workflow = Array.isArray(parsed) ? parsed[0] : parsed;
  const node = workflow.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`No existe el nodo ${nodeName} en ${workflowPath}`);
  return node.parameters.jsCode;
}

export function loadFixture(fixturePath = FIXTURE_PATH) {
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

/** Las noticias del sector que devolvería "Fetch Sector News". */
export const NOTICIAS_SECTOR = {
  news: [
    {
      title: "El consumo de pan artesano crece un 9% en España",
      source: "Expansión",
      published_at: "2026-09-22",
      url: "https://news.google.com/rss/articles/CBMiakFVX3lxTE1xLVhfaVo0b2VkQ2c",
      why_relevant: "El trasvase del pan industrial al obrador de barrio sube el ticket medio",
    },
    {
      title: "Valencia aprueba nuevas ayudas al comercio de proximidad",
      source: "Las Provincias",
      published_at: "2026-09-21",
      url: "https://news.google.com/rss/articles/CBMiakFVX3lxTE1xLVhfaVo0b2VkQ2h",
      why_relevant: "1,2 millones para modernizar locales del centro histórico de su ciudad",
    },
    {
      title: "La mantequilla encadena su tercera subida mensual",
      source: "El Economista",
      published_at: "2026-09-22",
      url: "https://news.google.com/rss/articles/CBMiakFVX3lxTE1xLVhfaVo0b2VkQ2k",
      why_relevant: "Es la materia prima principal de su bollería",
    },
    {
      title: "La harina se estabiliza tras seis meses al alza",
      source: "Agronegocios",
      published_at: "2026-09-20",
      url: "https://news.google.com/rss/articles/CBMiakFVX3lxTE1xLVhfaVo0b2VkQ2o",
      why_relevant: "Permite cerrar precio con el proveedor sin riesgo hasta fin de año",
    },
  ],
};

/**
 * Ejecuta el jsCode del nodo y devuelve su `json` de salida.
 * `userConfig` simula la respuesta de "Get User Config".
 */
export function runBuildPromptNode(jsCode, { payload, userConfig, news = NOTICIAS_SECTOR } = {}) {
  const fuentes = {
    "Run User Modules": payload,
    "Get User Config": userConfig,
  };
  const $ = (nombre) => {
    if (!(nombre in fuentes)) throw new Error(`nodo no simulado: ${nombre}`);
    return {
      get item() {
        return { json: fuentes[nombre] };
      },
      first: () => ({ json: fuentes[nombre] }),
    };
  };
  const fn = new Function("$json", "$", jsCode);
  return fn(news, $).json;
}

/** El prompt completo (system + user) tal y como viaja a la API. */
export function promptCompleto(salida) {
  const body = salida._anthropic_body;
  return body.system + "\n\n" + body.messages.map((m) => m.content).join("\n\n");
}
