const express = require('express');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'links.db');
const app = express();
const PORT = 3001;

let db;

function saveDb() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

function generateCode(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  let exists = true;
  while (exists) {
    code = '';
    for (let i = 0; i < length; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const stmt = db.prepare('SELECT 1 FROM links WHERE code = ?');
    stmt.bind([code]);
    exists = stmt.step();
    stmt.free();
  }
  return code;
}

app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.post('/api/shorten', (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL is required' });
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'URL is required' });
  }
  const code = generateCode();
  const stmt = db.prepare('INSERT INTO links (code, url) VALUES (?, ?)');
  stmt.run([code, trimmed]);
  stmt.free();
  saveDb();
  res.json({ shortUrl: `http://localhost:${PORT}/${code}`, code, url: trimmed });
});

app.get('/api/links', (req, res) => {
  const stmt = db.prepare('SELECT code, url, visits, created_at FROM links ORDER BY created_at DESC');
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  res.json(rows);
});

app.get('/:code', (req, res) => {
  const { code } = req.params;
  if (!/^[a-zA-Z0-9]{6}$/.test(code)) {
    return res.status(404).send('Not found');
  }
  const stmt = db.prepare('SELECT url FROM links WHERE code = ?');
  stmt.bind([code]);
  if (!stmt.step()) {
    stmt.free();
    return res.status(404).send('Not found');
  }
  const row = stmt.getAsObject();
  stmt.free();

  const up = db.prepare('UPDATE links SET visits = visits + 1 WHERE code = ?');
  up.run([code]);
  up.free();
  saveDb();

  res.redirect(301, row.url);
});

async function start() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      visits INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_code ON links(code)`);
  saveDb();

  app.listen(PORT, () => {
    console.log(`Link shortener running at http://localhost:${PORT}`);
  });
}

start();
