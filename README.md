# Premi Comerç de Barcelona

Landing responsive en catalán realizada con **Vue 3 + Vite**, con el banner oficial del Premi Comerç de Barcelona 2026.

## Desarrollo

Requiere Node.js 22.12 o posterior.

```sh
npm install
npm run dev
```

Abre http://localhost:5173. Vite redirige `/api` al servidor Express en el puerto 3001.

## Producción

```sh
npm ci
npm test
npm run build
NODE_ENV=production npm start
```

El servidor sirve la web compilada y la API en http://localhost:3001. Se puede configurar `PORT` y `DATA_DIR` mediante variables de entorno. En un alojamiento con contenedores, configura `DATA_DIR` en un volumen persistente. Publica el servidor detrás de HTTPS. GitHub Pages por sí solo no ejecuta esta API; se necesita alojamiento Node.js con almacenamiento persistente.

## CRM de inscripciones

El CRM está disponible en `/admin`. Para activarlo es obligatorio configurar una contraseña en el servidor:

```sh
ADMIN_USERNAME=admin ADMIN_PASSWORD='una-contrasena-segura' npm start
```

`ADMIN_USERNAME` es opcional y utiliza `admin` si no se define. `ADMIN_PASSWORD` no tiene valor predeterminado: mientras no se configure, la API administrativa permanece desactivada. El acceso debe publicarse siempre detrás de HTTPS.

El CRM permite consultar todas las inscripciones, buscar por persona, correo, teléfono o entidad y descargar el conjunto completo en un CSV UTF-8 compatible con Excel. Las credenciales se envían únicamente al iniciar sesión por HTTPS; no se guardan en Web Storage ni se incluyen en las peticiones posteriores. La sesión utiliza una cookie HttpOnly, Secure en producción y SameSite=Strict, con una caducidad absoluta de una hora. El cierre de sesión la revoca en el servidor. Cambiar usuario o contraseña invalida las sesiones existentes. No se usa segundo factor, por decisión del responsable del proyecto.

### Despliegue en Vercel

El proyecto incluye `vercel.json` para servir `/admin` y dirigir las peticiones `/api/*` a la función de Express. Las inscripciones se guardan como objetos JSON privados en Vercel Blob, ya que el sistema de archivos de las funciones de Vercel no es persistente.

Antes de desplegar esta versión:

1. Mantén el almacén **Blob privado** conectado al proyecto.
2. El mismo Blob privado mantiene las sesiones y los contadores bajo `security/v1/`, separados de las inscripciones en `inscripcions/`. No se requiere Redis ni otro servicio. Nunca uses el prefijo `VITE_` para los secretos del servidor.
3. Mantén `ADMIN_USERNAME` y configura `ADMIN_PASSWORD` con una contraseña aleatoria, única, de **al menos 16 caracteres**, preferiblemente 24 o más. Compártela por un canal seguro separado del mensaje de entrega.
4. Configura `APP_ORIGIN=https://www.inscripcionspremicomercbarcelona.cat`. Debe coincidir con el origen canónico, sin barra final. Redirige el dominio sin `www` al canónico en Vercel. Los previews admiten también su `VERCEL_URL` cuando `VERCEL_ENV=preview`; usa credenciales y almacenes separados para pruebas.
5. Despliega el commit nuevo, verifica inicio/cierre de sesión, un envío de prueba y su exportación. El servidor **bloquea envíos y login si Blob falla**, para no funcionar sin protección compartida. Una contraseña de menos de 16 caracteres bloquea el login en producción.

Los tokens de sesión son aleatorios de 256 bits y solo se guarda su hash; los identificadores de los contadores se guardan resumidos mediante SHA-256. Los registros de seguridad tienen una caducidad lógica: la API nunca acepta sesiones vencidas y reinicia las ventanas de los contadores caducados. Los contadores utilizan ETag y escrituras condicionales (`ifMatch`), con reintentos acotados, para no perder incrementos entre instancias. Las lecturas de seguridad omiten la caché. Este sistema genera operaciones adicionales facturables sobre Blob y debe revisarse si aumenta el tráfico. No hay eliminación automática de los objetos de seguridad vencidos: pueden borrarse desde el almacén al finalizar el evento; borrar `security/` revoca las sesiones y reinicia los límites, sin afectar a `inscripcions/`.

