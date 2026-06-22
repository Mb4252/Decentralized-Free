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
// إعدادات البوت (BingX Futures) - سكالبينج احترافي
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

// ✅ إعدادات رأس المال والمخاطرة
const TRADE_AMOUNT = 5;
const USE_FULL_BALANCE = false;
const MAX_RISK_PER_TRADE = 0.01;

// ✅ الرافعة المالية
const LEVERAGE = 10;

// ✅ أهداف سكالبينج سريعة
const PROFIT_USDT_TARGET = 0.12;
const MIN_PROFIT_USDT = 0.12;

// ✅ وقف الخسارة - ✅ مفعل
const STOP_LOSS_ENABLED = true;
const STOP_LOSS_USDT = 0.12;

// ✅ إعدادات الشمعة (1 دقيقة)
const CANDLE_INTERVAL = '1m';
const CANDLE_LIMIT = 50;

// ✅ قائمة العملات
const SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "AVAX-USDT"
];

// ✅ المتغيرات
let currentPosition = null;
let isRunning = false;
let lastTradeTime = 0;
const cooldown = 1000;

// ✅ سرعة المسح
const SCAN_INTERVAL = 1000;

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
        console.log(`✅ تم جلب معلومات العقد لـ ${symbol}:`, contractInfoCache[symbol]);
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
// ✅ تعديل الكمية حسب متطلبات المنصة
// ==========================================

function adjustQuantity(quantity, contractInfo) {
  if (!contractInfo) return quantity;
  
  const { minQty, stepSize } = contractInfo;
  
  let adjusted = Math.max(quantity, minQty);
  
  if (stepSize > 0) {
    adjusted = Math.floor(adjusted / stepSize) * stepSize;
  }
  
  return Number(adjusted.toFixed(6));
}

// ==========================================
// ✅ فلترة السيولة - مخففة
// ==========================================

function strongMarket(candles) {
  if (!candles || candles.length < 10) return false;

  const avgVolume =
    candles.slice(-10)
      .reduce((sum, c) => sum + Number(c.volume), 0) / 10;

  const last = candles[candles.length - 1];

  const volatility =
    (last.high - last.low) / last.close;

  const dollarVolume = last.close * avgVolume;

  console.log(`📊 السيولة: $${dollarVolume.toFixed(2)} | التذبذب: ${(volatility * 100).toFixed(3)}%`);

  return (
    dollarVolume > 3000 &&      // ✅ تم التخفيف
    volatility > 0.00008        // ✅ تم التخفيف
  );
}

// ==========================================
// ✅ نظام النقاط للإشارات
// ==========================================

