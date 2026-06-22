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
// إعدادات البوت - HYPE MOMENTUM
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;

// ==========================================
// إعدادات التداول
// ==========================================

const TRADE_AMOUNT = 3.5;        // مبلغ الدخول الثابت
const LEVERAGE = 30;              // الرافعة المالية
const FIXED_PROFIT_TARGET = 0.40; // هدف الربح الثابت
const FIXED_STOP_LOSS = -0.7;    // وقف الخسارة الثابت

// ==========================================
// إعدادات HYPE MOMENTUM
// ==========================================

const HYPE_VOLUME_MULTIPLIER = 2.0;  // مضاعف حجم الهيب
const DUMP_VOLUME_MULTIPLIER = 1.5;  // مضاعف حجم الدмп

// ==========================================
// إعدادات المسح
// ==========================================

const SCAN_INTERVAL = 5000;    // سرعة المسح (5 ثواني)
const COOLDOWN = 0;            // بدون كولداون

// ==========================================
// حساب الحركة المطلوبة للربح
// ==========================================

const REQUIRED_MOVE = FIXED_PROFIT_TARGET / (TRADE_AMOUNT * LEVERAGE);

// ==========================================
// العملات المتداولة - أكثر من 50 عملة قوية
// ==========================================

const SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "BNB-USDT",
  "SOL-USDT",
  "XRP-USDT",
  "ADA-USDT",
  "DOGE-USDT",
  "TRX-USDT",
  "AVAX-USDT",
  "LINK-USDT",
  "DOT-USDT",
  "LTC-USDT",
  "BCH-USDT",
  "ATOM-USDT",
  "UNI-USDT",
  "APT-USDT",
  "ARB-USDT",
  "OP-USDT",
  "NEAR-USDT",
  "FIL-USDT",
  "ETC-USDT",
  "AAVE-USDT",
  "SUI-USDT",
  "INJ-USDT",
  "SEI-USDT",
  "TIA-USDT",
  "WIF-USDT",
  "PEPE-USDT",
  "BONK-USDT",
  "FET-USDT",
  "RENDER-USDT",
  "JUP-USDT",
  "PYTH-USDT",
  "TON-USDT",
  "HBAR-USDT",
  "ALGO-USDT",
  "VET-USDT",
  "ICP-USDT",
  "EOS-USDT",
  "XLM-USDT",
  "THETA-USDT",
  "SAND-USDT",
  "MANA-USDT",
  "FLOW-USDT",
  "GALA-USDT",
  "AXS-USDT",
  "CHZ-USDT",
  "EGLD-USDT",
  "KAS-USDT",
  "STX-USDT",
  "RUNE-USDT",
  "MKR-USDT",
  "CRV-USDT",
  "DYDX-USDT",
  "GMX-USDT",
  "LDO-USDT",
  "BLUR-USDT",
  "ENS-USDT",
  "ZRO-USDT",
  "ZK-USDT",
  "NOT-USDT",
  "WLD-USDT",
  "ONDO-USDT",
  "BRETT-USDT",
  "ENA-USDT",
  "PENDLE-USDT",
  "HYPE-USDT"
];

// ✅ المتغيرات
let currentPosition = null;
let isRunning = false;
let lastTradeTime = 0;

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
// ✅ حساب المتوسط البسيط (للمؤشرات الأساسية)
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
// ✅ تحليل السوق - HYPE & DUMP
// ==========================================

