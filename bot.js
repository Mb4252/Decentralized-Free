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

// ✅ إعدادات الإشارات (RSI)
const RSI_OVERSOLD = 45;   // تم التعديل
const RSI_OVERBOUGHT = 55; // تم التعديل

const CHECK_INTERVAL = 5000;
const STOP_LOSS_PERCENT = null;

// ✅ إعدادات الشمعة (1 دقيقة)
const CANDLE_INTERVAL = '1m';
const CANDLE_LIMIT = 50; // تم التعديل إلى 50

// ✅ إعدادات الفلاتر (معطلة حالياً)
const MIN_VOLUME = 0;
const MIN_PRICE = 0;
const MAX_CHANGE_24H = 100;

// ✅ المتغيرات
let lastPrices = {};
let currentPosition = null;
let isRunning = false;

let lastTradeTime = 0;
const cooldown = 3000;

// ✅ سرعة المسح
const SCAN_INTERVAL = 15000;

// ✅ تخزين العملات مؤقتاً
let cachedSymbols = [];
let lastSymbolsUpdate = 0;
const SYMBOLS_CACHE_TTL = 60000;

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
  FUTURES_TICKER: '/openApi/swap/v2/quote/ticker',
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
// ✅ جلب جميع العملات من السوق
// ==========================================

async function getAllSymbols() {
  const response = await bingxRequest(
    'GET',
    '/openApi/swap/v2/quote/contracts',
    {},
    false
  );

  if (!response || response.code !== 0) {
    return [];
  }

  return response.data;
}

// ==========================================
// ✅ جلب العملات المفلترة (مع كاش)
// ==========================================

