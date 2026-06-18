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
const PRICE_CHANGE_THRESHOLD = 0.1;
const CHECK_INTERVAL = 5000;
const STOP_LOSS_PERCENT = null;

// ✅ إعدادات شمعة 15 دقيقة
const CANDLE_INTERVAL = '15m';
const CANDLE_LIMIT = 2;

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
// ✅ جلب بيانات الشمعة (معدل بالكامل)
// ==========================================

async function getCandleData(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol,
      interval: CANDLE_INTERVAL,
      limit: CANDLE_LIMIT
    }, false);

    const raw = response?.data;

    // 🔥 معالجة كل احتمالات شكل البيانات
    let data = null;

    if (Array.isArray(raw)) {
      data = raw;
    } else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }

    if (!data || data.length < 2) {
      console.log(`⚠️ بيانات غير صالحة لـ ${symbol}`);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`❌ فشل جلب شمعة ${symbol}:`, error.message);
    return null;
  }
}

// ==========================================
// ✅ تحليل الشمعة (مع حماية إضافية)
// ==========================================

async function analyzeCandle(symbol) {
  try {
    const candleData = await getCandleData(symbol);
    
    if (!candleData || !Array.isArray(candleData) || candleData.length < 2) {
      console.log(`⚠️ لا توجد بيانات كافية للشمعة لـ ${symbol}`);
      return null;
    }

    const currentCandle = candleData[candleData.length - 1];
    const previousCandle = candleData[candleData.length - 2];

    // ✅ حماية إضافية للتحقق من صحة البيانات
    if (
      !Array.isArray(currentCandle) ||
      currentCandle.length < 5 ||
      !Array.isArray(previousCandle) ||
      previousCandle.length < 5
    ) {
      console.log(`⚠️ بيانات الشمعة غير مكتملة لـ ${symbol}`);
      return null;
    }

    // ✅ بيانات الشمعة: [time, open, high, low, close, volume]
    const currentLow = Number(currentCandle[3]);
    const currentHigh = Number(currentCandle[2]);
    const currentClose = Number(currentCandle[4]);
    const previousClose = Number(previousCandle[4]);

    // ✅ التحقق من صحة القيم
    if (isNaN(currentLow) || isNaN(currentHigh) || isNaN(currentClose) || isNaN(previousClose)) {
      console.log(`⚠️ قيم غير صالحة لـ ${symbol}: Low=${currentLow}, High=${currentHigh}, Close=${currentClose}, PrevClose=${previousClose}`);
      return null;
    }

    if (currentLow === 0 || currentHigh === 0) {
      console.log(`⚠️ القاع أو القمة صفر لـ ${symbol}`);
      return null;
    }

    // ✅ حساب نسبة الارتداد من القاع (شراء)
    const bouncePercent = ((currentClose - currentLow) / currentLow) * 100;

    // ✅ حساب نسبة النزول من القمة (بيع)
    const dropPercent = ((currentHigh - currentClose) / currentHigh) * 100;

    // ✅ شروط الشراء: ارتداد من القاع + السعر أعلى من الشمعة السابقة
    const isBouncing = bouncePercent >= PRICE_CHANGE_THRESHOLD;
    const isRising = currentClose > previousClose;
    const shouldBuy = isBouncing && isRising;

    // ✅ شروط البيع: نزول من القمة + السعر أقل من الشمعة السابقة
    const isDropping = dropPercent >= PRICE_CHANGE_THRESHOLD;
    const isFalling = currentClose < previousClose;
    const shouldSell = isDropping && isFalling;

    return {
      symbol,
      currentLow,
      currentHigh,
      currentClose,
      previousClose,
      bouncePercent,
      dropPercent,
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
// فتح صفقة شراء (Long)
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) {
      console.log(`⚠️ لا يمكن فتح صفقة شراء: سعر ${symbol} غير متوفر`);
      return null;
    }

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Number(quantity.toFixed(1));

    if (roundedQuantity <= 0) {
      console.log(`⚠️ الكمية صغيرة جداً: ${roundedQuantity}`);
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

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Number(quantity.toFixed(1));

    if (roundedQuantity <= 0) {
      console.log(`⚠️ الكمية صغيرة جداً: ${roundedQuantity}`);
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
// متغيرات البوت
// ==========================================

let currentPosition = null;
let isRunning = false;
let lastCandleAnalysis = {};

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

    // ✅ التحقق من الصفقة المفتوحة
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) { isRunning = false; return; }

      let profitPercent;
      if (currentPosition.type === 'LONG') {
        profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      } else {
        profitPercent = ((currentPosition.entryPrice - currentPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      }
      
      console.log(`⚡ ${currentPosition.symbol} (${currentPosition.type}) - الربح: ${profitPercent.toFixed(2)}% | الدخول: ${currentPosition.entryPrice} | الحالي: ${currentPrice}`);

      if (profitPercent >= PROFIT_PERCENT) {
        console.log(`✅ جني ربح: ${profitPercent.toFixed(2)}% (الهدف ${PROFIT_PERCENT}%)`);
        const result = await closePosition(currentPosition);
        if (result) {
          currentPosition = null;
        }
      }

      isRunning = false;
      return;
    }

    // ✅ التحقق من الرصيد
    if (usdtBalance < TRADE_AMOUNT) {
      console.log(`⚠️ رصيد غير كافٍ (يحتاج ${TRADE_AMOUNT} USDT)`);
      isRunning = false;
      return;
    }

    // ✅ تحليل الشموع
    console.log(`📊 تحليل شموع 15 دقيقة لـ ${SYMBOLS.length} عملة...`);
    
    let bestBuyOpportunity = null;
    let bestSellOpportunity = null;

    for (const symbol of SYMBOLS) {
      const analysis = await analyzeCandle(symbol);
      if (!analysis) continue;

      lastCandleAnalysis[symbol] = analysis;

      // عرض معلومات التحليل
      let signals = [];
      if (analysis.shouldBuy) signals.push('🟢 شراء');
      if (analysis.shouldSell) signals.push('🔴 بيع');
      const signalText = signals.length > 0 ? signals.join(' | ') : '⏳ انتظار';
      
      console.log(`📊 ${symbol}: القاع=${analysis.currentLow}, القمة=${analysis.currentHigh}, الارتداد=${analysis.bouncePercent.toFixed(2)}%, النزول=${analysis.dropPercent.toFixed(2)}% → ${signalText}`);

      if (analysis.shouldBuy) {
        if (!bestBuyOpportunity || analysis.bouncePercent > bestBuyOpportunity.bouncePercent) {
          bestBuyOpportunity = analysis;
        }
      }

      if (analysis.shouldSell) {
        if (!bestSellOpportunity || analysis.dropPercent > bestSellOpportunity.dropPercent) {
          bestSellOpportunity = analysis;
        }
      }
    }

    // ✅ تحديد الأولوية: الشراء له الأولوية على البيع
    let selectedOpportunity = null;
    let signalType = null;

    if (bestBuyOpportunity) {
      selectedOpportunity = bestBuyOpportunity;
      signalType = 'BUY';
      console.log(`📈 ✅ إشارة شراء قوية: ${selectedOpportunity.symbol} - ارتداد ${selectedOpportunity.bouncePercent.toFixed(2)}% من القاع (${selectedOpportunity.currentLow})`);
    } else if (bestSellOpportunity) {
      selectedOpportunity = bestSellOpportunity;
      signalType = 'SELL';
      console.log(`📉 ✅ إشارة بيع قوية: ${selectedOpportunity.symbol} - نزول ${selectedOpportunity.dropPercent.toFixed(2)}% من القمة (${selectedOpportunity.currentHigh})`);
    }

    // ✅ تنفيذ الصفقة
    if (selectedOpportunity && signalType) {
      await setLeverage(selectedOpportunity.symbol);
      
      let position;
      if (signalType === 'BUY') {
        position = await openLongPosition(selectedOpportunity.symbol, TRADE_AMOUNT);
      } else {
        position = await openShortPosition(selectedOpportunity.symbol, TRADE_AMOUNT);
      }
      
      if (position) {
        currentPosition = position;
        console.log(`✅ تم فتح الصفقة على ${selectedOpportunity.symbol} (${signalType})`);
        console.log(`📊 نقطة الدخول: ${position.entryPrice} | الكمية: ${position.quantity}`);
        console.log(`🎯 هدف الربح: ${PROFIT_PERCENT}% | ⛔ وقف الخسارة: معطل`);
      }
    } else {
      console.log(`📊 لا توجد إشارات شراء أو بيع حالياً.`);
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
        <h1>🤖 بوت BingX Futures</h1>
        <p class="subtitle">📡 استراتيجية شمعة 15 دقيقة - شراء من القاع + بيع من القمة</p>
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
      status: '⚡ بوت BingX Futures يعمل (شراء + بيع)',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type}) - مفتوح` : 'لا توجد صفقة',
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
    console.log(`📈 عتبة الارتداد/النزول: ${PRICE_CHANGE_THRESHOLD}%`);
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
  ║   ⚡ بوت العقود الآجلة - شراء + بيع                        ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 جني ربح: ${PROFIT_PERCENT}% | ⛔ وقف خسارة: معطل          ║
  ║   📈 شراء من القاع (0.1%) + بيع من القمة (0.1%)              ║
  ║   🕐 الشمعة: 15 دقيقة                                        ║
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
