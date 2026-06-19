const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));

// Database Setup
const dbPath = process.env.DB_PATH || './database.sqlite';
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('[DB] Connection error:', err.message);
  else console.log(`[DB] Connected to SQLite database at ${dbPath}`);
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT,
      name TEXT,
      avatar TEXT,
      color TEXT,
      favorites_json TEXT
    )
  `);

  const defaultUsers = [
    { u: 'surya',   ph: '34a12809061e749271ae972328cd38bdd7fe3fc83bcfd5fc922e01dd1c3ba376', n: 'Surya',   a: 'S', c: '#8b5cf6' },
    { u: 'ananthu', ph: '77cce19facdc944ca9e5418413862881a33c731ed33f67ff254699f1b9570c77', n: 'Ananthu', a: 'A', c: '#22d3ee' },
    { u: 'devika',  ph: 'c99bc6f668e8999a380975a9be485150f91070498f11f5bf0d56f67eb0f68930', n: 'Devika',  a: 'D', c: '#f472b6' },
    { u: 'sonu',    ph: '65799f51379727f9a584975c238568cd1c570ef0873c10f3d5a546fcbe6073f3', n: 'Sonu',    a: 'S', c: '#34d399' },
    { u: 'bromin',  ph: '080b9643325aeb8de8c556420ab27403c28a13ef5a8d40d8fec0bf9adada73a8', n: 'Bromin',  a: 'B', c: '#f97316' },
    { u: 'arjun',   ph: '26a95b1e69c92f1cfb0381fd379d80526ecd9c368d3a7baa9be6c24b61a25e71', n: 'Arjun',   a: 'A', c: '#ef4444' },
    { u: 'deva',    ph: '55ac2b3161e9c9e2ecb04869ae5e4d6b372f6f1733fede2a06738af09a761c59', n: 'Deva',    a: 'D', c: '#a855f7' },
    { u: 'amal',    ph: '24bb9a41fcc4b3db6a3450ed9171b8c23ee9b494659f6ebfb697b30ea83d1fac', n: 'Amal',    a: 'A', c: '#10b981' },
    { u: 'sounder', ph: 'c8d22056fcdcff4bc5dd5bee816553dc939adc6ac0d68d9fff05c9d8c9cf9338', n: 'Sounder', a: 'S', c: '#fb923c' },
    { u: 'zlatan',  ph: 'a07c9be3cf72583e2829199730b483412c4280ce3fb210bc99237671447780d4', n: 'Zlatan',  a: 'Z', c: '#38bdf8' },
    { u: 'athu',    ph: 'ae20f98677a4659ee2e6a1e7a85176cc17ae4574d0ba6c81072ea2e4a161b5cb', n: 'Athu',    a: 'A', c: '#4ade80' },
    { u: 'mahesh',  ph: 'b7dafc766296428c56acaf95031aa8e644b667bc3a8358251613d9b2fbd16fa7', n: 'Mahesh',  a: 'M', c: '#f59e0b' },
    { u: 'abhilash',ph: 'bd39d425737af9e02ee8dbe2ebc9cf6385340c9f8b90fd0b41eac30f98ac433e', n: 'Abhilash',a: 'A', c: '#6366f1' }
  ];

  const stmt = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, name, avatar, color, favorites_json) VALUES (?, ?, ?, ?, ?, ?)');
  defaultUsers.forEach(user => {
    stmt.run(user.u, user.ph, user.n, user.a, user.c, '[]');
  });
  stmt.finalize();
});

// API: Login
app.post('/api/login', (req, res) => {
  const { username, passwordHash } = req.body;
  if (!username || !passwordHash) return res.status(400).json({ error: 'Missing credentials' });

  db.get('SELECT username, name, avatar, color FROM users WHERE username = ? AND password_hash = ?', [username, passwordHash], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(401).json({ error: 'Invalid username or password' });
    res.json({ success: true, user: row });
  });
});

// API: Get Favorites
app.get('/api/favorites', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Username required' });

  db.get('SELECT favorites_json FROM users WHERE username = ?', [username], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!row) return res.status(404).json({ error: 'User not found' });
    try {
      const favs = JSON.parse(row.favorites_json || '[]');
      res.json({ favorites: favs });
    } catch (e) {
      res.json({ favorites: [] });
    }
  });
});

// API: Save Favorites
app.post('/api/favorites', (req, res) => {
  const { username, favorites } = req.body;
  if (!username || !Array.isArray(favorites)) return res.status(400).json({ error: 'Invalid data' });

  db.run('UPDATE users SET favorites_json = ? WHERE username = ?', [JSON.stringify(favorites), username], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  });
});

app.listen(PORT, () => {
  console.log(`[Server] Running at http://localhost:${PORT}`);
});
