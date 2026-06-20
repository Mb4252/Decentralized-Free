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
const TRADE_AMOUNT = 4.8;
const USE_FULL_BALANCE = false;
const MAX_RISK_PER_TRADE = 0.01;

// ✅ الرافعة المالية
const LEVERAGE = 10;

// ✅ أهداف سكالبينج ثابتة (بدون ATR)
const FIXED_PROFIT_TARGET = 0.12;  // هدف ربح ثابت
const FIXED_STOP_LOSS = -0.12;     // وقف خسارة ثابت

// ✅ إعدادات الشمعة
const CANDLE_INTERVAL = '1m';
const CANDLE_LIMIT = 100;

// ✅ العملات الرئيسية
const SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "DOGE-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "SUI-USDT",
  "ADA-USDT",
  "TRX-USDT",
  "APT-USDT",
  "ARB-USDT"
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
// ✅ حساب EMA الحقيقي
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
// ✅ حساب RSI
// ==========================================

function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const rs = gains / (losses || 1);
  return 100 - (100 / (1 + rs));
}

// ==========================================
// ✅ حساب MACD
// ==========================================

function calculateMACD(closes) {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;

  const macdValues = [];
  for (let i = 0; i < closes.length; i++) {
    const e12 = calculateEMA(closes.slice(0, i + 1), 12);
    const e26 = calculateEMA(closes.slice(0, i + 1), 26);
    macdValues.push(e12 - e26);
  }

  const signal = calculateEMA(macdValues, 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

// ==========================================
// ✅ حساب ATR (للإشارات فقط)
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
// ✅ حساب VWAP
// ==========================================

function calculateVWAP(candles) {
  if (candles.length < 20) return 0;

  let cumVolumePrice = 0;
  let cumVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumVolumePrice += typicalPrice * candle.volume;
    cumVolume += candle.volume;
  }

  return cumVolumePrice / (cumVolume || 1);
}

// ==========================================
// ✅ حساب ADX
// ==========================================

function calculateADX(candles, period = 14) {
  if (candles.length < period + 1) return 0;

  const trs = [];
  const plusDM = [];
  const minusDM = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trs.push(tr);

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) {
      plusDM.push(upMove);
    } else {
      plusDM.push(0);
    }

    if (downMove > upMove && downMove > 0) {
      minusDM.push(downMove);
    } else {
      minusDM.push(0);
    }
  }

  const atr = calculateATR(candles, period);
  if (atr === 0) return 0;

  const plusDI = (plusDM.reduce((a, b) => a + b, 0) / trs.length) / atr * 100;
  const minusDI = (minusDM.reduce((a, b) => a + b, 0) / trs.length) / atr * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI + 0.0001) * 100;

  return dx;
}

// ==========================================
// ✅ حساب Volume Delta
// ==========================================

