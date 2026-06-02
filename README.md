# Asistente de Clasificacion Arancelaria NCM

Aplicacion web para sugerir posiciones NCM a 8 digitos a partir de una descripcion de producto.

## Como correr

1. Abrir una terminal en esta carpeta.
2. Ejecutar:

```bash
npm start
```

3. Entrar en el navegador a:

```text
http://localhost:3000
```

No requiere instalar dependencias externas.

## Publicar en internet

La guia paso a paso esta en `DEPLOY_RENDER.md`.

Resumen:

- Subir esta carpeta a GitHub.
- Crear un Web Service en Render.
- Usar `npm install` como Build Command.
- Usar `npm start` como Start Command.
- Cargar `OPENROUTER_API_KEY` como Environment Variable en Render.

## IA opcional

La aplicacion siempre intenta resolver primero con la base local `backend/data/ncm-db.json`.

Si no encuentra una coincidencia clara y queres activar IA:

1. Abrir el archivo `.env`.
2. Pegar `OPENROUTER_API_KEY`, `OPENAI_API_KEY` o `GEMINI_API_KEY`.
3. Reiniciar el servidor.

Para OpenRouter:

```env
OPENROUTER_API_KEY=sk-or-v1-tu_clave
OPENROUTER_MODEL=openrouter/free
```

Si pegaste una clave `sk-or-v1...` en `OPENAI_API_KEY`, el backend tambien la detecta como OpenRouter.

Prompt maestro usado:

```text
Sos un asistente especializado en NCM argentina. Analiza el producto, aplica las Reglas Generales Interpretativas del SA y sugiere la posicion a 8 digitos. Aclara siempre que es orientativo y que la clasificacion final es responsabilidad de un despachante matriculado.
```

## Como escalar la base NCM

Para una base productiva, mantener `ncm-db.json` como fuente inicial y migrar luego a SQLite o PostgreSQL con estas tablas:

- `ncm_items`: codigo, descripcion oficial, capitulo, partida, subpartida.
- `keywords`: terminos, sinonimos y pesos por NCM.
- `legal_notes`: notas de seccion, capitulo y observaciones legales.
- `rgi_rules`: reglas interpretativas aplicables.
- `classification_cases`: casos historicos validados por un despachante.

El buscador local ya esta preparado para indexar palabras clave y descripciones, por lo que se puede reemplazar el JSON por una consulta SQL sin cambiar el frontend.
