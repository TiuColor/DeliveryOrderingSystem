const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

const db = new sqlite3.Database('./orders.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      customerName TEXT,
      address TEXT,
      phone TEXT,
      itemDesc TEXT,
      status TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'customer' CHECK(role IN ('customer', 'merchant', 'courier'))
    )
  `);
  
  // 预置商家和快递员演示账号（手机号作为账号）
  const demoUsers = [
    { phone: '13800000001', password: '123456', role: 'merchant' },
    { phone: '13800000002', password: '123456', role: 'courier' }
  ];
  demoUsers.forEach(u => {
    db.get(`SELECT id FROM users WHERE phone = ?`, [u.phone], (err, row) => {
      if (!row) {
        const hash = bcrypt.hashSync(u.password, 10);
        db.run(`INSERT INTO users (phone, password, role) VALUES (?, ?, ?)`, [u.phone, hash, u.role]);
      }
    });
  });
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: '请先登录' });
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.session.user.role !== role) return res.status(403).json({ error: '权限不足' });
    next();
  };
}

const broadcastOrderUpdate = () => io.emit('order-updated', { timestamp: Date.now() });

// 检查手机号是否已注册
app.post('/api/check-phone', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: '手机号不能为空' });
  db.get(`SELECT id, role FROM users WHERE phone = ?`, [phone], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ registered: !!row, role: row?.role });
  });
});

// 注册（支持指定角色，默认 customer）
app.post('/api/register', async (req, res) => {
  const { phone, password, role = 'customer' } = req.body;
  if (!phone || !password) return res.status(400).json({ error: '手机号和密码不能为空' });
  if (!['customer', 'merchant', 'courier'].includes(role)) {
    return res.status(400).json({ error: '无效的角色' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (phone, password, role) VALUES (?, ?, ?)`, [phone, hashedPassword, role], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: '手机号已注册' });
        return res.status(500).json({ error: err.message });
      }
      req.session.user = { id: this.lastID, phone, role };
      res.json({ id: this.lastID, phone, role });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 登录
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  db.get(`SELECT * FROM users WHERE phone = ?`, [phone], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: '手机号未注册' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: '密码错误' });
    req.session.user = { id: user.id, phone: user.phone, role: user.role };
    res.json({ id: user.id, phone: user.phone, role: user.role });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: '未登录' });
  res.json(req.session.user);
});

// 获取订单（根据角色）
app.get('/api/orders', requireLogin, (req, res) => {
  const user = req.session.user;
  if (user.role === 'customer') {
    db.all(`SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC`, [user.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else if (user.role === 'merchant') {
    db.all(`SELECT * FROM orders ORDER BY createdAt DESC`, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else if (user.role === 'courier') {
    db.all(`SELECT * FROM orders WHERE status = 'dispatched' ORDER BY createdAt DESC`, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  } else {
    res.status(403).json({ error: '无效角色' });
  }
});

// 创建订单（仅 customer）
app.post('/api/orders', requireLogin, requireRole('customer'), (req, res) => {
  const { customerName, address, phone, itemDesc } = req.body;
  const userId = req.session.user.id;
  if (!customerName || !address || !phone || !itemDesc) {
    return res.status(400).json({ error: '请填写完整信息' });
  }
  db.run(
    `INSERT INTO orders (userId, customerName, address, phone, itemDesc, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [userId, customerName, address, phone, itemDesc],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      broadcastOrderUpdate();
      res.json({ id: this.lastID, status: 'pending' });
    }
  );
});

// 商家接单
app.post('/api/orders/:id/accept', requireLogin, requireRole('merchant'), (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE orders SET status = 'accepted' WHERE id = ? AND status = 'pending'`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(400).json({ error: '订单状态不允许接单' });
    broadcastOrderUpdate();
    res.json({ success: true });
  });
});

// 商家推送
app.post('/api/orders/:id/dispatch', requireLogin, requireRole('merchant'), (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE orders SET status = 'dispatched' WHERE id = ? AND status = 'accepted'`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(400).json({ error: '订单状态不允许推送' });
    broadcastOrderUpdate();
    res.json({ success: true });
  });
});

// 快递员完成
app.post('/api/orders/:id/complete', requireLogin, requireRole('courier'), (req, res) => {
  const { id } = req.params;
  db.run(`UPDATE orders SET status = 'delivered' WHERE id = ? AND status = 'dispatched'`, [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(400).json({ error: '订单状态不允许完成' });
    broadcastOrderUpdate();
    res.json({ success: true });
  });
});

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});