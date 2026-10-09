/**
 * Que un despliegue no apunte a la base de otro entorno.
 *
 * POR QUÉ EXISTE
 * --------------
 * Vercel publica una previsualización por cada rama empujada, y las variables
 * de entorno que se añaden sin acotar valen para Production, Preview y
 * Development a la vez. Resultado: la URL de cualquier rama hablaba con la base
 * de PRODUCCIÓN, y sus rutas de servidor llevaban la clave de servicio de
 * producción, que se salta RLS. Se descubrió en caliente el 9 de octubre de
 * 2026: un borrado hecho desde una previsualización apareció en los datos
 * reales.
 *
 * Esta comprobación convierte ese pie de banco silencioso en un fallo de
 * compilación, que es ruidoso y llega antes de que nadie toque nada.
 *
 * LAS CUATRO REGLAS
 * ----------------
 *  1. Un despliegue que NO es de producción no puede apuntar al proyecto de
 *     producción.
 *  2. Un despliegue de producción tiene que apuntar al proyecto de producción.
 *     El error simétrico —publicar producción contra una base de pruebas— es
 *     igual de grave y se detecta igual de mal.
 *  3. La URL y la clave de servicio tienen que ser del MISMO proyecto. Una
 *     mezcla (URL de pruebas con clave de producción, o al revés) es lo peor de
 *     los dos mundos y no la detecta ninguna de las dos reglas anteriores.
 *  4. Fuera de producción, Stripe no puede ir en modo real. Es la única de las
 *     demás credenciales que se distingue sin conocer su valor, porque el modo
 *     va en el prefijo (`sk_live_` frente a `sk_test_`). De RESEND_API_KEY no
 *     se puede decir lo mismo: no hay forma de saber si es de pruebas, así que
 *     ahí solo queda acotarla a mano en Vercel.
 *
 * FUERA DE VERCEL NO OPINA
 * ------------------------
 * Sin `VERCEL_ENV` —una compilación local— no dice nada: con qué base trabaja
 * cada uno en su equipo es su asunto, y romper `npm run build` en local no
 * ayuda a nadie.
 */

import { pathToFileURL } from "node:url";

/** Proyecto Supabase de producción. Si algún día cambia, se cambia aquí. */
export const REF_PRODUCCION = "dsgnymebkxxkslyeotee";

export type Entorno = {
  /** `VERCEL_ENV`: production | preview | development, o ausente en local. */
  vercelEnv: string | undefined;
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
  /** `STRIPE_SECRET_KEY`: `sk_live_…` cobra de verdad; `sk_test_…` no. */
  stripeSecretKey: string | undefined;
};

/** El `ref` del proyecto a partir de su URL (https://<ref>.supabase.co). */
export function refDeUrl(url: string | undefined): string | null {
  if (!url) return null;
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)\b/i.exec(url.trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * El `ref` que declara una clave de servicio.
 *
 * Las claves heredadas son un JWT con el `ref` en su carga, legible sin
 * verificar la firma: solo se compara con la URL, no se autoriza nada con ella.
 * Las nuevas (`sb_secret_…`) no lo llevan, así que de esas no se puede decir
 * nada y la regla 3 no aplica.
 */
export function refDeClave(key: string | undefined): string | null {
  if (!key) return null;
  const partes = key.trim().split(".");
  if (partes.length !== 3) return null;
  try {
    const carga = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    const ref = typeof carga?.ref === "string" ? carga.ref.toLowerCase() : null;
    return ref || null;
  } catch {
    return null;
  }
}

export function comprobar(e: Entorno): string[] {
  // Fuera de Vercel no hay nada que exigir.
  if (!e.vercelEnv) return [];

  const problemas: string[] = [];
  const refUrl = refDeUrl(e.supabaseUrl);

  if (!refUrl) {
    problemas.push(
      `NEXT_PUBLIC_SUPABASE_URL no parece una URL de Supabase: ${e.supabaseUrl ?? "(vacía)"}`,
    );
    return problemas;
  }

  const esProduccion = e.vercelEnv === "production";

  // 1. Una previsualización no escribe en producción.
  if (!esProduccion && refUrl === REF_PRODUCCION) {
    problemas.push(
      `Este despliegue es "${e.vercelEnv}" y apunta al proyecto de PRODUCCIÓN (${REF_PRODUCCION}).`,
      "En Vercel, acota las variables de Supabase a Production y da a Preview las de su propio proyecto.",
    );
  }

  // 2. Y producción no se publica contra otra base.
  if (esProduccion && refUrl !== REF_PRODUCCION) {
    problemas.push(
      `Este despliegue es de producción y apunta a ${refUrl}, que no es el proyecto de producción (${REF_PRODUCCION}).`,
    );
  }

  // 4. Stripe en modo real fuera de producción: cobraría de verdad.
  //    Es la única de las otras credenciales que se puede distinguir sin
  //    conocer su valor, porque Stripe marca el modo en el prefijo.
  if (!esProduccion && e.stripeSecretKey?.startsWith("sk_live_")) {
    problemas.push(
      `Este despliegue es "${e.vercelEnv}" y lleva una clave de Stripe en modo real (sk_live_): cobraría de verdad.`,
      "Usa sk_test_… en Preview, o déjala sin definir.",
    );
  }

  // 3. URL y clave de servicio, del mismo proyecto.
  const refClave = refDeClave(e.serviceRoleKey);
  if (refClave && refClave !== refUrl) {
    problemas.push(
      `La clave de servicio es del proyecto ${refClave} y la URL del proyecto ${refUrl}: están cruzadas.`,
    );
  }

  return problemas;
}

/** Recuadro, igual que en migraciones-check, para que no se pierda en la salida. */
function banner(lines: string[]): string {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const amarillo = (s: string) => (process.stderr.isTTY ? `\x1b[33;1m${s}\x1b[0m` : s);
  return [
    amarillo(`┌${"─".repeat(width)}┐`),
    ...lines.map((l) => amarillo("│ ") + l.padEnd(width - 1) + amarillo("│")),
    amarillo(`└${"─".repeat(width)}┘`),
  ].join("\n");
}

function main() {
  const soloAviso = process.argv.includes("--warn");
  const entorno: Entorno = {
    vercelEnv: process.env.VERCEL_ENV,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  };

  const problemas = comprobar(entorno);

  if (!problemas.length) {
    const donde = entorno.vercelEnv
      ? `${entorno.vercelEnv} → ${refDeUrl(entorno.supabaseUrl)}`
      : "fuera de Vercel, sin comprobar";
    console.log(`✓ entorno: ${donde}`);
    return;
  }

  if (soloAviso) {
    console.warn("\n" + banner(["⚠ ENTORNO:", ...problemas]) + "\n");
    return;
  }
  console.error(`\n✖ entorno:check:\n${problemas.map((p) => `  ${p}`).join("\n")}\n`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
