const MAX_BYTES = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

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
const nutritionCards = $("nutritionCards");
const nutritionState = $("nutritionState");
const allergenCards = $("allergenCards");
const viewToggle = $("viewToggle");
const viewer = $("viewer");
const promptLabel = drop.querySelector(".drop-prompt");

let selectedFile = null;
let translatedImageUrl = null;
let previewUrl = null;

const selectedLanguage = () => document.querySelector('input[name="language"]:checked').value;

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

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
  drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add("dragging"); })
);
["dragleave", "drop"].forEach((type) =>
  drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove("dragging"); })
);
drop.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

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
  if (loading) {
    nutritionState.textContent = "Loading nutrition estimates…";
    nutritionCards.replaceChildren();
    allergenCards.replaceChildren();
  }
}

function renderNutrition(items) {
  nutritionCards.replaceChildren();
  allergenCards.replaceChildren();
  const available = items.filter((item) => item.nutrition?.status === "estimated");
  nutritionState.textContent = available.length
    ? "Values are approximate and may not reflect the restaurant's recipe or portion."
    : "Nutrition estimates are unavailable for the detected dishes.";

  items.forEach((item) => {
    const nutrition = item.nutrition || {};
    if (nutrition.status === "not_applicable") return;

    const card = document.createElement("article");
    card.className = "nutrition-card";
    const title = document.createElement("h4");
    title.textContent = item.original;
    card.appendChild(title);

    if (nutrition.status === "estimated" && nutrition.data) {
      const values = document.createElement("div");
      values.className = "nutrition-values";
      [
        ["Calories", nutrition.data.calories],
        ["Protein", nutrition.data.protein],
        ["Carbohydrates", nutrition.data.carbohydrates],
        ["Total fat", nutrition.data.fat],
      ].forEach(([label, nutrient]) => {
        const value = document.createElement("span");
        const labelElement = document.createElement("strong");
        labelElement.textContent = label;
        value.append(labelElement, document.createElement("br"));
        value.append(`${nutrient.value} ${nutrient.unit}`);
        values.appendChild(value);
      });
      card.appendChild(values);

      const serving = document.createElement("p");
      serving.className = "nutrition-meta";
      serving.textContent = `${nutrition.data.serving} Source: ${nutrition.data.source}.`;
      card.appendChild(serving);
    } else {
      const unavailable = document.createElement("p");
      unavailable.className = "nutrition-meta";
      unavailable.textContent = nutrition.message || "No estimate available.";
      card.appendChild(unavailable);
    }

    nutritionCards.appendChild(card);

    const allergenCard = document.createElement("article");
    allergenCard.className = "allergen-card";
    const allergenTitle = document.createElement("strong");
    allergenTitle.textContent = item.original;
    const allergenMessage = document.createElement("p");
    allergenMessage.textContent = item.allergen_awareness?.message ||
      "Allergen information was not assessed.";
    allergenCard.append(allergenTitle, allergenMessage);
    allergenCards.appendChild(allergenCard);
  });
}

translateButton.addEventListener("click", async () => {
  if (!selectedFile) return;

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("language", selectedLanguage());

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

    textRows.replaceChildren();
    data.items.forEach((item, i) => {
      const row = document.createElement("tr");
      row.style.setProperty("--i", Math.min(i, 20));
      const originalCell = document.createElement("td");
      const translatedCell = document.createElement("td");
      originalCell.textContent = item.original;
      translatedCell.textContent = item.translated;
      row.append(originalCell, translatedCell);
      textRows.appendChild(row);
    });
    renderNutrition(data.items);

    emptyState.classList.add("hidden");
    // re-trigger the entrance animation on every new result
    resultContent.classList.add("hidden");
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