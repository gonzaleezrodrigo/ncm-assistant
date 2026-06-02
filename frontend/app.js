const input = document.querySelector("#productInput");
const classifyButton = document.querySelector("#classifyButton");
const clearButton = document.querySelector("#clearButton");
const loader = document.querySelector("#loader");
const resultPanel = document.querySelector("#resultPanel");
const healthBadge = document.querySelector("#healthBadge");

const fields = {
  resultTitle: document.querySelector("#resultTitle"),
  confidenceBadge: document.querySelector("#confidenceBadge"),
  ncmCode: document.querySelector("#ncmCode"),
  ncmDescription: document.querySelector("#ncmDescription"),
  criteriaText: document.querySelector("#criteriaText"),
  rgiText: document.querySelector("#rgiText"),
  questionsList: document.querySelector("#questionsList"),
  alternativesList: document.querySelector("#alternativesList"),
  warningsList: document.querySelector("#warningsList")
};

document.querySelectorAll("[data-case]").forEach(button => {
  button.addEventListener("click", () => {
    input.value = button.dataset.case;
    input.focus();
    classify();
  });
});

classifyButton.addEventListener("click", classify);
clearButton.addEventListener("click", () => {
  input.value = "";
  resultPanel.classList.add("hidden");
  input.focus();
});

input.addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    classify();
  }
});

checkHealth();

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const health = await response.json();
    const provider = health.aiProvider && health.aiProvider !== "none" ? ` (${health.aiProvider})` : "";
    healthBadge.textContent = `${health.localItems} posiciones locales · IA ${health.aiEnabled ? `activa${provider}` : "opcional"}`;
  } catch {
    healthBadge.textContent = "Servidor no disponible";
  }
}

async function classify() {
  const product = input.value.trim();
  if (!product) {
    input.focus();
    return;
  }

  setLoading(true);

  try {
    const response = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo clasificar el producto.");

    renderResult(result);
  } catch (error) {
    renderError(error.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(value) {
  classifyButton.disabled = value;
  loader.classList.toggle("active", value);
}

function renderResult(result) {
  resultPanel.classList.remove("hidden");
  fields.resultTitle.textContent = result.ncm ? "Posicion NCM sugerida" : "Clasificacion no concluyente";
  fields.ncmCode.textContent = result.ncm || "Sin NCM";
  fields.ncmDescription.textContent = result.descripcionOficial || "-";
  fields.criteriaText.textContent = result.criterio || "-";
  fields.rgiText.textContent = Array.isArray(result.rgi) ? result.rgi.join(" · ") : "-";

  const confidence = result.confidence || "baja";
  fields.confidenceBadge.className = `confidence ${confidence}`;
  fields.confidenceBadge.textContent = `Confianza ${confidence}${result.score !== null && result.score !== undefined ? ` · ${result.score}%` : ""}`;

  renderList(fields.questionsList, result.preguntas, "No se requieren datos adicionales para una orientacion inicial.");
  renderAlternatives(result.alternativas || []);
  renderList(fields.warningsList, result.advertencias, "Resultado orientativo. Validar con despachante matriculado.");

  resultPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderError(message) {
  renderResult({
    ncm: null,
    descripcionOficial: "No se pudo completar la consulta.",
    confidence: "baja",
    score: 0,
    criterio: message,
    rgi: ["RGI 1", "RGI 6"],
    preguntas: ["Reintentar la consulta o revisar el servidor."],
    alternativas: [],
    advertencias: ["La herramienta no reemplaza la intervencion profesional de un despachante matriculado."]
  });
}

function renderList(element, items, fallback) {
  element.innerHTML = "";
  const safeItems = Array.isArray(items) && items.length ? items : [fallback];

  safeItems.forEach(item => {
    const li = document.createElement("li");
    li.textContent = String(item);
    element.appendChild(li);
  });
}

function renderAlternatives(alternatives) {
  fields.alternativesList.innerHTML = "";

  if (!alternatives.length) {
    const li = document.createElement("li");
    li.textContent = "Sin alternativas relevantes en el umbral local.";
    fields.alternativesList.appendChild(li);
    return;
  }

  alternatives.forEach(alt => {
    const li = document.createElement("li");
    const score = alt.score !== undefined ? ` · ${alt.score}%` : "";
    li.textContent = `${alt.ncm || "NCM a validar"} - ${alt.descripcion || "Alternativa sugerida"}${score}`;
    fields.alternativesList.appendChild(li);
  });
}
