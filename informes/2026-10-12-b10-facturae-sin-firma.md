# b10-facturae-sin-firma: sin promesa de firma, y ninguna factura "registrada en Verifactu"

Rama `auto/b10-facturae-sin-firma`, sacada de `origin/main` (d2382bf). No toca main ni la base.

## Qué ha cambiado

| Dónde | Antes | Ahora |
|---|---|---|
| Ajustes › Empresa, "Facturación electrónica B2B" | "Emite en formato Facturae **firmado** para clientes que lo exigen (administraciones y grandes cuentas)." | "Emite en formato Facturae para clientes que lo exigen." |
| Alta de factura (Facturación › Emitidas y desde un proyecto) | `verifactu_registered = fiscal.verifactu_enabled`, que es `true` para todos | `verifactu_registered = false` siempre: no se envía nada a la AEAT |
| Ajustes › Empresa, valor inicial de `verifactu_enabled` | `true` (y `?? true` si no hay ajustes guardados) | `false` |
| Base | valor por defecto `true` | migración `20261012130000_fiscal_settings_verifactu_disabled_by_default.sql`, **PENDIENTE DE APROBAR** |

He quitado también "(administraciones y grandes cuentas)": para enviar a la Administración por FACe la Facturae tiene que ir firmada, así que esa frase seguía prometiendo la firma. Lo he comprobado en el generador (`issued-invoices/[id]/page.tsx`): el XML no lleva ningún bloque de firma.

He buscado "firma", "firmado", "XAdES" y "Facturae" en app, components y lib: no hay otra promesa de firma para Facturae. La firma de presupuestos (`/firmar`, OTP) no se ha tocado.

**La migración** solo cambia el valor por defecto de las filas nuevas. No hace ningún `UPDATE`:
- `fiscal_settings`: hay 4 filas y las 4 tienen `verifactu_enabled = true`. Se quedan así. Da igual en la práctica, porque el código ya no lo usa para marcar facturas.
- **Facturas ya marcadas: 10 de 10** tienen `verifactu_registered = true`, de 2 usuarios, y ninguna se ha enviado a la AEAT. No se tocan, como pediste.

## Cómo lo he comprobado

- Prueba nueva `__tests__/verifactu-not-registered.test.mjs` (4 casos): ninguna alta de factura escribe `verifactu_registered` con algo distinto de `false`; Ajustes arranca con `verifactu_enabled` en `false`; la migración solo cambia el valor por defecto, sin `update`, `insert` ni `delete`; y ningún texto promete "Facturae firmado" ni XAdES. Con el código de main fallan 3; con el arreglo pasan las 4.
- Batería unitaria completa: 612 pasan, 0 fallan, 2 `todo`. `test:migraciones-check`: 10/10.
- `npx tsc --noEmit`: sin errores. `eslint`: los mismos 23 errores de `react-hooks` que en main, ninguno nuevo.
- `npm run build`: correcto, con `.env.local` de main enlazado y quitado al terminar. Su `prebuild` consulta los precios de Stripe en modo prueba (solo lectura); lo digo por la regla 6.
- Base: solo `SELECT` (valores por defecto y recuentos).
- **No lo he visto en el navegador.**
- Mientras no se aplique la migración, `npm run migraciones:check` la dará como pendiente. Es lo esperado.

## Qué tienes que decidir o aprobar

1. **Aprobar la migración** del valor por defecto.
2. **El interruptor "Facturación electrónica B2B" no hace nada.** `facturae_enabled` se guarda, pero ningún código lo lee: el botón "Descargar Facturae XML" sale siempre, esté activado o no. ¿Lo quito, o hago que el botón dependa de él?
3. **Las 10 facturas ya marcadas.** No se ve en ningún sitio desde b8, pero el dato es falso. Corregirlas sería un `UPDATE` (pendiente de tu aprobación) o algo que decidir con el asesor, como ya apuntaba b6.
4. **Fuera de este bloque, por si te interesa:** la página de firma de presupuestos (`/firmar/[id]`) dice "Cumple con eIDAS Art. 25". Es una afirmación legal sobre la firma de presupuestos, no sobre Facturae. Valdría la pena que la mirase el asesor.

## Qué revisar en 10 minutos

1. Ajustes › Empresa: el texto de "Facturación electrónica B2B" sin "firmado" ni "administraciones".
2. Crea una factura de prueba y mira en Supabase que sale con `verifactu_registered = false`.
