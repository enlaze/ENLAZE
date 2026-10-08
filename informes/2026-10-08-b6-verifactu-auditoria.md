# b6-verifactu-auditoria — informe (2026-10-08)

**Solo informe; no he cambiado código.** He leído el código y consultado la base solo en lectura. Lo que es interpretación legal (RD 1007/2023 y la Orden HAC/1177/2024 que lo desarrolla) va marcado **[asesor]**.

## Resumen
Lo que hay es un **esbozo**: un hash SHA-256 "encadenado" y la URL del QR guardados en cada factura. **No cumple** ninguno de los seis requisitos tal como está. En producción hay 10 facturas de 2 usuarios marcadas `verifactu_registered = true` y no se ha enviado nada a la AEAT. **Lo urgente no es técnico: la app promete lo que no hace** (ver punto 7).

## Requisito por requisito

1. **Huella encadenada: hecha a medias y mal.**
   - Se calcula **en el navegador** (`projects/[id]/page.tsx:666`, `facturacion/EmitidasTab.tsx:74`). Quien manipule el cliente puede escribir cualquier hash.
   - La entrada es `número|NIF|total|fecha|hash anterior`. La norma fija qué campos y en qué formato (`IDEmisorFactura=…&NumSerieFactura=…&…&Huella=…&FechaHoraHusoGenRegistro=…`) **[asesor/técnico: confirmar con la especificación de la AEAT]**.
   - El hash anterior se toma de "la última factura por número" de ese usuario, sin bloqueo: dos facturas a la vez pueden encadenarse a la misma.
   - Se genera con la factura **en borrador**, no al emitirla.
   - **Al editar líneas se recalcula** (`issued-invoices/[id]/page.tsx:228`).
   - Al crear, la huella usa el total **antes** del IRPF y la factura guarda el total **después**: el hash no corresponde a lo guardado.
2. **Registro de facturación (alta y anulación): no existe.** Solo hay columnas sueltas en `issued_invoices`. No hay registros de alta ni de anulación con sus campos, fecha y hora con huso, ni tipo de factura.
3. **QR: no existe como QR.** Se guarda la URL `…/ValidarQR?nif=…&numserie=…&fecha=AAAA-MM-DD&importe=…` y se muestra como texto. No se dibuja ninguna imagen QR (no hay librería), y la factura impresa (`window.print()`) no lleva el QR ni la leyenda "VERI*FACTU" **[asesor: tamaño, posición, leyenda y formato de fecha DD-MM-AAAA]**.
4. **Registro de eventos: insuficiente.**
   - `fiscal_events` guarda acciones de la factura (creada, emitida, cobrada…). La norma pide eventos **del sistema** (arranque, parada, anomalías, exportaciones, restauraciones), encadenados y firmados, en la modalidad sin envío **[asesor]**.
   - Además, el usuario puede **editar y borrar** sus eventos: hay políticas RLS de UPDATE y DELETE.
5. **Envío a la AEAT: nada.** No hay cliente del servicio web, ni certificado, ni cola de reintentos. Sin envío, el sistema tendría que ir por la modalidad "no VERI*FACTU", que exige registros firmados (XAdES) y el registro de eventos completo. Tampoco existe.
6. **Inalterabilidad: no hay.**
   - En la base, `authenticated` tiene UPDATE y DELETE sobre `issued_invoices` y `fiscal_events`, con policies "own".
   - Ningún trigger impide tocar una factura emitida. Existe una papelera (`deleted_at`).
   - Lo que hay que conservar es **el registro**: hacen falta tablas solo de inserción y la rectificación mediante facturas o registros nuevos.
7. **Declaración responsable del fabricante: no existe.** Y, peor, hay afirmaciones falsas:
   - `software_versions` v1.0.0 tiene `verifactu_certified = true` y **cualquiera puede leerla** (policy `Public read`). La AEAT no "certifica" software; lo que hace falta es una declaración responsable del fabricante **[asesor]**.
   - La portada dice "Verifactu incluido" (`app/page.tsx:353`).
   - Ajustes dice que se genera "el QR verificable" y que "conserva el registro por ti", y ofrece "Facturae **firmado**", pero el XML se genera **sin firma** (`issued-invoices/[id]/page.tsx:60`).

## Fechas
La cola indica la obligación para autónomos desde el **1 de julio de 2027**; para sociedades se suele citar el **1 de enero de 2027** **[asesor: confirmar ambas, porque han cambiado más de una vez]**.

## Qué decides tú
1. **Ya, sin esperar a 2027:** quitar o suavizar las promesas (portada, Ajustes, "firmado") y poner `verifactu_certified = false`. Puedo prepararlo como bloque. El cambio en la base sería una migración pendiente de tu aprobación.
2. **Construirlo o integrarlo.** Hacerlo en casa supone envío SOAP con certificado, registros de alta y anulación, huella según la especificación, QR, eventos e inalterabilidad: varias semanas. La alternativa es un proveedor con API que actúe como sistema VERI*FACTU. Es una decisión de producto y de coste.
3. Con el asesor: modalidad (VERI*FACTU o no), qué hacer con las 10 facturas ya marcadas y el texto de la declaración responsable.

## Qué mirar con tus ojos (10 min)
- Abre una factura emitida, cambia una línea y mira cómo cambia el "Hash SHA-256". Eso no debería poder pasar.
- Imprímela: no hay QR.
- Ajustes → Empresa → Verifactu: lee lo que promete.
