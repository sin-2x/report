import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(root, "dist");
const publicDir = join(root, "public");
const dataPath = join(root, "data.txt");

loadEnv();

const port = Number(process.env.PORT || 3000);
const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
const chatId = process.env.TELEGRAM_CHAT_ID || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/items") {
      await handleItems(res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/send-report") {
      await handleReport(req, res);
      return;
    }

    if (req.method !== "GET") {
      sendJson(res, 405, { ok: false, error: "Метод не поддерживается" });
      return;
    }

    await serveStatic(url.pathname, res);
  } catch {
    sendJson(res, 500, { ok: false, error: "Ошибка сервера" });
  }
});

server.listen(port, () => {
  console.log(`Report app is running: http://localhost:${port}`);
});

async function handleItems(res) {
  const content = await readFile(dataPath, "utf8").catch(() => "");
  sendJson(res, 200, { ok: true, items: parseItems(content) });
}

async function handleReport(req, res) {
  if (!botToken || !chatId) {
    sendJson(res, 400, {
      ok: false,
      error: "Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в файл .env"
    });
    return;
  }

  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const text = buildTelegramMessage(payload);

  if (!text) {
    sendJson(res, 400, { ok: false, error: "Отчет пустой" });
    return;
  }

  const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true
    })
  });

  const telegramJson = await telegramResponse.json().catch(() => ({}));

  if (!telegramResponse.ok || !telegramJson.ok) {
    sendJson(res, 502, {
      ok: false,
      error: telegramJson.description || "Telegram не принял отчет"
    });
    return;
  }

  sendJson(res, 200, { ok: true });
}

function parseItems(content) {
  const seen = new Set();
  let currentGroup = "Без группы";
  const items = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const bracketGroup = line.match(/^\[(.+)]$/);
    if (bracketGroup) {
      currentGroup = bracketGroup[1].trim();
      continue;
    }

    const unit = /(^|\s)(кг|kg)(\s|$)/i.test(line) ? "кг" : "шт";
    const key = `${currentGroup}::${line}`.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name: line, unit, group: currentGroup });
  }

  return items;
}

function buildTelegramMessage(payload) {
  const date = sanitize(payload.date || new Date().toLocaleDateString("ru-RU"));
  const items = Array.isArray(payload.items) ? payload.items : [];
  const rows = items
    .filter((item) => item && String(item.name || "").trim() && item.quantity !== null && item.quantity !== undefined)
    .map((item) => ({
      name: sanitize(item.name),
      group: sanitize(item.group || "Без группы"),
      quantity: Number(item.quantity),
      unit: sanitize(item.unit || "шт")
    }))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);

  if (!rows.length) return "";

  const grouped = rows.reduce((acc, row) => {
    if (!acc.has(row.group)) acc.set(row.group, []);
    acc.get(row.group).push(row);
    return acc;
  }, new Map());

  const lines = [
    "<b>Проверка остатка в магазине</b>",
    `Дата: <b>${date}</b>`,
    "",
    "<b>Остаток от вчера:</b>"
  ];

  for (const [group, groupRows] of grouped.entries()) {
    lines.push("", `<b>${group}</b>`);
    lines.push(...groupRows.map((item) => `- ${item.name}: <b>${formatQuantity(item.quantity)} ${item.unit}</b>`));
  }

  return lines.join("\n").trim();
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 2
  });
}

async function serveStatic(pathname, res) {
  const staticDir = existsSync(distDir) ? distDir : publicDir;
  const requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const cleanPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(staticDir, cleanPath);

  if (!filePath.startsWith(staticDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const finalPath = existsSync(filePath) ? filePath : join(staticDir, "index.html");
  const content = await readFile(finalPath);
  res.writeHead(200, {
    "Content-Type": mimeTypes[extname(finalPath)] || "application/octet-stream"
  });
  res.end(content);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sanitize(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function loadEnv() {
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
