const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// إعدادات
// ==========================================

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const TRADES_FILE = path.join(__dirname, 'data', 'trades.json');

// ==========================================
// دوال قراءة وكتابة البيانات
// ==========================================

function getTradesData() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('❌ خطأ في قراءة الملف:', error);
  }
  return {
    trades: [],
    totalTrades: 0,
    totalProfit: 0,
    totalLoss: 0,
    openPositions: 0,
    currentBalance: 0
  };
}

function saveTradesData(data) {
  try {
    const dir = path.dirname(TRADES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRADES_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ خطأ في حفظ الملف:', error);
  }
}

// ==========================================
// API: جلب جميع البيانات
// ==========================================

app.get('/api/status', (req, res) => {
  const data = getTradesData();
  res.json(data);
});

// ==========================================
// API: إضافة صفقة جديدة (يستخدمها البوت)
// ==========================================

app.post('/api/add-trade', (req, res) => {
  const { type, token, amount, price, profit, status } = req.body;
  
  const data = getTradesData();
  
  const trade = {
    id: Date.now(),
    type: type || 'buy', // buy / sell
    token: token || 'BNB',
    amount: amount || 0,
    price: price || 0,
    profit: profit || 0,
    profitPercent: profit ? ((profit / (amount * price)) * 100).toFixed(2) : '0',
    status: status || 'open', // open / closed
    timestamp: new Date().toISOString()
  };
  
  data.trades.unshift(trade);
  data.totalTrades += 1;
  
  if (status === 'closed') {
    if (profit > 0) {
      data.totalProfit += profit;
    } else {
      data.totalLoss += Math.abs(profit);
    }
  }
  
  // تحديث عدد الصفقات المفتوحة
  data.openPositions = data.trades.filter(t => t.status === 'open').length;
  
  saveTradesData(data);
  res.json({ success: true, trade });
});

// ==========================================
// API: تحديث صفقة (إغلاق)
// ==========================================

app.post('/api/update-trade', (req, res) => {
  const { tradeId, status, profit } = req.body;
  
  const data = getTradesData();
  const tradeIndex = data.trades.findIndex(t => t.id === tradeId);
  
  if (tradeIndex === -1) {
    return res.status(404).json({ error: 'الصفقة غير موجودة' });
  }
  
  data.trades[tradeIndex].status = status || 'closed';
  if (profit !== undefined) {
    data.trades[tradeIndex].profit = profit;
    data.trades[tradeIndex].profitPercent = (profit / (data.trades[tradeIndex].amount * data.trades[tradeIndex].price) * 100).toFixed(2);
  }
  
  data.openPositions = data.trades.filter(t => t.status === 'open').length;
  
  if (status === 'closed' && profit !== undefined) {
    if (profit > 0) {
      data.totalProfit += profit;
    } else {
      data.totalLoss += Math.abs(profit);
    }
  }
  
  saveTradesData(data);
  res.json({ success: true });
});

// ==========================================
// تشغيل الخادم
// ==========================================

app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║   📊 لوحة تحكم البوت - DashBoard                  ║
  ║   🌐 http://localhost:${PORT}                      ║
  ╚═══════════════════════════════════════════════════╝
  `);
});