function analyzeMarket(data) {
  if (!data || data.length < 20) {
    return null;
  }

  const prices = data.map(c => Number(c.close));
  const volumes = data.map(c => Number(c.volume));

  const currentPrice = prices[prices.length - 1];
  const prevPrice = prices[prices.length - 2];

  const currentVol = volumes[volumes.length - 1];

  const avgVolume =
    volumes.slice(-11, -1)
    .reduce((a, b) => a + b, 0) / 10;

  const priceChange =
    ((currentPrice - prevPrice) / prevPrice) * 100;

  // فحص الفيكاوت (حجم منخفض مع ارتفاع)
  const isFakeout =
    priceChange > 0 &&
    currentVol < avgVolume;

  // ✅ شرط الهيب (شراء)
  const isHype =
    currentVol > (avgVolume * 2) &&
    priceChange > 0;

  // ✅ شرط الدمب (بيع)
  const isDump =
    currentVol > (avgVolume * 1.5) &&
    priceChange < -1.5;

  // حساب RSI للتحليل فقط
  const rsi = calculateRSI(prices, 14);

  console.log(`   📊 السعر: ${currentPrice.toFixed(4)} | التغير: ${priceChange.toFixed(2)}% | الحجم: ${(currentVol/avgVolume).toFixed(1)}x | RSI: ${rsi.toFixed(1)}`);

  return {
    currentPrice,
    currentVol,
    avgVolume,
    priceChange,
    isFakeout,
    isHype,
    isDump,
    rsi
  };
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

  return (
    dollarVolume > 500 &&
    volatility > 0.00001
  );
}

// ==========================================
// ✅ جلب بيانات الشمعة (15m مثل الكود الأصلي)
// ==========================================

