# Deuda Técnica Multi-Sector (Wizard Generador de Presupuestos)

Este documento registra la deuda técnica acumulada durante el desarrollo de la V1 del Generador Visual de Presupuestos (enfocado inicialmente como punta de lanza en el sector Construcción/Reformas). 

El objetivo es tener un mapa claro de los puntos a resolver antes o durante la integración del siguiente sector adicional (ej: Comercio Local/Retail u Hostelería).

## Estado de la Arquitectura
El motor de datos (`BudgetGenerateProvider.tsx`) ha sido parcheado para ser **agnóstico al sector**, consultando la base de datos de forma dinámica usando `state.sector`. Además, la base de datos (`budgets`, `budget_items`) ya es común para todos los sectores. 

Sin embargo, quedan los siguientes elementos por resolver:

### 1. Configuraciones Visuales Específicas (UI)
- **Problema:** Actualmente el UI en `app/dashboard/budgets/generate/page.tsx` bloquea el acceso a usuarios no-constructores con un *Feature Flag* (Muestra una pantalla de "Próximamente").
- **Solución Futura:** Crear configuraciones visuales (pasos, iconos, textos) específicas por sector. Ejemplo: En lugar de "Proveedor y materiales", un retail verá "Inventario y descuentos".

### 2. Eliminación del Fallback "construccion"
- **Problema:** En el provider de datos, existe la protección temporal `const activeSector = state.sector || "construccion";`.
- **Solución Futura:** Eliminar este fallback una vez todos los perfiles de usuario de ENLAZE tengan garantizado y normalizado un sector en su registro.

### 3. Unificación del Dominio "Sector"
- **Problema:** Actualmente el "sector" viaja por diferentes vías (Perfil del usuario de auth, configuración de BBDD `sector_config`, agentes externos de n8n, tablas de precios y estado del Wizard).
- **Solución Futura:** Establecer una única fuente de verdad férrea (probablemente un JOIN a `user_profiles.sector` o `sector_config.active_sector`) y obligar a todas las capas a consumirla sincronizadamente.

### 4. Categorías Específicas por Sector
- **Problema:** El Wizard actual realiza la lógica visual buscando explícitamente `category: 'material'` o `category: 'mano_obra'`. Otros sectores tienen realidades diferentes (`materia_prima`, `hora_profesional`, `producto`, `servicio`).
- **Solución Futura:** 
  - Definir un diccionario de categorías por sector.
  - En la inserción a `budget_items`, podemos mapear a categorías genéricas y guardar la categoría específica del sector como metadato (`sector_category`), o bien ampliar los ENUMs de categorías y adaptar los resúmenes del dashboard/PDF para agrupar dinámicamente según el sector.
  - **REGLA:** Nunca romper la estructura columnar básica de `budget_items`.
