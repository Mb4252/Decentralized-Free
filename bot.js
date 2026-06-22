const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
dotenv.config();

// ==========================================
// التحقق من المتغيرات البيئية
// ==========================================

if (!process.env.BINGX_API_KEY || !process.env.BINGX_API_SECRET) {
  console.error('❌ خطأ: BINGX_API_KEY و BINGX_API_SECRET مطلوبان في ملف .env');
  process.exit(1);
}

// ==========================================
// إعدادات البوت - مدير الصفقات فقط
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

// ==========================================
// إعدادات التداول
// ==========================================

const TRADE_AMOUNT = 6;        // مبلغ الدخول الثابت (للتوضيح فقط)
const LEVERAGE = 10;              // الرافعة المالية (للتوضيح فقط)
const FIXED_PROFIT_TARGET = 0.3;  // هدف الربح الثابت
const FIXED_STOP_LOSS = -0.5;     // وقف الخسارة الثابت

// ==========================================
// إعدادات المسح
// ==========================================

const SCAN_INTERVAL = 5000;    // سرعة المسح (5 ثواني)

// ==========================================
// العملات (للتوضيح فقط - لا تستخدم حالياً)
// ==========================================

const SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "BNB-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "ADA-USDT",
  "DOGE-USDT",
  "TRX-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "DOT-USDT",
  "LTC-USDT",
  "BCH-USDT",
  "ATOM-USDT",
  "UNI-USDT",
  "APT-USDT",
  "ARB-USDT",
  "OP-USDT",
  "NEAR-USDT",
  "FIL-USDT",
  "ETC-USDT",
  "AAVE-USDT",
  "SUI-USDT",
  "INJ-USDT",
  "SEI-USDT",
  "TIA-USDT",
  "WIF-USDT",
  "PEPE-USDT",
  "BONK-USDT",
  "FET-USDT",
  "RENDER-USDT",
  "JUP-USDT",
  "PYTH-USDT",
  "TON-USDT",
  "HBAR-USDT",
  "ALGO-USDT",
  "VET-USDT",
  "ICP-USDT",
  "EOS-USDT",
  "XLM-USDT",
  "THETA-USDT",
  "SAND-USDT",
  "MANA-USDT",
  "FLOW-USDT",
  "GALA-USDT",
  "AXS-USDT",
  "CHZ-USDT",
  "EGLD-USDT",
  "KAS-USDT",
  "STX-USDT",
  "RUNE-USDT",
  "MKR-USDT",
  "CRV-USDT",
  "DYDX-USDT",
  "GMX-USDT",
  "LDO-USDT",
  "BLUR-USDT",
  "ENS-USDT",
  "ZRO-USDT",
  "ZK-USDT",
  "NOT-USDT",
  "WLD-USDT",
  "ONDO-USDT",
  "BRETT-USDT",
  "ENA-USDT",
  "PENDLE-USDT",
  "HYPE-USDT"
];

// ✅ المتغيرات
let currentPosition = null;
let isRunning = false;
let lastTradeTime = 0;

// ✅ سجل الصفقات
const TRADES_FILE = path.join(__dirname, 'trades.json');
let tradesHistory = [];
let winRateBySymbol = {};

// ==========================================
// تحميل سجل الصفقات
// ==========================================

function loadTradesHistory() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      tradesHistory = JSON.parse(data);
      console.log(`📊 تم تحميل ${tradesHistory.length} صفقة سابقة`);
      
      const symbolStats = {};
      for (const trade of tradesHistory) {
        if (!symbolStats[trade.symbol]) {
          symbolStats[trade.symbol] = { wins: 0, total: 0 };
        }
        symbolStats[trade.symbol].total++;
        if (trade.result === 'WIN') {
          symbolStats[trade.symbol].wins++;
        }
      }
      
      for (const [symbol, stats] of Object.entries(symbolStats)) {
        winRateBySymbol[symbol] = (stats.wins / stats.total) * 100;
        console.log(`   📊 ${symbol}: ${winRateBySymbol[symbol].toFixed(1)}% (${stats.wins}/${stats.total})`);
      }
    }
  } catch (error) {
    console.error('❌ فشل تحميل سجل الصفقات:', error);
    tradesHistory = [];
  }
}

function saveTrade(trade) {
  tradesHistory.push(trade);
  try {
    fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesHistory, null, 2));
  } catch (error) {
    console.error('❌ فشل حفظ الصفقة:', error);
  }
}

