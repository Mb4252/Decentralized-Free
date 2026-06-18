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

// ✅ إعدادات رأس المال
const TRADE_AMOUNT = 1.2;
const USE_FULL_BALANCE = false;

// ✅ الرافعة المالية
const LEVERAGE = 10;

// ✅ أهداف سكالبينج سريعة
const PROFIT_USDT_TARGET = 0.05;
const MIN_PROFIT_USDT = 0.05;

const PRICE_CHANGE_THRESHOLD = 0.1;
const CHECK_INTERVAL = 5000;
const STOP_LOSS_PERCENT = null;

// ✅ إعدادات شمعة 15 دقيقة
const CANDLE_INTERVAL = '15m';
const CANDLE_LIMIT = 50;

// ✅ المتغيرات
let lastPrices = {};
let currentPosition = null;
let isRunning = false;

let lastTradeTime = 0;
const cooldown = 5000; // 5 ثواني فقط بين الصفقات

// ✅ تم تعديل الحساسية
const SCAN_INTERVAL = 1000; // مسح كل ثانية
const CHANGE_THRESHOLD = 0.01; // دخول أسرع
const MIN_SCORE = 0.08; // قبول فرص أكثر

// ✅ إعدادات الفلاتر الجديدة
const MIN_CANDLE_RANGE = 0.08;
const MAX_SYMBOLS_TO_SCAN = 50;

// ✅ إعدادات وقف الخسارة
const STOP_LOSS_ENABLED = false;

// ==========================================
// نقاط النهاية
// ==========================================

