# Masofly — Node.js + Telegram Bot + SQLite Arxitekturasi

## Tuzilma
- `public/index.html` — Masofly interfeysi (veb-sayt va Telegram Mini App)
- `src/server.js` — Express REST API (`/api/jobs`, `/api/jobs/:id/apply`, `/api/auth/telegram`)
- `src/bot.js` — Telegraf Telegram bot (`/start`, `/jobs`, `/notify` va yangi vakansiyalar bildirishnomasi)
- `src/db.js` — `better-sqlite3` ulanishi va boshlang'ich vakansiyalar
- `schema.sql` — `users`, `jobs`, `applications`, `saved_jobs` jadvallari (PostgreSQL'ga ham mos)

## Ishga tushirish
1. Bog'liqliklarni o'rnating:
   ```bash
   npm install
   ```
2. `.env.example` faylidan `.env` nusxa oling va `@BotFather`dan olingan `BOT_TOKEN`ni kiriting:
   ```bash
   cp .env.example .env
   ```
3. Serverni ishga tushiring:
   ```bash
   npm start
   ```
   Sayt `http://localhost:3000` manzilida ochiladi.
