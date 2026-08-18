# Tarifas autorizadas de Leroy Merlin y Grupo Puma

ENLAZE solo activa estos proveedores cuando existe una fuente de precios
facilitada o autorizada por el titular. El proceso no intenta superar bloqueos
del sitio web ni convierte estimaciones en precios oficiales.

## Formato del feed

El feed es JSON y contiene `source` y `products`.

```json
{
  "source": {
    "authorization_reference": "REFERENCIA-DEL-PROVEEDOR",
    "catalog_url": "https://www.grupopuma.com/uploads/.../tarifa.pdf",
    "catalog_published_at": "2026-01-01T00:00:00.000Z",
    "price_includes_vat": false,
    "price_scope": "Tarifa profesional España"
  },
  "products": [
    {
      "name": "Nombre comercial",
      "reference": "REFERENCIA-ESTABLE",
      "price": 13.9,
      "unit": "saco",
      "category": "material",
      "subcategory": "morteros"
    }
  ]
}
```

Para Leroy Merlin, cada producto también debe incluir su `product_url` oficial.
El importador fija el vendedor como Leroy Merlin y descarta referencias que no
sean numéricas. Para Grupo Puma, la URL de la tarifa debe pertenecer al dominio
oficial y a su zona de descargas.

## Comprobación local

La simulación no escribe datos:

```bash
npm run import:authorized-supplier -- \
  --provider grupo-puma \
  --input /ruta/tarifa.json \
  --authorization-reference REFERENCIA-DEL-PROVEEDOR
```

Solo después de validar el resultado se añade `--send`.

## Automatización

El workflow `Sincronizar tarifas autorizadas` se ejecuta a diario. Permanece en
espera mientras no estén configuradas las URL y referencias de autorización en
los secretos del repositorio. Las tarifas privadas descargadas no se publican
como artefactos de GitHub.
