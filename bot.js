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
const LEVERAGE = 5;
const TRADE_AMOUNT = 1.4;
const PROFIT_PERCENT = 5;
const PRICE_CHANGE_THRESHOLD = 0.1;  // نسبة الارتداد من القاع
const CHECK_INTERVAL = 5000;  // 5 ثواني
const STOP_LOSS_PERCENT = null;  // معطل

// ✅ إعدادات شمعة 15 دقيقة
const CANDLE_INTERVAL = '15m';  // شمعة 15 دقيقة
const CANDLE_LIMIT = 2;  // جلب آخر شمعتين

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
  FUTURES_CANDLE: '/openApi/swap/v2/quote/klines',  // ✅ نقطة نهاية الشموع
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
// ✅ جلب بيانات الشمعة (15 دقيقة)
// ==========================================

async function getCandleData(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol: symbol,
      interval: CANDLE_INTERVAL,
      limit: CANDLE_LIMIT
    }, false);
    
    if (response && response.code === 0 && response.data) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.error(`❌ فشل جلب شمعة ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ تحليل الشمعة: أدنى سعر وبداية الارتداد
// ==========================================

async function analyzeCandle(symbol) {
  try {
    const candleData = await getCandleData(symbol);
    if (!candleData || !candleData.length || candleData.length < 2) {
      return null;
    }

    // ✅ بيانات الشمعة: [time, open, high, low, close, volume]
    const currentCandle = candleData[candleData.length - 1];  // الشمعة الحالية
    const previousCandle = candleData[candleData.length - 2];  // الشمعة السابقة

    const currentLow = parseFloat(currentCandle[3]);  // أدنى سعر في الشمعة الحالية
    const currentClose = parseFloat(currentCandle[4]);  // سعر الإغلاق الحالي
    const previousClose = parseFloat(previousCandle[4]);  // سعر إغلاق الشمعة السابقة

    // ✅ حساب نسبة الارتداد من القاع
    const bouncePercent = ((currentClose - currentLow) / currentLow) * 100;

    // ✅ التحقق من بداية الارتداد
    const isBouncing = bouncePercent >= PRICE_CHANGE_THRESHOLD;

    // ✅ التحقق من أن السعر الحالي أكبر من إغلاق الشمعة السابقة (ارتفاع فعلي)
    const isRising = currentClose > previousClose;

    return {
      symbol,
      currentLow,
      currentClose,
      previousClose,
      bouncePercent,
      isBouncing,
      isRising,
      // ✅ شرط الدخول: ارتداد + ارتفاع فعلي
      shouldBuy: isBouncing && isRising
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
// تعيين الرافعة
// ==========================================

async function setLeverage(symbol) {
  try {
    const params = {
      symbol: symbol,
      leverage: LEVERAGE
    };
    
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
// فتح صفقة شراء
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
// إغلاق صفقة
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
// متغيرات البوت
// ==========================================

let currentPosition = null;
let isRunning = false;
let lastCandleAnalysis = {};  // ✅ تخزين آخر تحليل لكل عملة

// ==========================================
// ✅ دورة التداول الرئيسية (مع شمعة 15 دقيقة)
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

    // ✅ التحقق من الصفقة المفتوحة
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) { isRunning = false; return; }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      console.log(`⚡ ${currentPosition.symbol} - الربح: ${profitPercent.toFixed(2)}% | الدخول: ${currentPosition.entryPrice} | الحالي: ${currentPrice}`);

      // ✅ جني ربح 5%
      if (profitPercent >= PROFIT_PERCENT) {
        console.log(`✅ جني ربح: ${profitPercent.toFixed(2)}% (الهدف ${PROFIT_PERCENT}%)`);
        const result = await closePosition(currentPosition);
        if (result) {
          currentPosition = null;
        }
      }
      // ❌ وقف الخسارة معطل

      isRunning = false;
      return;
    }

    // ✅ التحقق من الرصيد
    if (usdtBalance < TRADE_AMOUNT) {
      console.log(`⚠️ رصيد غير كافٍ (يحتاج ${TRADE_AMOUNT} USDT)`);
      isRunning = false;
      return;
    }

    // ✅ تحليل الشموع لكل العملات
    console.log(`📊 تحليل شموع 15 دقيقة لـ ${SYMBOLS.length} عملة...`);
    
    let bestOpportunity = null;

    for (const symbol of SYMBOLS) {
      const analysis = await analyzeCandle(symbol);
      if (!analysis) continue;

      // ✅ تخزين التحليل
      lastCandleAnalysis[symbol] = analysis;

      console.log(`📊 ${symbol}: القاع=${analysis.currentLow}, الإغلاق=${analysis.currentClose}, الارتداد=${analysis.bouncePercent.toFixed(2)}%, ${analysis.shouldBuy ? '✅ إشارة شراء' : '⏳ انتظار'}`);

      // ✅ البحث عن أفضل فرصة (أكبر نسبة ارتداد)
      if (analysis.shouldBuy) {
        if (!bestOpportunity || analysis.bouncePercent > bestOpportunity.bouncePercent) {
          bestOpportunity = analysis;
        }
      }
    }

    // ✅ إذا وجدت فرصة، افتح صفقة
    if (bestOpportunity) {
      console.log(`📈 ✅ إشارة شراء قوية: ${bestOpportunity.symbol} - ارتداد ${bestOpportunity.bouncePercent.toFixed(2)}% من القاع (${bestOpportunity.currentLow})`);
      
      await setLeverage(bestOpportunity.symbol);
      const position = await openLongPosition(bestOpportunity.symbol, TRADE_AMOUNT);
      if (position) {
        currentPosition = position;
        console.log(`✅ تم فتح الصفقة على ${bestOpportunity.symbol}`);
        console.log(`📊 نقطة الدخول: ${position.entryPrice} | الكمية: ${position.quantity}`);
        console.log(`🎯 هدف الربح: ${PROFIT_PERCENT}% | ⛔ وقف الخسارة: معطل`);
      }
    } else {
      console.log(`📊 لا توجد إشارات شراء حالياً. انتظار ارتداد من القاع...`);
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
// واجهة HTML
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
          max-width: 750px;
          width: 100%;
          box-shadow: 0 10px 30px rgba(0, 170, 85, 0.2);
          border: 1px solid #00aa55;
        }
        h1 {
          text-align: center;
          color: #00aa55;
          font-size: 28px;
          margin-bottom: 5px;
        }
        .subtitle {
          text-align: center;
          color: #8899bb;
          margin-bottom: 25px;
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
          padding: 16px 18px;
          border-left: 4px solid #00aa55;
          transition: 0.3s;
        }
        .card:hover {
          background: #1f2a40;
        }
        .card .label {
          font-size: 11px;
          color: #8899bb;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .card .value {
          font-size: 18px;
          font-weight: bold;
          margin-top: 4px;
          color: #fff;
        }
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
        .refresh-btn:hover {
          background: #008844;
          transform: scale(1.02);
        }
        .settings-box {
          background: #1a2335;
          border-radius: 14px;
          padding: 14px 18px;
          margin-top: 16px;
          border: 1px solid #2a3a55;
        }
        .settings-box .label {
          font-size: 11px;
          color: #8899bb;
          text-transform: uppercase;
        }
        .settings-box .value {
          font-size: 15px;
          font-weight: bold;
          color: #aabbdd;
          margin-top: 4px;
        }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .settings-box .value .highlight-gray { color: #8899bb; }
        .settings-box .value .highlight-purple { color: #a855f7; }
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
        <p class="subtitle">📡 استراتيجية شمعة 15 دقيقة - الارتداد من القاع</p>

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
          <div class="card" style="grid-column: span 2;">
            <div class="label">📊 إشارات الشمعة</div>
            <div class="value" id="signals" style="font-size: 13px; color: #aabbdd;">جاري التحليل...</div>
          </div>
        </div>

        <div class="settings-box">
          <div class="label">⚙️ إعدادات التداول</div>
          <div class="value">
            💰 <span class="highlight-green">1.40 USDT</span> &nbsp;|&nbsp;
            🎯 جني ربح: <span class="highlight-gold">5%</span> &nbsp;|&nbsp;
            ⛔ وقف خسارة: <span class="highlight-gray">معطل</span> &nbsp;|&nbsp;
            📈 عتبة: <span class="highlight-gold">0.1%</span> &nbsp;|&nbsp;
            ⚡ رافعة: <span class="highlight-gold">5x</span> &nbsp;|&nbsp;
            🕐 الشمعة: <span class="highlight-purple">15 دقيقة</span>
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
            
            // عرض الإشارات
            if (data.signals) {
              document.getElementById('signals').innerHTML = data.signals;
            }
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
// نقاط نهاية JSON
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
    
    // ✅ بناء رسالة الإشارات
    let signalsHtml = '';
    for (const [symbol, analysis] of Object.entries(lastCandleAnalysis)) {
      if (analysis) {
        const status = analysis.shouldBuy ? '✅ إشارة شراء' : '⏳ انتظار';
        signalsHtml += `<span style="color: ${analysis.shouldBuy ? '#00aa55' : '#8899bb'}">${symbol}: ${analysis.bouncePercent.toFixed(2)}% ${status}</span> `;
      }
    }
    if (!signalsHtml) signalsHtml = '⏳ جاري تحليل الشموع...';
    
    res.json({
      status: '⚡ بوت BingX Futures يعمل (شمعة 15 دقيقة)',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      currentPosition: currentPosition ? `${currentPosition.symbol} - مفتوح` : 'لا توجد صفقة',
      signals: signalsHtml,
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${PROFIT_PERCENT}%`,
        stopLoss: 'معطل',
        leverage: `${LEVERAGE}x`,
        priceChangeThreshold: `${PRICE_CHANGE_THRESHOLD}%`,
        candleInterval: '15 دقيقة'
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
    console.log(`⛔ وقف الخسارة: معطل`);
    console.log(`📈 عتبة الارتداد: ${PRICE_CHANGE_THRESHOLD}% من القاع`);
    console.log(`🕐 الشمعة: 15 دقيقة`);
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
  ║   ⚡ بوت العقود الآجلة - شمعة 15 دقيقة                      ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 جني ربح: ${PROFIT_PERCENT}% | ⛔ وقف خسارة: معطل          ║
  ║   🕐 الشمعة: 15 دقيقة | 📈 عتبة الارتداد: 0.1%               ║
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

console.log('🚀 جاري تشغيل البوت...');
