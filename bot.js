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
const TRADE_AMOUNT = 0.8;
const USE_FULL_BALANCE = false;

// ✅ الرافعة المالية
const LEVERAGE = 10;

// ✅ أهداف سكالبينج سريعة
const PROFIT_USDT_TARGET = 0.05;
const MIN_PROFIT_USDT = 0.05;

// ✅ إعدادات الإشارات
const BUY_THRESHOLD = -0.05;   // هبوط 0.05% → شراء
const SELL_THRESHOLD = 0.05;   // صعود 0.05% → بيع

const CHECK_INTERVAL = 5000;
const STOP_LOSS_PERCENT = null;

// ✅ إعدادات الشمعة (1 دقيقة)
const CANDLE_INTERVAL = '1m';
const CANDLE_LIMIT = 2;

// ✅ قائمة العملات المحددة
const SYMBOLS = [
  'BTC-USDT',
  'ETH-USDT',
  'BNB-USDT',
  'SOL-USDT',
  'XRP-USDT',
  'DOGE-USDT',
  'ADA-USDT',
  'LINK-USDT',
  'AVAX-USDT',
  'TRX-USDT',
  'SUI-USDT',
  'TON-USDT',
  'HBAR-USDT',
  'APT-USDT',
  'NEAR-USDT',
  'DOT-USDT',
  'ATOM-USDT',
  'LTC-USDT',
  'BCH-USDT',
  'ETC-USDT'
];

// ✅ المتغيرات
let lastPrices = {};
let currentPosition = null;
let isRunning = false;

let lastTradeTime = 0;
const cooldown = 3000; // 3 ثواني بين الصفقات

// ✅ تم تعديل الحساسية
const SCAN_INTERVAL = 1000; // مسح كل ثانية

// ✅ إعدادات الفلاتر
const MIN_VOLUME = 1000000; // ✅ تم التعديل إلى 1,000,000

// ✅ إعدادات وقف الخسارة
const STOP_LOSS_ENABLED = false;

// ✅ تخزين تاريخ الأسعار
let priceHistory = {};

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
// جلب حجم التداول اليومي
// ==========================================

async function getVolume24h(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_TICKER, {
      symbol: symbol
    }, false);
    
    // ✅ طباعة البيانات للتشخيص
    console.log(`📊 ${symbol} - Ticker:`, response?.data);
    
    if (response && response.code === 0 && response.data) {
      const volume = parseFloat(response.data.volume) || 0;
      const quoteVolume = parseFloat(response.data.quoteVolume) || 0;
      return quoteVolume || volume;
    }
    return 0;
  } catch (error) {
    console.error(`❌ فشل جلب حجم ${symbol}:`, error);
    return 0;
  }
}

