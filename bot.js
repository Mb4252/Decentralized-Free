const { ethers } = require('ethers');
const dotenv = require('dotenv');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const abi = require('./abi.json');
dotenv.config();

// ==========================================
// إعدادات البوت
// ==========================================

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS || '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
const USDT_ADDRESS = process.env.USDT_ADDRESS || '0x55d398326f99059fF775485246999027B3197955';
const LEVERAGE = parseInt(process.env.LEVERAGE) || 10;
const TRADE_AMOUNT = parseFloat(process.env.TRADE_AMOUNT) || 0.001;
const PROFIT_PERCENT = parseFloat(process.env.PROFIT_PERCENT) || 1.2;
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 30000;
const SLIPPAGE = parseFloat(process.env.SLIPPAGE) || 0.5;
const DEBUG = process.env.DEBUG === 'true';

// عناوين العقود
const PANCAKE_ROUTER = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const PANCAKE_FACTORY = '0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73';

// ==========================================
// الاتصال بالشبكة
// ==========================================

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const router = new ethers.Contract(PANCAKE_ROUTER, abi, wallet);

let currentPosition = null;
let isRunning = false;
let tradeHistory = [];

// ==========================================
// دوال مساعدة
// ==========================================

function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${type}] ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==========================================
// جلب سعر العملة
// ==========================================