async function getCandles(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_CANDLE, {
      symbol,
      interval: '15m',
      limit: 100
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
// ✅ حساب كمية العقد
// ==========================================

function calculateQuantity(price) {
  return Number((TRADE_AMOUNT * LEVERAGE / price).toFixed(6));
}

// ==========================================
// ✅ تعيين الرافعة
// ==========================================

async function setLeverage(symbol, side) {
  try {
    const response = await bingxRequest(
      'POST',
      ENDPOINTS.FUTURES_LEVERAGE,
      {
        symbol,
        leverage: LEVERAGE,
        side: side
      }
    );

    if (response?.code === 0) {
      console.log(`   ✅ تم تثبيت الرافعة x${LEVERAGE} على ${symbol} (${side})`);
      return true;
    }
    return false;
  } catch (e) {
    console.log("   ❌ leverage error", e.message);
    return false;
  }
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
// ✅ تنفيذ أمر (شراء أو بيع)
// ==========================================

async function placeOrder(symbol, signal, stats) {
  try {
    const price = stats.currentPrice;
    if (!price) return null;

    const contractInfo = await getContractInfo(symbol);
    let roundedQuantity = calculateQuantity(price);
    
    if (contractInfo) {
      roundedQuantity = adjustQuantity(roundedQuantity, contractInfo);
    }
    
    console.log(`   📊 الكمية: ${roundedQuantity}`);
    console.log(`   💵 السعر: ${price}`);
    console.log(`   📊 التغير: ${stats.priceChange.toFixed(2)}%`);
    console.log(`   📊 الحجم: ${(stats.currentVol/stats.avgVolume).toFixed(1)}x`);
    
    if (roundedQuantity <= 0) return null;

    const isBuy = signal === 'BUY';
    const side = isBuy ? 'BUY' : 'SELL';
    const positionSide = isBuy ? 'LONG' : 'SHORT';
    
    const params = {
      symbol: symbol,
      side: side,
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: positionSide
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      console.log(`   🎯 TP ثابت: ${FIXED_PROFIT_TARGET} USDT`);
      console.log(`   ⛔ SL ثابت: ${FIXED_STOP_LOSS} USDT`);
      console.log(`   📊 الحركة المطلوبة: ${(REQUIRED_MOVE * 100).toFixed(3)}%`);
      
      console.log(`🚀 OPEN ${signal} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        type: isBuy ? 'LONG' : 'SHORT',
        orderId: response.data?.orderId || Date.now(),
        timestamp: Date.now(),
        stats: stats
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
// ✅ إغلاق صفقة
// ==========================================

async function closePosition(position, result = 'MANUAL') {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

    const isLong = position.type === 'LONG';
    const closeSide = isLong ? 'SELL' : 'BUY';
    const closePositionSide = isLong ? 'LONG' : 'SHORT';

    const params = {
      symbol: position.symbol,
      side: closeSide,
      type: 'MARKET',
      quantity: position.quantity,
      positionSide: closePositionSide
    };

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, params);

    if (response && response.code === 0) {
      let profit = (currentPrice - position.entryPrice) * position.quantity;
      if (position.type === 'SHORT') {
        profit = (position.entryPrice - currentPrice) * position.quantity;
      }
      
      saveTrade({
        symbol: position.symbol,
        type: position.type,
        entryPrice: position.entryPrice,
        exitPrice: currentPrice,
        quantity: position.quantity,
        profit: profit,
        result: profit > 0 ? 'WIN' : 'LOSS',
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
// ✅ جلب إشارة HYPE أو DUMP (بدون فلاتر)
// ==========================================

function getMomentumSignal(stats) {
  if (!stats) return null;

  // فحص الفيكاوت
  if (stats.isFakeout) {
    console.log(`   🚫 Fakeout Detected`);
    return null;
  }

  // ✅ شراء - HYPE
  if (stats.isHype) {
    console.log(`   🚀 HYPE BUY | التغير: ${stats.priceChange.toFixed(2)}% | الحجم: ${(stats.currentVol/stats.avgVolume).toFixed(1)}x`);
    return {
      signal: 'BUY',
      type: 'LONG'
    };
  }

  // ✅ بيع - DUMP
  if (stats.isDump) {
    console.log(`   📉 DUMP SELL | التغير: ${stats.priceChange.toFixed(2)}% | الحجم: ${(stats.currentVol/stats.avgVolume).toFixed(1)}x`);
    return {
      signal: 'SELL',
      type: 'SHORT'
    };
  }

  return null;
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
        console.log(`🎯 FIXED TP ${profitUSDT.toFixed(4)} USDT (الهدف: ${FIXED_PROFIT_TARGET} USDT)`);
        await closePosition(currentPosition, 'FIXED_TP');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      // ✅ وقف خسارة ثابت
      if (profitUSDT <= FIXED_STOP_LOSS) {
        console.log(`⛔ FIXED SL ${profitUSDT.toFixed(4)} USDT (الحد: ${FIXED_STOP_LOSS} USDT)`);
        await closePosition(currentPosition, 'FIXED_SL');
        currentPosition = null;
        lastTradeTime = Date.now();
        isRunning = false;
        return;
      }

      isRunning = false;
      return;
    }

    // ✅ بدون كولداون (COOLDOWN = 0)
    if (balance < TRADE_AMOUNT) {
      console.log('⚠️ رصيد غير كافي');
      isRunning = false;
      return;
    }

    console.log(`🔍 جاري تحليل ${SYMBOLS.length} عملة...`);
    
    // ✅ تحليل جميع العملات
    for (const symbol of SYMBOLS) {
      try {
        const candles = await getCandles(symbol);
        if (!candles || candles.length < 20) {
          console.log(`   ${symbol} ❌ بيانات غير كافية`);
          continue;
        }

        console.log(`\n📊 تحليل ${symbol}:`);

        // فحص السيولة
        if (!strongMarket(candles)) {
          console.log(`   ${symbol} ❌ سيولة منخفضة`);
          continue;
        }

        // تحليل السوق
        const stats = analyzeMarket(candles);
        if (!stats) {
          console.log(`   ${symbol} ❌ لا يمكن تحليل السوق`);
          continue;
        }

        // جلب الإشارة (HYPE أو DUMP)
        const result = getMomentumSignal(stats);
        if (!result) {
          console.log(`   ${symbol} ❌ لا توجد إشارة HYPE أو DUMP`);
          continue;
        }

        const { signal, type } = result;
        console.log(`🚀 إشارة ${signal} (${type}): ${symbol}`);

        // فحص السبريد
        if (!(await hasGoodSpread(symbol))) {
          console.log(`   ${symbol} سبريد مرتفع ❌`);
          continue;
        }

        // تعيين الرافعة حسب نوع الصفقة
        const leverageSide = type === 'LONG' ? 'LONG' : 'SHORT';
        await setLeverage(symbol, leverageSide);

        // تنفيذ الصفقة
        const position = await placeOrder(symbol, signal, stats);
        if (position) {
          currentPosition = position;
          lastTradeTime = Date.now();
          console.log(`✅ تم الدخول ${type}: ${symbol}`);
          console.log(`🎯 جني الربح الثابت: ${FIXED_PROFIT_TARGET} USDT`);
          console.log(`⛔ وقف الخسارة الثابت: ${FIXED_STOP_LOSS} USDT`);
          console.log(`📊 الحركة المطلوبة للربح: ${(REQUIRED_MOVE * 100).toFixed(3)}%`);
          break;
        }

      } catch (error) {
        console.error(`❌ خطأ في تحليل ${symbol}:`, error.message);
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
      <title>HYPE MOMENTUM</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Arial', sans-serif; background: #0a0e17; color: #fff; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 20px; }
        .container { background: #141b2b; border-radius: 20px; padding: 40px; max-width: 750px; width: 100%; box-shadow: 0 10px 30px rgba(255, 140, 0, 0.2); border: 1px solid #ff8c00; }
        h1 { text-align: center; color: #ff8c00; font-size: 28px; margin-bottom: 5px; }
        .subtitle { text-align: center; color: #8899bb; margin-bottom: 25px; font-size: 14px; }
        .status-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
        .card { background: #1a2335; border-radius: 14px; padding: 16px 18px; border-left: 4px solid #ff8c00; transition: 0.3s; }
        .card:hover { background: #1f2a40; }
        .card .label { font-size: 11px; color: #8899bb; text-transform: uppercase; letter-spacing: 0.5px; }
        .card .value { font-size: 18px; font-weight: bold; margin-top: 4px; color: #fff; }
        .card .value.green { color: #00aa55; }
        .card .value.gold { color: #f0b90b; }
        .card .value.blue { color: #4a9eff; }
        .card .value.red { color: #ff4444; }
        .card .value.orange { color: #ff8c00; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 30px; font-size: 13px; font-weight: bold; background: #ff8c00; color: #fff; }
        .footer { text-align: center; margin-top: 25px; font-size: 12px; color: #556688; border-top: 1px solid #1a2335; padding-top: 18px; }
        .refresh-btn { display: block; margin: 18px auto 0; padding: 10px 30px; background: #ff8c00; border: none; border-radius: 30px; color: #fff; font-weight: bold; cursor: pointer; transition: 0.3s; }
        .refresh-btn:hover { background: #e67a00; transform: scale(1.02); }
        .settings-box { background: #1a2335; border-radius: 14px; padding: 14px 18px; margin-top: 16px; border: 1px solid #2a3a55; }
        .settings-box .label { font-size: 11px; color: #8899bb; text-transform: uppercase; }
        .settings-box .value { font-size: 15px; font-weight: bold; color: #aabbdd; margin-top: 4px; }
        .settings-box .value .highlight-green { color: #00aa55; }
        .settings-box .value .highlight-gold { color: #f0b90b; }
        .settings-box .value .highlight-red { color: #ff4444; }
        .settings-box .value .highlight-orange { color: #ff8c00; }
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
        <h1>🔥 HYPE MOMENTUM</h1>
        <p class="subtitle">⚡ TP: ${FIXED_PROFIT_TARGET} | SL: ${FIXED_STOP_LOSS}</p>
        <div class="status-grid" id="statusGrid">
          <div class="card"><div class="label">📊 الحالة</div><div class="value"><span class="status-badge" id="statusBadge">🟢 يعمل</span></div></div>
          <div class="card"><div class="label">💰 الرصيد</div><div class="value green" id="balance">0.00 USDT</div></div>
          <div class="card"><div class="label">⚡ الرافعة</div><div class="value gold" id="leverage">10x</div></div>
          <div class="card" style="grid-column: span 3;"><div class="label">📈 الصفقة الحالية</div><div class="value blue" id="position">لا توجد صفقة</div></div>
        </div>
        <div class="trade-info" id="tradeInfo"><div class="label">💰 الربح / الخسارة</div><div class="value" id="profitDisplay">0.0000 USDT (0.00%)</div></div>
        <div class="settings-box">
          <div class="label">⚙️ إعدادات</div>
          <div class="value">💰 <span class="highlight-green">${TRADE_AMOUNT} USDT</span> | ⚡ <span class="highlight-gold">${LEVERAGE}x</span> | 🎯 <span class="highlight-gold">${FIXED_PROFIT_TARGET} ثابت</span> | ⛔ <span class="highlight-red">${FIXED_STOP_LOSS} ثابت</span> | 🔄 <span class="highlight-orange">مسح: 5s</span></div>
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
      status: '🔥 HYPE MOMENTUM',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(4)} USDT`,
      leverage: `${LEVERAGE}x`,
      tradeAmount: `${TRADE_AMOUNT} USDT`,
      currentPosition: currentPosition ? `${currentPosition.symbol} (${currentPosition.type})` : 'لا توجد صفقة',
      profit: profit,
      profitPercent: profitPercent,
      tradesCount: tradesHistory.length,
      symbol: `${SYMBOLS.length} عملة`,
      settings: {
        tradeAmount: `${TRADE_AMOUNT} USDT`,
        profitTarget: `${FIXED_PROFIT_TARGET} ثابت`,
        stopLoss: `${FIXED_STOP_LOSS} ثابت`,
        leverage: `${LEVERAGE}x`,
        scanInterval: `${SCAN_INTERVAL}ms (5 ثواني)`,
        cooldown: `${COOLDOWN}ms`,
        requiredMove: `${(REQUIRED_MOVE * 100).toFixed(3)}%`
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

    console.log('🔥🔥 بدء تشغيل HYPE MOMENTUM');
    console.log('📊 ===== إعدادات متقدمة =====');
    console.log(`💰 مبلغ التداول: ${TRADE_AMOUNT} USDT`);
    console.log(`⚡ الرافعة: ${LEVERAGE}x`);
    console.log(`🎯 الهدف الثابت: ${FIXED_PROFIT_TARGET} USDT`);
    console.log(`⛔ وقف الخسارة الثابت: ${FIXED_STOP_LOSS} USDT`);
    console.log(`📊 الحركة المطلوبة للربح: ${(REQUIRED_MOVE * 100).toFixed(3)}%`);
    console.log(`🔄 سرعة المسح: ${SCAN_INTERVAL}ms (5 ثواني)`);
    console.log(`⏳ كولداون: ${COOLDOWN}ms (بدون كولداون)`);
    console.log(`📊 عدد العملات: ${SYMBOLS.length} عملة`);
    console.log(`📊 نوع التداول: شراء (HYPE) وبيع (DUMP)`);
    console.log(`📊 الفاصل الزمني: 15m`);
    console.log('================================');

    await getContractInfo('BTC-USDT');

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

    console.log(`✅ البوت يعمل! مسح كل ${SCAN_INTERVAL}ms`);

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
  ║   🔥 HYPE MOMENTUM                                          ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard          ║
  ║   🚀 رافعة: ${LEVERAGE}x | 💰 ${TRADE_AMOUNT} USDT            ║
  ║   🎯 TP: ${FIXED_PROFIT_TARGET} ثابت | ⛔ SL: ${FIXED_STOP_LOSS} ثابت ║
  ║   📊 الحركة المطلوبة: ${(REQUIRED_MOVE * 100).toFixed(3)}%                    ║
  ║   🔄 سرعة المسح: ${SCAN_INTERVAL}ms (5 ثواني)                 ║
  ║   🚫 كولداون: ${COOLDOWN}ms                                   ║
  ║   📊 عدد العملات: ${SYMBOLS.length} عملة                      ║
  ║   📊 التداول: شراء (HYPE) + بيع (DUMP)                      ║
  ║   📊 الفاصل: 15m                                             ║
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
