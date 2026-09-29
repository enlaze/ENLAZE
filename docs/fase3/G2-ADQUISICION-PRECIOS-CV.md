# Plan de adquisición de precios — Comunitat Valenciana

Fecha: 2026-09-29. Estado: **plan. Ninguna adquisición iniciada.**
Complementa [G2-DESCOMPUESTOS.md](G2-DESCOMPUESTOS.md), que explica por qué hace
falta.

El rastreador tiene hoy 42.208 productos y sirve para valorar material. Un
presupuesto de obra necesita seis cosas más. Este documento dice cuáles, de
dónde salen, en qué orden y quién las consigue.

## Regla que no se rompe

**No se toca nada de lo que hay funcionando.** Todo lo de aquí entra por
caminos que ya existen o por tablas nuevas:

- Los descompuestos entran por `/api/technical-prices/import`, que ya está
  escrito y probado.
- Los productos de proveedor entran por donde ya entran.
- Las familias que hoy no tienen sitio —convenio, residuos, tasas— **van en
  tablas nuevas**, con su migración y sus gates, nunca metiendo a calzador un
  oficial de 1ª en `pb_products`.
- Ninguna importación sobrescribe `pb_products`, `price_items` ni
  `pb_price_current` sin una pasada de revisión previa.

## Estado de partida, medido

| Familia | Registros hoy | Sirve para presupuestar |
|---|---|---|
| Material de proveedor | 42.208 | sí |
| **Descompuestos** | **4 reales** (fixture de prueba) | **no** |
| **Mano de obra** | **~30** | **no** |
| **Maquinaria** | **22** | **no** |
| **Transporte** | **8** | **no** |
| **Residuos (RCD)** | **0** | **no** |
| **Tasas y licencias** | **0** | **no** |

Cinco familias vacías de siete. Y la mano de obra es entre el 35% y el 50% del
importe de una reforma.

---

## Bloque 0 · La base de descompuestos — **bloqueante**

Sin esto no hay G2. Todo lo demás se puede preparar en paralelo, pero nada se
termina sin esta pieza.

**Qué pedir:** la base en **BC3 / FIEBDC-3**, que es el formato que el
importador ya lee.

**Candidatas, por orden de encaje:**

| Base | Por qué |
|---|---|
| **IVE** — Institut Valencià de l'Edificació | Referencia oficial de la Comunitat Valenciana. Es la que usan arquitectos y administración de aquí. Encaje regional perfecto |
| **BEDEC** (ITeC) | Muy completa, cobertura nacional, incluye datos ambientales |
| **CYPE** | Cobertura nacional con ajuste provincial |
| **PREOC** | Edificación y obra civil, formato asequible |

**Lo que hay que confirmar antes de firmar, y es lo más importante:** que la
licencia permita **usar los precios dentro de un producto comercial que se
vende a terceros**. Muchas licencias cubren el uso profesional del que redacta
un proyecto, no la incorporación a un SaaS. Preguntarlo explícitamente y
pedirlo por escrito. Si la licencia no lo cubre, la base no sirve por buena que
sea.

**Responsable:** Álvaro / Dani. Es negociación, no ingeniería.

**Cómo entra:** una llamada a `/api/technical-prices/import` con
`source=ive`, `region=comunitat_valenciana`, `edition=<año>`. Sin escribir
código.

**Hecho cuando:** `technical_price_items` pasa de 4 filas reales a varios miles
con `material_cost`, `labor_cost` y `machinery_cost` distintos de cero, y una
partida de prueba —«pintura plástica en paredes, m²»— devuelve un descompuesto
coherente.

---

## Bloque 1 · Mano de obra por convenio

La segunda pieza que más pesa, y es **pública y gratuita**.

**Qué:** tablas salariales del **Convenio Colectivo Provincial de la
Construcción** de Valencia, Castellón y Alicante, publicadas en el BOP de cada
provincia. Categorías: peón ordinario, peón especializado, oficial de 2ª,
oficial de 1ª, encargado, capataz, jefe de obra.

