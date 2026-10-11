# b8-quitar-verifactu: fuera las promesas de Verifactu

Rama `auto/b8-quitar-verifactu`, sacada de `origin/main` (aeebc42). No toca main.

## Qué ha cambiado

Se quita el texto y no se pone otra promesa en su lugar.

| Dónde | Antes | Ahora |
|---|---|---|
| Landing, línea bajo el botón | "Sin tarjeta · Listo en 2 minutos · **Verifactu incluido** · Soporte en español" | sin "Verifactu incluido" |
| Ajustes › Empresa | interruptor "Verifactu · OBLIGATORIO 2026 · Genera el hash… y el QR verificable… y conserva el registro por ti" | quitado entero |
| Facturación (cabecera y pestaña Emitidas, 3 textos) | "con Verifactu y Facturae" | "con Facturae" |
| Emitidas, columna oculta "VF" (y en la exportación) | Sí/No "Hash Verifactu registrado" | columna quitada |
| Ficha de factura emitida | bloque "Verifactu" con hash, hash anterior y "URL verificación QR" de la AEAT | bloque "Hash de la factura" con los dos hashes; la URL de la AEAT ya no se enseña |
| Cumplimiento › Fiscal | "Facturas emitidas registradas Verifactu", tarjeta "Registradas Verifactu", "Trazabilidad fiscal, Verifactu y Facturae" | quitados; el subtítulo queda en "Trazabilidad fiscal y Facturae" |
| Panel y Cumplimiento (semáforo fiscal), línea de tiempo de la factura | "Fiscal / Verifactu", "hash Verifactu", "Hash Verifactu generado" | "Fiscal", "hash", "Hash generado" |

**Sin tocar:** las columnas `verifactu_*` de la base, el cálculo del hash al crear facturas, el valor guardado de `verifactu_enabled` (se sigue enviando el que ya tenía cada usuario) y los comentarios de código que dicen "Verifactu" (no se ven en pantalla).

**Base de datos:** no he tocado nada. La migración `supabase/migrations/20261011120000_software_versions_not_verifactu_certified.sql` está **PENDIENTE DE APROBAR**:
- pone `software_versions.verifactu_certified = false`. Hoy está a `true` en la única fila (v1.0.0), lo he comprobado en modo lectura;
- quita "Verifactu, " del changelog de esa fila ("Versión inicial de ENLAZE con compliance core, Verifactu, Facturae 3.2.2, multi-sector."). La tabla se puede leer sin iniciar sesión, así que el changelog también cuenta como promesa. Si prefieres no tocar el changelog, borra el segundo `UPDATE`.

He buscado en la base, en modo lectura, en `plan_catalog` y `sector_config` (textos de planes y menús): ninguna menciona Verifactu.

## Cómo lo he comprobado

- He buscado "verifactu" en app, components y lib: solo quedan nombres de columna y comentarios. He buscado "certificad", "homologad", "AEAT" y "antifraude": ninguna promesa.
- `npx tsc --noEmit`: sin errores.
- `eslint` sobre los 9 ficheros tocados: 0 errores y 21 avisos, los mismos 21 que en main.
- `npm run test:migraciones-check`: 10/10.
- `npm run build`: correcto.
- **No lo he visto en el navegador.** Lo de abajo está sin mirar con los ojos.

## Qué tienes que decidir o aprobar

1. **Aprobar la migración** (y decidir si se toca el changelog).
2. **¿Se sigue enseñando el hash?** El bloque "Hash de la factura" y el semáforo de Cumplimiento siguen contando facturas "con hash". No promete nada, pero un semáforo en verde en "Fiscal" puede leerse como "cumples". ¿Lo dejo, lo quito o lo cambio de texto?
3. **`verifactu_enabled` sigue a `true` por defecto.** Ya no hay interruptor, así que las facturas nuevas se siguen marcando `verifactu_registered = true` sin que se vea en ningún sitio. Es inofensivo, pero si quieres el dato limpio hay que cambiar el valor por defecto (sería otra migración).

## Qué revisar en 10 minutos

1. La landing (`/`), en la línea bajo el botón principal.
2. Ajustes › Empresa: tras "Siguiente factura" debe ir directamente "Facturación electrónica B2B".
3. Facturación › Emitidas: textos de cabecera y estado vacío, y que en el selector de columnas no esté "VF".
4. Una factura emitida: el bloque "Hash de la factura" sin la URL de la AEAT.
5. Cumplimiento › Fiscal: 3 controles (antes 4) y 2 tarjetas (antes 3).
