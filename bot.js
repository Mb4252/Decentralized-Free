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
// إعدادات البوت - النسخة النهائية
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

// ✅ إعدادات التداول
const TRADE_AMOUNT = 7;
const USE_FULL_BALANCE = false;
const MAX_RISK_PER_TRADE = 0.01;
const LEVERAGE = 15;

// ✅ أهداف ثابتة
const PROFIT_USDT_TARGET = 0.4;
const MIN_PROFIT_USDT = 0.4;
const STOP_LOSS_USDT = 0.7;
const STOP_LOSS_ENABLED = true;

// ✅ إعدادات الدخول
const BUY_SCORE_THRESHOLD = 45;
const SELL_SCORE_THRESHOLD = 45;
const MIN_SCORE_DIFF = 10;

// ✅ دخول سريع - مشدد
const FAST_ENTRY_VOLUME = 2.0;
const FAST_ENTRY_MOMENTUM = 0.5;
const FAST_ENTRY_RSI_BUY = 52;
const FAST_ENTRY_RSI_SELL = 48;

// ✅ إعدادات الشمعة
const CANDLE_INTERVAL = '1m';
const TREND_INTERVAL = '5m';
const CANDLE_LIMIT = 100;

// ✅ العملات القوية فقط
const SYMBOLS = [
  "BTC-USDT", "ETH-USDT", "SOL-USDT", "BNB-USDT", "XRP-USDT",
  "DOGE-USDT", "LINK-USDT", "AVAX-USDT", "SUI-USDT", "APT-USDT",
  "TAO-USDT", "ONDO-USDT", "ENA-USDT", "SEI-USDT", "INJ-USDT",
  "FET-USDT", "RENDER-USDT", "NEAR-USDT", "HBAR-USDT", "TIA-USDT",
  "RUNE-USDT", "UNI-USDT", "AAVE-USDT"
];

// ✅ المتغيرات
let currentPosition = null;
let isRunning = false;
let lastTradeTime = 0;
const cooldown = 2000;
const SCAN_INTERVAL = 3000;

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
  FUTURES_DEPTH: '/openApi/swap/v2/quote/depth',
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
// ✅ حساب EMA
// ==========================================

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1] || 0;

  const multiplier = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = ((prices[i] - ema) * multiplier) + ema;
  }

  return ema;
}

// ==========================================
// ✅ حساب RSI - محسّن
// ==========================================

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];

    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// ==========================================
// ✅ حساب ATR
// ==========================================

function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 0;

  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);
  }

  let atr = 0;
  for (let i = 0; i < period && i < trs.length; i++) {
    atr += trs[trs.length - 1 - i];
  }
  atr = atr / Math.min(period, trs.length);
  
  return atr;
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
        console.log(`   ✅ Contract Info ${symbol}:`, contractInfoCache[symbol]);
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
// ✅ تعديل الكمية - مع حماية
// ==========================================

function adjustQuantity(quantity, contractInfo) {
  if (!contractInfo) return quantity;
  
  const { minQty, stepSize } = contractInfo;
  
  if (isNaN(quantity) || quantity <= 0) {
    console.log(`   ⚠️ كمية غير صالحة: ${quantity}`);
    return 0;
  }
  
  let adjusted = Math.max(quantity, minQty || 0);
  
  if (stepSize && stepSize > 0) {
    adjusted = Math.floor(adjusted / stepSize) * stepSize;
  }
  
  return Number(adjusted.toFixed(6));
}

// ==========================================
// ✅ فلترة السيولة
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

  console.log(`   📊 Vol=${avgVolume.toFixed(2)} | DollarVol=$${dollarVolume.toFixed(2)} | تذبذب=${(volatility * 100).toFixed(3)}%`);

  return (
    dollarVolume > 500 &&
    volatility > 0.0003
  );
}

// ==========================================
// ✅ جلب شموع بأطر زمنية مختلفة
// ==========================================

async function getCandlesWithInterval(symbol, interval, limit = 60) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol,
      interval: interval,
      limit: limit
    }, false);

    if (!response || response.code !== 0) return null;

    const raw = response?.data;
    let data = null;

    if (Array.isArray(raw)) {
      data = raw;
    } else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }

    if (!data || !Array.isArray(data) || data.length < 20) return null;

    return data.map(candle => ({
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
      time: Number(candle.time)
    })).filter(c => !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close) && c.high > 0 && c.low > 0);
  } catch (error) {
    return null;
  }
}

