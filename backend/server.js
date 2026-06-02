const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
loadEnv(path.join(ROOT, ".env"));

const FRONTEND_DIR = path.join(ROOT, "frontend");
const DATA_DIR = path.join(__dirname, "data");
const PORT = Number(process.env.PORT || 3000);

const ncmDb = readJson(path.join(DATA_DIR, "ncm-db.json"));
const testCases = readJson(path.join(DATA_DIR, "test-cases.json"));
const searchIndex = buildSearchIndex(ncmDb);

const MASTER_PROMPT =
  "Sos un asistente especializado en NCM argentina. Analiza el producto, aplica las Reglas Generales Interpretativas del SA y sugiere la posicion a 8 digitos. Aclara siempre que es orientativo y que la clasificacion final es responsabilidad de un despachante matriculado.";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/classify") {
      const body = await readBody(req);
      const payload = JSON.parse(body || "{}");
      const product = String(payload.product || "").trim();

      if (!product) {
        sendJson(res, 400, { error: "Ingrese una descripcion de producto." });
        return;
      }

      const result = await classifyProduct(product);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        localItems: ncmDb.length,
        aiEnabled: Boolean(process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
        aiProvider: getAiProviderName()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ai-test") {
      if (!hasAiProvider()) {
        sendJson(res, 200, {
          ok: false,
          provider: "none",
          message: "No hay API key configurada."
        });
        return;
      }

      try {
        const ai = await classifyWithAi("pelota inflable de futbol para deporte", []);
        sendJson(res, 200, {
          ok: Boolean(ai?.ncm),
          provider: getAiProviderName(),
          model: getConfiguredModel(),
          sampleNcm: ai?.ncm || null,
          message: ai?.ncm ? "Conexion IA operativa." : "La IA respondio, pero no devolvio NCM."
        });
      } catch (error) {
        sendJson(res, 200, {
          ok: false,
          provider: getAiProviderName(),
          model: getConfiguredModel(),
          message: sanitizeError(error.message)
        });
      }
      return;
    }

    serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Error interno del asistente NCM." });
  }
});