// ==========================================
// تخزين معلومات العقود
// ==========================================

let contractInfoCache = {};
let lastContractFetch = 0;
const CONTRACT_CACHE_TTL = 60000;

// ==========================================
// نقاط النهاية
// ==========================================

const ENDPOINTS = {
  FUTURES_BALANCE: '/openApi/swap/v2/user/balance',
  FUTURES_PRICE: '/openApi/swap/v2/quote/price',
  FUTURES_LEVERAGE: '/openApi/swap/v2/trade/leverage',
  FUTURES_ORDER: '/openApi/swap/v2/trade/order',
  FUTURES_CANDLE: '/openApi/swap/v2/quote/klines',
  FUTURES_TICKER: '/openApi/swap/v2/quote/ticker',
  FUTURES_CONTRACTS: '/openApi/swap/v2/quote/contracts',
  FUTURES_POSITIONS: '/openApi/swap/v2/user/positions'
};

// ==========================================
// دالة التوقيع
// ==========================================

function generateSignature(params, secret) {
  const queryString = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const signature = crypto
    .createHmac('sha256', secret.trim())
    .update(queryString)
    .digest('hex');
  
  return signature;
}

// ==========================================
// دالة BingX Request
// ==========================================

async function bingxRequest(method, endpoint, params = {}, signed = true) {
  const baseURL = 'https://open-api.bingx.com';

  const allParams = {
    ...params,
    timestamp: Date.now().toString()
  };

  let signature = '';

  if (signed) {
    signature = generateSignature(allParams, API_SECRET);
  }

  const query = Object.keys(allParams)
    .sort()
    .map(k => `${k}=${allParams[k]}`)
    .join('&');

  const finalQuery = signed ? `${query}&signature=${signature}` : query;

  const url = `${baseURL}${endpoint}?${finalQuery}`;

  const headers = {
    'X-BX-APIKEY': API_KEY
  };

  try {
    let response;

    if (method === 'GET') {
      response = await axios.get(url, { headers });
    } else {
      response = await axios.post(url, null, { headers });
    }

    return response.data;

  } catch (error) {
    console.error('❌ BingX error:', error.response?.data || error.message);
    return null;
  }
}

// ==========================================
// ✅ جلب معلومات العقود
// ==========================================

async function getContractInfo(symbol) {
  const now = Date.now();
  
  if (contractInfoCache[symbol] && (now - lastContractFetch) < CONTRACT_CACHE_TTL) {
    return contractInfoCache[symbol];
  }

  try {
    const response = await bingxRequest(
      'GET',
      ENDPOINTS.FUTURES_CONTRACTS,
      {},
      false
    );

    if (response && response.code === 0 && response.data) {
      const contracts = response.data;
      const contract = contracts.find(c => c.symbol === symbol);
      
      if (contract) {
        contractInfoCache[symbol] = {
          minQty: Number(contract.minQty) || 0,
          stepSize: Number(contract.stepSize) || 0.000001,
          tickSize: Number(contract.tickSize) || 0.01,
          pricePrecision: contract.pricePrecision || 2,
          quantityPrecision: contract.quantityPrecision || 6
        };
        lastContractFetch = now;
        return contractInfoCache[symbol];
      }
    }
    return null;
  } catch (error) {
    console.error(`❌ فشل جلب معلومات العقد ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ جلب الصفقة المفتوحة يدوياً من حسابك
// ==========================================

async function getOpenPosition() {
  try {
    const response = await bingxRequest(
      'GET',
      ENDPOINTS.FUTURES_POSITIONS,
      {}
    );

    if (
      response &&
      response.code === 0 &&
      response.data &&
      response.data.length > 0
    ) {
      const pos = response.data.find(
        p => Number(p.positionAmt || p.positionQty) !== 0
      );

      if (!pos) return null;

      return {
        symbol: pos.symbol,
        entryPrice: Number(pos.avgPrice),
        quantity: Math.abs(Number(pos.positionAmt || pos.positionQty)),
        type:
          Number(pos.positionAmt || pos.positionQty) > 0
            ? 'LONG'
            : 'SHORT'
      };
    }

    return null;
  } catch (e) {
    return null;
  }
}

// ==========================================
// جلب سعر العملة الفوري
// ==========================================

async function getPrice(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_PRICE, { 
      symbol: symbol 
    }, false);
    
    if (response && response.code === 0 && response.data) {
      return parseFloat(response.data.price);
    }
    return null;
  } catch (error) {
    return null;
  }
}

// ==========================================
// ✅ إغلاق صفقة
// ==========================================

async function closePosition(position, result = 'MANUAL') {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

    const isLong = position.type === 'LONG';
    const closeSide = isLong ? 'SELL' : 'BUY';
    const closePositionSide = isLong ? 'LONG' : 'SHORT';

    const params = {
      symbol: position.symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: position.quantity,
      positionSide: closePositionSide
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      let profit = (currentPrice - position.entryPrice) * position.quantity;
      if (position.type === 'SHORT') {
        profit = (position.entryPrice - currentPrice) * position.quantity;
      }
      
      saveTrade({
        symbol: position.symbol,
        type: position.type,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        quantity: position.quantity,
        profit: profit,
        result: profit > 0 ? 'WIN' : 'LOSS',
        timestamp: new Date().toISOString()
      });

      console.log(`✅ تم إغلاق صفقة ${position.type}: ${position.symbol} (${result})`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ فشل إغلاق الصفقة:`, error);
    return false;
  }
}

