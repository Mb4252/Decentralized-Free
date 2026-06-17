const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const abi = require('./abi.json');
dotenv.config();

// ==========================================
// إعدادات البوت
// ==========================================

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const TRADE_AMOUNT = parseFloat(process.env.TRADE_AMOUNT) || 0.0001;
const LEVERAGE = parseInt(process.env.LEVERAGE) || 10;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 1.2;
const PRICE_CHANGE_THRESHOLD = parseFloat(process.env.PRICE_CHANGE_THRESHOLD) || 1.5;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 30000;
const SLIPPAGE = parseFloat(process.env.SLIPPAGE) || 0.5;

// قائمة العملات
const TOKENS = [
  { address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", name: "WBNB" },
  { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", name: "CAKE" },
  { address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", name: "BUSD" },
  { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", name: "ETH" },
  { address: "0x55d398326f99059fF775485246999027B3197955", name: "USDT" },
  { address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", name: "USDC" },
  { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", name: "BTCB" },
  { address: "0x0b15Ddf19D47E6a86A56148fb4aFFFc6929BcB89", name: "ADA" },
  { address: "0x5C6D51ecBA4D8E4F20373e3ce96a62342B125D6d", name: "XRP" },
  { address: "0x1CE0c2827e2eF14D5C4f29a091d735A204794041", name: "DOGE" }
];

// ==========================================
// الاتصال بالشبكة
// ==========================================

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const router = new ethers.Contract(PANCAKE_ROUTER, abi, wallet);

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
      tradesHistory = JSON.parse(data);
      return tradesHistory;
    }
  } catch (error) {
    console.error('خطأ في قراءة trades.json:', error);
  }
  return [];
}

function saveTrades() {
  try {
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

async function getTokenPriceBNB(tokenAddress) {
  try {
    const path = [tokenAddress, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'];
    const amountIn = ethers.utils.parseUnits('1', 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    return parseFloat(ethers.utils.formatUnits(amounts[1], 18));
  } catch (error) {
    return null;
  }
}

async function getAllPrices() {
  const prices = {};
  for (const token of TOKENS) {
    const price = await getTokenPriceBNB(token.address);
    if (price) prices[token.address] = { price, name: token.name };
  }
  return prices;
}

// ==========================================
// تحليل العملات المتزايدة
// ==========================================

function findRisingTokens(currentPrices) {
  const rising = [];
  for (const [address, data] of Object.entries(currentPrices)) {
    const price = data.price;
    if (priceHistory[address]) {
      const oldPrice = priceHistory[address];
      const changePercent = ((price - oldPrice) / oldPrice) * 100;
      if (changePercent >= PRICE_CHANGE_THRESHOLD) {
        rising.push({ address, name: data.name, price, changePercent, oldPrice });
      }
    }
  }
  rising.sort((a, b) => b.changePercent - a.changePercent);
  return rising;
}

// ==========================================
// شراء وبيع
// ==========================================

async function buyToken(tokenAddress, amountBNB) {
  try {
    const path = ['0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', tokenAddress];
    const amountIn = ethers.utils.parseUnits(amountBNB.toString(), 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOutMin = amounts[1].mul(100 - SLIPPAGE * 100).div(100 * 100);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const tx = await router.swapExactETHForTokens(
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      { value: amountIn, gasLimit: 300000 }
    );
    
    const receipt = await tx.wait();
    const tokenAmount = parseFloat(ethers.utils.formatUnits(amountOutMin, 18));
    log(`✅ شراء: ${tokenAmount} TOKEN مقابل ${amountBNB} BNB`, 'SUCCESS');
    log(`📝 TX: ${receipt.transactionHash}`, 'INFO');
    
    return { success: true, tokenAmount, tx: receipt.transactionHash };
  } catch (error) {
    log(`❌ فشل الشراء: ${error.message}`, 'ERROR');
    return { success: false, error: error.message };
  }
}

async function sellToken(tokenAddress, tokenAmount) {
  try {
    const path = [tokenAddress, '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c'];
    const amountIn = ethers.utils.parseUnits(tokenAmount.toString(), 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOutMin = amounts[1].mul(100 - SLIPPAGE * 100).div(100 * 100);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const tx = await router.swapExactTokensForETH(
      amountIn,
      amountOutMin,
      path,
      WALLET_ADDRESS,
      deadline,
      { gasLimit: 300000 }
    );
    
    const receipt = await tx.wait();
    const bnbReceived = parseFloat(ethers.utils.formatUnits(amountOutMin, 18));
    log(`✅ بيع: ${tokenAmount} TOKEN → ${bnbReceived} BNB`, 'SUCCESS');
    log(`📝 TX: ${receipt.transactionHash}`, 'INFO');
    
    return { success: true, bnbReceived, tx: receipt.transactionHash };
  } catch (error) {
    log(`❌ فشل البيع: ${error.message}`, 'ERROR');
    return { success: false, error: error.message };
  }
}

async function updatePriceHistory() {
  const currentPrices = await getAllPrices();
  for (const [address, data] of Object.entries(currentPrices)) {
    priceHistory[address] = data.price;
  }
}

// ==========================================
// دورة التداول الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    const balance = await wallet.getBalance();
    const bnbBalance = parseFloat(ethers.utils.formatEther(balance));
    log(`💰 رصيد BNB: ${bnbBalance.toFixed(6)} BNB`, 'INFO');

    if (currentPosition) {
      const currentPrice = await getTokenPriceBNB(currentPosition.address);
      if (!currentPrice) { isRunning = false; return; }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100;
      log(`📊 ${currentPosition.name} - الربح: ${profitPercent.toFixed(2)}%`, 'INFO');

      if (profitPercent >= PROFIT_PERCENT) {
        log(`✅ تحقيق الربح: ${profitPercent.toFixed(2)}%`, 'SUCCESS');
        const result = await sellToken(currentPosition.address, currentPosition.amount);
        if (result.success) {
          tradesHistory.push({
            id: Date.now(),
            type: 'sell',
            token: currentPosition.name,
            amount: currentPosition.amount,
            price: currentPrice,
            profit: (currentPrice - currentPosition.entryPrice) * currentPosition.amount,
            status: 'closed',
            timestamp: new Date().toISOString()
          });
          saveTrades();
          currentPosition = null;
          await updatePriceHistory();
        }
      } else if (profitPercent <= -5) {
        log(`⚠️ وقف الخسارة: ${profitPercent.toFixed(2)}%`, 'WARNING');
        const result = await sellToken(currentPosition.address, currentPosition.amount);
        if (result.success) {
          currentPosition = null;
          await updatePriceHistory();
        }
      }
      
      isRunning = false;
      return;
    }

    if (bnbBalance < TRADE_AMOUNT * LEVERAGE) {
      log(`⚠️ رصيد غير كافٍ`, 'WARNING');
      isRunning = false;
      return;
    }

    const currentPrices = await getAllPrices();
    if (Object.keys(priceHistory).length === 0) {
      for (const [address, data] of Object.entries(currentPrices)) {
        priceHistory[address] = data.price;
      }
      isRunning = false;
      return;
    }

    const risingTokens = findRisingTokens(currentPrices);
    
    if (risingTokens.length > 0) {
      const best = risingTokens[0];
      log(`📈 اكتشاف ارتفاع: ${best.name} - ${best.changePercent.toFixed(2)}%`, 'INFO');

      const tradeAmount = TRADE_AMOUNT * LEVERAGE;
      const result = await buyToken(best.address, tradeAmount);
      
      if (result.success) {
        currentPosition = {
          address: best.address,
          name: best.name,
          amount: result.tokenAmount,
          entryPrice: best.price,
          timestamp: Date.now()
        };
        tradesHistory.push({
          id: Date.now(),
          type: 'buy',
          token: best.name,
          amount: result.tokenAmount,
          price: best.price,
          profit: 0,
          status: 'open',
          timestamp: new Date().toISOString()
        });
        saveTrades();
        await updatePriceHistory();
        log(`✅ تم فتح الصفقة على ${best.name}`, 'SUCCESS');
      }
    }

  } catch (error) {
    log(`❌ خطأ: ${error.message}`, 'ERROR');
  }

  isRunning = false;
}

// ==========================================
// خادم الويب ولوحة التحكم
// ==========================================

const app = express();
const PORT = process.env.PORT || 10000;

// معالجة الأخطاء العامة
process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ وعد مرفوض:', error);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// صفحة الحالة
app.get('/', async (req, res) => {
  try {
    let positionStatus = 'لا توجد صفقة مفتوحة';
    let profit = '0%';
    
    if (currentPosition) {
      const currentPrice = await getTokenPriceBNB(currentPosition.address);
      if (currentPrice) {
        profit = (((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100).toFixed(2) + '%';
        positionStatus = `${currentPosition.name} - الربح: ${profit}`;
      }
    }
    
    const balance = await wallet.getBalance();
    const bnbBalance = parseFloat(ethers.utils.formatEther(balance)).toFixed(6);
    
    res.json({
      status: '🤖 بوت التداول يعمل',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      balance: `${bnbBalance} BNB`,
      currentPosition: positionStatus,
      watching: TOKENS.map(t => t.name).join(', '),
      settings: {
        tradeAmount: TRADE_AMOUNT,
        leverage: LEVERAGE,
        profitTarget: PROFIT_PERCENT + '%',
        priceChangeThreshold: PRICE_CHANGE_THRESHOLD + '%',
        checkInterval: CHECK_INTERVAL / 1000 + ' ثانية'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: جلب جميع البيانات
app.get('/api/status-full', async (req, res) => {
  try {
    const balance = await wallet.getBalance();
    const bnbBalance = parseFloat(ethers.utils.formatEther(balance));
    
    loadTrades();
    const openTrades = tradesHistory.filter(t => t.status === 'open');
    
    res.json({
      balance: bnbBalance,
      position: currentPosition,
      trades: tradesHistory,
      openTrades: openTrades.length,
      totalTrades: tradesHistory.length,
      watching: TOKENS.map(t => t.name),
      settings: {
        tradeAmount: TRADE_AMOUNT,
        leverage: LEVERAGE,
        profitTarget: PROFIT_PERCENT,
        priceChangeThreshold: PRICE_CHANGE_THRESHOLD
      }
    });
  } catch (error) {
    console.error('❌ خطأ في API:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: جلب الصفقات
app.get('/api/trades', async (req, res) => {
  try {
    loadTrades();
    res.json(tradesHistory);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: مسح الصفقات
app.delete('/api/clear-trades', (req, res) => {
  try {
    tradesHistory = [];
    saveTrades();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// لوحة التحكم
app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// تشغيل البوت والخادم
// ==========================================

async function startBot() {
  log(`🚀 بدء تشغيل بوت صيد الزخم`, 'START');
  log(`📊 العملات: ${TOKENS.map(t => t.name).join(', ')}`, 'INFO');
  log(`💰 المبلغ: ${TRADE_AMOUNT} BNB (رافعة x${LEVERAGE})`, 'INFO');
  log(`📈 حد الارتفاع: ${PRICE_CHANGE_THRESHOLD}%`, 'INFO');
  log(`🎯 هدف الربح: ${PROFIT_PERCENT}%`, 'INFO');
  log(`⏱️ الفحص كل ${CHECK_INTERVAL/1000} ثانية`, 'INFO');

  loadTrades();
  await updatePriceHistory();
  await tradingCycle();

  setInterval(async () => {
    await tradingCycle();
  }, CHECK_INTERVAL);

  log(`✅ البوت يعمل بنجاح!`, 'SUCCESS');
}

// تشغيل الخادم
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🤖 بوت التداول - Momentum Sniping Bot                      ║
  ║   📡 http://localhost:${PORT}                                  ║
  ║   📊 لوحة التحكم: http://localhost:${PORT}/dashboard.html     ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

// تشغيل البوت
startBot().catch(error => {
  log(`❌ فشل التشغيل: ${error.message}`, 'ERROR');
  process.exit(1);
});
