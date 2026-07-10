# Workflow n8n: Importar BC3 al Banco Tecnico

Workflow para importar archivos BC3/FIEBDC-3 al banco tecnico de precios de ENLAZE.

## Requisitos

- n8n corriendo (local con `npx n8n` o Docker)
- AGENT_API_KEY configurada en el endpoint de ENLAZE
- Un archivo .bc3 valido

## Instalacion

1. Abrir n8n en el navegador (por defecto http://localhost:5678)
2. Menu lateral > Workflows > Import from File
3. Seleccionar `technical-bc3-import.json`

## Configurar credencial

Antes de ejecutar, crear la credencial Header Auth:

1. Settings > Credentials > Add Credential
2. Tipo: **Header Auth**
3. Nombre: **ENLAZE API Key**
4. Header Name: `Authorization`
5. Header Value: `Bearer TU_AGENT_API_KEY_REAL`

Sustituir `TU_AGENT_API_KEY_REAL` por el valor de `AGENT_API_KEY` del `.env` de ENLAZE.

## Configurar parametros

Abrir el nodo **Configuracion** y editar el JSON:

```json
{
  "source": "public_bc3",
  "region": "test",
  "edition": "test-2026",
  "overwrite": "false",
  "endpointUrl": "https://enlaze.vercel.app/api/technical-prices/import",
  "filePath": "/Users/alvaromirallesgrande/Desktop/enlaze/scripts/fixtures/sample-technical-bank.bc3"
}
```

Campos editables:

| Campo | Valores | Default |
|---|---|---|
| source | `public_bc3`, `cype`, `ive`, `enlaze_base`, `manual` | `public_bc3` |
| region | `espana`, `andalucia`, `madrid`, `cataluna`, `test` | `test` |
| edition | texto libre | `test-2026` |
| overwrite | `false`, `true` | `false` |
| endpointUrl | URL del endpoint | produccion |
| filePath | ruta absoluta al .bc3 | fixture de test |

Sobre `source = cype`: usar SOLO cuando el archivo .bc3 proviene de una exportacion real de CYPE/Arquimedes/Open BIM. Nunca asignar `cype` a archivos de otra procedencia.

Rutas de archivo segun entorno:

- **macOS local**: `/Users/alvaromirallesgrande/Desktop/enlaze/scripts/fixtures/sample-technical-bank.bc3`
- **Docker**: `/data/bc3/import.bc3` (montar volumen con `-v /ruta/local:/data/bc3`)
- **Endpoint local**: cambiar `endpointUrl` a `http://localhost:3000/api/technical-prices/import`

## Ejecutar

1. Abrir el workflow en n8n
2. Click **Execute Workflow**
3. Ver resultado en el nodo **Fin OK** o **Fin Error**

## Resultado exitoso

```json
{
  "resultado": "IMPORTACION EXITOSA",
  "ok": true,
  "logId": "uuid-del-log",
  "chapters_created": 4,
  "chapters_updated": 0,
  "items_created": 4,
  "items_updated": 0,
  "components_created": 19,
  "items_skipped": 0,
  "warnings_count": 2,
  "warnings": ["..."]
}
```

## Errores

| HTTP | Mensaje | Causa probable |
|---|---|---|
| 401 | AGENT_API_KEY invalida o no configurada | Credencial no creada o key incorrecta |
| 400 | Archivo o parametros invalidos | Archivo no es .bc3, source invalido, o archivo vacio |
| 500 | Error interno importando BC3 | Error en parser o en escritura a Supabase |

## Flujo de nodos

```
Manual Trigger
  > Configuracion (source, region, edition, overwrite, filePath, endpointUrl)
    > Leer archivo BC3 (Read Binary File)
      > Preparar campos (Set con includeBinary)
        > POST Import BC3 (HTTP Request multipart/form-data)
          > Respuesta OK? (If statusCode == 200)
            > [true]  Resumen OK > Fin OK
            > [false] Error Handler > Fin Error
```
