# Перекличка остатков магазина

React + TypeScript приложение для утреннего пересчета остатков. Список товаров берется из `data.txt`, товары разделены по группам, в таблице рядом с каждым товаром вводится количество, а заполненные позиции отправляются в Telegram.

## Команды

```powershell
npm run dev
```

Запускает React-разработку через Vite на `http://localhost:5173`.

```powershell
npm run build
npm start
```

Собирает приложение и запускает Node-сервер на `http://localhost:3000`.

## Telegram

Создайте файл `.env` рядом с `server.js`:

```env
TELEGRAM_BOT_TOKEN=123456789:AA_your_bot_token_here
TELEGRAM_CHAT_ID=123456789
PORT=3000
```

`TELEGRAM_BOT_TOKEN` берется у `@BotFather`. Чтобы узнать `TELEGRAM_CHAT_ID`, напишите боту сообщение и откройте:

```text
https://api.telegram.org/botВАШ_ТОКЕН/getUpdates
```

## Группы в data.txt

Группа пишется в квадратных скобках, товары идут под ней:

```text
[СОМСА]
сомса 10000
сомса 6000

[КУХНЯ]
чебуреки
пирожки с картошкой
```
