function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function sanitize(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function formatQuantity(value) {
  return Number(value || 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 2
  });
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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "Метод не поддерживается" });
    return;
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  const chatId = process.env.TELEGRAM_CHAT_ID || "";

  if (!botToken || !chatId) {
    sendJson(res, 400, {
      ok: false,
      error: "Добавьте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в Environment Variables на Vercel"
    });
    return;
  }

  const text = buildTelegramMessage(req.body || {});

  if (!text) {
    sendJson(res, 400, { ok: false, error: "Отчет пустой" });
    return;
  }

  try {
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
  } catch {
    sendJson(res, 502, { ok: false, error: "Не удалось подключиться к Telegram" });
  }
}
