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
const LEVERAGE = 10;
const TRADE_AMOUNT = 1.45;
const PROFIT_PERCENT = 2;
const PRICE_CHANGE_THRESHOLD = 0.1;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 5000;
const STOP_LOSS_PERCENT = 4;

// ✅ قائمة العملات (تم إزالة SPCX-USDT لأنها غير موجودة)
const SYMBOLS = [
  'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'LINK-USDT',
  'ESPORTS-USDT'
];

// ==========================================
// ✅ نقاط النهاية الصحيحة لـ Swap (Futures)
// ==========================================

const ENDPOINTS = {
  FUTURES_BALANCE: '/openApi/swap/v2/user/balance',
  FUTURES_PRICE: '/openApi/swap/v2/quote/price',
  FUTURES_LEVERAGE: '/openApi/swap/v2/trade/leverage',
  FUTURES_ORDER: '/openApi/swap/v2/trade/order',
};

// ==========================================
// ✅ دالة التوقيع الصحيحة لـ BingX Futures
// ==========================================

function generateSignature(params, secret) {
  // ✅ بناء query string بترتيب أبجدي
  const sortedKeys = Object.keys(params).sort();
  const queryString = sortedKeys
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  console.log(`📝 التوقيع: ${queryString}`);
  
  return crypto
    .createHmac('sha256', secret)
    .update(queryString)
    .digest('hex');
}

// ==========================================
// ✅ طلب BingX الصحيح (Futures/Swap)
// ==========================================

async function bingxRequest(method, endpoint, params = {}, signed = true) {
  const baseURL = 'https://open-api.bingx.com';
  
  // ✅ timestamp يجب أن يكون داخل params وليس خارجه
  const allParams = {
    timestamp: Date.now().toString(),
    ...params
  };
  
  // ✅ بناء التوقيع من query string
  if (signed) {
    allParams.signature = generateSignature(allParams, API_SECRET);
  }
  
  const url = baseURL + endpoint;
  
  // ✅ إرسال المعاملات في query string (وليس body)
  const headers = {
    'X-BX-APIKEY': API_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    console.log(`🚀 إرسال طلب ${method} إلى: ${url}`);
    console.log(`📦 المعاملات:`, JSON.stringify(allParams, null, 2));
    
    let response;
    if (method === 'GET') {
      response = await axios.get(url, {
        params: allParams,
        headers: headers,
        timeout: 10000
      });
    } else {
      // ✅ POST مع query string
      response = await axios.post(
        url,
        null,
        {
          params: allParams,
          headers: headers,
          timeout: 10000
        }
      );
    }
    
    return response.data;
  } catch (error) {
    console.error('❌ خطأ في طلب BingX:', {
      endpoint: endpoint,
      url: url,
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    return null;
  }
}

// ==========================================
// جلب سعر العملة
// ==========================================

async function getPrice(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_PRICE, { 
      symbol: symbol 
    }, false);
    
    if (response && response.code === 0 && response.data) {
      return parseFloat(response.data.price);
    }
    if (response?.code === 100400) {
      console.log(`ℹ️ العملة ${symbol} غير مدعومة حالياً، سيتم تجاهلها`);
      return null;
    }
    console.log(`⚠️ فشل جلب سعر ${symbol}:`, response?.msg || response);
    return null;
  } catch (error) {
    console.error(`❌ فشل جلب سعر ${symbol}:`, error);
    return null;
  }
}

