const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const PRICE = /^\s*(₹|Rs\.?|INR|\$|€|£)?\s*\d/;
const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';

const $ = (id) => document.getElementById(id);
const fileInput = $("menuFile");
const drop = $("drop");
const translateButton = $("translateBtn");
const originalPreview = $("originalPreview");
const compareOriginal = $("compareOriginal");
const previewWrap = $("previewWrap");
const removeButton = $("removeImage");
const statusText = $("status");
const translatedImage = $("translatedImage");
const resultContent = $("resultContent");
const emptyState = $("emptyState");
const resultBadge = $("resultBadge");
const downloadButton = $("downloadBtn");
const textRows = $("textRows");
const viewToggle = $("viewToggle");
const viewer = $("viewer");
const promptLabel = drop.querySelector(".drop-prompt");

let selectedFile = null;
let translatedImageUrl = null;
let previewUrl = null;
let session = 0;               // bumps on every translation so stale nutrition replies are ignored
let nutritionCache = new Map();

const selectedLanguage = () => document.querySelector('input[name="language"]:checked').value;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

/* ---------- Photo handling ---------- */
function setFile(file) {
  if (!file) return;
  if (!TYPES.includes(file.type)) return setStatus("Use a JPG, PNG or WebP photo.", true);
  if (file.size > MAX_BYTES) return setStatus("That photo is over 15 MB. Try a smaller one.", true);

  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  originalPreview.src = previewUrl;
  compareOriginal.src = previewUrl;
  previewWrap.classList.remove("hidden");
  promptLabel.classList.add("hidden");
  drop.classList.add("has-file");
  translateButton.disabled = false;
  setStatus("");
}

function clearFile() {
  selectedFile = null;
  fileInput.value = "";
  originalPreview.removeAttribute("src");
  previewWrap.classList.add("hidden");
  promptLabel.classList.remove("hidden");
  drop.classList.remove("has-file", "busy");
  translateButton.disabled = true;
  setStatus("");
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

fileInput.addEventListener("change", () => setFile(fileInput.files[0]));
removeButton.addEventListener("click", clearFile);

["dragenter", "dragover"].forEach((type) =>
  drop.addEventListener(type, () => drop.classList.add("dragging"))
);
["dragleave", "drop"].forEach((type) =>
  drop.addEventListener(type, () => drop.classList.remove("dragging"))
);
// Drop anywhere on the page (and never let the browser navigate away to the image)
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  setFile(e.dataTransfer.files[0]);
});
// Paste a screenshot straight from the clipboard
document.addEventListener("paste", (e) => {
  const image = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
  if (image) setFile(image);
});

document.querySelectorAll('input[name="language"]').forEach((radio) =>
  radio.addEventListener("change", () => {
    if (!resultContent.classList.contains("hidden") && selectedFile) {
      setStatus("Language changed. Press Translate menu to update.");
    }
  })
);

/* ---------- Result view ---------- */
function setView(view) {
  viewToggle.dataset.view = view;
  viewer.dataset.view = view;
  viewToggle.querySelectorAll("button").forEach((b) =>
    b.setAttribute("aria-selected", String(b.dataset.view === view))
  );
}
viewToggle.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-view]");
  if (button) setView(button.dataset.view);
});

function setLoading(loading) {
  translateButton.classList.toggle("loading", loading);
  drop.classList.toggle("busy", loading);
  translateButton.disabled = loading || !selectedFile;
  translateButton.querySelector(".btn-label").textContent = loading ? "Translating…" : "Translate menu";
}

/* ---------- Dishes + inline nutrition ---------- */
function renderDishes(items) {
  textRows.replaceChildren();
  items.forEach((item, i) => {
    const row = document.createElement("tr");
    row.style.setProperty("--i", Math.min(i, 20));
    const original = document.createElement("td");
    const translated = document.createElement("td");
    const action = document.createElement("td");
    action.className = "action";
    original.textContent = item.original;
    translated.textContent = item.translated;

    if (PRICE.test(item.original)) {
      row.classList.add("price");           // prices and numbers have no nutrition
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "nutrition-btn";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", `Nutrition estimate for ${item.original}`);
      button.innerHTML = `Nutrition ${CHEVRON}`;
      button.addEventListener("click", () => toggleDetail(row, item, button));
      action.appendChild(button);
    }
    row.append(original, translated, action);
    textRows.appendChild(row);
  });
}

function closeAll() {
  textRows.querySelectorAll("tr.detail.open").forEach((d) => {
    d.classList.remove("open");
    d.inert = true;
  });
  textRows.querySelectorAll(".nutrition-btn").forEach((b) => b.setAttribute("aria-expanded", "false"));
}

