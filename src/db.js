const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'masofly.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
db.exec(schemaSql);

// Boshlang'ich namunaviy vakansiyalar (agar baza bo'sh bo'lsa)
const count = db.prepare('SELECT COUNT(*) AS cnt FROM jobs').get().cnt;
if (count === 0) {
  const insertJob = db.prepare(`
    INSERT INTO jobs (title, company, category, budget, budget_label, is_remote, is_junior, tags, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedJobs = [
    [
      'Next.js & Tailwind CSS Landing Sahifa Yasash',
      'FinTech Startap • Toshkent',
      'Dasturlash',
      350,
      '$350 • Loyiha',
      1,
      0,
      JSON.stringify(['React', 'Next.js', 'Tailwind', 'Responsive']),
      "Yangi to'lov ilovasi uchun tezkor va mobilga mos landing sahifa kerak."
    ],
    [
      "Telegram Mini App & To'lov Boti (Node.js)",
      'EduMarket • Masofaviy',
      'Telegram Bot',
      450,
      '$450 • Loyiha',
      1,
      0,
      JSON.stringify(['Node.js', 'Telegram Bot', 'WebApp', 'SQLite']),
      "Kurslar sotiladigan Telegram Mini App katalogi va admin paneli kerak."
    ],
    [
      'SaaS Dashboard uchun UI/UX Dizayn (Figma)',
      'CloudMetrics • Masofaviy',
      'UI/UX Dizayn',
      280,
      '$280 • Loyiha',
      1,
      1,
      JSON.stringify(['Figma', 'UI/UX', 'Design System', 'Dark Mode']),
      "Analitika platformasi uchun 8 ta asosiy ekranning light/dark dizayni kerak."
    ]
  ];

  db.exec('BEGIN');
  try {
    for (const row of seedJobs) insertJob.run(...row);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = db;
