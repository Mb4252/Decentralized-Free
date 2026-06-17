const Binance = require('node-binance-api');
const dotenv = require('dotenv');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
dotenv.config();

// ==========================================
// إعدادات البوت (Binance Futures - حقيقي)
// ==========================================

const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const LEVERAGE = parseInt(process.env.LEVERAGE) || 10;
const TRADE_AMOUNT = parseFloat(process.env.TRADE_AMOUNT) || 10;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 0.3;
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD) || 0.1;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 5000;
const STOP_LOSS_PERCENT = parseFloat(process.env.STOP_LOSS_PERCENT) || 2;

// قائمة العملات للمراقبة (Futures)
const SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'MATICUSDT', 'LINKUSDT'
];

// ==========================================
// الاتصال بـ Binance
// ==========================================

const binance = new Binance().options({
  APIKEY: API_KEY,
  APISECRET: API_SECRET,
  useServerTime: true,
  recvWindow: 60000,
  verbose: true
});

let currentPosition = null;
let priceHistory = {};
let isRunning = false;
let tradesHistory = [];
const TRADES_FILE = path.join(__dirname, 'data', 'trades.json');

// ==========================================
// دوال مساعدة
// ==========================================

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

function loadTrades() {
  try {
    if (fs.existsSync(TRADES_FILE)) {
      const data = fs.readFileSync(TRADES_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        tradesHistory = parsed;
        return parsed;
      }
    }
  } catch (error) {
    console.error('خطأ في قراءة trades.json:', error);
  }
  tradesHistory = [];
  return [];
}

function saveTrades() {
  try {
    if (!Array.isArray(tradesHistory)) {
      tradesHistory = [];
    }
    const dir = path.dirname(TRADES_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRADES_FILE, JSON.stringify(tradesHistory, null, 2));
  } catch (error) {
    console.error('خطأ في حفظ trades.json:', error);
  }
}

// ==========================================
// جلب سعر العملة
// ==========================================

async function getPrice(symbol) {
  try {
    const ticker = await binance.futuresPrices(symbol);
    return parseFloat(ticker[symbol]);
  } catch (error) {
    log(`❌ فشل جلب سعر ${symbol}: ${error.message}`, 'ERROR');
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
// تحليل العملات المتزايدة
// ==========================================

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

// ==========================================
// تعيين الرافعة المالية
// ==========================================

async function setLeverage(symbol) {
  try {
    await binance.futuresLeverage(symbol, LEVERAGE);
    log(`✅ تم تعيين الرافعة x${LEVERAGE} لـ ${symbol}`, 'SUCCESS');
  } catch (error) {
    log(`❌ فشل تعيين الرافعة: ${error.message}`, 'ERROR');
  }
}

// ==========================================
// فتح صفقة شراء (Long) - حقيقي
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) return null;

    // حساب الكمية مع الرافعة
    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Math.floor(quantity * 1000) / 1000;

    log(`📊 فتح صفقة شراء: ${roundedQuantity} ${symbol} بسعر ${price} (رافعة x${LEVERAGE})`, 'INFO');

    // ✅ تنفيذ الأمر (حقيقي)
    const order = await binance.futuresMarketBuy(symbol, roundedQuantity);
    
    log(`✅ تم فتح صفقة شراء: ${roundedQuantity} ${symbol} (ID: ${order.orderId})`, 'SUCCESS');
    
    return {
      symbol,
      entryPrice: price,
      quantity: roundedQuantity,
      orderId: order.orderId,
      timestamp: Date.now()
    };
  } catch (error) {
    log(`❌ فشل فتح الصفقة: ${error.message}`, 'ERROR');
    return null;
  }
}

// ==========================================
// إغلاق صفقة (بيع) - حقيقي
// ==========================================

