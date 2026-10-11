const storageKey = "morning-stock-rollcall-v1";
const fallbackItems = [
  { name: "сомса 6000", unit: "шт" },
  { name: "булочка", unit: "шт" },
  { name: "лепешка", unit: "шт" }
];

const state = {
  date: "",
  location: "Магазин",
  responsible: "",
  items: []
};

const form = document.querySelector("#reportForm");
const itemsList = document.querySelector("#itemsList");
const template = document.querySelector("#itemTemplate");
const search = document.querySelector("#search");
const preview = document.querySelector("#preview");
const statusBox = document.querySelector("#status");

init();

async function init() {
  const saved = loadState();
  const products = await loadProducts();
  const baseItems = products.length ? products : fallbackItems;

  Object.assign(state, {
    ...state,
    ...saved,
    items: mergeItems(baseItems, saved.items || [])
  });

  document.querySelector("#date").value = state.date || today();
  document.querySelector("#location").value = state.location || "Магазин";
  document.querySelector("#responsible").value = state.responsible || "";

  bindEvents();
  renderItems();
  updatePreview();
}

function bindEvents() {
  form.addEventListener("input", () => {
    saveDetails();
    updatePreview();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await sendReport();
  });

  search.addEventListener("input", renderItems);

  document.querySelector("#clearQuantities").addEventListener("click", () => {
    state.items = state.items.map((item) => ({ ...item, quantity: "" }));
    saveState();
    renderItems();
    updatePreview();
    setStatus("Все количества очищены", "success");
  });

  document.querySelector("#copyReport").addEventListener("click", async () => {
    await navigator.clipboard.writeText(makePlainReport());
    setStatus("Отчет скопирован", "success");
  });
}

async function loadProducts() {
  try {
    const response = await fetch("/api/items");
    const result = await response.json();
    return result.ok && Array.isArray(result.items) ? result.items : [];
  } catch {
    setStatus("Не удалось загрузить товары из data.txt", "error");
    return [];
  }
}

function mergeItems(baseItems, savedItems) {
  const savedByName = new Map(savedItems.map((item) => [normalize(item.name), item]));
  return baseItems.map((item) => {
    const saved = savedByName.get(normalize(item.name));
    return {
      id: saved?.id || crypto.randomUUID(),
      name: item.name,
      unit: item.unit || "шт",
      quantity: saved?.quantity ?? ""
    };
  });
}

function renderItems() {
  const query = normalize(search.value);
  itemsList.innerHTML = "";

  state.items.forEach((item, index) => {
    if (query && !normalize(item.name).includes(query)) return;

    const row = template.content.firstElementChild.cloneNode(true);
    const name = row.querySelector(".product-name");
    const quantity = row.querySelector(".product-quantity");
    const unit = row.querySelector(".product-unit");

    row.classList.toggle("is-filled", Number(item.quantity || 0) > 0);
    name.textContent = item.name;
    quantity.value = item.quantity;
    unit.textContent = item.unit || "шт";

    quantity.addEventListener("input", () => {
      const value = cleanQuantity(quantity.value);
      updateItem(index, { quantity: value });
      quantity.value = value;
      row.classList.toggle("is-filled", Number(value || 0) > 0);
    });

    itemsList.append(row);
  });

  updateCounters();
}

function updateItem(index, patch) {
  state.items[index] = { ...state.items[index], ...patch };
  saveState();
  updatePreview();
  updateCounters();
}

function saveDetails() {
  state.date = document.querySelector("#date").value;
  state.location = document.querySelector("#location").value.trim();
  state.responsible = document.querySelector("#responsible").value.trim();
  saveState();
}

function collectReport() {
  saveDetails();
  return {
    date: formatDate(state.date),
    location: state.location || "Магазин",
    responsible: state.responsible || "Не указано",
    items: state.items
      .map((item) => ({
        name: item.name.trim(),
        quantity: Number(item.quantity || 0),
        unit: item.unit || "шт"
      }))
      .filter((item) => item.name && item.quantity > 0)
  };
}

function makePlainReport() {
  const report = collectReport();
  const lines = [
    "Проверка остатка в магазине",
    `Дата: ${report.date}`,
    `Магазин: ${report.location}`,
    `Сотрудник: ${report.responsible}`,
    "",
    "Остаток от вчера:"
  ];

  if (!report.items.length) {
    lines.push("- пока ничего не заполнено");
  } else {
    lines.push(...report.items.map((item) => `- ${item.name}: ${item.quantity} ${item.unit}`));
  }

  return lines.join("\n");
}

function updatePreview() {
  preview.textContent = makePlainReport();
}

function updateCounters() {
  const filled = state.items.filter((item) => Number(item.quantity || 0) > 0).length;
  document.querySelector("#itemsCount").textContent = `${state.items.length} товаров`;
  document.querySelector("#visibleCount").textContent = `${itemsList.children.length} показано`;
  document.querySelector("#filledCount").textContent = `${filled} заполнено`;
}

async function sendReport() {
  const report = collectReport();

  if (!report.items.length) {
    setStatus("Введите количество хотя бы у одного товара", "error");
    return;
  }

  setStatus("Отправляю в Telegram...", "");

  try {
    const response = await fetch("/api/send-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report)
    });
    const result = await response.json();

    if (!response.ok || !result.ok) {
      throw new Error(result.error || "Не удалось отправить отчет");
    }

    setStatus("Отчет отправлен в Telegram", "success");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function saveState() {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}");
  } catch {
    return {};
  }
}

function cleanQuantity(value) {
  if (value === "") return "";
  return String(Math.max(0, Math.floor(Number(value || 0))));
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("ru-RU");
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString("ru-RU");
  return new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU");
}

function setStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = `status ${type || ""}`.trim();
}
