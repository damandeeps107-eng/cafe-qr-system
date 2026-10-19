const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? '/tmp' : path.join(__dirname, 'data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const MENU_FILE = path.join(DATA_DIR, 'menu.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory state with file persistence
let menu = [];
try {
  const sourceMenu = fs.existsSync(MENU_FILE) ? MENU_FILE : path.join(__dirname, 'data', 'menu.json');
  if (fs.existsSync(sourceMenu)) {
    menu = JSON.parse(fs.readFileSync(sourceMenu, 'utf-8'));
  }
} catch (e) {
  console.error('Error loading menu:', e);
}

let orders = [];
try {
  const sourceOrders = fs.existsSync(ORDERS_FILE) ? ORDERS_FILE : path.join(__dirname, 'data', 'orders.json');
  if (fs.existsSync(sourceOrders)) {
    orders = JSON.parse(fs.readFileSync(sourceOrders, 'utf-8'));
  }
} catch (e) {
  orders = [];
}

function saveOrders() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
  } catch (e) {
    console.error('Error saving orders:', e);
  }
}

// Get local machine IP for Wi-Fi scanning
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

function numberToWord(num) {
  const words = {
    1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
    6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
    11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen',
    15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
    19: 'nineteen', 20: 'twenty'
  };
  return words[num] || num.toString();
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Professional POS Natural English Announcement Generator
function generateOrderAnnouncementSpeech(order) {
  const tableWord = numberToWord(order.tableNo);

  if (!order.items || order.items.length === 0) {
    return `New order received! Table number ${tableWord}.`;
  }

  const formattedItems = order.items.map(item => {
    const qtyWord = numberToWord(item.qty);
    const cleanName = (item.name || '').replace(/\(.*\)/g, '').trim();
    return `${qtyWord} ${cleanName}`;
  });

  let itemsClause = '';
  if (formattedItems.length === 1) {
    itemsClause = capitalizeFirst(formattedItems[0]);
  } else if (formattedItems.length === 2) {
    itemsClause = `${capitalizeFirst(formattedItems[0])} and ${formattedItems[1]}`;
  } else {
    const lastItem = formattedItems.pop();
    itemsClause = `${capitalizeFirst(formattedItems.join(', '))}, and ${lastItem}`;
  }

  return `New order received! Table number ${tableWord}. ${itemsClause}.`;
}

const PUBLIC_DIR = path.join(__dirname, 'public');

// --- Web Routes ---
// 1. Dedicated Customer Ordering App
app.get('/order', (req, res) => {
  res.sendFile('order.html', { root: PUBLIC_DIR });
});

// 2. Main Root Domain: If ?table= query present (e.g. from table QR code), send Customer Menu; otherwise send Restaurant Dashboard
app.get('/', (req, res) => {
  if (req.query.table) {
    return res.sendFile('order.html', { root: PUBLIC_DIR });
  }
  res.sendFile('index.html', { root: PUBLIC_DIR });
});

// 3. Restaurant / Kitchen Live Dashboard with Voice Alerts
app.get(['/kitchen', '/dashboard', '/admin'], (req, res) => {
  res.sendFile('index.html', { root: PUBLIC_DIR });
});

// 4. Separate QR Codes Generator & Table Standees
app.get('/qr-codes', (req, res) => {
  res.sendFile('qr-codes.html', { root: PUBLIC_DIR });
});

// --- API Endpoints ---
const TUNNEL_URL = process.env.TUNNEL_URL || 'https://porcelain-internationally-allowance-constraint.trycloudflare.com';

app.get('/api/info', (req, res) => {
  const localIp = getLocalIp();
  const host = req.get('host') || `${localIp}:${PORT}`;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const baseUrl = `${protocol}://${host}`;
  const isProd = !host.includes('localhost') && !host.includes('127.0.0.1') && !host.includes('192.168.');

  res.json({
    localIp,
    port: PORT,
    baseUrl: baseUrl,
    productionUrl: isProd ? baseUrl : null,
    localWifiUrl: `http://${localIp}:${PORT}`,
    tunnelUrl: isProd ? baseUrl : TUNNEL_URL
  });
});

app.get('/api/menu', (req, res) => {
  res.json(menu);
});

app.get('/api/orders', (req, res) => {
  res.json(orders);
});

app.get('/api/orders/table/:tableNo', (req, res) => {
  const table = parseInt(req.params.tableNo, 10);
  const activeOrders = orders.filter(
    o => o.tableNo === table && o.status !== 'completed' && o.status !== 'cancelled'
  );
  res.json(activeOrders);
});

app.post('/api/orders', (req, res) => {
  const { tableNo, items, customerName, specialNote } = req.body;

  if (!tableNo || !items || !items.length) {
    return res.status(400).json({ error: 'Table number and items are required.' });
  }

  const totalAmount = items.reduce((sum, it) => sum + (it.price * it.qty), 0);
  const orderId = `ORD-${Date.now().toString().slice(-6)}`;
  
  const newOrder = {
    id: orderId,
    tableNo: parseInt(tableNo, 10),
    customerName: customerName || `Table ${tableNo} Guest`,
    items,
    specialNote: specialNote || '',
    totalAmount,
    status: 'pending', // pending -> preparing -> served -> completed / cancelled
    createdAt: new Date().toISOString(),
    speechText: generateOrderAnnouncementSpeech({ tableNo, items })
  };

  orders.unshift(newOrder);
  saveOrders();

  // Real-time broadcast to kitchen screens
  io.emit('new_order', newOrder);

  // Broadcast to customer screens for this table
  io.emit(`table_${newOrder.tableNo}_order`, newOrder);

  res.status(201).json(newOrder);
});

app.patch('/api/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const order = orders.find(o => o.id === req.params.id);

  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const validStatuses = ['pending', 'preparing', 'served', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  order.status = status;
  order.updatedAt = new Date().toISOString();
  saveOrders();

  // Notify everyone in real-time
  io.emit('order_status_updated', order);
  io.emit(`table_${order.tableNo}_status`, order);

  res.json(order);
});

// Call Waiter / Request Service
app.post('/api/call-waiter', (req, res) => {
  const { tableNo, requestType } = req.body;
  const alert = {
    id: `CALL-${Date.now()}`,
    tableNo: parseInt(tableNo, 10),
    requestType: requestType || 'वेटर की मदद',
    createdAt: new Date().toISOString(),
    speechText: `टेबल नंबर ${tableNo} से ${requestType || 'वेटर को बुलाया गया है'}!`
  };

  io.emit('waiter_called', alert);
  res.json({ success: true, alert });
});

// Dynamic QR code generation endpoint
app.get('/api/qr/:tableNo', async (req, res) => {
  try {
    const tableNo = req.params.tableNo;
    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const orderUrl = `${protocol}://${host}/?table=${tableNo}`;

    const qrDataUrl = await QRCode.toDataURL(orderUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#1e1b18',
        light: '#ffffff'
      }
    });

    res.json({ tableNo, url: orderUrl, qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// WebSocket Connection handling
io.on('connection', (socket) => {
  socket.on('disconnect', () => {});
});

module.exports = app;

if (!process.env.VERCEL) {
  server.listen(PORT, '0.0.0.0', () => {
    const localIp = getLocalIp();
    console.log(`====================================================`);
    console.log(`☕ Cafe QR Ordering & Kitchen Voice System Started!`);
    console.log(`----------------------------------------------------`);
    console.log(`📱 Customer App (Table 1): http://localhost:${PORT}/?table=1`);
    console.log(`📱 On Phone / Wi-Fi:      http://${localIp}:${PORT}/?table=1`);
    console.log(`🍳 Kitchen Dashboard:     http://localhost:${PORT}/kitchen`);
    console.log(`🖨️  Printable QR Standees: http://localhost:${PORT}/qr-codes`);
    console.log(`====================================================`);
  });
}