function calculateVolumeDelta(candles) {
  if (candles.length < 10) return 0;

  let buyVolume = 0;
  let sellVolume = 0;

  for (const candle of candles) {
    const body = Math.abs(candle.close - candle.open);
    const range = candle.high - candle.low;
    if (range === 0) continue;

    const buyRatio = (candle.close - candle.low) / range;
    const sellRatio = (candle.high - candle.close) / range;

    buyVolume += candle.volume * buyRatio;
    sellVolume += candle.volume * sellRatio;
  }

  const total = buyVolume + sellVolume;
  if (total === 0) return 0;

  return ((buyVolume - sellVolume) / total) * 100;
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
// ✅ تعديل الكمية
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
// ✅ فلترة السيولة - محسنة
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
    volatility > 0.00001
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
// ✅ التحقق من توافق الأطر الزمنية
// ==========================================

async function checkMultiTimeframe(symbol) {
  const intervals = ['1m', '3m', '5m'];
  const signals = [];

  for (const interval of intervals) {
    const candles = await getCandlesWithInterval(symbol, interval, 50);
    if (!candles || candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const rsi = calculateRSI(closes, 14);
    const macd = calculateMACD(closes);

    let signal = null;
    if (ema20 > ema50 && rsi < 40 && macd.histogram > 0) signal = 'BUY';
    else if (ema20 < ema50 && rsi > 60 && macd.histogram < 0) signal = 'SELL';

    signals.push({ interval, signal });
  }

  const buySignals = signals.filter(s => s.signal === 'BUY');
  const sellSignals = signals.filter(s => s.signal === 'SELL');

  if (buySignals.length >= 2) return 'BUY';
  if (sellSignals.length >= 2) return 'SELL';
  return null;
}

// ==========================================
// ✅ كشف Market Regime
// ==========================================

function detectMarketRegime(candles) {
  if (candles.length < 50) return 'NEUTRAL';
  
  const closes = candles.map(c => c.close);
  const adx = calculateADX(candles, 14);
  const rsi = calculateRSI(closes, 14);
  
  const avgRange = candles.slice(-20).reduce((sum, c) => sum + (c.high - c.low), 0) / 20;
  const avgClose = candles.slice(-20).reduce((sum, c) => sum + c.close, 0) / 20;
  const volatility = avgRange / avgClose;
  
  if (adx > 25 && volatility > 0.005) {
    if (rsi > 50) return 'BULL_TREND';
    return 'BEAR_TREND';
  }
  
  if (adx < 20 && volatility < 0.003) return 'RANGE';
  if (volatility > 0.01) return 'VOLATILE';
  
  return 'NEUTRAL';
}

// ==========================================
// ✅ نظام النقاط المحسن - مع Confidence
// ==========================================

async function checkSignal(candles, symbol, btcTrend) {
  if (!candles || candles.length < 50) return null;

  const current = candles[candles.length - 1];
  const closes = candles.map(c => c.close);

  // ✅ المؤشرات الفنية
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema100 = calculateEMA(closes, 100);
  const rsi = calculateRSI(closes, 14);
  const macd = calculateMACD(closes);
  const atr = calculateATR(candles, 14);
  const vwap = calculateVWAP(candles);
  const adx = calculateADX(candles, 14);
  const volumeDelta = calculateVolumeDelta(candles.slice(-20));
  const marketRegime = detectMarketRegime(candles);
  
  // ✅ متوسط الحجم والجسم
  const avgVolume = candles.slice(-11, -1)
    .reduce((s, c) => s + c.volume, 0) / 10;
  const avgBody = candles.slice(-11, -1)
    .reduce((s, c) => s + Math.abs(c.close - c.open), 0) / 10;

  const currentBody = Math.abs(current.close - current.open);
  const bodyRatio = currentBody / (avgBody || 0.000001);
  const volumeRatio = current.volume / (avgVolume || 0.000001);

  // ✅ Order Flow - السرعة
  const prevClose = candles[candles.length - 2].close;
  const velocity = ((current.close - prevClose) / prevClose) * 100;

  // ✅ كشف الاختراق - استبعاد الشمعة الحالية
  const last20High = Math.max(...candles.slice(-21, -1).map(c => c.high));
  const last20Low = Math.min(...candles.slice(-21, -1).map(c => c.low));
  const breakoutHigh = current.close > last20High;
  const breakoutLow = current.close < last20Low;

  // ✅ SMC - Break of Structure
  const prevHigh = candles[candles.length - 2].high;
  const prevLow = candles[candles.length - 2].low;
  const bosHigh = current.high > prevHigh && current.close < prevHigh;
  const bosLow = current.low < prevLow && current.close > prevLow;

  // ✅ كشف الحيتان
  const whaleCandle = volumeRatio > 5 && bodyRatio > 2 && current.close > current.open;
  const whaleCandleSell = volumeRatio > 5 && bodyRatio > 2 && current.close < current.open;

  // ✅ Multi Timeframe
  const mtfSignal = await checkMultiTimeframe(symbol);

  let buyScore = 0;
  let sellScore = 0;

  // ======== 1. TREND SCORE (80 نقطة) ========
  if (ema20 > ema50) buyScore += 20;
  if (ema20 < ema50) sellScore += 20;
  
  if (ema50 > ema100) buyScore += 10;
  if (ema50 < ema100) sellScore += 10;
  
  if (adx > 25 && ema20 > ema50) buyScore += 25;
  if (adx > 25 && ema20 < ema50) sellScore += 25;

  // ======== 2. MOMENTUM SCORE (80 نقطة) ========
  if (macd.histogram > 0 && macd.macd > macd.signal) buyScore += 20;
  if (macd.histogram < 0 && macd.macd < macd.signal) sellScore += 20;
  
  if (rsi < 30) buyScore += 15;
  if (rsi > 70) sellScore += 15;
  
  if (rsi > 55) buyScore += 15;
  if (rsi < 45) sellScore += 15;
  
  if (velocity > 0.15 && volumeRatio > 2) buyScore += 10;
  if (velocity < -0.15 && volumeRatio > 2) sellScore += 10;

  // ======== 3. VOLUME SCORE (80 نقطة) ========
  if (volumeRatio > 2) {
    buyScore += 15;
    sellScore += 15;
  }
  
  if (volumeDelta > 30) buyScore += 25;
  if (volumeDelta < -30) sellScore += 25;
  
  if (whaleCandle) buyScore += 20;
  if (whaleCandleSell) sellScore += 20;
  
  if (current.close > vwap) buyScore += 10;
  if (current.close < vwap) sellScore += 10;

  // ======== 4. MARKET STRUCTURE (60 نقطة) ========
  if (breakoutHigh) buyScore += 15;
  if (breakoutLow) sellScore += 15;
  
  if (bosHigh) sellScore += 15;
  if (bosLow) buyScore += 15;
  
  if (mtfSignal === 'BUY') buyScore += 20;
  if (mtfSignal === 'SELL') sellScore += 20;
  
  if (btcTrend === 'UP' && buyScore > 0) buyScore += 10;
  if (btcTrend === 'DOWN' && sellScore > 0) sellScore += 10;

  // ✅ حساب Confidence
  const maxScore = Math.max(buyScore, sellScore);
  const minScore = Math.min(buyScore, sellScore);
  const difference = Math.abs(buyScore - sellScore);
  const confidence = maxScore > 0 ? (difference / maxScore) * 100 : 0;

  console.log(`   📊 ${symbol} BUY=${buyScore} SELL=${sellScore} | Diff=${difference} | Confidence=${confidence.toFixed(1)}% | RSI=${rsi.toFixed(1)} | Delta=${volumeDelta.toFixed(1)}`);

  // ✅ ======== وضع القنص (مخفف) ========
  if (
    volumeDelta > 30 &&
    volumeRatio > 1.5 &&
    rsi < 35
  ) {
    console.log(`   🎯 وضع القنص BUY (Delta=${volumeDelta.toFixed(1)}, Vol=${volumeRatio.toFixed(1)}x, RSI=${rsi.toFixed(1)})`);
    return { signal: "BUY", atr: atr, entryPrice: current.close, isSnipe: true, confidence: confidence };
  }

  if (
    volumeDelta < -30 &&
    volumeRatio > 1.5 &&
    rsi > 65
  ) {
    console.log(`   🎯 وضع القنص SELL (Delta=${volumeDelta.toFixed(1)}, Vol=${volumeRatio.toFixed(1)}x, RSI=${rsi.toFixed(1)})`);
    return { signal: "SELL", atr: atr, entryPrice: current.close, isSnipe: true, confidence: confidence };
  }

  // ✅ ======== نظام الفروقات ========
  // شراء: buyScore >= 100 والفرق >= 40
  if (
    buyScore >= 100 &&
    (buyScore - sellScore) >= 40
  ) {
    console.log(`   ✅ إشارة BUY (${buyScore}/${sellScore}) | Confidence: ${confidence.toFixed(1)}%`);
    return { signal: "BUY", atr: atr, entryPrice: current.close, isSnipe: false, confidence: confidence };
  }

  // بيع: sellScore >= 100 والفرق >= 40
  if (
    sellScore >= 100 &&
    (sellScore - buyScore) >= 40
  ) {
    console.log(`   ✅ إشارة SELL (${buyScore}/${sellScore}) | Confidence: ${confidence.toFixed(1)}%`);
    return { signal: "SELL", atr: atr, entryPrice: current.close, isSnipe: false, confidence: confidence };
  }

  console.log(`   ❌ لا إشارة (BUY=${buyScore}, SELL=${sellScore}, Diff=${difference}, Need 100+40)`);
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
  console.log(`   📊 السبريد: ${spread.toFixed(3)}%`);
  return spread < 0.05;
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
// ✅ تنفيذ الأمر (بدون ATR)
// ==========================================

async function placeOrder(symbol, signalData, balance) {
  try {
    const price = await getPrice(symbol);
    if (!price) return null;

    const contractInfo = await getContractInfo(symbol);
    let roundedQuantity = calculateQuantity(price);
    
    if (contractInfo) {
      roundedQuantity = adjustQuantity(roundedQuantity, contractInfo);
    }
    
    console.log(`   📊 الكمية: ${roundedQuantity}`);
    console.log(`   💰 Balance: ${balance}`);
    console.log(`   💵 Price: ${price}`);
    console.log(`   🎯 وضع القنص: ${signalData.isSnipe ? 'نعم' : 'لا'}`);
    console.log(`   📊 الثقة: ${signalData.confidence?.toFixed(1) || 'N/A'}%`);
    
    if (roundedQuantity <= 0) return null;

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
      console.log(`   🎯 TP ثابت: ${FIXED_PROFIT_TARGET} USDT`);
      console.log(`   ⛔ SL ثابت: ${FIXED_STOP_LOSS} USDT`);
      
      console.log(`🚀 OPEN ${signalData.signal} ${symbol} (Confidence: ${signalData.confidence?.toFixed(1) || 'N/A'}%)`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: isBuy ? 'LONG' : 'SHORT',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now(),
        isSnipe: signalData.isSnipe || false,
        confidence: signalData.confidence || 0
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
    return null;
  }
}

// ==========================================
// ✅ جلب اتجاه BTC
// ==========================================

async function getBTCTrend() {
  const candles = await getCandles('BTC-USDT');
  if (!candles || candles.length < 50) return 'NEUTRAL';

  const closes = candles.map(c => c.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const rsi = calculateRSI(closes, 14);
  const adx = calculateADX(candles, 14);

  if (ema20 > ema50 * 1.01 && rsi > 50 && adx > 25) return 'UP';
  if (ema20 < ema50 * 0.99 && rsi < 50 && adx > 25) return 'DOWN';
  return 'NEUTRAL';
}

// ==========================================
// ✅ إغلاق صفقة
// ==========================================

async function closePosition(position, result = 'MANUAL') {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

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
        isSnipe: position.isSnipe || false,
        confidence: position.confidence || 0,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ تم إغلاق صفقة ${position.type}: ${position.symbol} (${result})`);
      return true;
    }
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
// ✅ الدورة الرئيسية - مع أهداف ثابتة (بدون ATR)
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await getFuturesBalance();
    console.log(`💰 الرصيد: ${balance.toFixed(4)} USDT`);

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

      // ✅ جني ربح ثابت
      if (profitUSDT >= FIXED_PROFIT_TARGET) {
        console.log(`🎯 جني ربح ثابت: ${profitUSDT.toFixed(4)} USDT (الهدف: ${FIXED_PROFIT_TARGET} USDT)`);
        await closePosition(currentPosition, 'FIXED_TP');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      // ✅ وقف خسارة ثابت
      if (profitUSDT <= FIXED_STOP_LOSS) {
        console.log(`⛔ وقف خسارة ثابت: ${profitUSDT.toFixed(4)} USDT (الحد: ${FIXED_STOP_LOSS} USDT)`);
        await closePosition(currentPosition, 'FIXED_SL');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      isRunning = false;
      return;
    }

    // ✅ كولداون
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

    // ✅ جلب اتجاه BTC
    const btcTrend = await getBTCTrend();
    console.log(`📊 اتجاه BTC: ${btcTrend}`);

    console.log(`🔍 جاري مسح ${SYMBOLS.length} عملة (معالجة متوازية)...`);
    
    // ✅ معالجة متوازية
    const results = await Promise.all(
      SYMBOLS.map(async (symbol) => {
        try {
          if (winRateBySymbol[symbol] !== undefined && winRateBySymbol[symbol] < 30) {
            return { symbol, signalData: null, error: 'نسبة ربح منخفضة' };
          }

          const candles = await getCandles(symbol);
          if (!candles || candles.length < 50) {
            return { symbol, signalData: null, error: 'بيانات غير كافية' };
          }

          console.log(`\n📊 تحليل ${symbol}:`);

          if (!strongMarket(candles)) {
            console.log(`   ${symbol} ❌ سيولة منخفضة`);
            return { symbol, signalData: null, error: 'سيولة منخفضة' };
          }

          const signalData = await checkSignal(candles, symbol, btcTrend);
          
          if (!signalData) {
            return { symbol, signalData: null, error: 'لا توجد إشارة' };
          }

          return { symbol, signalData, candles };
        } catch (error) {
          console.error(`❌ خطأ في تحليل ${symbol}:`, error.message);
          return { symbol, signalData: null, error: error.message };
        }
      })
    );

    // ✅ معالجة النتائج
    for (const result of results) {
      if (!result.signalData) continue;

      const { symbol, signalData } = result;
      
      console.log(`🚀 إشارة ${signalData.signal}: ${symbol}${signalData.isSnipe ? ' (وضع القنص)' : ''} (ثقة: ${signalData.confidence?.toFixed(1) || 'N/A'}%)`);

      if (!(await hasGoodSpread(symbol))) {
        console.log(`   ${symbol} سبريد مرتفع ❌`);
        continue;
      }

      await setLeverage(symbol);

      const position = await placeOrder(symbol, signalData, balance);
      if (position) {
        currentPosition = position;
        lastTradeTime = Date.now();
        console.log(`✅ تم الدخول: ${symbol} (${signalData.signal})`);
        console.log(`🎯 جني الربح الثابت: ${FIXED_PROFIT_TARGET} USDT`);
        console.log(`⛔ وقف الخسارة الثابت: ${FIXED_STOP_LOSS} USDT`);
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
        <p class="subtitle">🎯 TP: ${FIXED_PROFIT_TARGET} ثابت | ⛔ SL: ${FIXED_STOP_LOSS} ثابت</p>
        <div class="status-grid" id="statusGrid">
          <div class="card"><div class="label">📊 الحالة</div><div class="value"><span class="status-badge" id="statusBadge">🟢 يعمل</span></div></div>
          <div class="card"><div class="label">💰 الرصيد</div><div class="value green" id="balance">0.00 USDT</div></div>
          <div class="card"><div class="label">⚡ الرافعة</div><div class="value gold" id="leverage">10x</div></div>
          <div class="card" style="grid-column: span 3;"><div class="label">📈 الصفقة الحالية</div><div class="value blue" id="position">لا توجد صفقة</div></div>
        </div>
        <div class="trade-info" id="tradeInfo"><div class="label">💰 الربح / الخسارة</div><div class="value" id="profitDisplay">0.0000 USDT (0.00%)</div></div>
        <div class="settings-box">
          <div class="label">⚙️ إعدادات متقدمة</div>
          <div class="value">💰 <span class="highlight-green">${TRADE_AMOUNT} USDT</span> | ⚡ <span class="highlight-gold">${LEVERAGE}x</span> | 🎯 <span class="highlight-gold">${FIXED_PROFIT_TARGET} ثابت</span> | ⛔ <span class="highlight-red">${FIXED_STOP_LOSS} ثابت</span> | 📊 <span class="highlight-purple">عتبة 100 + فرق 40</span> | 🎯 <span class="highlight-purple">وضع القنص</span> | 📊 <span class="highlight-purple">Confidence</span></div>
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
      status: '⚡ بوت سكالبينج احترافي - أهداف ثابتة',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})${currentPosition.isSnipe ? ' [قنص]' : ''} (ثقة: ${currentPosition.confidence?.toFixed(1) || 'N/A'}%)` : 'لا توجد صفقة',
      profit: profit,
      profitPercent: profitPercent,
      tradesCount: tradesHistory.length,
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${FIXED_PROFIT_TARGET} ثابت`,
        stopLoss: `${FIXED_STOP_LOSS} ثابت`,
        leverage: `${LEVERAGE}x`,
        scoreThreshold: '100 + فرق 40',
        snipeMode: 'مفعل (مخفف)',
        confidence: 'مفعل',
        parallelProcessing: 'مفعل',
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

    console.log('⚡⚡ بدء تشغيل بوت سكالبينج احترافي');
    console.log('📊 ===== إعدادات متقدمة =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة: ${LEVERAGE}x`);
    console.log(`🎯 الهدف الثابت: ${FIXED_PROFIT_TARGET} USDT`);
    console.log(`⛔ وقف الخسارة الثابت: ${FIXED_STOP_LOSS} USDT`);
    console.log(`📊 نظام الدخول: عتبة 100 + فرق 40`);
    console.log(`📊 Confidence: مفعل`);
    console.log(`🎯 وضع القنص: مفعل (Delta>30, Vol>1.5, RSI<35/>65)`);
    console.log(`⚡ معالجة متوازية: مفعل`);
    console.log(`📊 العملات: ${SYMBOLS.length} عملة`);
    console.log(`🔄 سرعة المسح: ${SCAN_INTERVAL/1000} ثانية`);
    console.log('================================');

    for (const symbol of SYMBOLS) {
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
  ║   ⚡ بوت سكالبينج احترافي - أهداف ثابتة                    ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 ${TRADE_AMOUNT} USDT            ║
  ║   🎯 TP: ${FIXED_PROFIT_TARGET} ثابت | ⛔ SL: ${FIXED_STOP_LOSS} ثابت ║
  ║   📊 عتبة: 100 + فرق 40 | Confidence: مفعل                   ║
  ║   🎯 القنص: Delta>30 + Vol>1.5 + RSI Extreme                ║
  ║   ⚡ معالجة متوازية: مفعل                                    ║
  ║   📊 العملات: ${SYMBOLS.length} عملة                          ║
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
