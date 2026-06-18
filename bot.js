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
// إعدادات البوت (BingX Futures)
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

// ✅ إعدادات رأس المال الثابت
const TRADE_AMOUNT = 1.3; // مبلغ ثابت لكل صفقة
const LEVERAGE = 5; // الرافعة المالية المثالية للسكالبينج

// ✅ أهداف سكالبينج سريعة
const PROFIT_PERCENT = 0.08;
const PROFIT_USDT_TARGET = 0.05;
const MIN_PROFIT_USDT = 0.05; // أقل ربح مسموح

const PRICE_CHANGE_THRESHOLD = 0.1;
const CHECK_INTERVAL = 5000;
const STOP_LOSS_PERCENT = null;

// ✅ إعدادات شمعة 15 دقيقة
const CANDLE_INTERVAL = '15m';
const CANDLE_LIMIT = 50;

// ✅ المتغيرات الجديدة للاستراتيجية المتقدمة
let lastPrices = {};
let currentPosition = null;
let isRunning = false;

let lastTradeTime = 0;
const cooldown = 15000; // 15 ثانية بين الصفقات

// ✅ تم تعديل الحساسية
const SCAN_INTERVAL = 1500; // 1.5 ثانية (أسرع)
const CHANGE_THRESHOLD = 0.03;

// ✅ إعدادات الفلاتر الجديدة
const MIN_CANDLE_RANGE = 0.08;
const MIN_SCORE = 0.1;

// قائمة العملات
const SYMBOLS = [
  'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
  'ESPORTS-USDT'
];

// ==========================================
// نقاط النهاية
// ==========================================

const ENDPOINTS = {
  FUTURES_BALANCE: '/openApi/swap/v2/user/balance',
  FUTURES_PRICE: '/openApi/swap/v2/quote/price',
  FUTURES_LEVERAGE: '/openApi/swap/v2/trade/leverage',
  FUTURES_ORDER: '/openApi/swap/v2/trade/order',
  FUTURES_CANDLE: '/openApi/swap/v2/quote/klines',
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
// جلب بيانات الشمعة
// ==========================================

async function getCandleData(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol,
      interval: CANDLE_INTERVAL,
      limit: CANDLE_LIMIT
    }, false);

    const raw = response?.data;

    let data = null;

    if (Array.isArray(raw)) {
      data = raw;
    } 
    else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } 
    else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }
    else if (Array.isArray(response?.data)) {
      data = response.data;
    }

    if (!data || !Array.isArray(data) || data.length < 2) {
      return null;
    }

    const closedCandles = data.filter(c => c && c[4] && c[3]);
    
    if (closedCandles.length < 2) {
      return null;
    }

    return closedCandles;

  } catch (err) {
    console.log(`❌ خطأ شموع ${symbol}:`, err.message);
    return null;
  }
}

// ==========================================
// تحليل الشمعة
// ==========================================

