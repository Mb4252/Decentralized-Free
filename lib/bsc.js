const { ethers } = require('ethers');
require('dotenv').config();

// ========================================
// إعدادات الشبكة
// ========================================
const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

// محفظة البوت
const hotWalletPrivateKey = process.env.HOT_WALLET_PRIVATE_KEY;
const hotWallet = new ethers.Wallet(hotWalletPrivateKey, provider);
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS || hotWallet.address;

// محفظة الاستثمار
const INVESTMENT_WALLET = process.env.INVESTMENT_WALLET;

// عنوان عقد USDT (BEP20)
const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955';

// ABI لعقد USDT
const USDT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function transferFrom(address sender, address recipient, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, hotWallet);

// ========================================
// دالة التحقق من صحة المعاملة (Transaction)
// ========================================
async function verifyTransaction(txHash, expectedAmount, expectedToAddress = HOT_WALLET_ADDRESS) {
  try {
    console.log(`🔍 جاري التحقق من المعاملة: ${txHash}`);
    
    // 1. جلب تفاصيل المعاملة من الشبكة
    const tx = await provider.getTransaction(txHash);
    
    if (!tx) {
      return { success: false, error: 'المعاملة غير موجودة على الشبكة' };
    }
    
    // 2. التحقق من حالة المعاملة
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return { success: false, error: 'المعاملة لا تزال قيد الانتظار (Pending)' };
    }
    
    // 3. التحقق من نجاح المعاملة
    if (receipt.status !== 1) {
      return { success: false, error: 'فشلت المعاملة (Transaction Failed)' };
    }
    
    // 4. تحليل المعاملة (USDT أو BNB)
    let actualToAddress = tx.to;
    let actualAmount = null;
    
    if (tx.to && tx.to.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
      const iface = new ethers.Interface(USDT_ABI);
      
      for (const log of receipt.logs) {
        try {
          const parsedLog = iface.parseLog(log);
          if (parsedLog && parsedLog.name === 'Transfer') {
            const to = parsedLog.args[1];
            const value = parsedLog.args[2];
            const decimals = await usdtContract.decimals();
            
            actualToAddress = to;
            actualAmount = parseFloat(ethers.formatUnits(value, decimals));
            
            if (to.toLowerCase() === expectedToAddress.toLowerCase()) {
              break;
            }
          }
        } catch (e) {
          // تجاهل الأخطاء
        }
      }
    } else {
      actualToAddress = tx.to;
      actualAmount = parseFloat(ethers.formatEther(tx.value || 0));
    }
    
    // 5. التحقق من التطابق
    const isToAddressMatch = actualToAddress && actualToAddress.toLowerCase() === expectedToAddress.toLowerCase();
    const isAmountMatch = actualAmount && Math.abs(actualAmount - expectedAmount) < 0.01;
    
    if (!isToAddressMatch) {
      return { 
        success: false, 
        error: `العنوان غير متطابق. متوقع: ${expectedToAddress}, المستلم: ${actualToAddress}` 
      };
    }
    
    if (!isAmountMatch) {
      return { 
        success: false, 
        error: `المبلغ غير متطابق. متوقع: ${expectedAmount} USDT, المرسل: ${actualAmount} USDT` 
      };
    }
    
    console.log(`✅ المعاملة صالحة: ${txHash}`);
    return {
      success: true,
      txHash: txHash,
      from: tx.from,
      to: actualToAddress,
      amount: actualAmount,
      blockNumber: receipt.blockNumber,
      gasUsed: parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice)),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`❌ خطأ في التحقق: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ========================================
// الحصول على رصيد BNB
// ========================================
async function getBNBBalance(address = HOT_WALLET_ADDRESS) {
  try {
    const balance = await provider.getBalance(address);
    return parseFloat(ethers.formatEther(balance));
  } catch (error) {
    console.error(`❌ خطأ في جلب رصيد BNB: ${error.message}`);
    return 0;
  }
}

// ========================================
// الحصول على رصيد USDT
// ========================================
async function getUSDTBalance(address = HOT_WALLET_ADDRESS) {
  try {
    const balance = await usdtContract.balanceOf(address);
    const decimals = await usdtContract.decimals();
    return parseFloat(ethers.formatUnits(balance, decimals));
  } catch (error) {
    console.error(`❌ خطأ في جلب رصيد USDT: ${error.message}`);
    return 0;
  }
}

// ========================================
// تحويل USDT
// ========================================
async function transferUSDT(toAddress, amount) {
  try {
    if (!ethers.isAddress(toAddress)) {
      throw new Error(`عنوان غير صالح: ${toAddress}`);
    }
    
    const decimals = await usdtContract.decimals();
    const amountInWei = ethers.parseUnits(amount.toString(), decimals);
    const balance = await getUSDTBalance();
    
    if (balance < amount) {
      throw new Error(`رصيد USDT غير كافٍ: ${balance} USDT`);
    }
    
    const bnbBalance = await getBNBBalance();
    const MIN_BNB = parseFloat(process.env.MIN_BNB_BALANCE || 0.005);
    
    if (bnbBalance < MIN_BNB) {
      throw new Error(`رصيد BNB غير كافٍ للرسوم: ${bnbBalance} BNB`);
    }
    
    console.log(`🔄 جاري تحويل ${amount} USDT إلى ${toAddress.substring(0, 15)}...`);
    const tx = await usdtContract.transfer(toAddress, amountInWei);
    console.log(`📝 المعاملة مرسلة: ${tx.hash}`);
    
    const receipt = await tx.wait();
    const gasUsed = parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice));
    console.log(`✅ تم التحويل بنجاح! Gas: ${gasUsed.toFixed(6)} BNB`);
    
    return {
      success: true,
      hash: tx.hash,
      from: HOT_WALLET_ADDRESS,
      to: toAddress,
      amount: amount,
      gasUsed: gasUsed,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    console.error(`❌ فشل التحويل: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ========================================
// فحص رصيد BNB
// ========================================
async function checkBNBBalance() {
  const bnbBalance = await getBNBBalance();
  const MIN_BNB = parseFloat(process.env.MIN_BNB_BALANCE || 0.005);
  
  if (bnbBalance < MIN_BNB) {
    console.warn(`⚠️ رصيد BNB منخفض: ${bnbBalance.toFixed(6)} BNB`);
    return { isLow: true, balance: bnbBalance, minRequired: MIN_BNB };
  }
  
  console.log(`✅ رصيد BNB: ${bnbBalance.toFixed(6)} BNB`);
  return { isLow: false, balance: bnbBalance, minRequired: MIN_BNB };
}

// ========================================
// إرسال تنبيه
// ========================================
async function sendAlert(message) {
  console.log(`📢 تنبيه: ${message}`);
}

// ========================================
// تصدير الدوال
// ========================================
module.exports = {
  provider,
  hotWallet,
  HOT_WALLET_ADDRESS,
  INVESTMENT_WALLET,
  usdtContract,
  getBNBBalance,
  getUSDTBalance,
  transferUSDT,
  checkBNBBalance,
  sendAlert,
  verifyTransaction
};