// ==========================================
// ✅ جلب بيانات الشمعة وتحليل الإشارة
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
    } else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }

    if (!data || !Array.isArray(data) || data.length < 2) {
      return null;
    }

    const currentCandle = data[data.length - 1];
    const previousCandle = data[data.length - 2];

    if (!currentCandle || !previousCandle) return null;
    if (!Array.isArray(currentCandle) || !Array.isArray(previousCandle)) return null;
    if (currentCandle.length < 5 || previousCandle.length < 5) return null;

    const currentClose = Number(currentCandle[4]);
    const previousClose = Number(previousCandle[4]);

    if (isNaN(currentClose) || isNaN(previousClose)) return null;
    if (previousClose === 0) return null;

    // ✅ حساب نسبة التغير
    const changePercent = ((currentClose - previousClose) / previousClose) * 100;

    return {
      symbol,
      currentClose,
      previousClose,
      changePercent
    };
  } catch (error) {
    console.error(`❌ فشل جلب شمعة ${symbol}:`, error);
    return null;
  }
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
        leverage: LEVERAGE,
        side: 'LONG'
      }
    );

    const shortResponse = await bingxRequest(
      'POST',
      ENDPOINTS.FUTURES_LEVERAGE,
      {
        symbol,
        leverage: LEVERAGE,
        side: 'SHORT'
      }
    );

    if (longResponse?.code === 0 && shortResponse?.code === 0) {
      console.log(`✅ تم تثبيت الرافعة x${LEVERAGE} على ${symbol} (LONG + SHORT)`);
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
// ✅ الدورة الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    let tradeAmount = TRADE_AMOUNT;
    if (USE_FULL_BALANCE) {
      tradeAmount = balance * 0.95;
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

    // ✅ مسح العملات المحددة
    console.log(`🔍 جاري مسح ${SYMBOLS.length} عملة محددة...`);
    
    let bestSymbol = null;
    let bestSignal = null;
    let bestScore = 0;

    for (const symbol of SYMBOLS) {
      // ✅ فلتر حجم التداول (1,000,000)
      const volume24h = await getVolume24h(symbol);
      if (volume24h < MIN_VOLUME) {
        console.log(`📊 ${symbol}: حجم التداول منخفض (${volume24h.toFixed(0)} < ${MIN_VOLUME}) - تم التخطي`);
        continue;
      }

      // ✅ جلب بيانات الشمعة (1 دقيقة)
      const candleData = await getCandleData(symbol);
      if (!candleData) continue;

      const { changePercent, previousClose, currentClose } = candleData;
      
      // ✅ طباعة تفاصيل السعر لكل عملة
      console.log(
        `${symbol} | prev=${previousClose} | current=${currentClose} | change=${changePercent.toFixed(3)}%`
      );

      // ✅ تحديد الإشارة بناءً على نسبة التغير
      let signal = null;
      if (changePercent <= BUY_THRESHOLD) {
        signal = 'BUY';
      }
      if (changePercent >= SELL_THRESHOLD) {
        signal = 'SELL';
      }

      if (!signal) {
        console.log(`📊 ${symbol}: تغير ${changePercent.toFixed(2)}% - لا توجد إشارة (عتبة: شراء ${BUY_THRESHOLD}%, بيع ${SELL_THRESHOLD}%)`);
        continue;
      }

      // ✅ حساب السكور
      const score = Math.abs(changePercent);
      console.log(`📊 ${symbol}: تغير ${changePercent.toFixed(2)}% → إشارة ${signal} (سكور: ${score.toFixed(2)}) | حجم: ${volume24h.toFixed(0)}`);

      if (score > bestScore) {
        bestScore = score;
        bestSymbol = symbol;
        bestSignal = signal;
      }
    }

    // ✅ تنفيذ الصفقة
    if (bestSymbol && bestSignal && bestScore > 0) {
      console.log(`🚀 أفضل فرصة: ${bestSymbol} | ${bestSignal} | تغير: ${bestScore.toFixed(2)}%`);

      // ✅ التحقق من الرافعة قبل فتح الصفقة
      console.log(`⚡ سيتم فتح الصفقة على ${bestSymbol} برافعة x${LEVERAGE}`);
      
      const leverageSet = await setLeverage(bestSymbol);

      if (!leverageSet) {
        console.log(`❌ تم إلغاء الصفقة لأن الرافعة لم تُضبط على x${LEVERAGE}`);
        isRunning = false;
        return;
      }

      let position;
      if (bestSignal === 'BUY') {
        position = await openLongPosition(bestSymbol, tradeAmount);
      } else {
        position = await openShortPosition(bestSymbol, tradeAmount);
      }

      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();
        console.log(`✅ تم الدخول: ${bestSymbol} (${bestSignal})`);
      }
    } else {
      console.log(`⏳ لا توجد إشارات قوية (أفضل سكور: ${bestScore.toFixed(2)})`);
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
        <p class="subtitle">📡 شموع 1 دقيقة - سكالبينج فائق السرعة</p>
        
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
          <div class="label">⚙️ إعدادات V7 Pro - سكالبينج فائق السرعة</div>
          <div class="value">
            💰 <span class="highlight-green">0.80 USDT</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.05 USDT</span> &nbsp;|&nbsp;
            ⛔ وقف: <span class="highlight-gray">معطل</span> &nbsp;|&nbsp;
            📈 شراء: <span class="highlight-green">≤ -0.05%</span> &nbsp;|&nbsp;
            📉 بيع: <span class="highlight-red">≥ 0.05%</span> &nbsp;|&nbsp;
            ⚡ رافعة: <span class="highlight-gold">10x</span> &nbsp;|&nbsp;
            🕐 شمعة: <span class="highlight-purple">1 دقيقة</span> &nbsp;|&nbsp;
            📊 حجم: <span class="highlight-purple">≥ 1M</span> &nbsp;|&nbsp;
            ⏱️ كولداون: <span class="highlight-purple">3 ثواني</span>
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
      status: '⚡ بوت BingX - V7 Pro (سكالبينج 1 دقيقة)',
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
        buyThreshold: `${BUY_THRESHOLD}%`,
        sellThreshold: `${SELL_THRESHOLD}%`,
        candleInterval: '1 دقيقة',
        minVolume: `${MIN_VOLUME.toLocaleString()}`,
        scanInterval: `${SCAN_INTERVAL/1000} ثانية`,
        leverage: `${LEVERAGE}x`,
        cooldown: `${cooldown/1000} ثانية`,
        symbols: SYMBOLS.length
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
    console.log('⚡⚡ بدء تشغيل بوت V7 Pro - سكالبينج 1 دقيقة');
    console.log('📊 ===== إعدادات V7 Pro =====');
    console.log(`💰 مبلغ التداول الثابت: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT`);
    console.log(`📈 عتبة الشراء: ≤ ${BUY_THRESHOLD}% (هبوط)`);
    console.log(`📉 عتبة البيع: ≥ ${SELL_THRESHOLD}% (صعود)`);
    console.log(`🕐 فترة الشمعة: ${CANDLE_INTERVAL}`);
    console.log(`📊 فلتر الحجم الأدنى: ${MIN_VOLUME.toLocaleString()}`);
    console.log(`🔄 سرعة المسح: كل ${SCAN_INTERVAL/1000} ثانية`);
    console.log(`⏱️ كولداون: ${cooldown/1000} ثانية`);
    console.log(`📊 عدد العملات: ${SYMBOLS.length}`);
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
  ║   ⚡ بوت V7 Pro - سكالبينج فائق السرعة                     ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT                          ║
  ║   📈 شراء: ≤ ${BUY_THRESHOLD}% | 📉 بيع: ≥ ${SELL_THRESHOLD}% ║
  ║   🕐 شمعة: ${CANDLE_INTERVAL} | 📊 حجم: ≥ ${(MIN_VOLUME/1000000).toFixed(0)}M ║
  ║   ⏱️ كولداون: ${cooldown/1000}ثانية | 🔄 مسح: ${SCAN_INTERVAL/1000}ثانية ║
  ║   📊 ${SYMBOLS.length} عملة | ⚡ دخول سريع جداً               ║
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
