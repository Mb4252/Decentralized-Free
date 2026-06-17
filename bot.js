const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const express = require('express');
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

// قائمة العملات للمراقبة (عناوين العقود + أسماء)
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

let currentPosition = null; // الصفقة المفتوحة حالياً
let priceHistory = {}; // لتخزين الأسعار السابقة
let isRunning = false;

// ==========================================
// دوال مساعدة
// ==========================================

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

// ==========================================
// جلب سعر العملة (بالنسبة لـ BNB)
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

// ==========================================
// جلب جميع الأسعار الحالية
// ==========================================

async function getAllPrices() {
  const prices = {};
  for (const token of TOKENS) {
    const price = await getTokenPriceBNB(token.address);
    if (price) prices[token.address] = { price, name: token.name };
  }
  return prices;
}

// ==========================================
// تحليل العملات المتزايدة (Momentum Scan)
// ==========================================

function findRisingTokens(currentPrices) {
  const rising = [];
  for (const [address, data] of Object.entries(currentPrices)) {
    const price = data.price;
    if (priceHistory[address]) {
      const oldPrice = priceHistory[address];
      const changePercent = ((price - oldPrice) / oldPrice) * 100;
      if (changePercent >= PRICE_CHANGE_THRESHOLD) {
        rising.push({ 
          address, 
          name: data.name, 
          price, 
          changePercent,
          oldPrice
        });
      }
    }
  }
  // ترتيب حسب نسبة الارتفاع (الأعلى أولاً)
  rising.sort((a, b) => b.changePercent - a.changePercent);
  return rising;
}

// ==========================================
// شراء عملة (مع الرافعة المالية)
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

// ==========================================
// بيع عملة
// ==========================================

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

// ==========================================
// تحديث تاريخ الأسعار
// ==========================================

async function updatePriceHistory() {
  const currentPrices = await getAllPrices();
  for (const [address, data] of Object.entries(currentPrices)) {
    priceHistory[address] = data.price;
  }
  log(`📊 تم تحديث تاريخ الأسعار (${Object.keys(priceHistory).length} عملة)`, 'INFO');
}

// ==========================================
// دورة التداول الرئيسية
// ==========================================

async function tradingCycle() {
  if (isRunning) return;
  isRunning = true;

  try {
    // 1. جلب الرصيد
    const balance = await wallet.getBalance();
    const bnbBalance = parseFloat(ethers.utils.formatEther(balance));
    log(`💰 رصيد BNB: ${bnbBalance.toFixed(6)} BNB`, 'INFO');

    // 2. إذا كانت هناك صفقة مفتوحة، تحقق من الربح
    if (currentPosition) {
      const currentPrice = await getTokenPriceBNB(currentPosition.address);
      if (!currentPrice) {
        isRunning = false;
        return;
      }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100;
      log(`📊 العملة: ${currentPosition.name} - السعر الحالي: ${currentPrice.toFixed(4)} BNB - الربح: ${profitPercent.toFixed(2)}%`, 'INFO');

      // إذا وصل الربح للهدف → بيع
      if (profitPercent >= PROFIT_PERCENT) {
        log(`✅ تحقيق الربح: ${profitPercent.toFixed(2)}%`, 'SUCCESS');
        const result = await sellToken(currentPosition.address, currentPosition.amount);
        if (result.success) {
          currentPosition = null;
          log(`🔄 تم البيع، جاري البحث عن عملة جديدة...`, 'INFO');
          await updatePriceHistory();
        }
      } 
      // إذا وصلت الخسارة إلى 5% → بيع (وقف خسارة)
      else if (profitPercent <= -5) {
        log(`⚠️ وقف الخسارة: ${profitPercent.toFixed(2)}%`, 'WARNING');
        const result = await sellToken(currentPosition.address, currentPosition.amount);
        if (result.success) {
          currentPosition = null;
          log(`🔄 تم البيع بخسارة، جاري البحث عن عملة جديدة...`, 'INFO');
          await updatePriceHistory();
        }
      }
      
      isRunning = false;
      return;
    }

    // 3. إذا لم تكن هناك صفقة مفتوحة، ابحث عن فرصة شراء جديدة
    if (bnbBalance < TRADE_AMOUNT * LEVERAGE) {
      log(`⚠️ رصيد غير كافٍ (يحتاج ${(TRADE_AMOUNT * LEVERAGE).toFixed(6)} BNB)`, 'WARNING');
      isRunning = false;
      return;
    }

    // جلب الأسعار الحالية
    const currentPrices = await getAllPrices();
    if (!currentPrices || Object.keys(currentPrices).length === 0) {
      log('⚠️ لا توجد أسعار متاحة', 'WARNING');
      isRunning = false;
      return;
    }

    // تحديث تاريخ الأسعار (إذا كانت فارغة)
    if (Object.keys(priceHistory).length === 0) {
      for (const [address, data] of Object.entries(currentPrices)) {
        priceHistory[address] = data.price;
      }
      log('📊 تم تهيئة تاريخ الأسعار', 'INFO');
      isRunning = false;
      return;
    }

    // البحث عن عملات متزايدة
    const risingTokens = findRisingTokens(currentPrices);
    
    if (risingTokens.length > 0) {
      // اختر العملة الأعلى ارتفاعاً
      const best = risingTokens[0];
      log(`📈 اكتشاف ارتفاع: ${best.name} - ${best.changePercent.toFixed(2)}% (من ${best.oldPrice.toFixed(6)} إلى ${best.price.toFixed(6)})`, 'INFO');

      // حساب المبلغ مع الرافعة
      const tradeAmount = TRADE_AMOUNT * LEVERAGE;
      log(`📊 فتح صفقة شراء: ${tradeAmount.toFixed(6)} BNB (رافعة x${LEVERAGE}) على ${best.name}`, 'INFO');
      
      const result = await buyToken(best.address, tradeAmount);
      if (result.success) {
        currentPosition = {
          address: best.address,
          name: best.name,
          amount: result.tokenAmount,
          entryPrice: best.price,
          timestamp: Date.now()
        };
        log(`✅ تم فتح الصفقة على ${best.name}`, 'SUCCESS');
        await updatePriceHistory();
      }
    } else {
      log(`📊 لا توجد عملات متزايدة (الحد: ${PRICE_CHANGE_THRESHOLD}%)`, 'INFO');
    }

  } catch (error) {
    log(`❌ خطأ في دورة التداول: ${error.message}`, 'ERROR');
  }

  isRunning = false;
}

