// La guardia que impide que una previsualización escriba en producción.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  comprobar,
  refDeClave,
  refDeUrl,
  REF_PRODUCCION,
} from "../scripts/entorno-check.mts";

const PROD = `https://${REF_PRODUCCION}.supabase.co`;
const PRUEBAS = "https://wowzjvlyklooqafgzuqk.supabase.co";

/** Clave heredada: JWT sin firma válida; solo se lee su `ref`. */
const claveDe = (ref) =>
  "x." + Buffer.from(JSON.stringify({ iss: "supabase", ref, role: "service_role" })).toString("base64url") + ".y";

test("fuera de Vercel no opina: con qué base trabaja cada uno en su equipo es su asunto", () => {
  assert.deepEqual(comprobar({ vercelEnv: undefined, supabaseUrl: PROD, serviceRoleKey: claveDe(REF_PRODUCCION), stripeSecretKey: undefined }), []);
});

test("una previsualización contra producción es un fallo", () => {
  const problemas = comprobar({ vercelEnv: "preview", supabaseUrl: PROD, serviceRoleKey: claveDe(REF_PRODUCCION), stripeSecretKey: undefined });
  assert.ok(problemas.length > 0);
  assert.match(problemas[0], /es "preview" y apunta al proyecto de PRODUCCIÓN/);
  // El mensaje tiene que decir qué hacer, no solo que está mal.
  assert.match(problemas.join(" "), /acota las variables de Supabase a Production/);
});

test("development contra producción también", () => {
  assert.ok(comprobar({ vercelEnv: "development", supabaseUrl: PROD, serviceRoleKey: undefined, stripeSecretKey: undefined }).length > 0);
});

test("una previsualización contra su propio proyecto pasa", () => {
  assert.deepEqual(
    comprobar({ vercelEnv: "preview", supabaseUrl: PRUEBAS, serviceRoleKey: claveDe("wowzjvlyklooqafgzuqk"), stripeSecretKey: undefined }),
    [],
  );
});

test("producción contra producción pasa", () => {
  assert.deepEqual(
    comprobar({ vercelEnv: "production", supabaseUrl: PROD, serviceRoleKey: claveDe(REF_PRODUCCION), stripeSecretKey: undefined }),
    [],
  );
});

test("el error simétrico cuenta: producción publicada contra otra base", () => {
  const problemas = comprobar({ vercelEnv: "production", supabaseUrl: PRUEBAS, serviceRoleKey: claveDe("wowzjvlyklooqafgzuqk"), stripeSecretKey: undefined });
  assert.ok(problemas.length > 0);
  assert.match(problemas[0], /es de producción y apunta a wowzjvlyklooqafgzuqk/);
});

test("URL y clave cruzadas: lo que no detectan las otras dos reglas", () => {
  // Previsualización con su URL correcta pero la clave de servicio de producción:
  // las rutas de servidor escribirían en producción saltándose RLS.
  const problemas = comprobar({ vercelEnv: "preview", supabaseUrl: PRUEBAS, serviceRoleKey: claveDe(REF_PRODUCCION), stripeSecretKey: undefined });
  assert.equal(problemas.length, 1);
  assert.match(
    problemas[0],
    /clave de servicio es del proyecto dsgnymebkxxkslyeotee y la URL del proyecto wowzjvlyklooqafgzuqk: están cruzadas/,
  );
});

test("una clave nueva sb_secret_ no dice de qué proyecto es, y no se inventa", () => {
  assert.equal(refDeClave("sb_secret_valor_de_ejemplo_no_es_una_clave"), null);
  assert.deepEqual(comprobar({ vercelEnv: "preview", supabaseUrl: PRUEBAS, serviceRoleKey: "sb_secret_x", stripeSecretKey: undefined }), []);
});

test("una URL que no es de Supabase se denuncia en vez de pasar de largo", () => {
  const problemas = comprobar({ vercelEnv: "preview", supabaseUrl: "https://ejemplo.com", serviceRoleKey: undefined, stripeSecretKey: undefined });
  assert.equal(problemas.length, 1);
  assert.match(problemas[0], /no parece una URL de Supabase/);
  assert.equal(refDeUrl(undefined), null);
  assert.equal(refDeUrl("http://localhost:54321"), null);
});

test("va en prebuild, que es donde falla antes de que se publique nada", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts.prebuild, /entorno:check/);
  assert.match(pkg.scripts["entorno:check"], /scripts\/entorno-check\.mts/);
  // En `dev` solo avisa: romper el arranque local no ayudaría a nadie.
  assert.match(pkg.scripts.predev, /entorno-check\.mts --warn/);
});

test("Stripe en modo real fuera de producción cobraría de verdad", () => {
  const problemas = comprobar({
    vercelEnv: "preview", supabaseUrl: PRUEBAS,
    serviceRoleKey: claveDe("wowzjvlyklooqafgzuqk"), stripeSecretKey: "sk_live_" + "x".repeat(24),
  });
  assert.equal(problemas.length, 2);
  assert.match(problemas[0], /clave de Stripe en modo real \(sk_live_\): cobrar\u00eda de verdad/);
  assert.match(problemas[1], /sk_test_/);
});

test("en producción la clave real de Stripe es justo la que toca", () => {
  assert.deepEqual(
    comprobar({
      vercelEnv: "production", supabaseUrl: PROD,
      serviceRoleKey: claveDe(REF_PRODUCCION), stripeSecretKey: "sk_live_" + "x".repeat(24),
    }),
    [],
  );
});

test("y una de pruebas en Preview pasa sin ruido", () => {
  assert.deepEqual(
    comprobar({
      vercelEnv: "preview", supabaseUrl: PRUEBAS,
      serviceRoleKey: claveDe("wowzjvlyklooqafgzuqk"), stripeSecretKey: "sk_test_" + "x".repeat(24),
    }),
    [],
  );
});