async function analyzeCandle(symbol) {
  try {
    const candleData = await getCandleData(symbol);
    
    if (!candleData || !Array.isArray(candleData) || candleData.length < 2) {
      return null;
    }

    const currentCandle = candleData.at(-1);
    const previousCandle = candleData.at(-2);

    if (!currentCandle || !previousCandle) {
      return null;
    }

    if (!Array.isArray(currentCandle) || !Array.isArray(previousCandle)) {
      return null;
    }

    if (currentCandle.length < 5 || previousCandle.length < 5) {
      return null;
    }

    const currentLow = Number(currentCandle[3]);
    const currentHigh = Number(currentCandle[2]);
    const currentClose = Number(currentCandle[4]);
    const previousClose = Number(previousCandle[4]);

    if (isNaN(currentLow) || isNaN(currentHigh) || isNaN(currentClose) || isNaN(previousClose)) {
      return null;
    }

    if (currentLow === 0 || currentHigh === 0) {
      return null;
    }

    const candleRange = ((currentHigh - currentLow) / currentLow) * 100;
    if (candleRange < MIN_CANDLE_RANGE) {
      console.log(`📊 ${symbol}: نطاق الشمعة ضعيف (${candleRange.toFixed(2)}% < ${MIN_CANDLE_RANGE}%)`);
      return null;
    }

    const bouncePercent = ((currentClose - currentLow) / currentLow) * 100;
    const dropPercent = ((currentHigh - currentClose) / currentHigh) * 100;

    if (Math.abs(bouncePercent - dropPercent) < 0.02) {
      console.log(`📊 ${symbol}: تذبذب عالي`);
      return null;
    }

    const isBouncing = bouncePercent >= PRICE_CHANGE_THRESHOLD;
    const isRising = currentClose > previousClose;
    let shouldBuy = isBouncing && isRising;

    if (currentClose < previousClose && shouldBuy) {
      shouldBuy = false;
    }

    const isDropping = dropPercent >= PRICE_CHANGE_THRESHOLD;
    const isFalling = currentClose < previousClose;
    let shouldSell = isDropping && isFalling;

    if (currentClose > previousClose && shouldSell) {
      shouldSell = false;
    }

    return {
      symbol,
      currentLow,
      currentHigh,
      currentClose,
      previousClose,
      bouncePercent,
      dropPercent,
      candleRange,
      shouldBuy,
      shouldSell,
      bestSignal: shouldBuy ? 'BUY' : (shouldSell ? 'SELL' : null)
    };
  } catch (error) {
    console.error(`❌ فشل تحليل الشمعة ${symbol}:`, error);
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
    console.error(`❌ فشل جلب سعر ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ حساب كمية العقد بدقة
// ==========================================

function calculateQuantity(price) {
  const quantity = (TRADE_AMOUNT * LEVERAGE) / price;
  
  // تحسين الدقة بدون تكسير الصفقة
  const roundedQuantity = Number(quantity.toFixed(3));
  
  return roundedQuantity;
}

// ==========================================
// ✅ تعيين الرافعة - إصلاح نهائي
// ==========================================

async function setLeverage(symbol) {
  try {
    const params = {
      symbol,
      side: 'LONG',
      leverage: LEVERAGE
    };

    const res = await bingxRequest(
      'POST',
      '/openApi/swap/v2/trade/leverage',
      params
    );

    if (res && res.code === 0) {
      console.log(`✅ تم تعيين الرافعة x${LEVERAGE} لـ ${symbol}`);
      return true;
    }
    console.log(`⚠️ فشل تعيين الرافعة:`, res?.msg || res);
    return false;

  } catch (e) {
    console.log("❌ leverage error", e.message);
    return false;
  }
}

// ==========================================
// ✅ دخول سريع جداً
// ==========================================

async function fastEntry(symbol, side) {
  const price = await getPrice(symbol);
  if (!price) {
    console.log(`⚠️ لا يمكن الدخول: سعر ${symbol} غير متوفر`);
    return null;
  }

  const roundedQuantity = calculateQuantity(price);
  
  // ✅ حماية مهمة: التحقق من صحة الكمية
  if (roundedQuantity <= 0) {
    console.log('⚠️ كمية غير صالحة، تم إلغاء الصفقة');
    return null;
  }

  console.log(`📊 دخول ${side}: ${symbol} | كمية: ${roundedQuantity} | سعر: ${price} | حجم: ${(roundedQuantity * price).toFixed(2)} USDT`);

  const params = {
    symbol,
    side: side === 'BUY' ? 'BUY' : 'SELL',
    type: 'MARKET',
    quantity: roundedQuantity,
    positionSide: side === 'BUY' ? 'LONG' : 'SHORT'
  };

  const res = await bingxRequest(
    'POST',
    '/openApi/swap/v2/trade/order',
    params
  );

  if (res && res.code === 0) {
    console.log(`🚀 دخول ${side}: ${symbol} | $${TRADE_AMOUNT} | رافعة x${LEVERAGE}`);
    return {
      symbol,
      entryPrice: price,
      quantity: roundedQuantity,
      type: side === 'BUY' ? 'LONG' : 'SHORT',
      orderId: res.data?.orderId || Date.now(),
      timestamp: Date.now()
    };
  }

  console.log(`⚠️ فشل دخول ${side}:`, res?.msg || res);
  return null;
}

// ==========================================
// ✅ إشارة ذكية لقرار الدخول
// ==========================================

async function smartSignal(symbol) {
  const price = await getPrice(symbol);
  if (!price) return null;

  if (!lastPrices[symbol]) {
    lastPrices[symbol] = price;
    return null;
  }

  const last = lastPrices[symbol];
  const change = ((price - last) / last) * 100;

  lastPrices[symbol] = price;

  // ⚡ فلتر ضوضاء
  if (Math.abs(change) < 0.02) return null;

  // 🔥 قرار سريع
  if (change > 0) return 'BUY';
  if (change < 0) return 'SELL';

  return null;
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
        if (data.balance.balance) {
          return parseFloat(data.balance.balance) || 0;
        }
        if (data.balance.availableMargin) {
          return parseFloat(data.balance.availableMargin) || 0;
        }
        if (data.balance.equity) {
          return parseFloat(data.balance.equity) || 0;
        }
      }
      
      if (data.balance && typeof data.balance === 'string') {
        return parseFloat(data.balance) || 0;
      }
      
      for (const key of Object.keys(data)) {
        if (key.includes('balance') || key.includes('equity') || key.includes('available')) {
          const val = parseFloat(data[key]);
          if (!isNaN(val) && val > 0) {
            return val;
          }
        }
      }
    }
    return 0;
  } catch (error) {
    console.error('❌ فشل جلب الرصيد:', error);
    return 0;
  }
}

// ==========================================
// إغلاق صفقة
// ==========================================

async function closePosition(position) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) {
      console.log(`⚠️ لا يمكن إغلاق الصفقة: سعر ${position.symbol} غير متوفر`);
      return false;
    }

    console.log(`📊 إغلاق صفقة ${position.type}: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`);

    const closeSide = position.type === 'LONG' ? 'SELL' : 'BUY';
    const closePositionSide = position.type === 'LONG' ? 'LONG' : 'SHORT';

    const params = {
      symbol: position.symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: position.quantity,
      positionSide: closePositionSide
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`✅ تم إغلاق صفقة ${position.type}: ${position.symbol}`);
      return true;
    }
    console.log(`⚠️ فشل إغلاق الصفقة:`, response?.msg || response);
    return false;
  } catch (error) {
    console.error(`❌ فشل إغلاق الصفقة:`, error);
    return false;
  }
}

// ==========================================
// ✅ سكالبينج احترافي V7 Pro - المسح السريع
// ==========================================

async function fastScan() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    // إدارة الصفقة المفتوحة - خروج سريع
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) {
        isRunning = false;
        return;
      }

      // ✅ حساب الربح بالطريقة الدقيقة
      let profitUSDT = (currentPrice - currentPosition.entryPrice) * currentPosition.quantity;
      
      // ✅ إذا كانت الصفقة SHORT، نعكس الإشارة
      if (currentPosition.type === 'SHORT') {
        profitUSDT = (currentPosition.entryPrice - currentPrice) * currentPosition.quantity;
      }

      let profitPercent = (profitUSDT / (currentPosition.entryPrice * currentPosition.quantity)) * 100;

      console.log(`⚡ الربح الحالي: ${profitUSDT.toFixed(4)} USDT (${profitPercent.toFixed(2)}%)`);

      // ✅ إغلاق الصفقة عند تحقيق أقل ربح مسموح
      if (profitUSDT >= MIN_PROFIT_USDT) {
        console.log(`🎯 إغلاق الصفقة: ربح كافي ${profitUSDT.toFixed(4)} USDT`);
        await closePosition(currentPosition);
        currentPosition = null;
        lastTradeTime = Date.now();
      }
      
      // ✅ وقف خسارة سريع
      if (profitUSDT < -0.03) {
        console.log(`⛔ وقف خسارة سريع: ${profitUSDT.toFixed(4)} USDT`);
        await closePosition(currentPosition);
        currentPosition = null;
        lastTradeTime = Date.now();
      }

      isRunning = false;
      return;
    }

    // كولداون بين الصفقات
    if (Date.now() - lastTradeTime < cooldown) {
      console.log('⏳ في فترة انتظار بين الصفقات');
      isRunning = false;
      return;
    }

    if (balance < TRADE_AMOUNT) {
      console.log('⚠️ رصيد غير كافي');
      isRunning = false;
      return;
    }

    // ✅ V7 Pro Scalp - مسح سريع
    for (const symbol of SYMBOLS) {
      const signal = await smartSignal(symbol);
      if (!signal) continue;

      console.log(`🚀 إشارة ${signal}: ${symbol}`);

      await setLeverage(symbol);

      const position = await fastEntry(symbol, signal);

      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();
        console.log(`✅ تم الدخول: ${symbol} (${signal})`);
        break; // صفقة واحدة فقط
      }
    }

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
      <title>لوحة تحكم البوت</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Arial', sans-serif;
          background: #0a0e17;
          color: #fff;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          background: #141b2b;
          border-radius: 20px;
          padding: 40px;
          max-width: 750px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(0, 170, 85, 0.2);
          border: 1px solid #00aa55;
        }
        h1 { text-align: center; color: #00aa55; font-size: 28px; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #8899bb; margin-bottom: 25px; font-size: 14px; }
        .status-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .card {
          background: #1a2335;
          border-radius: 14px;
          padding: 16px 18px;
          border-left: 4px solid #00aa55;
          transition: 0.3s;
        }
        .card:hover { background: #1f2a40; }
        .card .label { font-size: 11px; color: #8899bb; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; color: #fff; }
        .card .value.green { color: #00aa55; }
        .card .value.gold { color: #f0b90b; }
        .card .value.blue { color: #4a9eff; }
        .card .value.red { color: #ff4444; }
        .card .value.purple { color: #a855f7; }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 30px;
          font-size: 13px;
          font-weight: bold;
        }
        .status-badge.online { background: #00aa55; color: #fff; }
        .footer {
          text-align: center;
          margin-top: 25px;
          font-size: 12px;
          color: #556688;
          border-top: 1px solid #1a2335;
          padding-top: 18px;
        }
        .refresh-btn {
          display: block;
          margin: 18px auto 0;
          padding: 10px 30px;
          background: #00aa55;
          border: none;
          border-radius: 30px;
          color: #fff;
          font-weight: bold;
          cursor: pointer;
          transition: 0.3s;
        }
        .refresh-btn:hover { background: #008844; transform: scale(1.02); }
        .settings-box {
          background: #1a2335;
          border-radius: 14px;
          padding: 14px 18px;
          margin-top: 16px;
          border: 1px solid #2a3a55;
        }
        .settings-box .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .settings-box .value { font-size: 15px; font-weight: bold; color: #aabbdd; margin-top: 4px; }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .settings-box .value .highlight-gray { color: #8899bb; }
        .settings-box .value .highlight-purple { color: #a855f7; }
        @media (max-width: 500px) {
          .status-grid { grid-template-columns: 1fr; }
          .container { padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 بوت BingX Futures - V7 Pro</h1>
        <p class="subtitle">📡 سكالبينج فائق السرعة - رأس مال ثابت</p>
        <div class="status-grid" id="statusGrid">
          <div class="card">
            <div class="label">📊 الحالة</div>
            <div class="value"><span class="status-badge online" id="statusBadge">🟢 يعمل</span></div>
          </div>
          <div class="card">
            <div class="label">💰 الرصيد</div>
            <div class="value green" id="balance">0.00 USDT</div>
          </div>
          <div class="card">
            <div class="label">⚡ الرافعة</div>
            <div class="value gold" id="leverage">5x</div>
          </div>
          <div class="card">
            <div class="label">📈 الصفقة</div>
            <div class="value blue" id="position">لا توجد</div>
          </div>
        </div>
        <div class="settings-box">
          <div class="label">⚙️ إعدادات V7 Pro Scalp</div>
          <div class="value">
            💰 <span class="highlight-green">1.30 USDT</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.05 USDT</span> &nbsp;|&nbsp;
            ⛔ وقف خسارة: <span class="highlight-red">-0.03 USDT</span> &nbsp;|&nbsp;
            📈 عتبة: <span class="highlight-gold">0.02%</span> &nbsp;|&nbsp;
            ⚡ رافعة: <span class="highlight-gold">5x</span> &nbsp;|&nbsp;
            ⏱️ كولداون: <span class="highlight-purple">15 ثانية</span> &nbsp;|&nbsp;
            🔄 مسح: <span class="highlight-purple">1.5 ثانية</span>
          </div>
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
            document.getElementById('position').textContent = data.currentPosition || 'لا توجد';
            document.getElementById('lastUpdate').textContent = '🕐 آخر تحديث: ' + new Date().toLocaleTimeString('ar-EG');
          } catch (error) {
            console.error('خطأ في جلب البيانات:', error);
          }
        }
        fetchStatus();
        setInterval(fetchStatus, 10000);
      </script>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.get('/', async (req, res) => {
  try {
    const usdtBalance = await getFuturesBalance();
    res.json({
      status: '⚡ بوت BingX Futures - V7 Pro Scalp',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})` : 'لا توجد',
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${MIN_PROFIT_USDT} USDT`,
        stopLoss: `-0.03 USDT`,
        changeThreshold: `0.02%`,
        scanInterval: `${SCAN_INTERVAL/1000} ثانية`,
        leverage: `${LEVERAGE}x`,
        cooldown: `${cooldown/1000} ثانية`
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
    console.log('⚡⚡ بدء تشغيل بوت العقود الآجلة V7 Pro');
    console.log('📊 ===== إعدادات V7 Pro Scalp =====');
    console.log(`💰 مبلغ التداول الثابت: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${MIN_PROFIT_USDT} USDT`);
    console.log(`⛔ وقف الخسارة: -0.03 USDT`);
    console.log(`📈 عتبة الدخول: 0.02%`);
    console.log(`⏱️ كولداون: ${cooldown/1000} ثانية`);
    console.log(`🔄 سرعة المسح: كل ${SCAN_INTERVAL/1000} ثانية`);
    console.log(`📊 العملات: ${SYMBOLS.join(', ')}`);
    console.log('================================');

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(4)}`);

    if (balance === 0) {
      console.log('⚠️ تحذير: الرصيد 0 أو غير متوفر.');
    }

    if (balance < TRADE_AMOUNT) {
      console.log(`⚠️ تحذير: الرصيد (${balance.toFixed(4)}) أقل من مبلغ التداول (${TRADE_AMOUNT})`);
    }

    // ✅ تشغيل المسح السريع
    await fastScan();

    setInterval(async () => {
      try {
        await fastScan();
      } catch (error) {
        console.error('❌ خطأ في الدورة المتكررة:', error);
      }
    }, SCAN_INTERVAL);

    console.log(`✅ البوت V7 Pro يعمل بنجاح! يتم التحديث كل ${SCAN_INTERVAL/1000} ثانية`);

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
  ║   ⚡ بوت العقود الآجلة - V7 Pro Scalp                      ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ ثابت: ${TRADE_AMOUNT} USDT  ║
  ║   🎯 هدف: ${MIN_PROFIT_USDT} USDT | ⛔ وقف: -0.03 USDT        ║
  ║   📈 دخول: 0.02% | 🔄 مسح: ${SCAN_INTERVAL/1000}ثانية          ║
  ║   📡 V7 Pro - رأس مال ثابت + حماية متقدمة                    ║
  ║   ⚠️ تداول حقيقي - استخدم بحذر!                              ║
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

console.log('🚀 جاري تشغيل البوت V7 Pro...');