// ==========================================
// جلب الرصيد
// ==========================================

async function getFuturesBalance() {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_BALANCE, {});
    
    if (response && response.code === 0) {
      const data = response.data || {};
      
      if (data.balance && typeof data.balance === 'object') {
        if (data.balance.balance) return parseFloat(data.balance.balance) || 0;
        if (data.balance.availableMargin) return parseFloat(data.balance.availableMargin) || 0;
        if (data.balance.equity) return parseFloat(data.balance.equity) || 0;
      }
      
      if (data.balance && typeof data.balance === 'string') {
        return parseFloat(data.balance) || 0;
      }
      
      for (const key of Object.keys(data)) {
        if (key.includes('balance') || key.includes('equity') || key.includes('available')) {
          const val = parseFloat(data[key]);
          if (!isNaN(val) && val > 0) return val;
        }
      }
    }
    return 0;
  } catch (error) {
    return 0;
  }
}

// ==========================================
// ✅ الدورة الرئيسية - مراقبة الصفقات فقط
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    // ✅ جلب الصفقة المفتوحة من BingX (إذا كانت موجودة)
    if (!currentPosition) {
      currentPosition = await getOpenPosition();

      if (currentPosition) {
        console.log(`📌 تم اكتشاف صفقة يدوية: ${currentPosition.symbol} (${currentPosition.type})`);
        console.log(`📊 سعر الدخول: ${currentPosition.entryPrice}`);
        console.log(`📊 الكمية: ${currentPosition.quantity}`);
      }
    }

    // ✅ إدارة الصفقة المفتوحة
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) {
        isRunning = false;
        return;
      }

      let profitUSDT = (currentPrice - currentPosition.entryPrice) * currentPosition.quantity;
      if (currentPosition.type === 'SHORT') {
        profitUSDT = (currentPosition.entryPrice - currentPrice) * currentPosition.quantity;
      }
      
      let profitPercent = (profitUSDT / (currentPosition.entryPrice * currentPosition.quantity)) * 100;
      console.log(`⚡ الربح الحالي: ${profitUSDT.toFixed(4)} USDT (${profitPercent.toFixed(2)}%)`);

      // ✅ جني ربح ثابت
      if (profitUSDT >= 0.3) {
        console.log(`🎯 FIXED TP ${profitUSDT.toFixed(4)} USDT (الهدف: 0.3 USDT)`);
        await closePosition(currentPosition, 'FIXED_TP');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      // ✅ وقف خسارة ثابت
      if (profitUSDT <= -0.5) {
        console.log(`⛔ FIXED SL ${profitUSDT.toFixed(4)} USDT (الحد: -0.5 USDT)`);
        await closePosition(currentPosition, 'FIXED_SL');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      isRunning = false;
      return;
    }

    // ✅ لا توجد صفقة مفتوحة - البوت في وضع الانتظار
    console.log(`⏳ لا توجد صفقات مفتوحة. البوت في وضع المراقبة...`);

  } catch (err) {
    console.error('❌ خطأ:', err.message);
  }

  isRunning = false;
}

// ==========================================
// خادم الويب
// ==========================================

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