async function getFilteredSymbols() {
  const now = Date.now();
  
  if (cachedSymbols.length > 0 && (now - lastSymbolsUpdate) < SYMBOLS_CACHE_TTL) {
    console.log(`📊 استخدام الكاش: ${cachedSymbols.length} عملة (منذ ${((now - lastSymbolsUpdate)/1000).toFixed(0)} ثانية)`);
    return cachedSymbols;
  }

  console.log('🔄 جلب العملات من السوق...');
  
  const contracts = await getAllSymbols();
  
  if (!contracts || contracts.length === 0) {
    console.log('⚠️ لم يتم جلب أي عملات');
    return [];
  }

  if (contracts.length > 0) {
    console.log('📋 أول عنصر في contracts:');
    console.log(JSON.stringify(contracts[0], null, 2));
  }

  const filtered = contracts.filter(c =>
    c.symbol && c.symbol.endsWith('USDT')
  );

  const limited = filtered.slice(0, 50);

  console.log(`✅ تم العثور على ${filtered.length} عملة USDT (تم أخذ ${limited.length} عملة فقط)`);
  
  const symbols = limited.map(c => c.symbol);
  
  cachedSymbols = symbols;
  lastSymbolsUpdate = now;
  
  return symbols;
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
// ✅ حساب EMA
// ==========================================

function calculateEMA(data, period) {
  if (data.length < period) return null;
  
  const k = 2 / (period + 1);
  let ema = data[0];
  
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  
  return ema;
}

// ==========================================
// ✅ حساب RSI
// ==========================================

function calculateRSI(data, period = 14) {
  if (data.length < period + 1) return null;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= period; i++) {
    const change = data[i] - data[i - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  for (let i = period + 1; i < data.length; i++) {
    const change = data[i] - data[i - 1];
    
    if (change >= 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1) + 0) / period;
    } else {
      avgGain = (avgGain * (period - 1) + 0) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  return rsi;
}

// ==========================================
// ✅ جلب بيانات الشمعة وتحليل المؤشرات
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

    if (!data || !Array.isArray(data)) return null;
    
    // ✅ تم التعديل: 50 شمعة كافية
    if (data.length < 50) {
      console.log(`📊 ${symbol}: بيانات غير كافية (${data.length} < 50)`);
      return null;
    }

    const closes = data.map(candle => Number(candle[4])).filter(price => !isNaN(price) && price > 0);
    
    if (closes.length < 20) return null;

    const currentClose = closes[closes.length - 1];
    const previousClose = closes[closes.length - 2];

    const ema9 = calculateEMA(closes, 9);
    const ema21 = calculateEMA(closes, 21);
    const rsi = calculateRSI(closes, 14);

    const ticker = await bingxRequest('GET', ENDPOINTS.FUTURES_TICKER, {
      symbol
    }, false);

    const changePercent24h = parseFloat(ticker?.data?.priceChangePercent || 0);
    const volume24h = parseFloat(ticker?.data?.volume || 0);

    // ✅ طباعة المؤشرات
    console.log(
      `${symbol} | EMA9=${ema9?.toFixed(4)} | EMA21=${ema21?.toFixed(4)} | RSI=${rsi?.toFixed(2)}`
    );

    return {
      symbol,
      currentClose,
      previousClose,
      ema9,
      ema21,
      rsi,
      changePercent24h,
      volume24h,
      changePercent: ((currentClose - previousClose) / previousClose) * 100
    };
  } catch (error) {
    console.error(`❌ فشل جلب شمعة ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ حساب كمية العقد
// ==========================================

function calculateQuantity(price, amount) {
  const quantity = (amount * LEVERAGE) / price;
  const roundedQuantity = parseFloat(quantity.toFixed(6));
  return roundedQuantity;
}

// ==========================================
// ✅ تعيين الرافعة
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
// فتح صفقة شراء
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
// فتح صفقة بيع
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

    const symbols = await getFilteredSymbols();
    
    if (!symbols || symbols.length === 0) {
      console.log('⚠️ لا توجد عملات مطابقة للفلاتر');
      isRunning = false;
      return;
    }

    console.log(`🔍 جاري مسح ${symbols.length} عملة محددة...`);
    
    let bestSymbol = null;
    let bestSignal = null;
    let bestScore = 0;

    for (const symbol of symbols) {
      const data = await getCandleData(symbol);
      if (!data) continue;

      const { ema9, ema21, rsi, volume24h, currentClose, previousClose, changePercent, changePercent24h } = data;

      if (ema9 === null || ema21 === null || rsi === null) {
        console.log(`📊 ${symbol}: بيانات غير كافية للمؤشرات`);
        continue;
      }

      // ✅ منطق الإشارة الجديد مع سكور الاتجاه
      let signal = null;
      let score = 0;

      // ✅ اتجاه صاعد: EMA9 > EMA21
      if (ema9 > ema21) {
        signal = 'BUY';
        score = ((ema9 - ema21) / ema21) * 100;
        console.log(`📊 ${symbol}: 📈 اتجاه صاعد | سكور=${score.toFixed(2)}`);
      }

      // ✅ اتجاه هابط: EMA9 < EMA21
      if (ema9 < ema21) {
        signal = 'SELL';
        score = ((ema21 - ema9) / ema21) * 100;
        console.log(`📊 ${symbol}: 📉 اتجاه هابط | سكور=${score.toFixed(2)}`);
      }

      // ✅ إذا كانت الإشارة شراء و RSI في منطقة التشبع البيعي (RSI < 45)
      if (signal === 'BUY' && rsi < RSI_OVERSOLD) {
        score *= 1.5; // مضاعفة السكور
        console.log(`📊 ${symbol}: ✅ RSI=${rsi.toFixed(2)} < ${RSI_OVERSOLD} (تشبع بيع) - تعزيز الشراء`);
      }

      // ✅ إذا كانت الإشارة بيع و RSI في منطقة التشبع الشرائي (RSI > 55)
      if (signal === 'SELL' && rsi > RSI_OVERBOUGHT) {
        score *= 1.5; // مضاعفة السكور
        console.log(`📊 ${symbol}: ✅ RSI=${rsi.toFixed(2)} > ${RSI_OVERBOUGHT} (تشبع شراء) - تعزيز البيع`);
      }

      if (!signal) continue;

      if (score > bestScore) {
        bestScore = score;
        bestSymbol = symbol;
        bestSignal = signal;
      }
    }

    // ✅ تنفيذ الصفقة
    if (bestSymbol && bestSignal && bestScore > 0) {
      console.log(`🚀 أفضل فرصة: ${bestSymbol} | ${bestSignal} | سكور: ${bestScore.toFixed(2)}`);

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
        <p class="subtitle">📡 اتجاه EMA + RSI</p>
        
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
            💰 <span class="highlight-green">0.80 USDT</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.05 USDT</span> &nbsp;|&nbsp;
            📈 شراء: <span class="highlight-green">EMA9>EMA21 + RSI&lt;45</span> &nbsp;|&nbsp;
            📉 بيع: <span class="highlight-red">EMA9&lt;EMA21 + RSI&gt;55</span> &nbsp;|&nbsp;
            📊 شموع: <span class="highlight-purple">50</span> &nbsp;|&nbsp;
            🔄 مسح: <span class="highlight-purple">15 ثانية</span>
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
      status: '⚡ بوت BingX - V7 Pro (اتجاه EMA + RSI)',
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
        rsiOversold: RSI_OVERSOLD,
        rsiOverbought: RSI_OVERBOUGHT,
        candleLimit: CANDLE_LIMIT,
        scanInterval: `${SCAN_INTERVAL/1000} ثانية`,
        leverage: `${LEVERAGE}x`,
        symbolsCount: cachedSymbols.length
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
    console.log('⚡⚡ بدء تشغيل بوت V7 Pro - اتجاه EMA + RSI');
    console.log('📊 ===== إعدادات V7 Pro =====');
    console.log(`💰 مبلغ التداول الثابت: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT`);
    console.log(`📈 شراء: EMA9 > EMA21 (RSI < ${RSI_OVERSOLD} تعزيز)`);
    console.log(`📉 بيع: EMA9 < EMA21 (RSI > ${RSI_OVERBOUGHT} تعزيز)`);
    console.log(`📊 عدد الشموع: ${CANDLE_LIMIT}`);
    console.log(`🔄 سرعة المسح: كل ${SCAN_INTERVAL/1000} ثانية`);
    console.log('================================');

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(4)}`);

    if (balance === 0) {
      console.log('⚠️ تحذير: الرصيد 0 أو غير متوفر.');
    }

    if (balance < TRADE_AMOUNT) {
      console.log(`⚠️ تحذير: الرصيد (${balance.toFixed(4)}) أقل من مبلغ التداول (${TRADE_AMOUNT})`);
    }

    await getFilteredSymbols();

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
  ║   ⚡ بوت V7 Pro - اتجاه EMA + RSI                          ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT                          ║
  ║   📈 شراء: EMA9>EMA21 + RSI<${RSI_OVERSOLD}                   ║
  ║   📉 بيع: EMA9<EMA21 + RSI>${RSI_OVERBOUGHT}                  ║
  ║   📊 شموع: ${CANDLE_LIMIT} | 🔄 مسح: ${SCAN_INTERVAL/1000}ثانية ║
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
