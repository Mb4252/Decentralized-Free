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
const LEVERAGE = parseInt(process.env.LEVERAGE) || 10;
const TRADE_AMOUNT = parseFloat(process.env.TRADE_AMOUNT) || 10;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 0.3;
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD) || 0.1;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 5000;
const STOP_LOSS_PERCENT = parseFloat(process.env.STOP_LOSS_PERCENT) || 2;

// قائمة العملات للمراقبة
const SYMBOLS = [
  'BTC-USDT', 'ETH-USDT', 'BNB-USDT', 'SOL-USDT', 'XRP-USDT',
  'ADA-USDT', 'DOGE-USDT', 'AVAX-USDT', 'MATIC-USDT', 'LINK-USDT'
];

// ==========================================
// نقاط النهاية (Endpoints)
// ==========================================

const ENDPOINTS = {
  FUTURES_BALANCE: '/openApi/swap/v2/user/balance',
  FUTURES_PRICE: '/openApi/swap/v2/quote/price',
  FUTURES_LEVERAGE: '/openApi/swap/v2/trade/leverage',
  FUTURES_ORDER: '/openApi/swap/v2/trade/order',
};

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
  // تجربة النطاقين المحتملين
  const baseURL = 'https://api.bingx.com'; // جرب هذا النطاق أولاً
  // const baseURL = 'https://open-api.bingx.com'; // جرب هذا إذا لم يعمل الأول
  
  const timestamp = Date.now();
  
  const allParams = {
    timestamp: timestamp.toString(),
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
    console.log(`🚀 إرسال طلب: ${method} ${url}`);
    console.log(`📦 المعاملات:`, JSON.stringify(allParams, null, 2));
    
    let response;
    if (method === 'GET') {
      response = await axios.get(url, {
        params: allParams,
        headers: headers,
        timeout: 10000
      });
    } else {
      response = await axios.post(url, allParams, {
        headers: headers,
        timeout: 10000
      });
    }
    return response.data;
  } catch (error) {
    // ✅ جزء تسجيل الأخطاء المطلوب
    console.error('❌ خطأ في طلب BingX:', {
      endpoint: endpoint,
      url: url,
      status: error.response?.status,
      data: error.response?.data
    });
    return null;
  }
}

// ==========================================
// جلب سعر العملة
// ==========================================

async function getPrice(symbol) {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_PRICE, { 
      symbol: symbol 
    }, false);
    
    if (response && response.code === 0 && response.data) {
      return parseFloat(response.data.price);
    }
    console.log(`⚠️ فشل جلب سعر ${symbol}:`, response?.msg || response);
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
    // تأخير بسيط لتجنب الإفراط في الطلبات
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return prices;
}

// ==========================================
// جلب الرصيد
// ==========================================

async function getFuturesBalance() {
  try {
    const response = await bingxRequest('GET', ENDPOINTS.FUTURES_BALANCE, {});
    
    console.log('📊 استجابة الرصيد:', JSON.stringify(response, null, 2).substring(0, 300));
    
    if (response && response.code === 0) {
      const data = response.data || {};
      
      // محاولة قراءة الرصيد بعدة طرق
      if (data.balance) {
        return parseFloat(data.balance) || 0;
      }
      
      if (data.USDT) {
        return parseFloat(data.USDT.available) || 0;
      }
      
      if (data.assets && Array.isArray(data.assets)) {
        const usdt = data.assets.find(a => a.asset === 'USDT');
        if (usdt) {
          return parseFloat(usdt.available) || 0;
        }
      }
      
      // البحث في أي حقل يحتوي على USDT
      for (const key of Object.keys(data)) {
        if (key.includes('USDT') || key.includes('balance')) {
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
    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_LEVERAGE, {
      symbol: symbol,
      leverage: LEVERAGE
    });
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
      console.log(`⚠️ لا يمكن فتح صفقة: سعر ${symbol} غير متوفر`);
      return null;
    }

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Math.floor(quantity * 1000) / 1000;

    if (roundedQuantity <= 0) {
      console.log(`⚠️ الكمية صغيرة جداً: ${roundedQuantity}`);
      return null;
    }

    console.log(`📊 فتح صفقة شراء: ${roundedQuantity} ${symbol} بسعر ${price}`);

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, {
      symbol: symbol,
      side: 'BUY',
      type: 'MARKET',
      quantity: roundedQuantity,
      positionSide: 'LONG'
    });

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
    console.log(`⚠️ فشل فتح الصفقة:`, response?.msg || response);
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح الصفقة:`, error);
    return null;
  }
}

// ==========================================
// إغلاق صفقة (بيع)
// ==========================================

async function closePosition(position) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) {
      console.log(`⚠️ لا يمكن إغلاق الصفقة: سعر ${position.symbol} غير متوفر`);
      return false;
    }

    console.log(`📊 إغلاق صفقة: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`);

    const response = await bingxRequest('POST', ENDPOINTS.FUTURES_ORDER, {
      symbol: position.symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity: position.quantity,
      positionSide: 'LONG'
    });

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
    console.log(`💰 رصيد USDT: ${usdtBalance.toFixed(2)}`);

    if (usdtBalance === 0) {
      console.log('⚠️ رصيد USDT: 0 أو غير متوفر');
      isRunning = false;
      return;
    }

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
      status: '⚡ بوت BingX Futures يعمل',
      timestamp: new Date().toISOString(),
      balance: `${usdtBalance.toFixed(2)} USDT`,
      leverage: `${LEVERAGE}x`,
      currentPosition: currentPosition ? `${currentPosition.symbol} - مفتوح` : 'لا توجد صفقة',
      watching: SYMBOLS.join(', ')
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
    console.log(`📊 العملات: ${SYMBOLS.join(', ')}`);
    console.log(`💰 المبلغ: ${TRADE_AMOUNT} USDT (رافعة x${LEVERAGE})`);

    const balance = await getFuturesBalance();
    console.log(`💰 رصيد USDT في Futures: ${balance.toFixed(2)}`);

    if (balance === 0) {
      console.log('⚠️ تحذير: الرصيد 0 أو غير متوفر.');
      console.log('📌 تأكد من:');
      console.log('   1. صحة مفاتيح API');
      console.log('   2. وجود رصيد في حساب العقود الآجلة');
      console.log('   3. تفعيل صلاحيات التداول للمفتاح');
    }

    await updatePriceHistory();
    console.log('✅ تم تحديث تاريخ الأسعار');

    await tradingCycle();

    setInterval(async () => {
      try {
        await tradingCycle();
      } catch (error) {
        console.error('❌ خطأ في الدورة المتكررة:', error);
      }
    }, CHECK_INTERVAL);

    console.log(`✅ البوت يعمل بنجاح!`);

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
  ║   ⚡ بوت العقود الآجلة - BingX Futures                      ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   🚀 رافعة حقيقية x${LEVERAGE}                               ║
  ║   ⚠️ تداول حقيقي - استخدم بحذر!                              ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
  
  startBot();
});

// ==========================================
// معالجة إشارات الإيقاف والأخطاء
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