// ==========================================
// ✅ تحليل دفتر الأوامر (Order Book)
// ==========================================

async function getOrderBookAnalysis(symbol) {
  try {
    const response = await bingxRequest(
      'GET',
      ENDPOINTS.FUTURES_DEPTH,
      { symbol, limit: 50 },
      false
    );

    if (!response || response.code !== 0) return null;

    const data = response.data;
    if (!data || !data.bids || !data.asks) return null;

    let bidVolume = 0;
    let askVolume = 0;

    for (const bid of data.bids) {
      bidVolume += parseFloat(bid[1]);
    }

    for (const ask of data.asks) {
      askVolume += parseFloat(ask[1]);
    }

    const ratio = bidVolume / (askVolume || 1);
    const total = bidVolume + askVolume;
    const delta = ((bidVolume - askVolume) / total) * 100;

    return { bidVolume, askVolume, ratio, delta };
  } catch (error) {
    console.error(`❌ فشل جلب دفتر الأوامر:`, error);
    return null;
  }
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

    if (!response || response.code === 100400) return null;

    const raw = response?.data;
    let data = null;

    if (Array.isArray(raw)) {
      data = raw;
    } else if (Array.isArray(raw?.data)) {
      data = raw.data;
    } else if (Array.isArray(response?.data?.data)) {
      data = response.data.data;
    }

    if (!data || !Array.isArray(data) || data.length < 50) return null;

    return data.map(candle => ({
      open: Number(candle.open),
      high: Number(candle.high),
      low: Number(candle.low),
      close: Number(candle.close),
      volume: Number(candle.volume),
      time: Number(candle.time)
    })).filter(c => !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close) && c.high > 0 && c.low > 0);
  } catch (error) {
    return null;
  }
}

// ==========================================
// ✅ جلب السعر الفوري (Ticker) - مع دعم صيغ متعددة
// ==========================================