**El detalle que no se puede equivocar:** se guarda **coste empresa por hora**,
no salario de convenio. Al salario hay que sumarle Seguridad Social, pagas,
vacaciones y días no trabajados. Un oficial de 1ª con salario de convenio del
orden de 12-13 €/h le cuesta a la empresa unos 22-26 €/h. Guardar el salario
hace que **todos** los presupuestos salgan aproximadamente un 40% baratos, y el
usuario pierde dinero usando la herramienta.

El multiplicador exacto lo tiene que validar una asesoría laboral o una
constructora de confianza. No es un número que deba inventar el equipo técnico.

**Responsable:** Álvaro o Dani para conseguir las tablas y validar el
multiplicador; Codex para la tabla nueva y la ingesta.

**Caducidad:** anual. Los workflows de n8n que ya leen el BOE pueden vigilar el
BOP provincial y avisar cuando salga la tabla nueva.

**Hecho cuando:** las tres provincias tienen sus categorías con coste empresa y
vigencia, y una prueba falla si alguien guarda el salario a secas.

---

## Bloque 2 · Residuos, tasas y licencias

Poco dato, mucho efecto. Es lo que diferencia un presupuesto completo de uno que
deja sorpresas al cliente.

**Residuos (RCD):** €/t y €/m³ por tipo de residuo en gestores autorizados de la
Comunitat, alquiler de contenedor, transporte a planta. Y la **fianza de
residuos** que exige el ayuntamiento al pedir licencia, que se adelanta y se
recupera.

**Tasas municipales**, y cambian de municipio a municipio:

- **ICIO**, entre el 2% y el 4% según ordenanza.
- Tasa de licencia urbanística.
- Ocupación de vía pública para contenedor o andamio.
- Visado colegial cuando hace falta proyecto.

**Alcance inicial propuesto:** los veinte municipios más grandes de la
Comunitat. València, Alacant, Elx, Castelló, Torrent, Gandia, Paterna, Sagunt,
Alcoi, Benidorm y siguientes. Cubre la mayor parte del mercado con poco dato.

**Responsable:** Codex, con verificación de Álvaro o Dani sobre dos o tres
municipios conocidos antes de darlo por bueno.

**Cómo:** las ordenanzas fiscales se publican. Mismo patrón que ya usan los
workflows con el BOE.

**Hecho cuando:** un presupuesto en València y otro en Torrent dan ICIO
distinto, y ambos coinciden con la ordenanza vigente.

---

## Bloque 3 · Cerámica — la ventaja regional

Estáis en la puerta del mayor clúster cerámico de Europa. Ningún competidor
nacional tiene esa cercanía.

**Fabricantes de Castellón:** Porcelanosa (Vila-real), Pamesa, Keraben,
Argenta, Grespania, Colorker, Tau, Peronda, STN, Cicogres. **ASCER** es la
patronal del sector.

**Qué pedir:** la tarifa anual en PDF para prescriptores y distribuidores.

**Por qué es fácil:** es exactamente el camino que ya funciona con OBRAMAT
—16.665 productos entraron así, por `official_pdf_catalog`—. **No hay que tocar
código**: es conseguir el PDF.

**Argumento para el fabricante:** una plataforma que pone sus productos delante
de constructores que compran es prescripción. Eso es lo que quieren. Un correo
al departamento comercial funciona mejor que un scraper, y deja acuerdo por
escrito.

**Responsable:** Álvaro o Dani. Empezar por dos o tres y ver qué responden.

---

## Bloque 4 · Fabricantes y distribuidores por capítulo

Por orden de aparición en una reforma:

