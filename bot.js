const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
dotenv.config();

// ==========================================
// إعدادات البوت (BingX Futures - حقيقي)
// ==========================================

const API_KEY = process.env.BINGX_API_KEY;
const API_SECRET = process.env.BINGX_API_SECRET;
const LEVERAGE = parseInt(process.env.LEVERAGE) || 10;
const TRADE_AMOUNT = parseFloat(process.env.TRADE_AMOUNT) || 10;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 0.3;
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD) || 0.1;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 5000;
const STOP_LOSS_PERCENT = parseFloat(process.env.STOP_LOSS_PERCENT) || 2;

// قائمة العملات للمراقبة (Futures على BingX)
const SYMBOLS = [
  'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'MATIC-USDT', 'LINK-USDT'
];

// ==========================================
// دوال مساعدة (BingX API)
// ==========================================

function generateSignature(params, secret) {
  const sortedKeys = Object.keys(params).sort();
  let queryString = '';
  for (const key of sortedKeys) {
    if (queryString) queryString += '&';
    queryString += key + '=' + params[key];
  }
  return crypto.createHmac('sha256', secret).update(queryString).digest('hex');
}

async function bingxRequest(method, endpoint, params = {}, signed = true) {
  const baseURL = 'https://api.bingx.com';
  const timestamp = Date.now();
  
  const allParams = {
    timestamp: timestamp,
    ...params
  };
  
  if (signed) {
    allParams.signature = generateSignature(allParams, API_SECRET);
  }
  
  const url = baseURL + endpoint;
  const headers = {
    'X-BX-APIKEY': API_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    const response = await axios({
      method: method,
      url: url,
      params: allParams,
      headers: headers
    });
    return response.data;
  } catch (error) {
    console.error('❌ خطأ في طلب BingX:', error.response?.data || error.message);
    return null;
  }
}

// ==========================================
// جلب سعر العملة
// ==========================================

async function getPrice(symbol) {
  try {
    const response = await bingxRequest('GET', '/openApi/swap/v2/quote/price', { symbol }, false);
    if (response && response.data) {
      return parseFloat(response.data.price);
    }
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
  }
  return prices;
}

// ==========================================
// جلب الرصيد من BingX Futures
// ==========================================

async function getFuturesBalance() {
  try {
    const response = await bingxRequest('GET', '/openApi/swap/v2/user/balance', {});
    if (response && response.data && response.data.balance) {
      const usdtAsset = response.data.balance.find(asset => asset.asset === 'USDT');
      if (usdtAsset) {
        return parseFloat(usdtAsset.available) || 0;
      }
    }
    return 0;
  } catch (error) {
    console.error('❌ فشل جلب الرصيد:', error);
    return 0;
  }
}

// ==========================================
// تعيين الرافعة المالية
// ==========================================

async function setLeverage(symbol) {
  try {
    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/leverage', {
      symbol: symbol,
      leverage: LEVERAGE
    });
    if (response && response.code === 0) {
      console.log(`✅ تم تعيين الرافعة x${LEVERAGE} لـ ${symbol}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ فشل تعيين الرافعة:`, error);
    return false;
  }
}

// ==========================================
// فتح صفقة شراء (Long) - حقيقي
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) return null;

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Math.floor(quantity * 1000) / 1000;

    console.log(`📊 فتح صفقة شراء: ${roundedQuantity} ${symbol} بسعر ${price} (رافعة x${LEVERAGE})`);

    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/order', {
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: roundedQuantity
    });

    if (response && response.code === 0) {
      console.log(`✅ تم فتح صفقة شراء: ${roundedQuantity} ${symbol}`);
      return {
        symbol,
        entryPrice: price,
        quantity: roundedQuantity,
        orderId: response.data.orderId,
        timestamp: Date.now()
      };
    }
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح الصفقة:`, error);
    return null;
  }
}

// ==========================================
// إغلاق صفقة (بيع) - حقيقي
// ==========================================

async function closePosition(position) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

    console.log(`📊 إغلاق صفقة: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`);

    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/order', {
      symbol: position.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: position.quantity
    });

    if (response && response.code === 0) {
      console.log(`✅ تم إغلاق الصفقة: ${position.symbol}`);
      return true;
    }
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
  for (const [symbol, data] of Object.entries(currentPrices)) {
    priceHistory[symbol] = data.price;
  }
}

// ==========================================
// دورة التداول الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const usdtBalance = await getFuturesBalance();
    if (usdtBalance === 0) {
      console.log('⚠️ رصيد USDT: 0 أو غير متوفر');
      isRunning = false;
      return;
    }

    console.log(`💰 رصيد USDT: ${usdtBalance.toFixed(2)}`);

    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) { isRunning = false; return; }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      console.log(`⚡ ${currentPosition.symbol} - الربح: ${profitPercent.toFixed(2)}%`);

      if (profitPercent >= PROFIT_PERCENT) {
        console.log(`✅ جني ربح: ${profitPercent.toFixed(2)}%`);
        const result = await closePosition(currentPosition);
        if (result) {
          currentPosition = null;
          await updatePriceHistory();
        }
      } else if (profitPercent <= -STOP_LOSS_PERCENT) {
        console.log(`⚠️ وقف الخسارة: ${profitPercent.toFixed(2)}%`);
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
      console.log(`📈 اكتشاف ارتفاع: ${best.symbol} - ${best.changePercent.toFixed(2)}%`);

      await setLeverage(best.symbol);
      const position = await openLongPosition(best.symbol, TRADE_AMOUNT);
      if (position) {
        currentPosition = position;
        await updatePriceHistory();
        console.log(`✅ تم فتح الصفقة على ${best.symbol}`);
      }
    }

  } catch (error) {
    console.error(`❌ خطأ: ${error.message}`);
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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', async (req, res) => {
  const usdtBalance = await getFuturesBalance();
  res.json({
    status: '⚡ بوت BingX Futures يعمل (حقيقي)',
    timestamp: new Date().toISOString(),
    balance: `${usdtBalance.toFixed(2)} USDT`,
    leverage: `${LEVERAGE}x`,
    currentPosition: currentPosition ? `${currentPosition.symbol} - مفتوح` : 'لا توجد صفقة',
    watching: SYMBOLS.join(', ')
  });
});

// ==========================================
// تشغيل البوت
// ==========================================

async function startBot() {
  console.log(`⚡⚡ بدء تشغيل بوت العقود الآجلة (BingX - حقيقي)`);
  console.log(`📊 العملات: ${SYMBOLS.join(', ')}`);
  console.log(`💰 المبلغ: ${TRADE_AMOUNT} USDT (رافعة x${LEVERAGE})`);
  console.log(`⚠️ تحذير: هذا البوت يستخدم أموالاً حقيقية!`);

  const balance = await getFuturesBalance();
  console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(2)}`);

  await updatePriceHistory();
  await tradingCycle();

  setInterval(async () => {
    await tradingCycle();
  }, CHECK_INTERVAL);

  console.log(`✅ البوت يعمل بنجاح!`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   ⚡ بوت العقود الآجلة - BingX Futures (حقيقي)              ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   🚀 رافعة حقيقية x${LEVERAGE}                               ║
  ║   ⚠️ تداول حقيقي - استخدم بحذر!                              ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

startBot().catch(error => {
  console.error(`❌ فشل التشغيل: ${error.message}`);
  process.exit(1);
});