async function closePosition(position, profit) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

    log(`📊 إغلاق صفقة: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`, 'INFO');

    // ✅ تنفيذ البيع (حقيقي)
    const order = await binance.futuresMarketSell(position.symbol, position.quantity);
    
    log(`✅ تم إغلاق الصفقة: ${position.symbol} (ID: ${order.orderId})`, 'SUCCESS');
    return true;
  } catch (error) {
    log(`❌ فشل إغلاق الصفقة: ${error.message}`, 'ERROR');
    return false;
  }
}

// ==========================================
// تحديث تاريخ الأسعار
// ==========================================

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
    // جلب الرصيد
    const balances = await binance.futuresBalance();
    const usdtBalance = parseFloat(balances.USDT.available) || 0;
    log(`💰 رصيد USDT: ${usdtBalance.toFixed(2)}`, 'INFO');

    // إذا كانت هناك صفقة مفتوحة
    if (currentPosition) {
      const currentPrice = await getPrice(currentPosition.symbol);
      if (!currentPrice) { isRunning = false; return; }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE;
      log(`⚡ ${currentPosition.symbol} - الربح: ${profitPercent.toFixed(2)}%`, 'INFO');

      // جني ربح
      if (profitPercent >= PROFIT_PERCENT) {
        log(`✅ جني ربح: ${profitPercent.toFixed(2)}%`, 'SUCCESS');
        const result = await closePosition(currentPosition, profitPercent);
        if (result) {
          tradesHistory.push({
            id: Date.now(),
            type: 'sell',
            symbol: currentPosition.symbol,
            quantity: currentPosition.quantity,
            price: currentPrice,
            profit: (currentPrice - currentPosition.entryPrice) * currentPosition.quantity,
            status: 'closed',
            timestamp: new Date().toISOString()
          });
          saveTrades();
          currentPosition = null;
          await updatePriceHistory();
        }
      } 
      // وقف خسارة
      else if (profitPercent <= -STOP_LOSS_PERCENT) {
        log(`⚠️ وقف الخسارة: ${profitPercent.toFixed(2)}%`, 'WARNING');
        const result = await closePosition(currentPosition, profitPercent);
        if (result) {
          currentPosition = null;
          await updatePriceHistory();
        }
      }
      
      isRunning = false;
      return;
    }

    // التحقق من الرصيد
    if (usdtBalance < TRADE_AMOUNT) {
      log(`⚠️ رصيد غير كافٍ (يحتاج ${TRADE_AMOUNT} USDT)`, 'WARNING');
      isRunning = false;
      return;
    }

    // جلب الأسعار الحالية
    const currentPrices = await getAllPrices();
    if (Object.keys(priceHistory).length === 0) {
      for (const [symbol, data] of Object.entries(currentPrices)) {
        priceHistory[symbol] = data.price;
      }
      isRunning = false;
      return;
    }

    // البحث عن عملات متزايدة
    const risingTokens = findRisingTokens(currentPrices);
    
    if (risingTokens.length > 0) {
      const best = risingTokens[0];
      log(`📈 اكتشاف ارتفاع: ${best.symbol} - ${best.changePercent.toFixed(2)}%`, 'INFO');

      // تعيين الرافعة
      await setLeverage(best.symbol);

      // فتح صفقة
      const position = await openLongPosition(best.symbol, TRADE_AMOUNT);
      if (position) {
        currentPosition = position;
        tradesHistory.push({
          id: Date.now(),
          type: 'buy',
          symbol: best.symbol,
          quantity: position.quantity,
          price: position.entryPrice,
          profit: 0,
          status: 'open',
          timestamp: new Date().toISOString()
        });
        saveTrades();
        await updatePriceHistory();
        log(`✅ تم فتح الصفقة على ${best.symbol} (رافعة x${LEVERAGE})`, 'SUCCESS');
      }
    }

  } catch (error) {
    log(`❌ خطأ: ${error.message}`, 'ERROR');
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
  let positionStatus = 'لا توجد صفقة مفتوحة';
  let profit = '0%';
  
  if (currentPosition) {
    const currentPrice = await getPrice(currentPosition.symbol);
    if (currentPrice) {
      profit = (((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100 * LEVERAGE).toFixed(2) + '%';
      positionStatus = `${currentPosition.symbol} - الربح: ${profit}`;
    }
  }
  
  const balances = await binance.futuresBalance();
  const usdtBalance = parseFloat(balances.USDT.available) || 0;
  
  res.json({
    status: '⚡ بوت العقود الآجلة يعمل (حقيقي)',
    version: '4.0.0',
    timestamp: new Date().toISOString(),
    balance: `${usdtBalance.toFixed(2)} USDT`,
    leverage: `${LEVERAGE}x`,
    currentPosition: positionStatus,
    watching: SYMBOLS.join(', '),
    settings: {
      tradeAmount: TRADE_AMOUNT,
      leverage: LEVERAGE,
      profitTarget: PROFIT_PERCENT + '%',
      priceChangeThreshold: PRICE_CHANGE_THRESHOLD + '%',
      stopLoss: STOP_LOSS_PERCENT + '%',
      checkInterval: CHECK_INTERVAL / 1000 + ' ثانية'
    }
  });
});

app.get('/api/status-full', async (req, res) => {
  try {
    const balances = await binance.futuresBalance();
    const usdtBalance = parseFloat(balances.USDT.available) || 0;
    
    loadTrades();
    const openTrades = tradesHistory.filter(t => t.status === 'open');
    
    res.json({
      balance: usdtBalance,
      position: currentPosition,
      trades: tradesHistory,
      openTrades: openTrades.length,
      totalTrades: tradesHistory.length,
      watching: SYMBOLS,
      settings: {
        tradeAmount: TRADE_AMOUNT,
        leverage: LEVERAGE,
        profitTarget: PROFIT_PERCENT,
        priceChangeThreshold: PRICE_CHANGE_THRESHOLD
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/trades', async (req, res) => {
  loadTrades();
  res.json(tradesHistory);
});

app.delete('/api/clear-trades', (req, res) => {
  tradesHistory = [];
  saveTrades();
  res.json({ success: true });
});

app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// تشغيل البوت
// ==========================================

async function startBot() {
  log(`⚡⚡ بدء تشغيل بوت العقود الآجلة (Futures - حقيقي)`, 'START');
  log(`📊 العملات: ${SYMBOLS.join(', ')}`, 'INFO');
  log(`💰 المبلغ: ${TRADE_AMOUNT} USDT (رافعة x${LEVERAGE})`, 'INFO');
  log(`📈 حد الارتفاع: ${PRICE_CHANGE_THRESHOLD}%`, 'INFO');
  log(`🎯 هدف الربح: ${PROFIT_PERCENT}%`, 'INFO');
  log(`🛑 وقف الخسارة: ${STOP_LOSS_PERCENT}%`, 'INFO');
  log(`⏱️ الفحص كل ${CHECK_INTERVAL/1000} ثانية`, 'INFO');
  log(`⚠️ تحذير: هذا البوت يستخدم أموالاً حقيقية!`, 'WARNING');

  // التحقق من الاتصال
  try {
    await binance.futuresBalance();
    log(`✅ الاتصال بـ Binance ناجح`, 'SUCCESS');
  } catch (error) {
    log(`❌ فشل الاتصال بـ Binance: ${error.message}`, 'ERROR');
    process.exit(1);
  }

  loadTrades();
  await updatePriceHistory();
  await tradingCycle();

  setInterval(async () => {
    await tradingCycle();
  }, CHECK_INTERVAL);

  log(`✅ البوت يعمل بنجاح! (تداول حقيقي)`, 'SUCCESS');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   ⚡ بوت العقود الآجلة - Futures Bot (حقيقي)                ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard.html     ║
  ║   🚀 رافعة حقيقية x${LEVERAGE} - يشتري عند أي ارتفاع 0.1%      ║
  ║   ⚠️ تداول حقيقي - استخدم بحذر!                              ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

startBot().catch(error => {
  log(`❌ فشل التشغيل: ${error.message}`, 'ERROR');
  process.exit(1);
});
