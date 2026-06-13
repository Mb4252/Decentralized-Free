const { ethers } = require('ethers');
require('dotenv').config();

// إعدادات الشبكة
const BSC_RPC_URL = process.env.BSC_RPC_URL;
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

// محفظة البوت (Hot Wallet)
const hotWalletPrivateKey = process.env.HOT_WALLET_PRIVATE_KEY;
const hotWallet = new ethers.Wallet(hotWalletPrivateKey, provider);
const HOT_WALLET_ADDRESS = hotWallet.address;

// محفظة الاستثمار
const INVESTMENT_WALLET = process.env.INVESTMENT_WALLET;

// عنوان عقد USDT (BEP20)
const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT;

// ABI لعقد USDT (الوظائف الأساسية فقط)
const USDT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

// إنشاء عقد USDT
const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, hotWallet);

// الحصول على رصيد BNB للمحفظة
async function getBNBBalance(address = HOT_WALLET_ADDRESS) {
  const balance = await provider.getBalance(address);
  return parseFloat(ethers.formatEther(balance));
}

// الحصول على رصيد USDT للمحفظة
async function getUSDTBalance(address = HOT_WALLET_ADDRESS) {
  const balance = await usdtContract.balanceOf(address);
  const decimals = await usdtContract.decimals();
  return parseFloat(ethers.formatUnits(balance, decimals));
}

// تحويل USDT من المحفظة الساخنة إلى عنوان آخر
async function transferUSDT(toAddress, amount) {
  try {
    const decimals = await usdtContract.decimals();
    const amountInWei = ethers.parseUnits(amount.toString(), decimals);
    
    // التحقق من رصيد USDT
    const balance = await getUSDTBalance();
    if (balance < amount) {
      throw new Error(`رصيد USDT غير كافٍ: ${balance} USDT متاح، المطلوب ${amount} USDT`);
    }
    
    // التحقق من رصيد BNB للرسوم
    const bnbBalance = await getBNBBalance();
    const MIN_BNB = parseFloat(process.env.MIN_BNB_BALANCE || 0.01);
    if (bnbBalance < MIN_BNB) {
      throw new Error(`رصيد BNB غير كافٍ للرسوم: ${bnbBalance} BNB متاح، الحد الأدنى ${MIN_BNB} BNB`);
    }
    
    console.log(`🔄 جاري تحويل ${amount} USDT إلى ${toAddress}...`);
    const tx = await usdtContract.transfer(toAddress, amountInWei);
    console.log(`📝 المعاملة مرسلة: ${tx.hash}`);
    
    const receipt = await tx.wait();
    console.log(`✅ تم التحويل بنجاح! Gas المستخدم: ${ethers.formatEther(receipt.gasUsed * receipt.gasPrice)} BNB`);
    
    return {
      success: true,
      hash: tx.hash,
      from: HOT_WALLET_ADDRESS,
      to: toAddress,
      amount: amount,
      gasUsed: ethers.formatEther(receipt.gasUsed * receipt.gasPrice),
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    console.error(`❌ فشل التحويل: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// مراقبة رصيد BNB (نظام حماية السيولة)
async function checkBNBBalance() {
  const bnbBalance = await getBNBBalance();
  const MIN_BNB = parseFloat(process.env.MIN_BNB_BALANCE || 0.01);
  
  if (bnbBalance < MIN_BNB) {
    console.warn(`⚠️ تنبيه: رصيد BNB منخفض! ${bnbBalance} BNB متاح (الحد الأدنى: ${MIN_BNB} BNB)`);
    return { isLow: true, balance: bnbBalance, minRequired: MIN_BNB };
  }
  
  console.log(`✅ رصيد BNB كافٍ: ${bnbBalance} BNB`);
  return { isLow: false, balance: bnbBalance, minRequired: MIN_BNB };
}

// مراقبة الإيداعات الجديدة (يتم استدعاؤها من الـ Cron Job أو Webhook)
async function checkNewDeposits() {
  console.log('🔍 جاري فحص الإيداعات الجديدة...');
  
  // التحقق من رصيد BNB أولاً
  const bnbStatus = await checkBNBBalance();
  if (bnbStatus.isLow) {
    console.error('❌ تم إيقاف العمليات بسبب نقص رصيد BNB');
    await sendAlert('⚠️ تنبيه: رصيد BNB منخفض! يرجى إعادة شحن المحفظة.');
    return { processed: 0, error: 'Low BNB balance' };
  }
  
  // هنا سيتم جلب الإيداعات من قاعدة البيانات و معالجتها
  // (سيتم تفصيلها في server.js)
  
  return { processed: 0 };
}

// إرسال تنبيه (يمكن إرسال بريد إلكتروني أو إلى تلغرام)
async function sendAlert(message) {
  console.log(`📢 تنبيه: ${message}`);
  // يمكن إضافة إرسال بريد إلكتروني أو رسالة تلغرام هنا
}

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
  checkNewDeposits,
  sendAlert
};
