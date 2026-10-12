import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("sin clave de correo, importar las rutas no falla y el envío devuelve un error controlado", () => {
  const env = { ...process.env };
  delete env.RESEND_API_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = spawnSync(process.execPath, [
    "--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      globalThis.fetch = () => { throw new Error('La prueba no debe realizar llamadas de red'); };
      const notifications = await import('./lib/notification-service.ts');
      const user = { id: 'test-user', email: 'test@example.com', user_metadata: {} };
      const supabase = {
        auth: { getUser: async () => ({ data: { user } }) },
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
          data: { email_notifications: { client_created: true } }, error: null,
        }) }) }) }),
      };
      assert.deepEqual(await notifications.notifyClientCreated(supabase, 'Cliente de prueba'), {
        success: false, error: 'RESEND_API_KEY no está configurado',
      });
      const route = await import('./app/api/signatures/send-otp/route.ts');
      const response = await route.POST(new Request('http://localhost/api/signatures/send-otp', {
        method: 'POST', headers: { 'x-forwarded-for': '127.0.0.222' }, body: '{}',
      }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: 'El servicio de correo no está disponible en este momento.',
      });
    `,
  ], { cwd: fileURLToPath(new URL("../", import.meta.url)), env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
});
