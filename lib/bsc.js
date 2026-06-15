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
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS || hotWallet.address || '0x9EB39A10c059877910DAff1fd8098e5DB32486F7';

// محفظة الاستثمار
const INVESTMENT_WALLET = process.env.INVESTMENT_WALLET;

// عنوان عقد USDT (BEP20)
const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955';

// ABI لعقد USDT (الوظائف الأساسية فقط)
const USDT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function transferFrom(address sender, address recipient, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, hotWallet);

// ========================================
// دالة التحقق من صحة المعاملة (Transaction) - نسخة محسنة
// ========================================
async function verifyTransaction(txHash, expectedAmount, expectedToAddress = HOT_WALLET_ADDRESS) {
  try {
    console.log(`🔍 جاري التحقق من المعاملة: ${txHash}`);
    
    // 1. جلب تفاصيل المعاملة من الشبكة
    const tx = await provider.getTransaction(txHash);
    
    if (!tx) {
      return { 
        success: false, 
        error: '❌ المعاملة غير موجودة على الشبكة. تأكد من:\n1. صحة Transaction Hash\n2. أن المعاملة تمت على شبكة BSC (BEP20)\n3. انتظار بضع دقائق ثم المحاولة مرة أخرى' 
      };
    }
    
    // 2. جلب إيصال المعاملة (receipt)
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (!receipt) {
      return { 
        success: false, 
        error: '⏳ المعاملة لا تزال قيد الانتظار (Pending). يرجى الانتظار حتى يتم تأكيدها على الشبكة ثم حاول مرة أخرى.\nقد يستغرق هذا بضع دقائق.' 
      };
    }
    
    // 3. التحقق من نجاح المعاملة
    if (receipt.status !== 1) {
      return { 
        success: false, 
        error: '❌ فشلت المعاملة (Transaction Failed). تأكد من:\n1. وجود رصيد كافٍ في محفظتك\n2. أنك ترسل USDT وليس عملة أخرى\n3. رسوم الشبكة (Gas) مناسبة' 
      };
    }
    
    // 4. متغيرات لتخزين البيانات المستخرجة
    let actualToAddress = null;
    let actualAmount = null;
    let fromAddress = null;
    
    // 5. التحقق مما إذا كانت المعاملة موجهة لعقد USDT
    if (tx.to && tx.to.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
      console.log('📝 معاملة USDT detected, parsing logs...');
      
      // إنشاء Interface لتحليل الأحداث
      const iface = new ethers.Interface(USDT_ABI);
      
      // البحث في logs عن حدث Transfer
      for (const log of receipt.logs) {
        // التأكد أن الـ log يأتي من عقد USDT
        if (log.address.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
          try {
            const parsedLog = iface.parseLog(log);
            if (parsedLog && parsedLog.name === 'Transfer') {
              // في ABI الخاص بـ USDT، ترتيب المعاملات هو: (from, to, value)
              fromAddress = parsedLog.args[0];
              actualToAddress = parsedLog.args[1];
              const value = parsedLog.args[2];
              const decimals = await usdtContract.decimals();
              actualAmount = parseFloat(ethers.formatUnits(value, decimals));
              
              console.log(`📊 Transfer event found: From: ${fromAddress}, To: ${actualToAddress}, Amount: ${actualAmount} USDT`);
              
              // إذا وجدنا التحويل المطلوب (للمحفظة المستلمة)، نخرج من الحلقة
              if (actualToAddress && actualToAddress.toLowerCase() === expectedToAddress.toLowerCase()) {
                console.log('✅ Target recipient found!');
                break;
              }
            }
          } catch (e) {
            // تجاهل الأخطاء في فك تشفير log واحد
            console.warn('⚠️ Failed to parse log:', e.message);
          }
        }
      }
    } else {
      // معاملة BNB عادية
      console.log('📝 BNB transaction detected');
      actualToAddress = tx.to;
      actualAmount = parseFloat(ethers.formatEther(tx.value || 0));
      fromAddress = tx.from;
    }
    
    // 6. التحقق من وجود البيانات
    if (actualToAddress === null) {
      return { 
        success: false, 
        error: '❌ لم يتم العثور على حدث Transfer في المعاملة.\nتأكد من:\n1. أنك أرسلت USDT (وليس BNB أو عملة أخرى)\n2. أنك أرسلت على شبكة BSC (BEP20)\n3. أن عنوان المستلم صحيح' 
      };
    }
    
    // 7. التحقق من تطابق العنوان (غير حساس لحالة الأحرف)
    const isToAddressMatch = actualToAddress.toLowerCase() === expectedToAddress.toLowerCase();
    
    if (!isToAddressMatch) {
      return { 
        success: false, 
        error: `⚠️ العنوان غير متطابق!\n\n📤 العنوان الذي أرسلت إليه:\n${actualToAddress}\n\n📥 العنوان الصحيح للمنصة:\n${expectedToAddress}\n\n🔧 الحلول المقترحة:\n1. تأكد من أنك تنسخ العنوان بشكل صحيح\n2. تأكد من أنك ترسل على شبكة BSC (BEP20)\n3. إذا كنت تستخدم المستخدم الاستثنائي، يمكنك التواصل مع الدعم` 
      };
    }
    
    // 8. التحقق من المبلغ (إذا كان متوقعاً)
    if (expectedAmount && expectedAmount > 0) {
      const isAmountMatch = Math.abs(actualAmount - expectedAmount) < 0.01;
      if (!isAmountMatch) {
        return { 
          success: false, 
          error: `⚠️ المبلغ غير متطابق!\n\n💰 المبلغ المرسل: ${actualAmount} USDT\n💰 المبلغ المطلوب: ${expectedAmount} USDT\n\n🔧 الحل: تأكد من إرسال المبلغ الصحيح` 
        };
      }
    }
    
    console.log(`✅ المعاملة صالحة: ${txHash}`);
    return {
      success: true,
      txHash: txHash,
      from: fromAddress,
      to: actualToAddress,
      amount: actualAmount,
      blockNumber: receipt.blockNumber,
      gasUsed: parseFloat(ethers.formatEther(receipt.gasUsed * receipt.gasPrice)),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error(`❌ خطأ في التحقق من المعاملة: ${error.message}`);
    return { 
      success: false, 
      error: `❌ خطأ تقني: ${error.message}\n\nيرجى المحاولة مرة أخرى أو التواصل مع الدعم.` 
    };
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
      throw new Error(`رصيد USDT غير كافٍ: ${balance} USDT متاح، والمطلوب: ${amount} USDT`);
    }
    
    const bnbBalance = await getBNBBalance();
    const MIN_BNB = parseFloat(process.env.MIN_BNB_BALANCE || 0.005);
    
    if (bnbBalance < MIN_BNB) {
      throw new Error(`رصيد BNB غير كافٍ لرسوم الشبكة: ${bnbBalance} BNB متاح، والحد الأدنى المطلوب: ${MIN_BNB} BNB`);
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
    console.warn(`⚠️ رصيد BNB منخفض: ${bnbBalance.toFixed(6)} BNB (الحد الأدنى: ${MIN_BNB} BNB)`);
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
  // يمكن إضافة إرسال بريد إلكتروني أو رسالة تلغرام هنا
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