async function getTicker(symbol) {
  try {
    const response = await bingxRequest(
      'GET',
      ENDPOINTS.FUTURES_TICKER,
      { symbol },
      false
    );

    if (response && response.code === 0 && response.data) {
      const data = response.data;

      // ✅ محاولة استخراج السعر من عدة مصادر
      const price = parseFloat(
        data.lastPrice ||
        data.bidPrice ||
        data.askPrice ||
        data.price ||
        data.last ||
        0
      );

      const bid = parseFloat(data.bidPrice || data.bid || 0);
      const ask = parseFloat(data.askPrice || data.ask || 0);
      const volume = parseFloat(data.volume || data.vol || 0);

      return {
        price: price,
        bid: bid,
        ask: ask,
        volume: volume
      };
    }

    return null;
  } catch (error) {
    console.error(`❌ فشل جلب السعر ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ جلب اتجاه 5 دقائق
// ==========================================

async function getTrendDirection(symbol) {
  const candles = await getCandlesWithInterval(symbol, TREND_INTERVAL, 60);
  if (!candles || candles.length < 50) return 'NEUTRAL';

  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);

  if (ema20 > ema50 * 1.005) return 'UP';
  if (ema20 < ema50 * 0.995) return 'DOWN';
  return 'NEUTRAL';
}

// ==========================================
// ✅ نظام النقاط المحسن - مع فلتر RSI والاتجاه
// ==========================================

async function checkSignal(symbol) {
  try {
    const candles = await getCandles(symbol);
    if (!candles || candles.length < 50) return null;

    const current = candles[candles.length - 1];
    const closes = candles.map(c => c.close);
    const atr = calculateATR(candles, 14);

    const avgVolume = candles.slice(-11, -1)
      .reduce((s, c) => s + c.volume, 0) / 10;
    const avgBody = candles.slice(-11, -1)
      .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 10;

    const currentBody = Math.abs(current.close - current.open);
    const bodyRatio = currentBody / (avgBody || 0.000001);
    const volumeRatio = current.volume / (avgVolume || 0.000001);

    const last5 = candles.slice(-5);
    const momentum = ((last5[4].close - last5[0].open) / last5[0].open) * 100;

    const volumeSpike = current.volume > avgVolume * FAST_ENTRY_VOLUME;
    const volatility = (current.high - current.low) / current.close;
    const rsi = calculateRSI(closes, 14);
    const trend5m = await getTrendDirection(symbol);
    const orderBook = await getOrderBookAnalysis(symbol);

    const last20High = Math.max(...candles.slice(-21, -1).map(c => c.high));
    const last20Low = Math.min(...candles.slice(-21, -1).map(c => c.low));
    const breakoutHigh = current.close > last20High;
    const breakoutLow = current.close < last20Low;

    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const isUptrend = ema20 > ema50;
    const isDowntrend = ema20 < ema50;

    let buyScore = 0;
    let sellScore = 0;

    if (momentum > 0.15) buyScore += 25;
    if (momentum < -0.15) sellScore += 25;

    if (volumeSpike) {
      buyScore += 20;
      sellScore += 20;
    }

    if (rsi > 55) buyScore += 15;
    if (rsi < 45) sellScore += 15;

    if (trend5m === 'UP') buyScore += 15;
    if (trend5m === 'DOWN') sellScore += 15;

    if (orderBook) {
      if (orderBook.ratio > 1.2) buyScore += 15;
      if (orderBook.ratio < 0.8) sellScore += 15;
    }

    if (breakoutHigh) buyScore += 10;
    if (breakoutLow) sellScore += 10;

    // ✅ فلتر الاتجاه - لا تشتري إلا في اتجاه صاعد
    if (!isUptrend && buyScore > 0) buyScore = Math.max(0, buyScore - 30);
    // ✅ فلتر الاتجاه - لا تبيع إلا في اتجاه هابط
    if (!isDowntrend && sellScore > 0) sellScore = Math.max(0, sellScore - 30);

    // ✅ منع الشراء إذا RSI أعلى من 65
    if (rsi > 65 && buyScore > 0) buyScore = Math.max(0, buyScore - 20);
    
    // ✅ منع البيع إذا RSI أقل من 35
    if (rsi < 35 && sellScore > 0) sellScore = Math.max(0, sellScore - 20);

    const maxScore = Math.max(buyScore, sellScore);
    const difference = Math.abs(buyScore - sellScore);
    let confidence = Math.min(maxScore, 100);

    console.log(`   📊 ${symbol} BUY=${buyScore} SELL=${sellScore} | Diff=${difference} | Vol=${volumeRatio.toFixed(1)}x | Mom=${momentum.toFixed(2)}% | RSI=${rsi.toFixed(1)} | Trend=${isUptrend ? 'UP' : 'DOWN'} | Conf=${confidence.toFixed(1)}%`);

    // ======== ✅ الدخول السريع - مشدد ========
    // شراء سريع: Vol > 2x, Mom > 0.5%, RSI > 52
    if (
      volumeRatio > FAST_ENTRY_VOLUME &&
      momentum > FAST_ENTRY_MOMENTUM &&
      rsi > FAST_ENTRY_RSI_BUY &&
      isUptrend &&
      rsi < 65
    ) {
      console.log(`   🚀 دخول سريع BUY (Vol=${volumeRatio.toFixed(1)}x, Mom=${momentum.toFixed(2)}%, RSI=${rsi.toFixed(1)})`);
      return { signal: "BUY", atr: atr, entryPrice: current.close, confidence: 95, isFastEntry: true };
    }

    // بيع سريع: Vol > 2x, Mom < -0.5%, RSI < 48
    if (
      volumeRatio > FAST_ENTRY_VOLUME &&
      momentum < -FAST_ENTRY_MOMENTUM &&
      rsi < FAST_ENTRY_RSI_SELL &&
      isDowntrend &&
      rsi > 35
    ) {
      console.log(`   🚀 دخول سريع SELL (Vol=${volumeRatio.toFixed(1)}x, Mom=${momentum.toFixed(2)}%, RSI=${rsi.toFixed(1)})`);
      return { signal: "SELL", atr: atr, entryPrice: current.close, confidence: 95, isFastEntry: true };
    }

    // ======== ✅ نظام الفروقات مع فلتر RSI ========
    if (
      buyScore >= BUY_SCORE_THRESHOLD &&
      (buyScore - sellScore) >= MIN_SCORE_DIFF &&
      rsi < 65 &&
      isUptrend
    ) {
      console.log(`   ✅ إشارة BUY (${buyScore}/${sellScore}) | Confidence: ${confidence.toFixed(1)}%`);
      return { signal: "BUY", atr: atr, entryPrice: current.close, confidence: confidence, isFastEntry: false };
    }

    if (
      sellScore >= SELL_SCORE_THRESHOLD &&
      (sellScore - buyScore) >= MIN_SCORE_DIFF &&
      rsi > 35 &&
      isDowntrend
    ) {
      console.log(`   ✅ إشارة SELL (${buyScore}/${sellScore}) | Confidence: ${confidence.toFixed(1)}%`);
      return { signal: "SELL", atr: atr, entryPrice: current.close, confidence: confidence, isFastEntry: false };
    }

    console.log(`   ❌ لا إشارة (Need ${BUY_SCORE_THRESHOLD}+${MIN_SCORE_DIFF})`);
    return null;

  } catch (error) {
    console.error(`❌ خطأ في تحليل ${symbol}:`, error.message);
    return null;
  }
}

// ==========================================
// ✅ حساب كمية العقد - مع حماية من NaN
// ==========================================

function calculateQuantity(price) {
  if (!price || isNaN(price) || price <= 0 || !Number.isFinite(price)) {
    console.log(`   ⚠️ سعر غير صالح للحساب: ${price}`);
    return 0;
  }

  const quantity = (TRADE_AMOUNT * LEVERAGE) / price;
  return Number(quantity.toFixed(6));
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
      console.log(`   ✅ تم تثبيت الرافعة x${LEVERAGE} على ${symbol}`);
      return true;
    }
    return false;
  } catch (e) {
    console.log("   ❌ leverage error", e.message);
    return false;
  }
}

// ==========================================
// ✅ تنفيذ الأمر - مع حماية السعر والكمية
// ==========================================

async function placeOrder(symbol, signalData, balance) {
  try {
    const ticker = await getTicker(symbol);
    if (!ticker) {
      console.log(`   ❌ لا يمكن جلب السعر لـ ${symbol}`);
      return null;
    }

    // ✅ حماية السعر
    const price = Number(ticker.price);
    if (!Number.isFinite(price) || price <= 0) {
      console.log(`   ❌ سعر غير صالح ${symbol}:`, ticker);
      return null;
    }

    const contractInfo = await getContractInfo(symbol);
    console.log(`   📊 Contract Info:`, contractInfo);

    let roundedQuantity = calculateQuantity(price);
    console.log(`   📊 الكمية المحسوبة (قبل التعديل): ${roundedQuantity}`);

    if (contractInfo) {
      roundedQuantity = adjustQuantity(roundedQuantity, contractInfo);
    }

    console.log(`   📊 تفاصيل الأمر:`);
    console.log(`      symbol: ${symbol}`);
    console.log(`      price: ${price}`);
    console.log(`      quantity: ${roundedQuantity}`);
    console.log(`      side: ${signalData.signal}`);

    if (roundedQuantity <= 0 || isNaN(roundedQuantity) || !Number.isFinite(roundedQuantity)) {
      console.log(`   ❌ كمية غير صالحة: ${roundedQuantity}`);
      return null;
    }

    console.log(`   💰 Balance: ${balance}`);
    console.log(`   📊 الثقة: ${signalData.confidence?.toFixed(1) || 'N/A'}%`);
    console.log(`   🚀 دخول سريع: ${signalData.isFastEntry ? 'نعم' : 'لا'}`);

    const isBuy = signalData.signal === 'BUY';
    const params = {
      symbol: symbol,
      side: isBuy ? 'BUY' : 'SELL',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: isBuy ? 'LONG' : 'SHORT'
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`🚀 OPEN ${signalData.signal} ${symbol} (Confidence: ${signalData.confidence?.toFixed(1) || 'N/A'}%)${signalData.isFastEntry ? ' [دخول سريع]' : ''}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: isBuy ? 'LONG' : 'SHORT',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now(),
        atr: signalData.atr || 0.01,
        confidence: signalData.confidence || 0,
        isFastEntry: signalData.isFastEntry || false,
        highestProfit: 0
      };
    }
    console.log(`   ❌ فشل الصفقة:`, response?.msg || response);
    return null;
  } catch (error) {
    console.log("   ❌ فشل الصفقة:", error.message);
    return null;
  }
}