Para ejecutar la función de Vercel fuera de la plataforma también se necesita `BLOB_READ_WRITE_TOKEN`. El servidor local utiliza `DATA_DIR`. Solo en desarrollo se usa un almacén de sesiones/límites en memoria y no se necesita Blob. Con `NODE_ENV=production` se requiere Blob para sesiones y límites aunque se ejecute fuera de Vercel. Los archivos `.env` no se cargan automáticamente; configura las variables en el proceso o usa `node --env-file=.env server/index.js`.

## Formulario

Campos del CSV original: nombre, apellido, email, teléfono, acompañante sí/no, nombre y apellido del acompañante (condicionales), entidad/asociación, dirección de la entidad, confirmación de asistencia, asistencia por movilidad reducida y consentimiento. Los metadatos de Elementor no son campos del formulario.

El navegador y la API validan los campos. `POST /api/inscripcions` guarda cada inscripción en `data/inscripcions.jsonl` (una línea JSON por inscripción), incluyendo UUID, fecha y texto de consentimiento. El mensaje **«Inscripció rebuda correctament.»** solo aparece tras una respuesta de guardado correcta. Si falla, se conservan los campos y se permite reintentar. No se envían correos de confirmación.

Los registros se consultan en el CRM protegido; no hay una ruta pública para descargarlos. La carpeta `data/` está excluida de Git. El CSV original de asistentes no se incorpora al repositorio.

## Controles de seguridad y operación

- Límites compartidos: 8 intentos de login por IP y 40 globales por cuenta cada 15 minutos; 20 envíos por IP cada 15 minutos y 5 por correo cada hora. Cuentan también intentos inválidos. Devuelve HTTP 429 y `Retry-After`. El bloqueo global puede afectar temporalmente a usuarios legítimos durante un ataque; permite contener intentos desde múltiples IP.
- Las consultas y exportaciones requieren sesión válida; hay límites adicionales (60 consultas / 10 exportaciones por IP cada 15 minutos). No se admite el antiguo acceso Basic Auth.
- Origen validado, cookies SameSite=Strict, comprobación de Fetch Metadata y JSON obligatorio para operaciones de escritura, incluido login/logout, para evitar peticiones de otros sitios. Las integraciones legítimas deben enviar el `Origin` canónico y JSON.
- Validación del lado servidor, campos de longitud limitada, rechazo de caracteres de control, límite de payload de 16 KB y campo trampa antispam. Estas medidas reducen abuso, pero no sustituyen a un CAPTCHA o al filtrado de ataques distribuidos.
- CSP restrictiva sin scripts inline ni `eval`, bloqueo de iframes, HSTS, `nosniff`, permisos de navegador limitados, APIs sin caché y errores sin detalles internos. Cabeceras también aplicadas por Vercel a los archivos estáticos.
- Neutralización de fórmulas y escapado de comillas, comas y saltos en la exportación CSV. Los CSV descargados contienen datos personales: su custodia corresponde al equipo gestor.
- Eventos de login aceptado/rechazado, cierre y exportación en Runtime Logs, sin credenciales ni datos del formulario. Con una cuenta compartida no se puede atribuir cada acción a una persona. Si necesitáis trazabilidad individual, el siguiente paso es cuentas nominativas / SSO.

Configura en Vercel Firewall alertas y límites en el perímetro, y protege la cuenta de Vercel con MFA y roles mínimos. No se han modificado las opciones de la cuenta de Vercel desde este repositorio. Define el plazo de conservación y elimina/exporta los datos desde el almacén privado cuando termine la finalidad del evento; no hay borrado automático ni copias adicionales configuradas por esta aplicación. Este refuerzo no equivale a una auditoría externa ni a una certificación de seguridad o cumplimiento.

## Comprobaciones

`npm test` comprueba validación, consentimiento, persistencia, cookies de sesión, caducidad, revocación, rotación de credenciales, rechazo de Basic Auth, controles de origen, límites compartidos, actualizaciones concurrentes de Blob con un SDK simulado, fallo cerrado del almacén, payloads grandes, antispam y CSV. `npm run build` verifica Vue y `npm audit --omit=dev` revisa las dependencias de ejecución. Las pruebas locales no sustituyen a comprobar las credenciales reales y el despliegue en Vercel.