// ==========================================
// خادم ويب بسيط (لتلبية متطلبات Render)
// ==========================================

const webApp = express();
const WEB_PORT = process.env.PORT || 10000;

webApp.get('/', async (req, res) => {
  let positionStatus = 'لا توجد صفقة مفتوحة';
  let profit = '0%';
  
  if (currentPosition) {
    const currentPrice = await getTokenPriceBNB(currentPosition.address);
    if (currentPrice) {
      profit = (((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100).toFixed(2) + '%';
      positionStatus = `${currentPosition.name} - السعر: ${currentPrice.toFixed(4)} BNB - الربح: ${profit}`;
    } else {
      positionStatus = `${currentPosition.name} - جاري تحديث السعر...`;
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
});

webApp.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`📡 خادم الحالة يعمل على المنفذ ${WEB_PORT}`);
});

// ==========================================
// تشغيل البوت
// ==========================================

async function startBot() {
  log(`🚀 بدء تشغيل بوت صيد الزخم (Momentum Sniping)`, 'START');
  log(`📊 العملات المراقبة: ${TOKENS.map(t => t.name).join(', ')}`, 'INFO');
  log(`💰 المبلغ: ${TRADE_AMOUNT} BNB (رافعة x${LEVERAGE})`, 'INFO');
  log(`📈 حد الارتفاع: ${PRICE_CHANGE_THRESHOLD}%`, 'INFO');
  log(`🎯 هدف الربح: ${PROFIT_PERCENT}%`, 'INFO');
  log(`⏱️ الفحص كل ${CHECK_INTERVAL/1000} ثانية`, 'INFO');
  log(`📡 خادم الحالة: http://localhost:${WEB_PORT}`, 'INFO');

  // تحديث الأسعار الأولية
  await updatePriceHistory();

  // تشغيل الدورة الأولى
  await tradingCycle();

  // دورة التشغيل المتكررة
  setInterval(async () => {
    await tradingCycle();
  }, CHECK_INTERVAL);

  log(`✅ البوت يعمل بنجاح!`, 'SUCCESS');
}

// ==========================================
// التعامل مع إيقاف البوت
// ==========================================

process.on('SIGINT', async () => {
  log('🛑 جاري إيقاف البوت...', 'INFO');
  process.exit(0);
});

// ==========================================
// تشغيل البوت
// ==========================================

startBot().catch(error => {
  log(`❌ فشل تشغيل البوت: ${error.message}`, 'ERROR');
  process.exit(1);
});
