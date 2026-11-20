const { Telegraf, Markup } = require('telegraf');
const db = require('./db');

const token = process.env.BOT_TOKEN;
const webAppUrl = process.env.WEBAPP_URL || '';
const isHttpsWebApp = /^https:\/\//i.test(webAppUrl);

let bot = null;

function buildWebAppKeyboard(extraRows = []) {
  const rows = [];
  if (isHttpsWebApp) {
    rows.push([Markup.button.webApp('🚀 Masofly Mini Appni ochish', webAppUrl)]);
  }
  rows.push(...extraRows);
  return rows.length ? Markup.inlineKeyboard(rows) : undefined;
}

function initBot() {
  if (!token || token.includes('YOUR_TELEGRAM_BOT_TOKEN')) {
    console.log('[Bot] BOT_TOKEN kiritilmagan — bot rejimi o‘chiq (faqat API ishlaydi).');
    return null;
  }

  bot = new Telegraf(token);
  bot.catch((err) => {
    console.error('[Bot Xatolik]', err.message || err);
  });

  bot.start(async (ctx) => {
    const tgUser = ctx.from;
    const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');

    db.prepare(`
      INSERT INTO users (telegram_id, username, full_name)
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        full_name = excluded.full_name
    `).run(String(tgUser.id), tgUser.username || null, fullName);

    const localHint = isHttpsWebApp
      ? "Quyidagi tugma orqali Mini App'ni oching yoki /jobs buyrug'i bilan so'nggi e'lonlarni ko'ring."
      : "So'nggi e'lonlarni ko'rish uchun /jobs buyrug'ini bosing (Mini App tugmasi uchun HTTPS domen kerak).";

    await ctx.reply(
      `Salom, ${tgUser.first_name}! 👋\n\n` +
      `Masofly — O'zbekistondagi IT, dizayn va masofaviy freelance ishlar platformasi.\n` +
      localHint,
      buildWebAppKeyboard([[Markup.button.callback('📋 So‘nggi vakansiyalar', 'LATEST_JOBS')]])
    );
  });

  bot.command('jobs', (ctx) => sendLatestJobs(ctx));
  bot.action('LATEST_JOBS', async (ctx) => {
    await ctx.answerCbQuery();
    return sendLatestJobs(ctx);
  });

  bot.command('notify', (ctx) => {
    const tgId = String(ctx.from.id);
    const user = db.prepare('SELECT notify_enabled FROM users WHERE telegram_id = ?').get(tgId);
    const next = user && user.notify_enabled ? 0 : 1;
    db.prepare('UPDATE users SET notify_enabled = ? WHERE telegram_id = ?').run(next, tgId);
    ctx.reply(next ? '🔔 Yangi vakansiyalar haqida bildirishnomalar yoqildi.' : '🔕 Bildirishnomalar o‘chirildi.');
  });

  bot.launch().then(() => {
    console.log(`[Bot] Masofly Telegram bot ishga tushdi. (Mini App HTTPS: ${isHttpsWebApp ? 'ha' : "yo'q - lokal rejim"})`);
  });
  return bot;
}

function sendLatestJobs(ctx) {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'open' ORDER BY id DESC LIMIT 5").all();
  if (!jobs.length) return ctx.reply('Hozircha ochiq vakansiyalar yo‘q.');

  const text = jobs.map((j, i) =>
    `${i + 1}. <b>${j.title}</b>\n💰 ${j.budget_label} • 🏷 ${j.category}`
  ).join('\n\n');

  const extra = isHttpsWebApp ? { ...Markup.inlineKeyboard([[Markup.button.webApp('Barchasini ko‘rish', webAppUrl)]]) } : {};
  return ctx.replyWithHTML(`🔥 <b>So'nggi 5 ta vakansiya:</b>\n\n${text}`, extra);
}

async function broadcastNewJob(job) {
  if (!bot) return;
  const subscribers = db.prepare('SELECT telegram_id FROM users WHERE notify_enabled = 1').all();
  const msg = `🆕 <b>Yangi vakansiya!</b>\n\n<b>${job.title}</b>\n🏢 ${job.company}\n💰 ${job.budget_label}\n🏷 ${job.category}`;
  const extra = isHttpsWebApp ? Markup.inlineKeyboard([[Markup.button.webApp('1-klikda topshirish', webAppUrl)]]) : {};

  for (const sub of subscribers) {
    try {
      await bot.telegram.sendMessage(sub.telegram_id, msg, { parse_mode: 'HTML', ...extra });
    } catch (_) {}
  }
}

module.exports = { initBot, broadcastNewJob };