// ==========================================
// ✅ Trailing Stop
// ==========================================

function updateTrailingStop(position, currentPrice) {
  if (!position) return null;

  let profitUSDT = (currentPrice - position.entryPrice) * position.quantity;
  if (position.type === 'SHORT') {
    profitUSDT = (position.entryPrice - currentPrice) * position.quantity;
  }

  if (profitUSDT > position.highestProfit) {
    position.highestProfit = profitUSDT;
  }

  let newStopLoss = null;

  if (position.highestProfit >= 0.20) {
    newStopLoss = position.entryPrice + (position.type === 'LONG' ? -0.05 : 0.05);
  }

  if (position.highestProfit >= 0.35) {
    newStopLoss = position.entryPrice + (position.type === 'LONG' ? -0.15 : 0.15);
  }

  if (position.highestProfit >= 0.50) {
    newStopLoss = position.entryPrice + (position.type === 'LONG' ? -0.30 : 0.30);
  }

  return newStopLoss;
}

// ==========================================
// ✅ إغلاق صفقة
// ==========================================

async function closePosition(position, result = 'MANUAL') {
  try {
    const ticker = await getTicker(position.symbol);
    if (!ticker) return false;

    const currentPrice = Number(ticker.price);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      console.log(`   ❌ سعر غير صالح للإغلاق: ${currentPrice}`);
      return false;
    }

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
      const profit = (currentPrice - position.entryPrice) * position.quantity;
      const finalProfit = position.type === 'SHORT' ? -profit : profit;
      
      saveTrade({
        symbol: position.symbol,
        type: position.type,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        quantity: position.quantity,
        profit: finalProfit,
        result: finalProfit > 0 ? 'WIN' : 'LOSS',
        confidence: position.confidence || 0,
        isFastEntry: position.isFastEntry || false,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ تم إغلاق صفقة ${position.type}: ${position.symbol} (${result})`);
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
// ✅ جلب الرصيد
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
// ✅ الدورة الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

    if (currentPosition) {
      const ticker = await getTicker(currentPosition.symbol);
      if (!ticker) {
        console.log(`   ❌ لا يمكن جلب السعر لـ ${currentPosition.symbol}`);
        isRunning = false;
        return;
      }

      const currentPrice = Number(ticker.price);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        console.log(`   ❌ سعر غير صالح لـ ${currentPosition.symbol}`);
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
        console.log(`🎯 جني ربح: ${profitUSDT.toFixed(4)} USDT (الهدف: ${PROFIT_USDT_TARGET} USDT)`);
        await closePosition(currentPosition, 'TAKE_PROFIT');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      const newStopLoss = updateTrailingStop(currentPosition, currentPrice);
      if (newStopLoss) {
        const isStopLoss = currentPosition.type === 'LONG'
          ? currentPrice <= newStopLoss
          : currentPrice >= newStopLoss;
        
        if (isStopLoss) {
          console.log(`⛔ Trailing Stop: ${profitUSDT.toFixed(4)} USDT`);
          await closePosition(currentPosition, 'TRAILING_STOP');
          currentPosition = null;
          lastTradeTime = Date.now();
          isRunning = false;
          return;
        }
      }

      if (STOP_LOSS_ENABLED && profitUSDT < -STOP_LOSS_USDT) {
        console.log(`⛔ وقف خسارة: ${profitUSDT.toFixed(4)} USDT (الحد: -${STOP_LOSS_USDT} USDT)`);
        await closePosition(currentPosition, 'STOP_LOSS');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      isRunning = false;
      return;
    }

    if (Date.now() - lastTradeTime < cooldown) {
      console.log('⏳ كولداون...');
      isRunning = false;
      return;
    }

    if (balance < TRADE_AMOUNT) {
      console.log('⚠️ رصيد غير كافي');
      isRunning = false;
      return;
    }

    console.log(`🔍 جاري مسح ${SYMBOLS.length} عملة...`);
    
    const results = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          if (winRateBySymbol[symbol] !== undefined && winRateBySymbol[symbol] < 30) {
            return { symbol, signalData: null, error: 'نسبة ربح منخفضة' };
          }

          const signalData = await checkSignal(symbol);
          if (!signalData) {
            return { symbol, signalData: null, error: 'لا توجد إشارة' };
          }

          return { symbol, signalData };
        } catch (error) {
          console.error(`❌ خطأ في تحليل ${symbol}:`, error.message);
          return { symbol, signalData: null, error: error.message };
        }
      })
    );

    for (const result of results) {
      if (!result.signalData) continue;

      const { symbol, signalData } = result;
      
      console.log(`🚀 إشارة ${signalData.signal}: ${symbol} (ثقة: ${signalData.confidence?.toFixed(1) || 'N/A'}%)${signalData.isFastEntry ? ' [دخول سريع]' : ''}`);

      await setLeverage(symbol);

      const position = await placeOrder(symbol, signalData, balance);
      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();
        console.log(`✅ تم الدخول: ${symbol} (${signalData.signal})`);
        console.log(`🎯 هدف الربح: +${PROFIT_USDT_TARGET} USDT`);
        console.log(`⛔ وقف الخسارة: -${STOP_LOSS_USDT} USDT`);
        break;
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
      <title>لوحة تحكم البوت - سكالبينج احترافي</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; background: #0a0e17; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: #141b2b; border-radius: 20px; padding: 40px; max-width: 750px; width: 100%; box-shadow: 0 10px 30px rgba(0, 170, 85, 0.2); border: 1px solid #00aa55; }
        h1 { text-align: center; color: #00aa55; font-size: 28px; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #8899bb; margin-bottom: 25px; font-size: 14px; }
        .status-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .card { background: #1a2335; border-radius: 14px; padding: 16px 18px; border-left: 4px solid #00aa55; transition: 0.3s; }
        .card:hover { background: #1f2a40; }
        .card .label { font-size: 11px; color: #8899bb; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; color: #fff; }
        .card .value.green { color: #00aa55; }
        .card .value.gold { color: #f0b90b; }
        .card .value.blue { color: #4a9eff; }
        .card .value.red { color: #ff4444; }
        .card .value.purple { color: #a855f7; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 30px; font-size: 13px; font-weight: bold; background: #00aa55; color: #fff; }
        .footer { text-align: center; margin-top: 25px; font-size: 12px; color: #556688; border-top: 1px solid #1a2335; padding-top: 18px; }
        .refresh-btn { display: block; margin: 18px auto 0; padding: 10px 30px; background: #00aa55; border: none; border-radius: 30px; color: #fff; font-weight: bold; cursor: pointer; transition: 0.3s; }
        .refresh-btn:hover { background: #008844; transform: scale(1.02); }
        .settings-box { background: #1a2335; border-radius: 14px; padding: 14px 18px; margin-top: 16px; border: 1px solid #2a3a55; }
        .settings-box .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .settings-box .value { font-size: 15px; font-weight: bold; color: #aabbdd; margin-top: 4px; }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .settings-box .value .highlight-purple { color: #a855f7; }
        .trade-info { background: #1a2335; border-radius: 14px; padding: 16px 18px; margin-top: 12px; border: 1px solid #2a3a55; text-align: center; }
        .trade-info .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .trade-info .value { font-size: 20px; font-weight: bold; margin-top: 4px; }
        .profit-positive { color: #00aa55; }
        .profit-negative { color: #ff4444; }
        @media (max-width: 500px) { .status-grid { grid-template-columns: 1fr 1fr; } .container { padding: 20px; } }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>⚡ بوت سكالبينج احترافي</h1>
        <p class="subtitle">📊 23 عملة | عتبة 45+10 | دخول سريع 2x+0.5% | فلتر RSI+Trend</p>
        <div class="status-grid" id="statusGrid">
          <div class="card"><div class="label">📊 الحالة</div><div class="value"><span class="status-badge" id="statusBadge">🟢 يعمل</span></div></div>
          <div class="card"><div class="label">💰 الرصيد</div><div class="value green" id="balance">0.00 USDT</div></div>
          <div class="card"><div class="label">⚡ الرافعة</div><div class="value gold" id="leverage">15x</div></div>
          <div class="card" style="grid-column: span 3;"><div class="label">📈 الصفقة الحالية</div><div class="value blue" id="position">لا توجد صفقة</div></div>
        </div>
        <div class="trade-info" id="tradeInfo"><div class="label">💰 الربح / الخسارة</div><div class="value" id="profitDisplay">0.0000 USDT (0.00%)</div></div>
        <div class="settings-box">
          <div class="label">⚙️ إعدادات متقدمة</div>
          <div class="value">💰 <span class="highlight-green">7 USDT</span> | ⚡ <span class="highlight-gold">15x</span> | 🎯 <span class="highlight-gold">0.4 USDT</span> | ⛔ <span class="highlight-red">0.7 USDT</span> | 📊 <span class="highlight-purple">عتبة 45 + فرق 10</span> | 🚀 <span class="highlight-purple">دخول سريع 2x+0.5%</span> | 🛡️ <span class="highlight-purple">RSI+Trend</span></div>
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
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/', async (req, res) => {
  try {
    const usdtBalance = await getFuturesBalance();
    let profit = null;
    let profitPercent = null;
    
    if (currentPosition) {
      const ticker = await getTicker(currentPosition.symbol);
      if (ticker && ticker.price && Number.isFinite(ticker.price) && ticker.price > 0) {
        const currentPrice = ticker.price;
        let rawProfit = (currentPrice - currentPosition.entryPrice) * currentPosition.quantity;
        if (currentPosition.type === 'SHORT') {
          rawProfit = (currentPosition.entryPrice - currentPrice) * currentPosition.quantity;
        }
        profit = rawProfit;
        profitPercent = (profit / (currentPosition.entryPrice * currentPosition.quantity)) * 100;
      }
    }
    
    res.json({
      status: '⚡ بوت سكالبينج احترافي',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT`,
      profitTarget: `${PROFIT_USDT_TARGET} USDT`,
      stopLoss: `${STOP_LOSS_USDT} USDT`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})${currentPosition.isFastEntry ? ' [دخول سريع]' : ''}` : 'لا توجد صفقة',
      profit: profit,
      profitPercent: profitPercent,
      tradesCount: tradesHistory.length,
      symbolsCount: SYMBOLS.length,
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${PROFIT_USDT_TARGET} USDT`,
        stopLoss: `${STOP_LOSS_USDT} USDT`,
        leverage: `${LEVERAGE}x`,
        scoreThreshold: '45 + فرق 10',
        fastEntry: 'مفعل (2x + 0.5%)',
        rsiFilter: 'مفعل (RSI < 65 للشراء، RSI > 35 للبيع)',
        trendFilter: 'مفعل (EMA20 > EMA50 للشراء)',
        trailingStop: 'مفعل',
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
    loadTradesHistory();

    console.log('⚡⚡ بدء تشغيل بوت سكالبينج احترافي - النسخة النهائية');
    console.log('📊 ===== إعدادات متقدمة =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة: ${LEVERAGE}x`);
    console.log(`🎯 هدف الربح: ${PROFIT_USDT_TARGET} USDT (ثابت)`);
    console.log(`⛔ وقف الخسارة: ${STOP_LOSS_USDT} USDT (ثابت)`);
    console.log(`📊 نظام الدخول: عتبة ${BUY_SCORE_THRESHOLD} + فرق ${MIN_SCORE_DIFF}`);
    console.log(`🚀 دخول سريع: Vol>${FAST_ENTRY_VOLUME}x + Mom>${FAST_ENTRY_MOMENTUM}% + RSI>${FAST_ENTRY_RSI_BUY}`);
    console.log(`🛡️ فلتر RSI: شراء RSI<65, بيع RSI>35`);
    console.log(`🛡️ فلتر الاتجاه: شراء EMA20>EMA50, بيع EMA20<EMA50`);
    console.log(`📊 العملات: ${SYMBOLS.length} عملة قوية`);
    console.log(`🔄 سرعة المسح: ${SCAN_INTERVAL/1000} ثانية`);
    console.log('================================');

    for (const symbol of SYMBOLS.slice(0, 5)) {
      await getContractInfo(symbol);
    }

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

    console.log(`✅ البوت يعمل! مسح كل ${SCAN_INTERVAL/1000} ثانية`);

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
  ║   ⚡ بوت سكالبينج احترافي - النسخة النهائية                ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 ${TRADE_AMOUNT} USDT            ║
  ║   🎯 هدف: ${PROFIT_USDT_TARGET} USDT | ⛔ وقف: ${STOP_LOSS_USDT} USDT ║
  ║   📊 عتبة: ${BUY_SCORE_THRESHOLD} + فرق ${MIN_SCORE_DIFF}     ║
  ║   🚀 دخول سريع: ${FAST_ENTRY_VOLUME}x + ${FAST_ENTRY_MOMENTUM}% + RSI${FAST_ENTRY_RSI_BUY} ║
  ║   🛡️ فلتر RSI: شراء<65, بيع>35                               ║
  ║   🛡️ فلتر الاتجاه: شراء UP, بيع DOWN                        ║
  ║   📊 العملات: ${SYMBOLS.length} عملة قوية                     ║
  ║   🔄 مسح: ${SCAN_INTERVAL/1000} ثانية                         ║
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