async function getAllPrices() {
  const prices = {};
  for (const symbol of SYMBOLS) {
    const price = await getPrice(symbol);
    if (price) prices[symbol] = { price, name: symbol };
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return prices;
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
// ✅ تعيين الرافعة (Futures)
// ==========================================

async function setLeverage(symbol) {
  try {
    const params = {
      symbol: symbol,
      leverage: LEVERAGE
    };
    
    console.log("🔧 LEVERAGE REQUEST:", JSON.stringify(params, null, 2));
    
    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_LEVERAGE, params);
    
    if (response && response.code === 0) {
      console.log(`✅ تم تعيين الرافعة x${LEVERAGE} لـ ${symbol}`);
      return true;
    }
    console.log(`⚠️ فشل تعيين الرافعة:`, response?.msg || response);
    return false;
  } catch (error) {
    console.error(`❌ فشل تعيين الرافعة:`, error);
    return false;
  }
}

// ==========================================
// ✅ فتح صفقة شراء (Futures)
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) {
      console.log(`⚠️ لا يمكن فتح صفقة: سعر ${symbol} غير متوفر`);
      return null;
    }

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Number(quantity.toFixed(1));

    if (roundedQuantity <= 0) {
      console.log(`⚠️ الكمية صغيرة جداً: ${roundedQuantity}`);
      return null;
    }

    console.log(`📊 فتح صفقة شراء: ${roundedQuantity} ${symbol} بسعر ${price}`);
    console.log(`📊 حجم الصفقة: ${(roundedQuantity * price).toFixed(2)} USDT (رافعة x${LEVERAGE})`);

    const params = {
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: 'LONG'
    };
    
    console.log("📝 ORDER REQUEST:", JSON.stringify(params, null, 2));

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`✅ تم فتح صفقة شراء: ${roundedQuantity} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now()
      };
    }
    console.log(`⚠️ فشل فتح الصفقة:`, JSON.stringify(response, null, 2));
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح الصفقة:`, error);
    return null;
  }
}

// ==========================================
// إغلاق صفقة (بيع)
// ==========================================

async function closePosition(position) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) {
      console.log(`⚠️ لا يمكن إغلاق الصفقة: سعر ${position.symbol} غير متوفر`);
      return false;
    }

    console.log(`📊 إغلاق صفقة: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`);

    const params = {
      symbol: position.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: position.quantity,
      positionSide: 'LONG'
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`✅ تم إغلاق الصفقة: ${position.symbol}`);
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
// تحليل العملات المتزايدة
// ==========================================

let priceHistory = {};
let currentPosition = null;
let isRunning = false;
let activeSymbols = [];

function findRisingTokens(currentPrices) {
  const rising = [];
  for (const [symbol, data] of Object.entries(currentPrices)) {
    const price = data.price;
    if (priceHistory[symbol]) {
      const oldPrice = priceHistory[symbol];
      const changePercent = ((price - oldPrice) / oldPrice) * 100;
      if (changePercent >= PRICE_CHANGE_THRESHOLD) {
        rising.push({ symbol, name: symbol, price, changePercent, oldPrice });
      }
    }
  }
  rising.sort((a, b) => b.changePercent - a.changePercent);
  return rising;
}

async function updatePriceHistory() {
  const currentPrices = await getAllPrices();
  activeSymbols = Object.keys(currentPrices);
  
  for (const [symbol, data] of Object.entries(currentPrices)) {
    priceHistory[symbol] = data.price;
  }
  
  console.log(`📊 العملات النشطة: ${activeSymbols.length} من ${SYMBOLS.length}`);
}