async function getPrice(tokenAddress) {
  try {
    const path = [tokenAddress, USDT_ADDRESS];
    const amountIn = ethers.utils.parseUnits('1', 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    const price = parseFloat(ethers.utils.formatUnits(amounts[1], 18));
    return price;
  } catch (error) {
    log(`❌ فشل جلب السعر: ${error.message}`, 'ERROR');
    return null;
  }
}

// ==========================================
// شراء عملة
// ==========================================

async function buyToken(amountBNB) {
  try {
    const path = [TOKEN_ADDRESS, USDT_ADDRESS];
    const amountIn = ethers.utils.parseUnits(amountBNB.toString(), 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOutMin = amounts[1].mul(100 - SLIPPAGE * 100).div(100 * 100);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const tx = await router.swapExactETHForTokens(
      amountOutMin,
      [TOKEN_ADDRESS, USDT_ADDRESS],
      WALLET_ADDRESS,
      deadline,
      { value: amountIn, gasLimit: 300000 }
    );
    
    const receipt = await tx.wait();
    const price = await getPrice(TOKEN_ADDRESS);
    log(`✅ تم الشراء بنجاح: ${amountBNB} BNB -> ${ethers.utils.formatUnits(amountOutMin, 18)} USDT`, 'SUCCESS');
    log(`📝 TX: ${receipt.transactionHash}`, 'INFO');
    
    // إرسال البيانات للوحة التحكم
    await sendTradeToDashboard('buy', 'BNB', amountBNB, price, 0, 'open');
    
    return receipt;
  } catch (error) {
    log(`❌ فشل الشراء: ${error.message}`, 'ERROR');
    return null;
  }
}

// ==========================================
// بيع عملة
// ==========================================

async function sellToken(amountToken, profit = 0) {
  try {
    const path = [TOKEN_ADDRESS, USDT_ADDRESS];
    const amountIn = ethers.utils.parseUnits(amountToken.toString(), 18);
    const amounts = await router.getAmountsOut(amountIn, path);
    const amountOutMin = amounts[1].mul(100 - SLIPPAGE * 100).div(100 * 100);
    
    const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
    const tx = await router.swapExactTokensForETH(
      amountIn,
      amountOutMin,
      [TOKEN_ADDRESS, USDT_ADDRESS],
      WALLET_ADDRESS,
      deadline,
      { gasLimit: 300000 }
    );
    
    const receipt = await tx.wait();
    const price = await getPrice(TOKEN_ADDRESS);
    log(`✅ تم البيع بنجاح: ${amountToken} TOKEN -> ${ethers.utils.formatUnits(amountOutMin, 18)} USDT`, 'SUCCESS');
    log(`📝 TX: ${receipt.transactionHash}`, 'INFO');
    
    // إرسال البيانات للوحة التحكم
    await sendTradeToDashboard('sell', 'BNB', amountToken, price, profit, 'closed');
    
    return receipt;
  } catch (error) {
    log(`❌ فشل البيع: ${error.message}`, 'ERROR');
    return null;
  }
}

// ==========================================
// إرسال البيانات للوحة التحكم
// ==========================================

async function sendTradeToDashboard(type, token, amount, price, profit, status) {
  try {
    await axios.post('http://localhost:8080/api/add-trade', {
      type,
      token,
      amount,
      price,
      profit,
      status
    });
  } catch (error) {
    // لا نعرض خطأ حتى لا نوقف البوت
    if (DEBUG) {
      log(`⚠️ فشل إرسال البيانات للوحة التحكم: ${error.message}`, 'WARNING');
    }
  }
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

    // 2. إذا لم تكن هناك صفقة مفتوحة، افتح واحدة
    if (!currentPosition) {
      if (bnbBalance < TRADE_AMOUNT) {
        log(`⚠️ رصيد غير كافٍ (يحتاج ${TRADE_AMOUNT} BNB)`, 'WARNING');
        isRunning = false;
        return;
      }

      // حساب كمية الشراء مع الرافعة
      const tradeAmount = TRADE_AMOUNT * LEVERAGE;
      const currentPrice = await getPrice(TOKEN_ADDRESS);
      log(`📊 فتح صفقة شراء: ${tradeAmount.toFixed(6)} BNB (رافعة x${LEVERAGE})`, 'INFO');
      
      const receipt = await buyToken(tradeAmount);
      if (receipt) {
        currentPosition = {
          entryPrice: currentPrice,
          amount: tradeAmount,
          timestamp: Date.now()
        };
        log(`✅ تم فتح الصفقة بنجاح`, 'SUCCESS');
      }
    } else {
      // 3. إذا كانت هناك صفقة مفتوحة، تحقق من الربح
      const currentPrice = await getPrice(TOKEN_ADDRESS);
      if (!currentPrice) {
        isRunning = false;
        return;
      }

      const profitPercent = ((currentPrice - currentPosition.entryPrice) / currentPosition.entryPrice) * 100;
      const profitAmount = (currentPrice - currentPosition.entryPrice) * currentPosition.amount;
      log(`📊 السعر الحالي: ${currentPrice.toFixed(6)} USDT، الربح: ${profitPercent.toFixed(2)}%`, 'INFO');

      if (profitPercent >= PROFIT_PERCENT) {
        log(`✅ جني ربح: ${profitPercent.toFixed(2)}% (${profitAmount.toFixed(4)} USDT)`, 'SUCCESS');
        await sellToken(currentPosition.amount, profitAmount);
        currentPosition = null;
        log(`🔄 جاري التحضير للصفقة التالية...`, 'INFO');
      } else if (profitPercent <= -5) {
        log(`⚠️ وقف الخسارة مفعل! الخسارة ${profitPercent.toFixed(2)}%`, 'WARNING');
        await sellToken(currentPosition.amount, profitAmount);
        currentPosition = null;
      }
    }

  } catch (error) {
    log(`❌ خطأ في دورة التداول: ${error.message}`, 'ERROR');
  }

  isRunning = false;
}

// ==========================================
// تشغيل البوت
// ==========================================

async function startBot() {
  log(`🚀 بدء تشغيل بوت التداول الشبكي (Grid)`, 'START');
  log(`📊 العملة: ${TOKEN_ADDRESS}`, 'INFO');
  log(`💰 المبلغ: ${TRADE_AMOUNT} BNB (رافعة x${LEVERAGE})`, 'INFO');
  log(`📈 نسبة الربح: ${PROFIT_PERCENT}%`, 'INFO');
  log(`⏱️ الفحص كل ${CHECK_INTERVAL/1000} ثانية`, 'INFO');
  log(`📡 لوحة التحكم: http://localhost:8080`, 'INFO');

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