app.get('/dashboard', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>HYPE MOMENTUM - مدير الصفقات</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; background: #0a0e17; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: #141b2b; border-radius: 20px; padding: 40px; max-width: 750px; width: 100%; box-shadow: 0 10px 30px rgba(255, 140, 0, 0.2); border: 1px solid #ff8c00; }
        h1 { text-align: center; color: #ff8c00; font-size: 28px; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #8899bb; margin-bottom: 25px; font-size: 14px; }
        .status-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .card { background: #1a2335; border-radius: 14px; padding: 16px 18px; border-left: 4px solid #ff8c00; transition: 0.3s; }
        .card:hover { background: #1f2a40; }
        .card .label { font-size: 11px; color: #8899bb; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; color: #fff; }
        .card .value.green { color: #00aa55; }
        .card .value.gold { color: #f0b90b; }
        .card .value.blue { color: #4a9eff; }
        .card .value.red { color: #ff4444; }
        .card .value.orange { color: #ff8c00; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 30px; font-size: 13px; font-weight: bold; background: #ff8c00; color: #fff; }
        .status-badge.waiting { background: #ff8c00; }
        .status-badge.monitoring { background: #4a9eff; }
        .footer { text-align: center; margin-top: 25px; font-size: 12px; color: #556688; border-top: 1px solid #1a2335; padding-top: 18px; }
        .refresh-btn { display: block; margin: 18px auto 0; padding: 10px 30px; background: #ff8c00; border: none; border-radius: 30px; color: #fff; font-weight: bold; cursor: pointer; transition: 0.3s; }
        .refresh-btn:hover { background: #e67a00; transform: scale(1.02); }
        .settings-box { background: #1a2335; border-radius: 14px; padding: 14px 18px; margin-top: 16px; border: 1px solid #2a3a55; }
        .settings-box .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .settings-box .value { font-size: 15px; font-weight: bold; color: #aabbdd; margin-top: 4px; }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .settings-box .value .highlight-orange { color: #ff8c00; }
        .trade-info { background: #1a2335; border-radius: 14px; padding: 16px 18px; margin-top: 12px; border: 1px solid #2a3a55; text-align: center; }
        .trade-info .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .trade-info .value { font-size: 20px; font-weight: bold; margin-top: 4px; }
        .profit-positive { color: #00aa55; }
        .profit-negative { color: #ff4444; }
        .mode-badge { display: inline-block; padding: 4px 12px; border-radius: 30px; font-size: 12px; font-weight: bold; background: #4a9eff; color: #fff; }
        @media (max-width: 500px) { .status-grid { grid-template-columns: 1fr 1fr; } .container { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📊 مدير الصفقات</h1>
        <p class="subtitle">⚡ TP: 0.3 USDT | SL: -0.5 USDT <span class="mode-badge">🔄 مراقبة فقط</span></p>
        <div class="status-grid" id="statusGrid">
          <div class="card"><div class="label">📊 الحالة</div><div class="value"><span class="status-badge waiting" id="statusBadge">⏳ انتظار</span></div></div>
          <div class="card"><div class="label">💰 الرصيد</div><div class="value green" id="balance">0.00 USDT</div></div>
          <div class="card"><div class="label">⚡ الرافعة</div><div class="value gold" id="leverage">10x</div></div>
          <div class="card" style="grid-column: span 3;"><div class="label">📈 الصفقة الحالية</div><div class="value blue" id="position">لا توجد صفقة</div></div>
        </div>
        <div class="trade-info" id="tradeInfo"><div class="label">💰 الربح / الخسارة</div><div class="value" id="profitDisplay">0.0000 USDT (0.00%)</div></div>
        <div class="settings-box">
          <div class="label">⚙️ إعدادات الإغلاق</div>
          <div class="value">🎯 <span class="highlight-green">0.3 USDT</span> | ⛔ <span class="highlight-red">-0.5 USDT</span> | 🔄 <span class="highlight-orange">مسح: 5s</span></div>
        </div>
        <button class="refresh-btn" onclick="fetchStatus()">🔄 تحديث</button>
        <div class="footer" id="lastUpdate">🕐 آخر تحديث: --</div>
      </div>
      <script>
        async function fetchStatus() {
          try {
            const res = await fetch('/');
            const data = await res.json();
            document.getElementById('balance').textContent = data.balance || '0.00 USDT';
            document.getElementById('leverage').textContent = data.leverage || '--';
            document.getElementById('position').textContent = data.currentPosition || 'لا توجد صفقة';
            
            const statusBadge = document.getElementById('statusBadge');
            if (data.currentPosition && data.currentPosition !== 'لا توجد صفقة') {
              statusBadge.textContent = '📊 مراقبة';
              statusBadge.className = 'status-badge monitoring';
            } else {
              statusBadge.textContent = '⏳ انتظار';
              statusBadge.className = 'status-badge waiting';
            }
            
            const profitDisplay = document.getElementById('profitDisplay');
            if (data.profit !== undefined && data.profit !== null) {
              const profit = data.profit;
              const profitPercent = data.profitPercent || 0;
              const isPositive = profit >= 0;
              const sign = isPositive ? '+' : '';
              profitDisplay.innerHTML = '<span class="' + (isPositive ? 'profit-positive' : 'profit-negative') + '">' + sign + profit.toFixed(4) + ' USDT (' + sign + profitPercent.toFixed(2) + '%)</span>';
            } else {
              profitDisplay.textContent = '0.0000 USDT (0.00%)';
            }
            document.getElementById('lastUpdate').textContent = '🕐 آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
          } catch (error) {
            console.error('خطأ في جلب البيانات:', error);
          }
        }
        fetchStatus();
        setInterval(fetchStatus, 5000);
      </script>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/', async (req, res) => {
  try {
    const usdtBalance = await getFuturesBalance();
    let profit = null;
    let profitPercent = null;
    
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (currentPrice) {
        let rawProfit = (currentPrice - currentPosition.entryPrice) * currentPosition.quantity;
        if (currentPosition.type === 'SHORT') {
          rawProfit = (currentPosition.entryPrice - currentPrice) * currentPosition.quantity;
        }
        profit = rawProfit;
        profitPercent = (profit / (currentPosition.entryPrice * currentPosition.quantity)) * 100;
      }
    }
    
    res.json({
      status: '📊 مدير الصفقات',
      mode: 'مراقبة فقط - بدون فتح صفقات',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT (للتوضيح فقط)`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})` : 'لا توجد صفقة',
      profit: profit,
      profitPercent: profitPercent,
      tradesCount: tradesHistory.length,
      settings: {
        profitTarget: `0.3 USDT`,
        stopLoss: `-0.5 USDT`,
        scanInterval: `${SCAN_INTERVAL}ms (5 ثواني)`,
        mode: 'مراقبة فقط'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// تشغيل البوت
// ==========================================

async function startBot() {
  try {
    loadTradesHistory();

    console.log('📊📊 بدء تشغيل مدير الصفقات');
    console.log('📊 ===== إعدادات مدير الصفقات =====');
    console.log(`🎯 هدف الربح الثابت: 0.3 USDT`);
    console.log(`⛔ وقف الخسارة الثابت: -0.5 USDT`);
    console.log(`🔄 سرعة المسح: ${SCAN_INTERVAL}ms (5 ثواني)`);
    console.log(`📊 الوضع: مراقبة فقط - لا يتم فتح صفقات تلقائياً`);
    console.log(`📊 سيتم إغلاق الصفقات عند +0.3 USDT أو -0.5 USDT`);
    console.log('================================');

    await getContractInfo('BTC-USDT');

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT: ${balance.toFixed(4)}`);

    await tradingCycle();

    setInterval(async () => {
      try {
        await tradingCycle();
      } catch (error) {
        console.error('❌ خطأ:', error);
      }
    }, SCAN_INTERVAL);

    console.log(`✅ مدير الصفقات يعمل! مراقبة كل ${SCAN_INTERVAL}ms`);

  } catch (error) {
    console.error(`❌ فشل بدء البوت: ${error.message}`);
    setTimeout(startBot, 30000);
  }
}

// ==========================================
// بدء الخادم
// ==========================================

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   📊 مدير الصفقات - HYPE MOMENTUM                           ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🎯 TP: 0.3 USDT | ⛔ SL: -0.5 USDT                        ║
  ║   🔄 سرعة المسح: ${SCAN_INTERVAL}ms (5 ثواني)                 ║
  ║   📊 الوضع: مراقبة فقط - بدون فتح صفقات                     ║
  ║   📊 سيتم إغلاق الصفقات عند +0.3 USDT أو -0.5 USDT         ║
  ║   ⚠️ افتح الصفقات يدوياً من تطبيق BingX                     ║
  ║   🔄 البوت سيراقب ويغلق تلقائياً عند الوصول للهدف          ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
  
  startBot();
});

// ==========================================
// معالجة الإيقاف
// ==========================================

process.on('SIGTERM', () => {
  console.log('🛑 إيقاف البوت...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('🛑 إيقاف البوت...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ رفض غير معالج:', reason);
});

console.log('🚀 جاري تشغيل مدير الصفقات...');