const ENDPOINTS = {
  FUTURES_BALANCE: '/openApi/swap/v2/user/balance',
  FUTURES_PRICE: '/openApi/swap/v2/quote/price',
  FUTURES_LEVERAGE: '/openApi/swap/v2/trade/leverage',
  FUTURES_ORDER: '/openApi/swap/v2/trade/order',
  FUTURES_CANDLE: '/openApi/swap/v2/quote/klines',
  FUTURES_CONTRACTS: '/openApi/swap/v2/quote/contracts',
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
// ✅ جلب جميع الرموز من السوق (مع حد أقصى)
// ==========================================

async function getAllSymbols() {
  try {
    const res = await bingxRequest(
      'GET',
      '/openApi/swap/v2/quote/contracts',
      {},
      false
    );

    if (res && res.code === 0 && res.data) {
      let symbols = res.data.map(c => c.symbol);
      
      if (symbols.length > MAX_SYMBOLS_TO_SCAN) {
        symbols = symbols.slice(0, MAX_SYMBOLS_TO_SCAN);
        console.log(`📊 تم تقليص الرموز إلى ${MAX_SYMBOLS_TO_SCAN} رمز (من ${res.data.length})`);
      } else {
        console.log(`📊 تم جلب ${symbols.length} رمز من السوق`);
      }
      
      return symbols;
    }
    return [];
  } catch (error) {
    console.error('❌ فشل جلب الرموز:', error);
    return [];
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
// ✅ جلب تغير السعر (من آخر سعر مسجل)
// ==========================================

async function getPriceChange(symbol) {
  const price = await getPrice(symbol);
  if (!price) return 0;

  if (!lastPrices[symbol]) {
    lastPrices[symbol] = price;
    return 0;
  }

  const last = lastPrices[symbol];
  const change = ((price - last) / last) * 100;
  lastPrices[symbol] = price;

  return change;
}

// ==========================================
// ✅ فلتر الاتجاه العام
// ==========================================

async function getTrend(symbol) {
  const p1 = await getPrice(symbol);
  await new Promise(r => setTimeout(r, 2000));
  const p2 = await getPrice(symbol);

  if (!p1 || !p2) return null;

  const change = ((p2 - p1) / p1) * 100;

  return {
    trend: change > 0 ? 'UP' : 'DOWN',
    strength: Math.abs(change)
  };
}

// ==========================================
// ✅ مسح السوق بالكامل
// ==========================================

async function scanMarket() {
  const symbols = await getAllSymbols();
  if (!symbols || symbols.length === 0) {
    console.log('⚠️ لا توجد رموز في السوق');
    return { best: null, bestScore: 0, bestDirection: null };
  }

  let best = null;
  let bestScore = 0;
  let bestDirection = null;
  let scanned = 0;

  console.log(`🔍 جاري مسح ${symbols.length} رمز...`);

  for (const symbol of symbols) {
    if (symbol.includes('USDC') || symbol.includes('BUSD') || symbol.includes('DAI')) {
      continue;
    }

    const price = await getPrice(symbol);
    if (!price) continue;

    const change = await getPriceChange(symbol);
    if (Math.abs(change) < CHANGE_THRESHOLD) continue;

    const trend = await getTrend(symbol);
    if (!trend) continue;

    let score = Math.abs(change) * 2;

    if (trend.trend === 'UP') score += trend.strength;
    if (trend.trend === 'DOWN') score += trend.strength;

    const knownSymbols = ['BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT'];
    if (knownSymbols.includes(symbol)) {
      score *= 1.2;
    }

    if (score > bestScore) {
      bestScore = score;
      best = symbol;
      bestDirection = change > 0 ? 'BUY' : 'SELL';
    }

    scanned++;
    if (scanned % 10 === 0) {
      console.log(`📊 تم مسح ${scanned}/${symbols.length} رمز`);
    }
  }

  console.log(`✅ اكتمل المسح: ${scanned} رمز`);
  return { best, bestScore, bestDirection };
}

// ==========================================
// ✅ حساب كمية العقد بدقة (6 أرقام عشرية)
// ==========================================

function calculateQuantity(price, amount) {
  const quantity = (amount * LEVERAGE) / price;
  const roundedQuantity = parseFloat(quantity.toFixed(6));
  return roundedQuantity;
}

// ==========================================
// ✅ تعيين الرافعة (LONG + SHORT)
// ==========================================

async function setLeverage(symbol) {
  try {
    const longResponse = await bingxRequest(
      'POST',
      ENDPOINTS.FUTURES_LEVERAGE,
      {
        symbol,
        side: 'LONG',
        leverage: LEVERAGE
      }
    );

    const shortResponse = await bingxRequest(
      'POST',
      ENDPOINTS.FUTURES_LEVERAGE,
      {
        symbol,
        side: 'SHORT',
        leverage: LEVERAGE
      }
    );

    if (longResponse?.code === 0 && shortResponse?.code === 0) {
      console.log(`✅ تم تثبيت الرافعة x${LEVERAGE} على ${symbol}`);
      return true;
    }

    console.log(`⚠️ فشل تثبيت الرافعة: LONG=${longResponse?.code}, SHORT=${shortResponse?.code}`);
    return false;

  } catch (e) {
    console.log("❌ leverage error", e.message);
    return false;
  }
}

// ==========================================
// فتح صفقة شراء (Long)
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) {
      console.log(`⚠️ لا يمكن فتح صفقة شراء: سعر ${symbol} غير متوفر`);
      return null;
    }

    const roundedQuantity = calculateQuantity(price, amount);
    
    if (roundedQuantity <= 0) {
      console.log('⚠️ كمية غير صالحة، تم إلغاء الصفقة');
      return null;
    }

    console.log(`📊 فتح صفقة شراء (Long): ${roundedQuantity} ${symbol} بسعر ${price}`);
    console.log(`📊 حجم الصفقة: ${(roundedQuantity * price).toFixed(2)} USDT (رافعة x${LEVERAGE})`);

    const params = {
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: 'LONG'
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`✅ تم فتح صفقة شراء: ${roundedQuantity} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: 'LONG',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now()
      };
    }
    console.log(`⚠️ فشل فتح صفقة شراء:`, JSON.stringify(response, null, 2));
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح صفقة شراء:`, error);
    return null;
  }
}

// ==========================================
// فتح صفقة بيع (Short)
// ==========================================

