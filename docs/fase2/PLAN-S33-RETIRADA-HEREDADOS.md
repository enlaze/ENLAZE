# S3.3 — plan de retirada de los enlaces heredados

Fecha: 2026-09-27. Estado: **plan y comprobaciones. Bloqueado por decisión de producto.**
Rama: `codex/legacy-token-s33-prep`, desde `origin/main` `ec4958e`.
**No hay migración en esta rama, y no la habrá hasta que la decisión llegue.**

## Qué bloquea exactamente

Falta la respuesta de los **tres propietarios**: si alguno llegó a compartir uno
de los ocho enlaces con su cliente. Sin eso, vaciarlos es apostar a que nadie
los tiene guardados.

No hay forma técnica de sortearlo: **no existe telemetría de acceso al portal**
—ni columna, ni tabla, ni evento—, así que la pregunta no se puede responder
con datos. Instrumentar y esperar sería semanas de calendario para ocho enlaces
que, por el estado de los proyectos, probablemente nadie ha abierto.

## Lo que sí se sabe, medido

Ocho proyectos, todos con enlace heredado —es el 100%, porque la columna lo
emitía en cada alta hasta S3.1—, tres propietarios, **0 cambios propuestos** y
**0 presupuestos enviados** en toda la base. Cuatro de los ocho se llaman
«prueba», «prueba 2», «prueba 3» y «reforma».

Un cliente que abriera cualquiera de los ocho vería un portal vacío. Ese es el
argumento de fondo para no montar una campaña de sustitución.

## Los tres pasos, y por qué no se pueden solapar

**(a) Vaciar** los enlaces que se decida retirar: `access_token = NULL`, posible
desde S3.1. Por proyecto, nunca en bloque a ciegas.

**(b) Retirar la compatibilidad heredada** de `portal_read_snapshot` y
`portal_respond_to_change`. Solo cuando queden **cero** enlaces: mientras quede
uno, retirarla lo deja fuera sin aviso. Hoy ambas RPC la aceptan
(`rpc_con_legacy = 2`).

**(c) Eliminar la columna.** Solo cuando (b) esté desplegada y estable. Antes,
la columna es la red de seguridad: si (b) resultara equivocada, se revierte y
los enlaces siguen ahí.

Cada paso es una migración distinta, con su precheck y su compensación. El
orden no es negociable: (c) antes que (b) deja el portal roto sin vuelta atrás.

## Comprobaciones, ya escritas y probadas

| Bloque | Para qué |
|---|---|
| `CHECK_E4_L3_S33_INVENTARIO` | la conversación con los propietarios: proyecto, estado, actividad y si tiene enlace. **Sin secretos**: comprueba presencia, nunca selecciona `access_token` |
| `CHECK_E4_L3_S33_PASO_B_PRECHECK` | ¿se puede retirar la compatibilidad? Exige cero heredados |
| `CHECK_E4_L3_S33_PASO_C_PRECHECK` | ¿se puede quitar la columna? Exige que (b) esté desplegada |

Ejecutado hoy contra producción, el de (b) responde
`ESPERAR: quedan 8 enlaces heredados activos`, que es la respuesta correcta.

## Recomendación

Preguntar a los tres propietarios. A la respuesta negativa, vaciar los ocho en
una sola operación tras (a). Si alguno dice que sí, ese proyecto y solo ese
recibe un token moderno con `read` + `approve_changes`, 90 días y propietario el
`user_id` del proyecto, se le comunica al cliente, y su enlace heredado se vacía
después.

## Riesgos

- **Vaciar es irreversible en la práctica.** El valor no se guarda en ningún
  sitio; recuperarlo significaría emitir uno nuevo y volver a comunicarlo.
- **Los ocho siguen siendo portadores y sin caducidad** mientras existan.
- **El paso (b) es el peligroso**: si se hace con un enlace vivo, el cliente que
  lo tenga deja de entrar y nadie se entera, porque no hay telemetría. Por eso
  su precheck exige cero y no «pocos».
