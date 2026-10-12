-- auto/b8-quitar-verifactu. Aprobada y aplicada el 2026-10-12 (versión
-- registrada 20261012100029; el fichero se llamaba 20261011120000).
--
-- software_versions.verifactu_certified = true es falso: no hay envío a la
-- AEAT, ni QR, ni inalterabilidad, ni declaración responsable (ver informe de
-- auto/b6-verifactu-auditoria). El flag y el changelog se leen como promesa.
--
-- Idempotente: se puede lanzar más de una vez.

UPDATE public.software_versions
   SET verifactu_certified = false
 WHERE verifactu_certified IS DISTINCT FROM false;

UPDATE public.software_versions
   SET changelog = replace(changelog, 'Verifactu, ', '')
 WHERE changelog LIKE '%Verifactu, %';
