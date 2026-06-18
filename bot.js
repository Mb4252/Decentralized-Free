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
const CANDLE_LIMIT = 50;

// ✅ المتغيرات الجديدة للاستراتيجية المتقدمة
let lastPrices = {};
let currentPosition = null;
let isRunning = false;

let lastTradeTime = 0;
const cooldown = 15000; // 15 ثانية بين الصفقات

// ✅ تم تعديل الحساسية
const SCAN_INTERVAL = 1500; // 1.5 ثانية (أسرع)
const CHANGE_THRESHOLD = 0.03; // 0.03% (أكثر حساسية)
const PROFIT_USDT_TARGET = 0.1;

// ✅ إعدادات الفلاتر الجديدة
const MIN_CANDLE_RANGE = 0.08; // أقل نطاق شمعة مقبول
const MIN_SCORE = 0.1; // ✅ تم التخفيض من 0.3 إلى 0.1

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

    // تصفية الشمعات المكتملة فقط
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
// ✅ تحليل الشمعة (مع فلاتر قوية)
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

    // ✅ فلترة قوة الشموع
    const candleRange = ((currentHigh - currentLow) / currentLow) * 100;
    if (candleRange < MIN_CANDLE_RANGE) {
      console.log(`📊 ${symbol}: نطاق الشمعة ضعيف (${candleRange.toFixed(2)}% < ${MIN_CANDLE_RANGE}%)`);
      return null;
    }

    // ✅ حساب نسب الارتداد والنزول
    const bouncePercent = ((currentClose - currentLow) / currentLow) * 100;
    const dropPercent = ((currentHigh - currentClose) / currentHigh) * 100;

    // ✅ منع التذبذب - إذا كانت النسب متقاربة، نرفض الصفقة
    if (Math.abs(bouncePercent - dropPercent) < 0.02) {
      console.log(`📊 ${symbol}: تذبذب عالي (ارتداد=${bouncePercent.toFixed(2)}%, نزول=${dropPercent.toFixed(2)}%)`);
      return null;
    }

    // ✅ شروط الشراء
    const isBouncing = bouncePercent >= PRICE_CHANGE_THRESHOLD;
    const isRising = currentClose > previousClose;
    let shouldBuy = isBouncing && isRising;

    // ✅ تأكيد الاتجاه - منع الشراء إذا كان السعر أقل من الشمعة السابقة
    if (currentClose < previousClose && shouldBuy) {
      console.log(`📊 ${symbol}: اتجاه هابط، تم تجاهل إشارة الشراء`);
      shouldBuy = false;
    }

    // ✅ شروط البيع
    const isDropping = dropPercent >= PRICE_CHANGE_THRESHOLD;
    const isFalling = currentClose < previousClose;
    let shouldSell = isDropping && isFalling;

    // ✅ تأكيد الاتجاه - منع البيع إذا كان السعر أعلى من الشمعة السابقة
    if (currentClose > previousClose && shouldSell) {
      console.log(`📊 ${symbol}: اتجاه صاعد، تم تجاهل إشارة البيع`);
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
// ✅ فلتر الاتجاه العام (معدل)
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
// ✅ سكالبينج احترافي - المسح السريع (معدل للحساسية العالية)
// ==========================================

async function fastScan() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    // إدارة الصفقة المفتوحة
    if (currentPosition) {
      const price = await getPrice(currentPosition.symbol);
      if (!price) {
        isRunning = false;
        return;
      }

      let profitUSDT =
        currentPosition.type === 'LONG'
          ? (price - currentPosition.entryPrice) * currentPosition.quantity * LEVERAGE
          : (currentPosition.entryPrice - price) * currentPosition.quantity * LEVERAGE;

      console.log(`⚡ الربح الحالي: ${profitUSDT.toFixed(4)} USDT`);

      if (profitUSDT >= PROFIT_USDT_TARGET) {
        console.log(`🎯 هدف تحقق: ${profitUSDT.toFixed(4)} USDT`);
        await closePosition(currentPosition);
        currentPosition = null;
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

    let bestSymbol = null;
    let bestScore = 0;
    let bestDirection = null;
    let bestCandleAnalysis = null;

    for (const symbol of SYMBOLS) {
      // ✅ تحليل الشمعة أولاً
      const candleAnalysis = await analyzeCandle(symbol);
      if (!candleAnalysis) continue;

      // ✅ إذا لم تكن هناك إشارة شراء أو بيع من الشمعة، تخطي
      if (!candleAnalysis.shouldBuy && !candleAnalysis.shouldSell) continue;

      const price = await getPrice(symbol);
      if (!price) continue;

      if (!lastPrices[symbol]) {
        lastPrices[symbol] = price;
        continue;
      }

      const oldPrice = lastPrices[symbol];
      const change = ((price - oldPrice) / oldPrice) * 100;
      lastPrices[symbol] = price;

      // ✅ التقاط الميكرو موف - حساسية عالية جداً (0.02%)
      if (Math.abs(change) < 0.02) {
        console.log(`📊 ${symbol}: حركة صغيرة جداً (${change.toFixed(3)}%) - تم تجاهلها`);
        continue;
      }

      const trend = await getTrend(symbol);
      if (!trend) continue;

      /**
       * 🔥 SCORE SYSTEM (الذكاء الحقيقي) - معدل للحساسية العالية
       */
      let score = Math.abs(change) * 2 + trend.strength * 1.5;

      // ✅ إضافة قوة الشمعة إلى السكور
      if (candleAnalysis.candleRange) {
        score += candleAnalysis.candleRange * 0.8;
      }

      // ✅ دعم الاتجاه من تحليل الشمعة
      if (candleAnalysis.shouldBuy && trend.trend === 'UP') score *= 2.0;
      if (candleAnalysis.shouldSell && trend.trend === 'DOWN') score *= 2.0;

      // ✅ تأكيد الاتجاه مع إشارة الشمعة
      let direction = null;
      if (candleAnalysis.shouldBuy && change > 0) direction = 'BUY';
      if (candleAnalysis.shouldSell && change < 0) direction = 'SELL';

      if (!direction) continue;

      // ✅ منع الدخول المباشر - السكور أقل من 0.1
      if (score < MIN_SCORE) {
        console.log(`📊 ${symbol}: السكور منخفض (${score.toFixed(2)} < ${MIN_SCORE})`);
        continue;
      }

      if (score > bestScore) {
        bestScore = score;
        bestSymbol = symbol;
        bestDirection = direction;
        bestCandleAnalysis = candleAnalysis;
      }

      console.log(`📊 ${symbol} | change=${change.toFixed(3)}% | trend=${trend.trend} | score=${score.toFixed(2)} | signal=${direction}`);
    }

    // تنفيذ الصفقة - شرط القوة مخفض إلى 0.1
    if (bestSymbol && bestDirection && bestScore > 0.1) {
      console.log(`🚀 أفضل فرصة: ${bestSymbol} | ${bestDirection} | score=${bestScore.toFixed(2)}`);
      if (bestCandleAnalysis) {
        console.log(`📊 تفاصيل الشمعة: قاع=${bestCandleAnalysis.currentLow}, قمة=${bestCandleAnalysis.currentHigh}, نطاق=${bestCandleAnalysis.candleRange.toFixed(2)}%`);
      }

      await setLeverage(bestSymbol);

      let position =
        bestDirection === 'BUY'
          ? await openLongPosition(bestSymbol, TRADE_AMOUNT)
          : await openShortPosition(bestSymbol, TRADE_AMOUNT);

      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();

        console.log(`✅ تم الدخول: ${bestSymbol} (${bestDirection})`);
      }
    } else {
      console.log('⏳ لا توجد فرصة قوية الآن');
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
        <h1>🤖 بوت BingX Futures</h1>
        <p class="subtitle">📡 سكالبينج فائق الحساسية - مايكرو موف</p>
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
          <div class="label">⚙️ إعدادات التداول - حساسية عالية</div>
          <div class="value">
            💰 <span class="highlight-green">1.40 USDT</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.10 USDT</span> &nbsp;|&nbsp;
            📈 عتبة: <span class="highlight-gold">0.03%</span> &nbsp;|&nbsp;
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
      status: '⚡ بوت BingX Futures - سكالبينج فائق الحساسية',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})` : 'لا توجد',
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${PROFIT_USDT_TARGET} USDT`,
        changeThreshold: `${CHANGE_THRESHOLD}%`,
        minCandleRange: `${MIN_CANDLE_RANGE}%`,
        minScore: `${MIN_SCORE}`,
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
    console.log('⚡⚡ بدء تشغيل بوت العقود الآجلة (BingX)');
    console.log('📊 ===== إعدادات التداول =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT`);
    console.log(`📈 عتبة التغير: ${CHANGE_THRESHOLD}% (حساسية عالية)`);
    console.log(`🕯️ الحد الأدنى لنطاق الشمعة: ${MIN_CANDLE_RANGE}%`);
    console.log(`📊 الحد الأدنى للسكور: ${MIN_SCORE} (حساسية عالية)`);
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

    console.log(`✅ البوت يعمل بنجاح! يتم التحديث كل ${SCAN_INTERVAL/1000} ثانية`);

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
  ║   ⚡ بوت العقود الآجلة - سكالبينج فائق الحساسية            ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT      ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT | 📈 عتبة: ${CHANGE_THRESHOLD}%  ║
  ║   🕯️ نطاق شمعة: ≥${MIN_CANDLE_RANGE}% | 📊 سكور: ≥${MIN_SCORE}  ║
  ║   ⏱️ كولداون: ${cooldown/1000} ثانية | 🔄 مسح: ${SCAN_INTERVAL/1000} ثانية ║
  ║   📡 التقاط مايكرو موف (0.02%)                               ║
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
