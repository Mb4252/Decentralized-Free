const { ethers } = require('ethers');
require('dotenv').config();

const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';
const provider = new ethers.JsonRpcProvider(BSC_RPC_URL);

const hotWalletPrivateKey = process.env.HOT_WALLET_PRIVATE_KEY;
const hotWallet = new ethers.Wallet(hotWalletPrivateKey, provider);
const HOT_WALLET_ADDRESS = process.env.HOT_WALLET_ADDRESS || '0x9EB39A10c059877910DAff1fd8098e5DB32486F7';

const USDT_CONTRACT_ADDRESS = process.env.USDT_CONTRACT || '0x55d398326f99059fF775485246999027B3197955';

const USDT_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'event Transfer(address indexed from, address indexed to, uint256 value)'
];

const usdtContract = new ethers.Contract(USDT_CONTRACT_ADDRESS, USDT_ABI, hotWallet);

async function verifyTransaction(txHash, expectedAmount, expectedToAddress = HOT_WALLET_ADDRESS) {
  try {
    console.log(`🔍 جاري التحقق من المعاملة: ${txHash}`);
    
    if (!txHash || typeof txHash !== 'string') {
      return { success: false, error: '❌ TXID غير صالح' };
    }
    
    txHash = txHash.trim();
    if (!txHash.startsWith('0x')) {
      txHash = '0x' + txHash;
    }
    
    const tx = await provider.getTransaction(txHash);
    if (!tx) {
      return { success: false, error: '❌ المعاملة غير موجودة على الشبكة' };
    }
    
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { success: false, error: '⏳ المعاملة لا تزال قيد الانتظار' };
    }
    
    if (receipt.status !== 1) {
      return { success: false, error: '❌ فشلت المعاملة' };
    }
    
    let actualToAddress = null;
    let actualAmount = null;
    let fromAddress = null;
    
    if (tx.to && tx.to.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
      const iface = new ethers.Interface(USDT_ABI);
      
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === USDT_CONTRACT_ADDRESS.toLowerCase()) {
          try {
            const parsedLog = iface.parseLog(log);
            if (parsedLog && parsedLog.name === 'Transfer') {
              fromAddress = parsedLog.args[0];
              actualToAddress = parsedLog.args[1];
              const value = parsedLog.args[2];
              const decimals = await usdtContract.decimals();
              actualAmount = parseFloat(ethers.formatUnits(value, decimals));
              break;
            }
          } catch (e) {}
        }
      }
    } else {
      actualToAddress = tx.to;
      actualAmount = parseFloat(ethers.formatEther(tx.value || 0));
      fromAddress = tx.from;
    }
    
    if (actualToAddress === null) {
      return { success: false, error: '❌ لم يتم العثور على Transfer' };
    }
    
    if (actualToAddress.toLowerCase() !== expectedToAddress.toLowerCase()) {
      return { success: false, error: '⚠️ العنوان غير متطابق' };
    }
    
    if (expectedAmount > 0 && actualAmount < expectedAmount) {
      return { success: false, error: `⚠️ المبلغ غير كافٍ: ${actualAmount} < ${expectedAmount}` };
    }
    
    return {
      success: true,
      txHash: txHash,
      from: fromAddress,
      to: actualToAddress,
      amount: actualAmount,
      blockNumber: receipt.blockNumber
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function getUSDTBalance(address = HOT_WALLET_ADDRESS) {
  try {
    const balance = await usdtContract.balanceOf(address);
    const decimals = await usdtContract.decimals();
    return parseFloat(ethers.formatUnits(balance, decimals));
  } catch (error) {
    return 0;
  }
}

async function transferUSDT(toAddress, amount) {
  try {
    const decimals = await usdtContract.decimals();
    const amountInWei = ethers.parseUnits(amount.toString(), decimals);
    const tx = await usdtContract.transfer(toAddress, amountInWei);
    const receipt = await tx.wait();
    return {
      success: true,
      hash: tx.hash,
      amount: amount,
      blockNumber: receipt.blockNumber
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  HOT_WALLET_ADDRESS,
  verifyTransaction,
  getUSDTBalance,
  transferUSDT
};
