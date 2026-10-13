# Three Agents · Primera Línea

[Repositorio](https://github.com/Jfede98/three-agents/tree/feature/jfede_branch)

Tablero comercial que cruza consultas de clientes, inventario y promociones para proponer reposiciones por ciudad. Una persona revisa la evidencia y aprueba o rechaza cada propuesta.

La versión actual funciona con **Convex local y análisis determinista por reglas**. No necesita una cuenta ni claves de servicios externos para analizar los datos. **No usa IA generativa**: los tres analizadores calculan y explican sus resultados a partir de métricas sintéticas.

## Arranque local

Requisitos: Node.js 22 LTS (22.13 o superior) y npm; `.nvmrc` selecciona esa versión. En Windows se verificó con Node.js 22.23.3. La primera instalación necesita acceso a Internet para descargar las dependencias y el backend local.

```powershell
git clone --branch feature/jfede_branch https://github.com/Jfede98/three-agents.git
cd three-agents
npm ci
npm run setup
npm run dev
```

En un checkout nuevo, el arranque configura automáticamente un backend local sin cuenta. Si el proyecto ya apunta a un entorno remoto, estos comandos se detienen antes de publicar cambios; `npx convex deployment select local` permite seleccionar un despliegue local propio. Tanto el arranque como la importación rechazan destinos remotos.

`setup` configura el backend, genera `.env.local` e importa los archivos de `data/mock/`. Reemplaza las ocho tablas del dataset sintético y reconstruye sus métricas; usarlo de nuevo sólo cuando se quiera volver a importar esos archivos. No hace falta copiar `.env.example` ni escribir una clave manualmente.

`dev` mantiene en ejecución Convex y Next.js. Abrir **http://localhost:3000**. Al cerrar ese proceso, el backend local también se detiene; los datos persisten en `.convex/` y se recuperan al volver a iniciarlo. Esa carpeta y `.env.local` están excluidos de Git.

También se pueden iniciar por separado, en dos terminales:

```powershell
npm run dev:backend
npm run dev:web
```

## Qué se puede probar

1. Elegir Guayaquil, Quito o Cuenca.
2. Pausar o avanzar la simulación para observar consultas, existencias y promociones.
3. Pulsar **Analizar datos** y revisar los tres resultados por reglas.
4. Aprobar o rechazar una propuesta pendiente. El análisis no modifica las existencias.
5. Comprobar la decisión: aprobar repone la cantidad propuesta, hasta el objetivo de inventario; rechazar conserva las existencias.

Las propuestas vencen a los 15 minutos y dejan de ser válidas si el escenario cambia de forma incompatible. Repetir una aprobación o un rechazo no aplica dos veces la operación. Un producto con inventario completo no necesita una nueva reposición.

## Datos y análisis

Se conservan los archivos sintéticos originales, su fecha de referencia y el escenario de Farmaenlace. No hay conexión con WhatsApp, sistemas de inventario ni catálogos reales.

| Analizador | Datos que utiliza | Resultado |
| --- | --- | --- |
| Consultas | Volumen observado y base de comparación | Cambio de demanda y evidencia |
| Inventario | Existencias, objetivo y cobertura por zona | Necesidad de reposición |
| Promociones | Catálogo y vigencia de promociones | Disponibilidad de una promoción |

La simulación mantiene su propio reloj e inventario. Las métricas por hora de esa simulación se distinguen del histórico sintético del dataset; sus proyecciones no se presentan como observaciones reales. El botón de reinicio restablece el escenario simulado, no reescribe los archivos del dataset.

`npm run data:generate` regenera los archivos sintéticos. `npm run data:import` importa los archivos existentes con el backend local encendido. No es necesario regenerar para ejecutar la aplicación.

## Verificación

Con el backend local en ejecución:

```powershell
npm test
npm run typecheck
npm run build
npm run test:smoke
```

Las pruebas automatizadas cubren análisis, validación de datos, decisiones y protección frente a propuestas desactualizadas. La prueba de integración local recorre rechazo, aprobación, repetición de decisiones y lectura con otro cliente. Modifica únicamente el escenario sintético del backend local y lo deja pausado. Rechaza endpoints remotos.

## Estructura

- `app/`, `components/`: interfaz Next.js, React y escena 3D.
- `convex/`: esquema, consultas reactivas, simulación, análisis y decisiones.
- `data/mock/`: catálogo, sucursales, consultas, existencias, promociones y noticias sintéticas.
- `scripts/`: generación, importación y prueba de integración local.

## Próximo paso: cuentas propias

Convex ya proporciona la base de datos, las funciones y la sincronización en tiempo real. El modo local permite continuar sin crear una cuenta. Para un entorno compartido se puede vincular el proyecto a una cuenta propia mediante `npx convex login` y configurar un despliegue de desarrollo en Convex Cloud. [Guía oficial](https://docs.convex.dev/cli/local-deployments).

Convex no sustituye por sí mismo a un modelo generativo. Si se añade IA, habrá que elegir un proveedor y configurar sus propias credenciales en el backend. La interfaz debe seguir distinguiendo los análisis por reglas de los generados por un modelo.

Este entorno es de desarrollo: aún no hay autenticación ni permisos por usuario, y las decisiones usan un actor de demostración. Antes de publicarlo para terceros hay que configurar esas dos capas y elegir alojamiento para el frontend. No hay un despliegue público configurado en esta versión.