server.listen(PORT, () => {
  console.log(`Asistente NCM operativo en http://localhost:${PORT}`);
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("Payload demasiado grande."));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function serveStatic(requestPath, res) {
  const cleanPath = requestPath === "/" ? "/index.html" : decodeURIComponent(requestPath);
  const filePath = path.normalize(path.join(FRONTEND_DIR, cleanPath));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Archivo no encontrado");
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function classifyProduct(product) {
  const normalized = normalize(product);
  const testMatch = findTestCase(normalized);

  if (testMatch) {
    const item = ncmDb.find(row => row.ncm === testMatch.ncm);
    return formatLocalResult(item, product, 100, "caso_obligatorio", []);
  }

  const local = searchLocal(normalized);
  if (local.best && local.best.score >= 40) {
    return formatLocalResult(local.best.item, product, local.best.score, "base_local", local.candidates);
  }

  let aiError = "";
  if (hasAiProvider()) {
    try {
      const ai = await classifyWithAi(product, local.candidates);
      if (ai) return ai;
    } catch (error) {
      aiError = error.message || "No se pudo conectar con el proveedor de IA.";
    }
  }

  if (local.best && local.best.score >= 25) {
    return formatLocalResult(local.best.item, product, local.best.score, "base_local_revision", local.candidates, {
      confidence: "media",
      legalWarning: [
        "Coincidencia local parcial. Validar ficha tecnica, composicion, uso principal y notas legales antes de declarar.",
        aiError ? `La IA configurada no respondio: ${sanitizeError(aiError)}` : ""
      ].filter(Boolean).join(" ")
    });
  }

  return {
    source: "sin_coincidencia",
    product,
    ncm: null,
    descripcionOficial: "No se encontro una coincidencia local suficientemente clara.",
    confidence: "baja",
    score: 0,
    criterio: "La descripcion no alcanzo el umbral minimo de coincidencia en la base local. Para inferencia automatica, configure OPENROUTER_API_KEY, OPENAI_API_KEY o GEMINI_API_KEY en el servidor.",
    rgi: ["RGI 1", "RGI 6"],
    preguntas: [
      "Indicar composicion material porcentual.",
      "Indicar funcion principal y uso declarado.",
      "Adjuntar ficha tecnica, marca/modelo y forma de presentacion."
    ],
    alternativas: local.candidates.map(candidate => ({
      ncm: candidate.item.ncm,
      descripcion: candidate.item.descripcionOficial,
      score: candidate.score
    })),
    advertencias: [
      "Resultado orientativo. La clasificacion final debe ser validada por un despachante de aduana matriculado.",
      "No se genero una posicion ficticia.",
      aiError ? `La IA configurada no respondio: ${sanitizeError(aiError)}` : "La IA no esta configurada o no devolvio una respuesta util."
    ]
  };
}

function findTestCase(normalizedText) {
  return testCases.find(testCase => {
    const phrases = [testCase.input, ...(testCase.matchPhrases || [])].map(normalize);
    return phrases.some(phrase => normalizedText.includes(phrase));
  });
}

function buildSearchIndex(items) {
  return items.map(item => {
    const keywordText = (item.keywords || []).join(" ");
    const questionText = (item.preguntas || []).join(" ");
    return {
      item,
      normalizedDescription: normalize(item.descripcionOficial),
      normalizedKeywords: (item.keywords || []).map(normalize),
      tokenSet: new Set(tokenize(`${item.descripcionOficial} ${keywordText} ${questionText} ${item.capitulo || ""}`))
    };
  });
}

function searchLocal(normalizedText) {
  const queryTokens = tokenize(normalizedText);
  const querySet = new Set(queryTokens);

  const candidates = searchIndex
    .map(entry => {
      let score = 0;
      const reasons = [];

      for (const keyword of entry.normalizedKeywords) {
        if (!keyword) continue;
        const keywordTokens = tokenize(keyword);
        const phraseWeight = keywordTokens.length > 1 ? 22 : 16;

        if (normalizedText.includes(keyword)) {
          score += phraseWeight;
          reasons.push(keyword);
        } else if (keywordTokens.every(token => querySet.has(token))) {
          score += Math.max(8, phraseWeight - 5);
          reasons.push(keyword);
        }
      }

      for (const token of querySet) {
        if (entry.tokenSet.has(token)) score += 5;
      }

      if (entry.normalizedDescription.includes(normalizedText) && normalizedText.length > 5) {
        score += 20;
      }

      const cappedScore = Math.min(100, score);
      return { item: entry.item, score: cappedScore, reasons: [...new Set(reasons)].slice(0, 6) };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { best: candidates[0] || null, candidates };
}

function formatLocalResult(item, product, score, source, candidates, overrides = {}) {
  const confidence = overrides.confidence || (score >= 80 ? "alta" : score >= 40 ? "media" : "baja");
  const warnings = [
    ...(item.advertencias || []),
    overrides.legalWarning || "Resultado orientativo. La clasificacion final es responsabilidad de un despachante de aduana matriculado."
  ];

  return {
    source,
    product,
    ncm: item.ncm,
    descripcionOficial: item.descripcionOficial,
    capitulo: item.capitulo,
    confidence,
    score,
    criterio: item.criterio,
    rgi: item.rgi || ["RGI 1", "RGI 6"],
    preguntas: item.preguntas || [],
    alternativas: (candidates || [])
      .filter(candidate => candidate.item.ncm !== item.ncm)
      .slice(0, 3)
      .map(candidate => ({
        ncm: candidate.item.ncm,
        descripcion: candidate.item.descripcionOficial,
        score: candidate.score
      })),
    advertencias: warnings
  };
}

function hasAiProvider() {
  return Boolean(getOpenRouterKey() || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}

async function classifyWithAi(product, candidates) {
  if (getOpenRouterKey()) return classifyWithOpenRouter(product, candidates);
  if (process.env.OPENAI_API_KEY) return classifyWithOpenAI(product, candidates);
  if (process.env.GEMINI_API_KEY) return classifyWithGemini(product, candidates);
  return null;
}

function getAiProviderName() {
  if (getOpenRouterKey()) return "openrouter";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return "none";
}

function getOpenRouterKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  if ((process.env.OPENAI_API_KEY || "").startsWith("sk-or-v1-")) return process.env.OPENAI_API_KEY;
  return "";
}

function sanitizeError(message) {
  return String(message || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[api-key]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [api-key]")
    .slice(0, 260);
}

function getConfiguredModel() {
  if (getOpenRouterKey()) return process.env.OPENROUTER_MODEL || "openrouter/free";
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_MODEL || "gemini-1.5-flash";
  return "";
}

async function classifyWithOpenRouter(product, candidates) {
  const model = process.env.OPENROUTER_MODEL || "openrouter/free";
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${getOpenRouterKey()}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3000",
      "X-Title": process.env.OPENROUTER_APP_NAME || "Asistente NCM"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        { role: "system", content: `${MASTER_PROMPT} Responde exclusivamente JSON valido, sin markdown.` },
        { role: "user", content: buildAiPrompt(product, candidates) }
      ]
    })
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || json.message || `OpenRouter error ${response.status}`;
    throw new Error(message);
  }

  const content = json.choices?.[0]?.message?.content;
  return normalizeAiResult(content, product, "openrouter");
}

async function classifyWithOpenAI(product, candidates) {
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${MASTER_PROMPT} Responde exclusivamente JSON valido.` },
        { role: "user", content: buildAiPrompt(product, candidates) }
      ]
    })
  });

  if (!response.ok) throw new Error(`OpenAI error ${response.status}`);
  const json = await response.json();
  const content = json.choices?.[0]?.message?.content;
  return normalizeAiResult(content, product, "openai");
}

async function classifyWithGemini(product, candidates) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${MASTER_PROMPT}\nResponde exclusivamente JSON valido.\n${buildAiPrompt(product, candidates)}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    })
  });

  if (!response.ok) throw new Error(`Gemini error ${response.status}`);
  const json = await response.json();
  const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
  return normalizeAiResult(content, product, "gemini");
}

function buildAiPrompt(product, candidates) {
  return JSON.stringify({
    producto: product,
    candidatosLocales: candidates.map(candidate => ({
      ncm: candidate.item.ncm,
      descripcion: candidate.item.descripcionOficial,
      score: candidate.score
    })),
    formatoRequerido: {
      ncm: "0000.00.00",
      descripcionOficial: "texto",
      confidence: "alta|media|baja",
      criterio: "texto breve con RGI aplicadas",
      rgi: ["RGI 1", "RGI 6"],
      preguntas: ["texto"],
      alternativas: [{ ncm: "0000.00.00", descripcion: "texto" }],
      advertencias: ["texto legal orientativo"]
    }
  });
}

function normalizeAiResult(content, product, source) {
  if (!content) return null;
  const parsed = parseJsonContent(content);
  return {
    source,
    product,
    ncm: parsed.ncm || null,
    descripcionOficial: parsed.descripcionOficial || "Clasificacion sugerida por IA.",
    confidence: parsed.confidence || "baja",
    score: null,
    criterio: parsed.criterio || "Inferencia orientativa basada en descripcion del usuario y Reglas Generales Interpretativas.",
    rgi: parsed.rgi || ["RGI 1", "RGI 6"],
    preguntas: parsed.preguntas || [],
    alternativas: parsed.alternativas || [],
    advertencias: [
      ...(parsed.advertencias || []),
      "Resultado orientativo generado por IA. La clasificacion final es responsabilidad de un despachante de aduana matriculado."
    ]
  };
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  try {
    return JSON.parse(text);
    } catch {
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1].trim());

    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }

    throw new Error("La IA no devolvio JSON valido.");
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.,;:()/"'`´]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value) {
  const stopWords = new Set(["con", "sin", "para", "por", "del", "las", "los", "una", "uno", "unos", "unas", "de", "la", "el", "y", "o"]);
  return normalize(value)
    .split(" ")
    .map(token => token.trim())
    .filter(token => token.length > 2 && !stopWords.has(token));
}
