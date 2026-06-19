const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// 中间件
app.use(express.json());
app.use(express.static('public'));

// 数据库初始化
const db = new sqlite3.Database('./orders.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      customerName TEXT,
      address TEXT,
      phone TEXT,
      itemDesc TEXT,
      status TEXT DEFAULT 'pending',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 广播订单更新
const broadcastOrderUpdate = () => {
  io.emit('order-updated', { timestamp: Date.now() });
};

// API 路由

// 获取订单列表
app.get('/api/orders', (req, res) => {
  const { role, userId } = req.query;
  
  if (role === 'merchant') {
    db.all(`SELECT * FROM orders ORDER BY createdAt DESC`, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  } else if (role === 'courier') {
    db.all(`SELECT * FROM orders WHERE status = 'dispatched' ORDER BY createdAt DESC`, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  } else if (userId) {
    db.all(`SELECT * FROM orders WHERE userId = ? ORDER BY createdAt DESC`, [userId], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    });
  } else {
    res.status(400).json({ error: 'Invalid request' });
  }
});

// 创建订单
app.post('/api/orders', (req, res) => {
  const { userId, customerName, address, phone, itemDesc } = req.body;
  
  if (!userId || !customerName || !address || !phone || !itemDesc) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }
  
  db.run(
    `INSERT INTO orders (userId, customerName, address, phone, itemDesc, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [userId, customerName, address, phone, itemDesc],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      broadcastOrderUpdate();
      res.json({ id: this.lastID, status: 'pending' });
    }
  );
});

// 商家接单
app.post('/api/orders/:id/accept', (req, res) => {
  const { id } = req.params;
  
  db.run(
    `UPDATE orders SET status = 'accepted', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'`,
    [id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(400).json({ error: 'Order cannot be accepted' });
        return;
      }
      broadcastOrderUpdate();
      res.json({ success: true });
    }
  );
});

// 商家制作完成并推送给快递员
app.post('/api/orders/:id/dispatch', (req, res) => {
  const { id } = req.params;
  
  db.run(
    `UPDATE orders SET status = 'dispatched', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'accepted'`,
    [id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(400).json({ error: 'Order cannot be dispatched' });
        return;
      }
      broadcastOrderUpdate();
      res.json({ success: true });
    }
  );
});

// 快递员完成配送
app.post('/api/orders/:id/complete', (req, res) => {
  const { id } = req.params;
  
  db.run(
    `UPDATE orders SET status = 'delivered', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND status = 'dispatched'`,
    [id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (this.changes === 0) {
        res.status(400).json({ error: 'Order cannot be completed' });
        return;
      }
      broadcastOrderUpdate();
      res.json({ success: true });
    }
  );
});

// WebSocket 连接
io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});