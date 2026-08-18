# Copia de seguridad antes de consolidar Construcción

Esta carpeta conserva las tres versiones existentes antes de modificar n8n:

- `legacy-construccion-51-nodos.json`: workflow solicitado, sin publicar.
- `fuentes-oficiales-publicado.json`: versión publicada de fuentes oficiales.
- `manomano-publicado.json`: versión publicada del rastreador ManoMano.

Los archivos son exportaciones de n8n sin los secretos de las credenciales. Las
credenciales permanecen guardadas exclusivamente en la instancia local de n8n.

Para restaurar una copia se debe importar el JSON correspondiente y publicar su
versión desde n8n. No se deben publicar simultáneamente el workflow consolidado
y sus dos workflows de origen porque se duplicarían las ejecuciones programadas.
