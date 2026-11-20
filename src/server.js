require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const db = require('./db');
const { initBot, broadcastNewJob } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SECRET = process.env.AUTH_SECRET || process.env.BOT_TOKEN || 'masofly-dev-secret-change-me';

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parol xeshlash (qo'shimcha paketlarsiz Node crypto.scryptSync)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  return keyBuf.length === derived.length && crypto.timingSafeEqual(keyBuf, derived);
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, email: user.email, role: user.role, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.exp && data.exp < Date.now()) return null;
  return data;
}

function sanitizeUser(u) {
  if (!u) return null;
  return { id: u.id, full_name: u.full_name, email: u.email, username: u.username, role: u.role };
}

// Telegram WebApp initData HMAC tekshiruvi
function verifyTelegramWebAppData(initData) {
  const botToken = process.env.BOT_TOKEN;
  if (!botToken || !initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (calculatedHash !== hash) return null;
  return JSON.parse(params.get('user') || 'null');
}

// --- AUTH ROUTES ---
app.post('/api/auth/register', (req, res) => {
  const { full_name, email, password, role = 'freelancer', username = '' } = req.body;
  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Ism, email va parol kiritilishi shart.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Parol kamida 6 ta belgidan iborat bo‘lishi kerak.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) {
    return res.status(409).json({ error: 'Bu email bilan foydalanuvchi allaqachon ro‘yxatdan o‘tgan.' });
  }

  const safeRole = role === 'employer' ? 'employer' : 'freelancer';
  const passHash = hashPassword(password);
  const cleanTg = username ? String(username).replace(/^@/, '').trim() : null;

  const info = db.prepare(`
    INSERT INTO users (full_name, email, password_hash, role, username)
    VALUES (?, ?, ?, ?, ?)
  `).run(full_name.trim(), normalizedEmail, passHash, safeRole, cleanTg);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = createToken(user);
  res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email va parolni kiriting.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email yoki parol noto‘g‘ri.' });
  }

  const token = createToken(user);
  res.json({ token, user: sanitizeUser(user) });
});

app.get('/api/auth/me', (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const decoded = verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Avtorizatsiya talab qilinadi.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.id);
  if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi.' });
  res.json({ user: sanitizeUser(user) });
});

app.post('/api/auth/telegram', (req, res) => {
  const tgUser = verifyTelegramWebAppData(req.body.initData);
  if (!tgUser) return res.status(401).json({ error: 'Telegram imzosi yaroqsiz.' });

  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  db.prepare(`
    INSERT INTO users (telegram_id, username, full_name)
    VALUES (?, ?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, full_name = excluded.full_name
  `).run(String(tgUser.id), tgUser.username || null, fullName);

  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(tgUser.id));
  res.json({ ok: true, token: createToken(user), user: sanitizeUser(user) });
});

// --- JOBS ROUTES ---
app.get('/api/jobs', (req, res) => {
  const { category, q, remote, junior } = req.query;
  let sql = "SELECT * FROM jobs WHERE status = 'open'";
  const params = [];

  if (category && category !== 'all') {
    sql += ' AND category = ?';
    params.push(category);
  }
  if (remote === 'true') sql += ' AND is_remote = 1';
  if (junior === 'true') sql += ' AND is_junior = 1';
  if (q) {
    sql += ' AND (title LIKE ? OR company LIKE ? OR tags LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params).map((r) => ({
    ...r,
    remote: Boolean(r.is_remote),
    junior: Boolean(r.is_junior),
    tags: JSON.parse(r.tags || '[]')
  }));

  res.json({ jobs: rows });
});

app.post('/api/jobs', async (req, res) => {
  const { title, company, category, budget, remote = true, junior = false, tags = [], description } = req.body;
  if (!title || !company || !category || !budget || !description) {
    return res.status(400).json({ error: 'Barcha majburiy maydonlarni to‘ldiring.' });
  }

  const budgetNum = Number(budget);
  const budgetLabel = `$${budgetNum} • Loyiha`;

  const info = db.prepare(`
    INSERT INTO jobs (title, company, category, budget, budget_label, is_remote, is_junior, tags, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, company, category, budgetNum, budgetLabel, remote ? 1 : 0, junior ? 1 : 0, JSON.stringify(tags), description);

  const created = db.prepare('SELECT * FROM jobs WHERE id = ?').get(info.lastInsertRowid);
  broadcastNewJob(created).catch(() => {});

  res.status(201).json({ job: { ...created, tags } });
});

app.post('/api/jobs/:id/apply', (req, res) => {
  const jobId = Number(req.params.id);
  const { applicant_name, telegram_username, portfolio_url = '', cover_note = '' } = req.body;

  const job = db.prepare('SELECT id FROM jobs WHERE id = ?').get(jobId);
  if (!job) return res.status(404).json({ error: 'Vakansiya topilmadi.' });
  if (!applicant_name || !telegram_username) {
    return res.status(400).json({ error: 'Ism va Telegram username majburiy.' });
  }

  const info = db.prepare(`
    INSERT INTO applications (job_id, applicant_name, telegram_username, portfolio_url, cover_note)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, applicant_name, telegram_username, portfolio_url, cover_note);

  res.status(201).json({ application_id: info.lastInsertRowid, status: 'pending' });
});

initBot();

app.listen(PORT, () => {
  console.log(`[Server] Masofly http://localhost:${PORT} da ishga tushdi.`);
});
