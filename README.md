# Premi Comerç de Barcelona

Landing responsive en catalán realizada con **Vue 3 + Vite**, inspirada en la gráfica de la [web de Comerç de Barcelona](https://ajuntament.barcelona.cat/comerc/ca/tens-un-establiment/premi-comerc-de-barcelona): rojo, fondos claros y sello geométrico vectorial propio.

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
npm start
```

El servidor sirve la web compilada y la API en http://localhost:3001. Se puede configurar `PORT` y `DATA_DIR` mediante variables de entorno. En un alojamiento con contenedores, configura `DATA_DIR` en un volumen persistente. Publica el servidor detrás de HTTPS. GitHub Pages por sí solo no ejecuta esta API; se necesita alojamiento Node.js con almacenamiento persistente.

## Formulario

Campos del CSV original: nombre, apellido, email, teléfono, acompañante sí/no, nombre y apellido del acompañante (condicionales), entidad/asociación, dirección de la entidad, confirmación de asistencia, asistencia por movilidad reducida y consentimiento. Los metadatos de Elementor no son campos del formulario.

El navegador y la API validan los campos. `POST /api/inscripcions` guarda cada inscripción en `data/inscripcions.jsonl` (una línea JSON por inscripción), incluyendo UUID, fecha y texto de consentimiento. El mensaje **«Inscripció rebuda correctament.»** solo aparece tras una respuesta de guardado correcta. Si falla, se conservan los campos y se permite reintentar. No se envían correos de confirmación.

Los registros se consultan directamente en el archivo del servidor; no hay una ruta pública para descargarlos. La carpeta `data/` está excluida de Git. El CSV de asistentes no se incorpora al repositorio. Para uso continuado, realiza copias de seguridad del volumen de datos.

## Comprobaciones

`npm test` comprueba validación, consentimiento, acompañantes condicionales, persistencia y errores de almacenamiento. `npm run build` verifica la compilación de Vue.