| Capítulo | Nombres |
|---|---|
| Morteros, cementos, SATE | Grupo Puma ✓, Weber ✓, Sika ✓ (parcial), Mapei, Propamsa, Cemex, Holcim, Cementval (Sagunt) |
| Yeso y placa | Pladur, Knauf, Placo |
| Aislamiento | Isover, Rockwool, Ursa (con fábrica en la Comunitat), Danosa |
| Fontanería y saneamiento | Roca ✓, Jimten/Adequa, Uralita; distribuidores tipo Saltoki o Comafe |
| Electricidad | Simon, Schneider, Legrand, Hager; distribución: Elektra, Rexel, Grupo Electro Stocks |
| Climatización y ACS | Daikin, Mitsubishi, Baxi, Vaillant, Bosch |
| Pintura | **Montó e Isaval, valencianas**; Titanlux, Bruguer, Valentine, Procolor |
| Carpintería y aluminio | Cortizo, Technal, Exlabesa |
| Almacenes | OBRAMAT ✓, BigMat (hoy solo 14 productos), Gamma |

✓ = ya presente en el rastreador.

**Los distribuidores locales concretos los conocéis vosotros mejor que yo:
verificad esa parte.** Y tenedlo presente: **el precio que vale es el del
almacén donde compra vuestro usuario**, no el PVP del fabricante.

**Responsable:** Álvaro y Dani para la relación comercial; Codex para la
ingesta de cada tarifa que llegue.

---

## Bloque 5 · Vuestros propios precios pagados

El mejor dato del sistema y ya es vuestro.

La plataforma guarda facturas recibidas. Son **precios realmente pagados, con
descuento aplicado** — mejor que cualquier catálogo. Alimentan los niveles
`negotiated` e `historical_approved` del resolutor, que son los de mayor
confianza de toda la cadena y hoy están vacíos.

**Responsable:** Codex, cuando G2 esté encaminado.

**Cuidado:** son datos de un cliente concreto. El precio que Ferretería X hace a
un usuario **no** puede filtrarse a otro. Va en su nivel privado por empresa,
con su RLS, como ya está previsto en la cadena del resolutor.

---

## Orden, dependencias y responsables

| # | Bloque | Responsable | Bloquea a | Coste |
|---|---|---|---|---|
| 0 | Base de descompuestos (IVE) | Álvaro / Dani | **todo G2** | licencia |
| 1 | Convenio de las tres provincias | Álvaro / Dani + Codex | precio de mano de obra | gratis |
| 2 | Residuos, ICIO y tasas | Codex + verificación | presupuesto completo | gratis |
| 3 | Tarifas de cerámica | Álvaro / Dani | diferenciación | gratis |
| 4 | Resto de fabricantes | Álvaro / Dani + Codex | cobertura | gratis |
| 5 | Facturas propias | Codex | precisión por empresa | gratis |

**Cuatro de los seis bloques no cuestan dinero.** El único con coste es el 0, y
es el que lo desbloquea todo.

Los bloques 1, 2 y 3 se pueden hacer **en paralelo** con la negociación del 0,
porque no dependen de ella.

## Cómo verificamos que cada bloque está hecho

| Bloque | Comprobación |
|---|---|
| 0 | `technical_price_items` con miles de filas y descompuesto real; una partida de prueba devuelve componentes coherentes |
| 1 | Las tres provincias con sus categorías en coste empresa y vigencia; prueba que rechaza el salario a secas |
| 2 | Dos municipios distintos dan ICIO distinto y ambos coinciden con su ordenanza |
| 3 | Al menos dos fabricantes cerámicos con tarifa vigente ingerida |
| 4 | Cada tarifa nueva aumenta la cobertura sin degradar la confianza media |
| 5 | Un precio pagado por una empresa **no** aparece para otra |

## Riesgos

- **La licencia del bloque 0 puede no permitir uso comercial.** Es el riesgo
  que hay que despejar primero, antes de invertir tiempo en el resto.
- **Las tablas de convenio caducan cada año** y las ordenanzas cambian. Sin
  modelar la vigencia desde el principio, el sistema envejece en silencio —que
  es exactamente lo que pasó con `pb_price_current` durante dos meses.
- **Los acuerdos con fabricantes dependen de personas.** Conviene empezar por
  dos o tres y aprender del proceso antes de escalarlo.
- **El bloque 5 mezcla datos entre empresas si se implementa mal.** Es el único
  de la lista con riesgo de privacidad, y por eso va el último y con su RLS
  revisada.