// ==========================================
// دورة التداول الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const usdtBalance = await getFuturesBalance();
    console.log(`💰 رصيد USDT: ${usdtBalance.toFixed(4)}`);

    if (usdtBalance === 0) {
      console.log('⚠️ رصيد USDT: 0 أو غير متوفر');
      isRunning = false;
      return;
    }

    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) { isRunning = false; return; }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      console.log(`⚡ ${currentPosition.symbol} - الربح: ${profitPercent.toFixed(2)}% | نقطة الدخول: ${currentPosition.entryPrice} | السعر الحالي: ${currentPrice}`);

      if (profitPercent >= PROFIT_PERCENT) {
        console.log(`✅ جني ربح: ${profitPercent.toFixed(2)}% (الهدف ${PROFIT_PERCENT}%)`);
        const result = await closePosition(currentPosition);
        if (result) {
          currentPosition = null;
          await updatePriceHistory();
        }
      } else if (profitPercent <= -STOP_LOSS_PERCENT) {
        console.log(`⚠️ وقف الخسارة: ${profitPercent.toFixed(2)}% (الحد ${STOP_LOSS_PERCENT}%)`);
        const result = await closePosition(currentPosition);
        if (result) {
          currentPosition = null;
          await updatePriceHistory();
        }
      }
      isRunning = false;
      return;
    }

    if (usdtBalance < TRADE_AMOUNT) {
      console.log(`⚠️ رصيد غير كافٍ (يحتاج ${TRADE_AMOUNT} USDT)`);
      isRunning = false;
      return;
    }

    const currentPrices = await getAllPrices();
    if (Object.keys(priceHistory).length === 0) {
      for (const [symbol, data] of Object.entries(currentPrices)) {
        priceHistory[symbol] = data.price;
      }
      isRunning = false;
      return;
    }

    const risingTokens = findRisingTokens(currentPrices);
    if (risingTokens.length > 0) {
      const best = risingTokens[0];
      console.log(`📈 اكتشاف ارتفاع: ${best.symbol} - ${best.changePercent.toFixed(2)}% (العتبة ${PRICE_CHANGE_THRESHOLD}%)`);

      await setLeverage(best.symbol);
      const position = await openLongPosition(best.symbol, TRADE_AMOUNT);
      if (position) {
        currentPosition = position;
        await updatePriceHistory();
        console.log(`✅ تم فتح الصفقة على ${best.symbol}`);
        console.log(`📊 نقطة الدخول: ${position.entryPrice} | الكمية: ${position.quantity}`);
        console.log(`🎯 هدف الربح: ${PROFIT_PERCENT}% | ⛔ وقف الخسارة: ${STOP_LOSS_PERCENT}%`);
      }
    } else {
      let maxChange = 0;
      let maxSymbol = '';
      for (const [symbol, data] of Object.entries(currentPrices)) {
        if (priceHistory[symbol]) {
          const change = ((data.price - priceHistory[symbol]) / priceHistory[symbol]) * 100;
          if (Math.abs(change) > Math.abs(maxChange)) {
            maxChange = change;
            maxSymbol = symbol;
          }
        }
      }
      if (maxSymbol) {
        console.log(`📊 السوق هادئ: أكبر تغير ${maxSymbol} - ${maxChange.toFixed(2)}% (العتبة ${PRICE_CHANGE_THRESHOLD}%)`);
      }
    }

  } catch (error) {
    console.error(`❌ خطأ في دورة التداول: ${error.message}`);
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
// ✅ واجهة HTML (صفحة لوحة التحكم)
// ==========================================

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
          max-width: 700px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(0, 170, 85, 0.2);
          border: 1px solid #00aa55;
        }
        h1 {
          text-align: center;
          color: #00aa55;
          font-size: 28px;
          margin-bottom: 10px;
        }
        .subtitle {
          text-align: center;
          color: #8899bb;
          margin-bottom: 30px;
          font-size: 14px;
        }
        .status-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .card {
          background: #1a2335;
          border-radius: 14px;
          padding: 18px 20px;
          border-left: 4px solid #00aa55;
          transition: 0.3s;
        }
        .card:hover {
          background: #1f2a40;
        }
        .card .label {
          font-size: 12px;
          color: #8899bb;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .card .value {
          font-size: 22px;
          font-weight: bold;
          margin-top: 6px;
          color: #fff;
        }
        .card .value.green { color: #00aa55; }
        .card .value.gold { color: #f0b90b; }
        .card .value.blue { color: #4a9eff; }
        .card .value.red { color: #ff4444; }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 30px;
          font-size: 13px;
          font-weight: bold;
        }
        .status-badge.online { background: #00aa55; color: #fff; }
        .status-badge.offline { background: #ff4444; color: #fff; }
        .status-badge.waiting { background: #f0b90b; color: #000; }
        .footer {
          text-align: center;
          margin-top: 30px;
          font-size: 12px;
          color: #556688;
          border-top: 1px solid #1a2335;
          padding-top: 20px;
        }
        .refresh-btn {
          display: block;
          margin: 20px auto 0;
          padding: 10px 30px;
          background: #00aa55;
          border: none;
          border-radius: 30px;
          color: #fff;
          font-weight: bold;
          cursor: pointer;
          transition: 0.3s;
        }
        .refresh-btn:hover {
          background: #008844;
          transform: scale(1.02);
        }
        .settings-box {
          background: #1a2335;
          border-radius: 14px;
          padding: 16px 20px;
          margin-top: 16px;
          border: 1px solid #2a3a55;
        }
        .settings-box .label {
          font-size: 12px;
          color: #8899bb;
          text-transform: uppercase;
        }
        .settings-box .value {
          font-size: 16px;
          font-weight: bold;
          color: #aabbdd;
          margin-top: 4px;
        }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .token-tag {
          display: inline-block;
          background: #1a2335;
          padding: 2px 10px;
          border-radius: 12px;
          font-size: 12px;
          color: #aabbdd;
          margin: 2px;
          border: 1px solid #2a3a55;
        }
        .token-tag.new {
          border-color: #f0b90b;
          color: #f0b90b;
        }
        @media (max-width: 500px) {
          .status-grid { grid-template-columns: 1fr; }
          .container { padding: 20px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🤖 بوت BingX Futures</h1>
        <p class="subtitle">📡 تداول آلي بالرافعة المالية</p>

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
          <div class="card">
            <div class="label">📈 الصفقة الحالية</div>
            <div class="value blue" id="position">لا توجد</div>
          </div>
          <div class="card" style="grid-column: span 2;">
            <div class="label">👀 العملات المراقبة</div>
            <div class="value" id="watching" style="font-size: 14px; color: #aabbdd;">
              BTC, ETH, BNB, SOL, XRP, ADA, DOGE, AVAX, LINK, 
              <span class="token-tag new">✨ ESPORTS</span>
            </div>
          </div>
        </div>

        <div class="settings-box">
          <div class="label">⚙️ إعدادات التداول</div>
          <div class="value">
            💰 المبلغ: <span class="highlight-green">1.45 USDT</span> &nbsp;|&nbsp;
            🎯 جني ربح: <span class="highlight-gold">2%</span> &nbsp;|&nbsp;
            ⛔ وقف خسارة: <span class="highlight-red">4%</span> &nbsp;|&nbsp;
            📈 عتبة: <span class="highlight-gold">0.1%</span>
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
            document.getElementById('watching').textContent = data.watching || '--';
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

// ==========================================
// نقاط نهاية JSON (للـ API)
// ==========================================

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
      status: '⚡ بوت BingX Futures يعمل',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      currentPosition: currentPosition ? `${currentPosition.symbol} - مفتوح` : 'لا توجد صفقة',
      watching: SYMBOLS.join(', '),
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${PROFIT_PERCENT}%`,
        stopLoss: `${STOP_LOSS_PERCENT}%`,
        leverage: `${LEVERAGE}x`,
        priceChangeThreshold: `${PRICE_CHANGE_THRESHOLD}%`
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
    console.log('⚡⚡ بدء تشغيل بوت العقود الآجلة (BingX)');
    console.log('📊 ===== إعدادات التداول =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف جني الأرباح: ${PROFIT_PERCENT}%`);
    console.log(`⛔ وقف الخسارة: ${STOP_LOSS_PERCENT}%`);
    console.log(`📈 عتبة الارتفاع: ${PRICE_CHANGE_THRESHOLD}%`);
    console.log(`📊 العملات: ${SYMBOLS.join(', ')}`);
    console.log('================================');

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(4)}`);

    if (balance === 0) {
      console.log('⚠️ تحذير: الرصيد 0 أو غير متوفر.');
      console.log('📌 تأكد من:');
      console.log('   1. صحة مفاتيح API');
      console.log('   2. وجود رصيد في حساب العقود الآجلة');
      console.log('   3. تفعيل صلاحيات التداول للمفتاح');
    }

    if (balance < TRADE_AMOUNT) {
      console.log(`⚠️ تحذير: الرصيد (${balance.toFixed(4)}) أقل من مبلغ التداول (${TRADE_AMOUNT})`);
    }

    await updatePriceHistory();
    console.log('✅ تم تحديث تاريخ الأسعار');

    await tradingCycle();

    setInterval(async () => {
      try {
        await tradingCycle();
      } catch (error) {
        console.error('❌ خطأ في الدورة المتكررة:', error);
      }
    }, CHECK_INTERVAL);

    console.log(`✅ البوت يعمل بنجاح! يتم التحديث كل ${CHECK_INTERVAL/1000} ثانية`);

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
  ║   ⚡ بوت العقود الآجلة - BingX Futures                      ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 جني ربح: ${PROFIT_PERCENT}% | ⛔ وقف خسارة: ${STOP_LOSS_PERCENT}%  ║
  ║   📈 العملات: ${SYMBOLS.length} عملة                           ║
  ║   ⚠️ تداول حقيقي - استخدم بحذر!                              ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
  
  startBot();
});

// ==========================================
// معالجة إشارات الإيقاف والأخطاء
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

console.log('🚀 جاري تشغيل البوت...');
