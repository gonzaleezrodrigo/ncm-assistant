# Publicar en Render

## 1. Subir a GitHub

Subi esta carpeta `ncm-assistant` a un repositorio de GitHub.

No subas el archivo `.env`. Ya esta protegido por `.gitignore`.

## 2. Crear Web Service en Render

1. Entrar a https://render.com
2. New > Web Service
3. Conectar el repositorio de GitHub
4. Configurar:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
```

Si el repositorio contiene solo esta carpeta, dejar Root Directory vacio.

Si el repositorio contiene carpetas extra y `ncm-assistant` esta adentro, poner:

```text
Root Directory: ncm-assistant
```

## 3. Variables de entorno

En Render, entrar a Environment y agregar:

```text
OPENROUTER_API_KEY=tu_clave_openrouter
OPENROUTER_MODEL=openrouter/free
OPENROUTER_SITE_URL=https://tu-url-de-render.onrender.com
OPENROUTER_APP_NAME=Asistente NCM
```

No pongas la API key en el frontend ni en GitHub.

## 4. Probar

Cuando Render termine el deploy, abrir:

```text
https://tu-url-de-render.onrender.com
```

Para diagnosticar IA:

```text
https://tu-url-de-render.onrender.com/api/ai-test
```

Si devuelve `Conexion IA operativa`, esta todo conectado.

## Nota

En plan gratuito, Render puede dormir la app si queda inactiva. La primera consulta despues de un rato puede tardar unos segundos.

