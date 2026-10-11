-- PENDIENTE DE APROBAR (auto/b8-quitar-verifactu). No aplicada.
--
-- software_versions.verifactu_certified = true es falso: no hay envío a la
-- AEAT, ni QR, ni inalterabilidad, ni declaración responsable (ver informe de
-- auto/b6-verifactu-auditoria). La tabla tiene lectura pública, así que el
-- flag y el changelog son una promesa visible desde fuera de la app.
--
-- Idempotente: se puede lanzar más de una vez.

UPDATE public.software_versions
   SET verifactu_certified = false
 WHERE verifactu_certified IS DISTINCT FROM false;

UPDATE public.software_versions
   SET changelog = replace(changelog, 'Verifactu, ', '')
 WHERE changelog LIKE '%Verifactu, %';