async function openShortPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) {
      console.log(`⚠️ لا يمكن فتح صفقة بيع: سعر ${symbol} غير متوفر`);
      return null;
    }

    const roundedQuantity = calculateQuantity(price, amount);
    
    if (roundedQuantity <= 0) {
      console.log('⚠️ كمية غير صالحة، تم إلغاء الصفقة');
      return null;
    }

    console.log(`📊 فتح صفقة بيع (Short): ${roundedQuantity} ${symbol} بسعر ${price}`);
    console.log(`📊 حجم الصفقة: ${(roundedQuantity * price).toFixed(2)} USDT (رافعة x${LEVERAGE})`);

    const params = {
      symbol: symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: 'SHORT'
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`✅ تم فتح صفقة بيع: ${roundedQuantity} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: 'SHORT',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now()
      };
    }
    console.log(`⚠️ فشل فتح صفقة بيع:`, JSON.stringify(response, null, 2));
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح صفقة بيع:`, error);
    return null;
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
// ✅ الدورة الرئيسية مع مسح السوق بالكامل
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    // تحديد مبلغ التداول
    let tradeAmount = TRADE_AMOUNT;
    if (USE_FULL_BALANCE) {
      tradeAmount = balance * 0.95; // استخدام 95% من الرصيد
      console.log(`📊 استخدام الرصيد بالكامل: ${tradeAmount.toFixed(4)} USDT`);
    }

    // إدارة الصفقة المفتوحة
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

      if (profitUSDT >= PROFIT_USDT_TARGET) {
        console.log(`🎯 إغلاق الصفقة: ربح كافي ${profitUSDT.toFixed(4)} USDT`);
        await closePosition(currentPosition);
        currentPosition = null;
        lastTradeTime = Date.now();
      }
      
      if (STOP_LOSS_ENABLED && profitUSDT < -0.03) {
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

    if (balance < tradeAmount) {
      console.log('⚠️ رصيد غير كافي');
      isRunning = false;
      return;
    }

    // ✅ مسح السوق بالكامل
    console.log('🔍 جاري مسح السوق بالكامل...');
    const result = await scanMarket();

    if (result.best && result.bestScore > MIN_SCORE) {
      console.log(`🚀 أفضل فرصة: ${result.best} | ${result.bestDirection} | score=${result.bestScore.toFixed(2)}`);

      // ✅ التحقق من الرافعة قبل فتح الصفقة
      console.log(`⚡ سيتم فتح الصفقة على ${result.best} برافعة x${LEVERAGE}`);
      
      const leverageSet = await setLeverage(result.best);

      if (!leverageSet) {
        console.log(`❌ تم إلغاء الصفقة لأن الرافعة لم تُضبط على x${LEVERAGE}`);
        isRunning = false;
        return;
      }

      let position;
      if (result.bestDirection === 'BUY') {
        position = await openLongPosition(result.best, tradeAmount);
      } else {
        position = await openShortPosition(result.best, tradeAmount);
      }

      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();
        console.log(`✅ تم الدخول: ${result.best} (${result.bestDirection})`);
      }
    } else {
      console.log(`⏳ لا توجد فرصة قوية (أفضل سكور: ${result.bestScore.toFixed(2)})`);
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

// ==========================================
// ✅ لوحة تحكم HTML
// ==========================================

app.get('/dashboard', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>لوحة تحكم البوت - V7 Pro</title>
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
          grid-template-columns: 1fr 1fr 1fr;
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
        .trade-info {
          background: #1a2335;
          border-radius: 14px;
          padding: 16px 18px;
          margin-top: 12px;
          border: 1px solid #2a3a55;
          text-align: center;
        }
        .trade-info .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .trade-info .value { font-size: 20px; font-weight: bold; margin-top: 4px; }
        .profit-positive { color: #00aa55; }
        .profit-negative { color: #ff4444; }
        @media (max-width: 500px) {
          .status-grid { grid-template-columns: 1fr 1fr; }
          .container { padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 بوت BingX - V7 Pro</h1>
        <p class="subtitle">📡 مسح السوق بالكامل + سكالبينج ذكي</p>
        
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
            <div class="value gold" id="leverage">10x</div>
          </div>
          <div class="card" style="grid-column: span 3;">
            <div class="label">📈 الصفقة الحالية</div>
            <div class="value blue" id="position">لا توجد صفقة</div>
          </div>
        </div>

        <div class="trade-info" id="tradeInfo">
          <div class="label">💰 الربح / الخسارة الحالي</div>
          <div class="value" id="profitDisplay">0.0000 USDT (0.00%)</div>
        </div>

        <div class="settings-box">
          <div class="label">⚙️ إعدادات V7 Pro</div>
          <div class="value">
            💰 <span class="highlight-green">1.20 USDT</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.05 USDT</span> &nbsp;|&nbsp;
            ⛔ وقف: <span class="highlight-gray">معطل</span> &nbsp;|&nbsp;
            📈 عتبة: <span class="highlight-gold">0.01%</span> &nbsp;|&nbsp;
            ⚡ رافعة: <span class="highlight-gold">10x</span> &nbsp;|&nbsp;
            🔄 مسح: <span class="highlight-purple">1 ثانية</span> &nbsp;|&nbsp;
            ⏱️ كولداون: <span class="highlight-purple">5 ثواني</span>
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
            document.getElementById('position').textContent = data.currentPosition || 'لا توجد صفقة';
            
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
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ==========================================
// ✅ API مع عرض الربح/الخسارة
// ==========================================

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
      status: '⚡ بوت BingX - V7 Pro (مسح السوق بالكامل)',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT`,
      useFullBalance: USE_FULL_BALANCE,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})` : 'لا توجد صفقة',
      profit: profit,
      profitPercent: profitPercent,
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${PROFIT_USDT_TARGET} USDT`,
        stopLoss: STOP_LOSS_ENABLED ? '-0.03 USDT' : 'معطل',
        changeThreshold: `${CHANGE_THRESHOLD}%`,
        scanInterval: `${SCAN_INTERVAL/1000} ثانية`,
        leverage: `${LEVERAGE}x`,
        cooldown: `${cooldown/1000} ثانية`,
        maxSymbols: MAX_SYMBOLS_TO_SCAN
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
    console.log('⚡⚡ بدء تشغيل بوت V7 Pro - مسح السوق بالكامل');
    console.log('📊 ===== إعدادات V7 Pro =====');
    console.log(`💰 مبلغ التداول الثابت: ${TRADE_AMOUNT} USDT`);
    console.log(`📊 استخدام الرصيد بالكامل: ${USE_FULL_BALANCE ? 'نعم' : 'لا'}`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT`);
    console.log(`⛔ وقف الخسارة: ${STOP_LOSS_ENABLED ? 'مفعل (-0.03 USDT)' : 'معطل'}`);
    console.log(`📈 عتبة الدخول: ${CHANGE_THRESHOLD}%`);
    console.log(`🔄 سرعة المسح: كل ${SCAN_INTERVAL/1000} ثانية`);
    console.log(`⏱️ كولداون: ${cooldown/1000} ثانية`);
    console.log(`📊 الحد الأقصى للرموز: ${MAX_SYMBOLS_TO_SCAN}`);
    console.log('================================');

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(4)}`);

    if (balance === 0) {
      console.log('⚠️ تحذير: الرصيد 0 أو غير متوفر.');
    }

    if (balance < TRADE_AMOUNT) {
      console.log(`⚠️ تحذير: الرصيد (${balance.toFixed(4)}) أقل من مبلغ التداول (${TRADE_AMOUNT})`);
    }

    await tradingCycle();

    setInterval(async () => {
      try {
        await tradingCycle();
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
  ║   ⚡ بوت V7 Pro - مسح السوق بالكامل                        ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT | ⛔ وقف: ${STOP_LOSS_ENABLED ? 'مفعل' : 'معطل'}  ║
  ║   📈 عتبة: ${CHANGE_THRESHOLD}% | 🔄 مسح: ${SCAN_INTERVAL/1000}ثانية ║
  ║   📡 مسح السوق بالكامل + سكالبينج ذكي                       ║
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
