# Seguridad de la API key

- El archivo `.env` es solo para uso local.
- `.env` esta incluido en `.gitignore`, por lo que no debe subirse a GitHub.
- En Render, la clave se carga como Environment Variable.
- El frontend nunca recibe la API key.
- Si una clave fue publicada por error, hay que revocarla en OpenRouter y generar una nueva.

