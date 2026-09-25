/**
 * Compara las migraciones de supabase/migrations con las registradas en la base
 * (supabase_migrations.schema_migrations) y dice cuáles faltan en cada lado.
 *
 *   npm run migraciones:check   → sale con 1 si no coinciden, 2 si no pudo comprobarlo
 *   npm run dev                 → lo lanza antes (predev) con --warn: avisa, nunca bloquea
 *
 * Lee el historial por la Management API con SUPABASE_ACCESS_TOKEN (.env.local
 * o secreto de Actions): un token de supabase.com/dashboard/account/tokens
 * limitado a este proyecto y con un único permiso, Database → Migrations → Read.
 * No hay vía por conexión directa a propósito: SUPABASE_DB_URL daría lectura y
 * escritura sobre toda la base para leer una lista de versiones.
 * El proyecto sale de SUPABASE_PROJECT_REF, de NEXT_PUBLIC_SUPABASE_URL o de
 * supabase/.temp/project-ref, en ese orden.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const TIMEOUT_MS = 8000;

export type Comparison = {
  repo: number;
  db: number;
  /** Ficheros del repo cuya versión no está registrada en la base. */
  pendingInDb: string[];
  /** Versiones registradas en la base sin fichero en el repo. */
  missingInRepo: string[];
  /** Versiones que aparecen en más de un fichero del repo. */
  duplicatedInRepo: string[];
};

export function repoMigrations(dir = MIGRATIONS_DIR): string[] {
  return readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
}

export function compareMigrations(files: string[], dbVersions: string[]): Comparison {
  const applied = new Set(dbVersions);
  const byVersion = new Map<string, string[]>();
  for (const file of files) {
    const version = file.slice(0, 14);
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  return {
    repo: files.length,
    db: applied.size,
    pendingInDb: files.filter((f) => !applied.has(f.slice(0, 14))),
    missingInRepo: [...applied].filter((v) => !byVersion.has(v)).sort(),
    duplicatedInRepo: [...byVersion].filter(([, fs]) => fs.length > 1).map(([v]) => v),
  };
}

export function isAligned(c: Comparison): boolean {
  return !c.pendingInDb.length && !c.missingInRepo.length && !c.duplicatedInRepo.length;
}

function projectRef(): string | null {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (match) return match[1];
  try {
    return readFileSync(join(process.cwd(), "supabase", ".temp", "project-ref"), "utf8").trim() || null;
  } catch {
    return null;
  }
}

async function versionsFromApi(token: string, ref: string): Promise<string[]> {
  const base = process.env.SUPABASE_API_URL ?? "https://api.supabase.com";
  const res = await fetch(`${base}/v1/projects/${ref}/database/migrations`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `la Management API respondió ${res.status} para el proyecto ${ref}: el token ` +
        "necesita este proyecto y el permiso Database → Migrations → Read",
    );
  }
  if (!res.ok) throw new Error(`la Management API respondió ${res.status} para el proyecto ${ref}`);
  const rows = (await res.json()) as { version: string }[];
  return rows.map((r) => r.version);
}

async function appliedVersions(): Promise<string[]> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new Error("falta SUPABASE_ACCESS_TOKEN en .env.local");
  }
  const ref = projectRef();
  if (!ref) throw new Error("no se sabe qué proyecto mirar: define SUPABASE_PROJECT_REF");
  return versionsFromApi(token, ref);
}

function report(c: Comparison): string[] {
  const lines = [`El repo y la base NO coinciden (repo ${c.repo} · base ${c.db}).`];
  if (c.pendingInDb.length) {
    lines.push("", "Sin aplicar en la base (están en el repo):");
    lines.push(...c.pendingInDb.map((f) => `  - ${f}`));
  }
  if (c.missingInRepo.length) {
    lines.push("", "Aplicadas en la base sin fichero en el repo:");
    lines.push(...c.missingInRepo.map((v) => `  - ${v}`));
  }
  if (c.duplicatedInRepo.length) {
    lines.push("", "Versiones repetidas en el repo:");
    lines.push(...c.duplicatedInRepo.map((v) => `  - ${v}`));
  }
  return lines;
}

/** Recuadro amarillo para que no se pierda entre la salida de `next dev`. */
function banner(lines: string[]): string {
  const width = Math.max(...lines.map((l) => l.length)) + 2;
  const yellow = (s: string) => (process.stderr.isTTY ? `\x1b[33;1m${s}\x1b[0m` : s);
  return [
    yellow(`┌${"─".repeat(width)}┐`),
    ...lines.map((l) => yellow("│ ") + l.padEnd(width - 1) + yellow("│")),
    yellow(`└${"─".repeat(width)}┘`),
  ].join("\n");
}

async function main() {
  const warnOnly = process.argv.includes("--warn");
  const files = repoMigrations();

  let versions: string[];
  try {
    versions = await appliedVersions();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (warnOnly) {
      console.warn(banner(["⚠ MIGRACIONES: no se ha podido comprobar la base.", reason]) + "\n");
      return;
    }
    console.error(`\n✖ migraciones:check: no se ha podido comprobar: ${reason}\n`);
    process.exit(2);
  }

  const c = compareMigrations(files, versions);
  if (isAligned(c)) {
    console.log(`✓ migraciones: repo y base coinciden (${c.repo} migraciones)`);
    return;
  }
  const lines = report(c);
  if (warnOnly) {
    lines[0] = `⚠ MIGRACIONES: ${lines[0]}`;
    lines.push("", "Detalle: npm run migraciones:check");
    console.warn("\n" + banner(lines) + "\n");
    return;
  }
  console.error(`\n✖ migraciones:check: ${lines.join("\n")}\n`);
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