function buildDetail(row) {
  const detail = document.createElement("tr");
  detail.className = "detail";
  detail.inert = true;
  detail.innerHTML = '<td colspan="3"><div class="detail-grid"><div class="detail-inner"><div class="detail-body"></div></div></div></td>';
  row.after(detail);
  return detail;
}

function toggleDetail(row, item, button) {
  const wasOpen = button.getAttribute("aria-expanded") === "true";
  closeAll();
  if (wasOpen) return;

  let detail = row.nextElementSibling;
  if (!detail?.classList.contains("detail")) detail = buildDetail(row);
  button.setAttribute("aria-expanded", "true");
  detail.inert = false;
  void detail.offsetWidth;                  // commit the collapsed state so the open animates
  detail.classList.add("open");
  loadNutrition(item, detail.querySelector(".detail-body"));
}

function showSkeleton(body) {
  const grid = document.createElement("div");
  grid.className = "nutrition-values";
  for (let i = 0; i < 4; i++) {
    const s = document.createElement("div");
    s.className = "stat skel";
    grid.appendChild(s);
  }
  body.replaceChildren(grid);
}

async function loadNutrition(item, body) {
  const key = item.original;
  if (nutritionCache.has(key)) return renderNutrition(body, nutritionCache.get(key));

  const current = session;
  showSkeleton(body);
  try {
    const response = await fetch("/api/nutrition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dish_name: item.original }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Nutrition lookup failed.");
    if (current !== session) return;
    nutritionCache.set(key, data);
    renderNutrition(body, data);
  } catch (error) {
    if (current !== session) return;
    const message = document.createElement("p");
    message.className = "detail-error";
    message.textContent = (error instanceof Error ? error.message : "Nutrition lookup failed.") + " ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "link-button";
    retry.textContent = "Try again";
    retry.addEventListener("click", () => loadNutrition(item, body));
    message.appendChild(retry);
    body.replaceChildren(message);
  }
}

function renderNutrition(body, result) {
  const nutrition = result.nutrition;
  const nodes = [];

  if (nutrition.status === "estimated" && nutrition.data) {
    const d = nutrition.data;
    const grid = document.createElement("div");
    grid.className = "nutrition-values";
    [["Calories", d.calories], ["Protein", d.protein], ["Carbs", d.carbohydrates], ["Fat", d.fat]]
      .forEach(([label, n]) => {
        const stat = document.createElement("div");
        stat.className = "stat";
        const value = document.createElement("b");
        value.textContent = n.value;
        const unit = document.createElement("small");
        unit.textContent = n.unit;
        value.appendChild(unit);
        const name = document.createElement("span");
        name.textContent = label;
        stat.append(value, name);
        grid.appendChild(stat);
      });
    const meta = document.createElement("p");
    meta.className = "detail-meta";
    meta.textContent = `${d.serving} Source: ${d.source}.`;
    nodes.push(grid, meta);
  } else {
    const message = document.createElement("p");
    message.className = "detail-meta";
    message.textContent = nutrition.message || "No estimate is available for this dish.";
    nodes.push(message);
  }

  if (result.allergen_awareness?.message) {
    const note = document.createElement("p");
    note.className = "detail-meta allergen-note";
    note.textContent = result.allergen_awareness.message;
    nodes.push(note);
  }
  body.replaceChildren(...nodes);
}

/* ---------- Translate ---------- */
translateButton.addEventListener("click", async () => {
  if (!selectedFile) return;

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("language", selectedLanguage());

  session++;
  nutritionCache = new Map();
  setLoading(true);
  setStatus("Reading the menu and translating it…");
  resultBadge.textContent = "Translating";
  resultBadge.classList.remove("done");

  try {
    const response = await fetch("/api/translate", { method: "POST", body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Translation failed.");

    translatedImage.src = data.image;
    translatedImageUrl = data.image;
    setView("translated");
    renderDishes(data.items);

    emptyState.classList.add("hidden");
    resultContent.classList.add("hidden");   // re-trigger the entrance animation
    void resultContent.offsetWidth;
    resultContent.classList.remove("hidden");

    resultBadge.textContent = "Ready";
    resultBadge.classList.add("done");
    setStatus("Your translated menu is ready.");

    if (window.matchMedia("(max-width: 850px)").matches) {
      resultContent.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (error) {
    setStatus(
      (error instanceof Error ? error.message : "Translation failed.") + " Check the photo and try again.",
      true
    );
    resultBadge.textContent = "Failed";
  } finally {
    setLoading(false);
  }
});

downloadButton.addEventListener("click", () => {
  if (!translatedImageUrl) return;
  const link = document.createElement("a");
  link.href = translatedImageUrl;
  link.download = "menuly-translated.png";
  link.click();
});