function checkSignal(candles, symbol) {
  if (!candles || candles.length < 50) {
    console.log(`${symbol} ❌ بيانات غير كافية (${candles?.length || 0}/50)`);
    return null;
  }

  const current = candles[candles.length - 1];

  // ✅ حساب EMA20 و EMA50
  const closePrices = candles.map(c => c.close);
  const ema20 = closePrices.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ema50 = closePrices.slice(-50).reduce((a, b) => a + b, 0) / 50;

  // ✅ متوسط الحجم والجسم (آخر 10 شموع قبل الحالية)
  const avgVolume = candles.slice(-11, -1)
    .reduce((s, c) => s + c.volume, 0) / 10;

  const avgBody = candles.slice(-11, -1)
    .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 10;

  const currentBody = Math.abs(current.close - current.open);
  const bodyRatio = currentBody / (avgBody || 0.000001);
  const volumeRatio = current.volume / (avgVolume || 0.000001);

  let buyScore = 0;
  let sellScore = 0;

  // ✅ 1. الاتجاه العام (20 نقطة)
  if (ema20 > ema50) buyScore += 20;
  if (ema20 < ema50) sellScore += 20;

  // ✅ 2. حجم التداول (20 نقطة)
  if (volumeRatio > 1.1) {
    buyScore += 20;
    sellScore += 20;
  }

  // ✅ 3. قوة الشمعة (15 نقطة)
  if (bodyRatio > 0.8) {
    buyScore += 15;
    sellScore += 15;
  }

  // ✅ 4. اتجاه آخر 3 شموع (20 نقطة)
  const c1 = candles[candles.length - 2];
  const c2 = candles[candles.length - 3];
  const c3 = candles[candles.length - 4];

  if (c1.close > c1.open && c2.close > c2.open && c3.close > c3.open) {
    buyScore += 20;
  }

  if (c1.close < c1.open && c2.close < c2.open && c3.close < c3.open) {
    sellScore += 20;
  }

  // ✅ 5. الشمعة الحالية (25 نقطة)
  if (current.close > current.open) buyScore += 25;
  if (current.close < current.open) sellScore += 25;

  console.log(`📊 ${symbol} BUY=${buyScore} SELL=${sellScore} | body=${bodyRatio.toFixed(2)}x volume=${volumeRatio.toFixed(2)}x`);

  // ✅ القرار النهائي
  if (buyScore >= 70) {
    console.log(`   ✅ إشارة BUY (${buyScore}/100)`);
    return "BUY";
  }

  if (sellScore >= 70) {
    console.log(`   ✅ إشارة SELL (${sellScore}/100)`);
    return "SELL";
  }

  console.log(`   ❌ لا إشارة (أعلى نقاط: ${Math.max(buyScore, sellScore)}/70)`);
  return null;
}

// ==========================================
// ✅ فحص السبريد
// ==========================================

async function hasGoodSpread(symbol) {
  const ticker = await bingxRequest(
    'GET',
    ENDPOINTS.FUTURES_TICKER,
    { symbol },
    false
  );

  if (!ticker?.data) return false;

  const bid = Number(ticker.data.bidPrice);
  const ask = Number(ticker.data.askPrice);

  const spread = ((ask - bid) / bid) * 100;

  console.log(`📊 السبريد: ${spread.toFixed(3)}%`);
  
  return spread < 0.05;
}

// ==========================================
// ✅ جلب العملات
// ==========================================

async function getTopVolumeSymbols() {
  return SYMBOLS;
}

// ==========================================
// ✅ جلب بيانات الشمعة
// ==========================================

async function getCandles(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol,
      interval: CANDLE_INTERVAL,
      limit: CANDLE_LIMIT
    }, false);

    if (!response) {
      console.log(symbol, "API_FAILED");
      return null;
    }

    if (response.code === 100400) {
      console.log(`⚠️ الرمز ${symbol} غير موجود`);
      return null;
    }

    const raw = response?.data;

    let data = null;

    if (Array.isArray(raw)) {
      data = raw;
    } else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }

    if (!data || !Array.isArray(data) || data.length < 50) {
      console.log(symbol, `بيانات غير كافية: ${data ? data.length : 0}/50`);
      return null;
    }

    const candles = data.map(candle => ({
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
      time: Number(candle.time)
    })).filter(c => !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close) && c.high > 0 && c.low > 0);

    if (candles.length < 50) {
      console.log(symbol, `بيانات غير صالحة بعد التصفية: ${candles.length}/50`);
      return null;
    }

    console.log(symbol, `✅ تم جلب ${candles.length} شمعة`);
    return candles;
  } catch (error) {
    console.error(`❌ فشل جلب شمعة ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ حساب كمية العقد
// ==========================================

function calculateQuantity(price) {
  return Number((TRADE_AMOUNT * LEVERAGE / price).toFixed(6));
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
      console.log(`✅ تم تثبيت الرافعة x${LEVERAGE} على ${symbol}`);
      return true;
    }

    return false;
  } catch (e) {
    console.log("❌ leverage error", e.message);
    return false;
  }
}

// ==========================================
// ✅ تنفيذ الأمر
// ==========================================

async function placeOrder(symbol, side, balance) {
  try {
    const price = await getPrice(symbol);
    if (!price) {
      console.log(`⚠️ لا يمكن تنفيذ الأمر: سعر ${symbol} غير متوفر`);
      return null;
    }

    const contractInfo = await getContractInfo(symbol);
    let roundedQuantity = calculateQuantity(price);
    
    if (contractInfo) {
      roundedQuantity = adjustQuantity(roundedQuantity, contractInfo);
    }
    
    console.log("📊 الكمية المحسوبة:", roundedQuantity);
    console.log("💰 Balance:", balance);
    console.log("💰 Trade Amount:", TRADE_AMOUNT);
    console.log("⚡ Leverage:", LEVERAGE);
    console.log("💵 Price:", price);
    
    if (roundedQuantity <= 0) {
      console.log('⚠️ كمية غير صالحة');
      return null;
    }

    const isBuy = side === 'BUY';
    console.log(`📊 ${isBuy ? 'شراء' : 'بيع'} (${side}): ${roundedQuantity} ${symbol} بسعر ${price}`);

    const params = {
      symbol: symbol,
      side: isBuy ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: isBuy ? 'LONG' : 'SHORT'
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    console.log('📡 رد المنصة:');
    console.log(JSON.stringify(response, null, 2));

    if (response && response.code === 0) {
      console.log(`🚀 OPEN ${side} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: isBuy ? 'LONG' : 'SHORT',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now()
      };
    }
    console.log(`❌ فشل الصفقة:`, response?.msg || response);
    return null;
  } catch (error) {
    console.log("❌ فشل الصفقة:", error.message);
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

      // ✅ جني الربح
      if (profitUSDT >= PROFIT_USDT_TARGET) {
        console.log(`🎯 إغلاق الصفقة: ربح كافي ${profitUSDT.toFixed(4)} USDT`);
        await closePosition(currentPosition);
        currentPosition = null;
        lastTradeTime = Date.now();
      }
      
      // ✅ وقف الخسارة - مفعل
      if (STOP_LOSS_ENABLED && profitUSDT < -STOP_LOSS_USDT) {
        console.log(`⛔ وقف خسارة: ${profitUSDT.toFixed(4)} USDT (الحد: -${STOP_LOSS_USDT} USDT)`);
        await closePosition(currentPosition);
        currentPosition = null;
        lastTradeTime = Date.now();
      }

      isRunning = false;
      return;
    }

    // ✅ كولداون - 1 ثانية
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

    const symbols = await getTopVolumeSymbols();
    
    if (!symbols || symbols.length === 0) {
      console.log('⚠️ لا توجد عملات');
      isRunning = false;
      return;
    }

    console.log(`🔍 جاري مسح ${symbols.length} عملة (سكالبينج)...`);
    
    for (const symbol of symbols) {
      const candles = await getCandles(symbol);
      
      if (!candles || candles.length < 50) continue;

      // ✅ فحص الإشارة بنظام النقاط
      const signal = checkSignal(candles, symbol);
      
      if (signal) {
        console.log(`🚀 إشارة ${signal}: ${symbol}`);

        // ✅ فحص السبريد
        if (!(await hasGoodSpread(symbol))) {
          console.log(`${symbol} سبريد مرتفع ❌`);
          continue;
        }
        console.log(`${symbol} سبريد جيد ✅`);

        const leverageSet = await setLeverage(symbol);
        if (!leverageSet) {
          console.log(`❌ فشل تعيين الرافعة`);
          continue;
        }

        const position = await placeOrder(symbol, signal, balance);
        if (position) {
          currentPosition = position;
          lastTradeTime = Date.now();
          console.log(`✅ تم الدخول: ${symbol} (${signal})`);
          console.log(`⛔ وقف الخسارة: -${STOP_LOSS_USDT} USDT`);
          console.log(`🎯 هدف الربح: +${PROFIT_USDT_TARGET} USDT`);
          break;
        }
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
      <title>لوحة تحكم البوت - سكالبينج</title>
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
        <h1>⚡ بوت سكالبينج</h1>
        <p class="subtitle">📡 شموع 1 دقيقة - نظام نقاط 100%</p>
        
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
          <div class="label">⚙️ إعدادات سكالبينج</div>
          <div class="value">
            💰 <span class="highlight-green">5 USDT</span> &nbsp;|&nbsp;
            ⚡ <span class="highlight-gold">10x رافعة</span> &nbsp;|&nbsp;
            🎯 هدف: <span class="highlight-gold">0.12 USDT</span> &nbsp;|&nbsp;
            ⛔ وقف: <span class="highlight-red">0.12 USDT</span> &nbsp;|&nbsp;
            🕐 شمعة: <span class="highlight-purple">1 دقيقة</span> &nbsp;|&nbsp;
            📊 عملات: <span class="highlight-purple">BTC, ETH, SOL, XRP, DOGE, AVAX</span> &nbsp;|&nbsp;
            🔄 مسح: <span class="highlight-purple">1 ثانية</span> &nbsp;|&nbsp;
            📊 نظام: <span class="highlight-purple">نقاط (عتبة 70)</span>
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
      status: '⚡ بوت سكالبينج - نظام نقاط 100%',
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
        stopLoss: `${STOP_LOSS_USDT} USDT`,
        riskPerTrade: `${MAX_RISK_PER_TRADE * 100}%`,
        candleInterval: '1 دقيقة',
        scanInterval: `${SCAN_INTERVAL/1000} ثانية`,
        leverage: `${LEVERAGE}x`,
        scoreThreshold: '70 نقطة',
        symbols: SYMBOLS
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
    console.log('⚡⚡ بدء تشغيل بوت سكالبينج - نظام نقاط 100%');
    console.log('📊 ===== إعدادات سكالبينج =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة المالية: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT`);
    console.log(`⛔ وقف الخسارة: ${STOP_LOSS_USDT} USDT`);
    console.log(`📊 عتبة النقاط: 70/100`);
    console.log(`📊 نظام النقاط:`);
    console.log(`   📈 الاتجاه (EMA): 20 نقطة`);
    console.log(`   📊 حجم التداول: 20 نقطة`);
    console.log(`   🔥 قوة الشمعة: 15 نقطة`);
    console.log(`   📉 آخر 3 شموع: 20 نقطة`);
    console.log(`   🕯️ الشمعة الحالية: 25 نقطة`);
    console.log(`📊 شرط السيولة: $3,000 | تذبذب: 0.008%`);
    console.log(`🕐 فترة الشمعة: ${CANDLE_INTERVAL}`);
    console.log(`📊 العملات: ${SYMBOLS.join(', ')}`);
    console.log(`🔄 سرعة المسح: كل ${SCAN_INTERVAL/1000} ثانية`);
    console.log(`⛔ وقف الخسارة: ${STOP_LOSS_ENABLED ? 'مفعل' : 'معطل'}`);
    console.log('================================');

    console.log('📡 جاري جلب معلومات العقود...');
    for (const symbol of SYMBOLS) {
      await getContractInfo(symbol);
    }

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
  ║   ⚡ بوت سكالبينج - نظام نقاط 100%                        ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 مبلغ: ${TRADE_AMOUNT} USDT    ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT | ⛔ وقف: ${STOP_LOSS_USDT} USDT ║
  ║   📊 عتبة النقاط: 70/100                                     ║
  ║   📈 الاتجاه: 20 | 📊 حجم: 20 | 🔥 قوة: 15                  ║
  ║   📉 3 شموع: 20 | 🕯️ حالية: 25                              ║
  ║   📊 سيولة: $3,000 | تذبذب: 0.008%                          ║
  ║   🕐 شمعة: ${CANDLE_INTERVAL} | 📊 ${SYMBOLS.length} عملة     ║
  ║   📊 العملات: ${SYMBOLS.join(', ')}                          ║
  ║   🔄 مسح: ${SCAN_INTERVAL/1000} ثانية                         ║
  ║   ⛔ وقف الخسارة: مفعل                                       ║
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
