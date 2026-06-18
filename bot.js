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
// دوال مساعدة (BingX API - نقاط النهاية الصحيحة)
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
  // ✅ استخدام النطاق الصحيح لـ BingX
  const baseURL = 'https://api.bingx.com';
  const timestamp = Date.now();
  
  const allParams = {
    timestamp: timestamp,
    ...params
  };
  
  if (signed) {
    allParams.signature = generateSignature(allParams, API_SECRET);
  }
  
  // ✅ إزالة params من URL ووضعها في body لـ POST
  const url = baseURL + endpoint;
  const headers = {
    'X-BX-APIKEY': API_KEY,
    'Content-Type': 'application/json'
  };
  
  try {
    let response;
    if (method === 'GET') {
      response = await axios.get(url, {
        params: allParams,
        headers: headers
      });
    } else {
      response = await axios.post(url, allParams, {
        headers: headers
      });
    }
    return response.data;
  } catch (error) {
    console.error('❌ خطأ في طلب BingX:', error.response?.data || error.message);
    return null;
  }
}

// ==========================================
// ✅ جلب سعر العملة - Endpoint صحيح
// ==========================================

async function getPrice(symbol) {
  try {
    // ✅ نقطة النهاية الصحيحة لسعر العقود الآجلة
    const response = await bingxRequest('GET', '/openApi/swap/v2/quote/price', { symbol }, false);
    if (response && response.code === 0 && response.data) {
      return parseFloat(response.data.price);
    }
    console.log(`⚠️ استجابة السعر لـ ${symbol}:`, response);
    return null;
  } catch (error) {
    console.error(`❌ فشل جلب سعر ${symbol}:`, error);
    return null;
  }
}

// ==========================================
// ✅ جلب الرصيد من BingX Futures - Endpoint صحيح
// ==========================================

async function getFuturesBalance() {
  try {
    // ✅ نقطة النهاية الصحيحة لجلب الرصيد
    const response = await bingxRequest('GET', '/openApi/swap/v2/user/balance', {});
    
    console.log('📊 استجابة الرصيد:', JSON.stringify(response, null, 2));
    
    if (response && response.code === 0) {
      const balance = response.data || {};
      // ✅ البحث عن USDT في الأصول
      if (balance.balance) {
        return parseFloat(balance.balance) || 0;
      }
      // ✅ طريقة أخرى للوصول للرصيد
      if (balance.USDT) {
        return parseFloat(balance.USDT.available) || 0;
      }
      // ✅ إذا كان على شكل مصفوفة
      if (Array.isArray(balance)) {
        const usdtAsset = balance.find(asset => asset.asset === 'USDT');
        if (usdtAsset) {
          return parseFloat(usdtAsset.available) || 0;
        }
      }
    }
    console.log('⚠️ استجابة الرصيد غير متوقعة:', JSON.stringify(response, null, 2));
    return 0;
  } catch (error) {
    console.error('❌ فشل جلب الرصيد:', error);
    return 0;
  }
}

// ==========================================
// ✅ تعيين الرافعة المالية - Endpoint صحيح
// ==========================================

async function setLeverage(symbol) {
  try {
    // ✅ نقطة النهاية الصحيحة لتعيين الرافعة
    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/leverage', {
      symbol: symbol,
      leverage: LEVERAGE,
      side: 'LONG' // أو 'SHORT' حسب نوع الصفقة
    });
    if (response && response.code === 0) {
      console.log(`✅ تم تعيين الرافعة x${LEVERAGE} لـ ${symbol}`);
      return true;
    }
    console.log(`⚠️ فشل تعيين الرافعة لـ ${symbol}:`, response);
    return false;
  } catch (error) {
    console.error(`❌ فشل تعيين الرافعة:`, error);
    return false;
  }
}

// ==========================================
// ✅ فتح صفقة شراء (Long) - Endpoint صحيح
// ==========================================

async function openLongPosition(symbol, amount) {
  try {
    const price = await getPrice(symbol);
    if (!price) return null;

    const quantity = (amount * LEVERAGE) / price;
    const roundedQuantity = Math.floor(quantity * 1000) / 1000;

    console.log(`📊 فتح صفقة شراء: ${roundedQuantity} ${symbol} بسعر ${price} (رافعة x${LEVERAGE})`);

    // ✅ نقطة النهاية الصحيحة لفتح الصفقة
    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/order', {
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
        orderId: response.data.orderId,
        timestamp: Date.now()
      };
    }
    console.log(`⚠️ فشل فتح الصفقة:`, response);
    return null;
  } catch (error) {
    console.error(`❌ فشل فتح الصفقة:`, error);
    return null;
  }
}

// ==========================================
// ✅ إغلاق صفقة (بيع) - Endpoint صحيح
// ==========================================

async function closePosition(position) {
  try {
    const currentPrice = await getPrice(position.symbol);
    if (!currentPrice) return false;

    console.log(`📊 إغلاق صفقة: ${position.quantity} ${position.symbol} بسعر ${currentPrice}`);

    // ✅ نقطة النهاية الصحيحة لإغلاق الصفقة
    const response = await bingxRequest('POST', '/openApi/swap/v2/trade/order', {
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
    console.log(`⚠️ فشل إغلاق الصفقة:`, response);
    return false;
  } catch (error) {
    console.error(`❌ فشل إغلاق الصفقة:`, error);
    return false;
  }
}

// ==========================================
// ✅ جلب جميع الأسعار - محسّن
// ==========================================

async function getAllPrices() {
  const prices = {};
  for (const symbol of SYMBOLS) {
    const price = await getPrice(symbol);
    if (price) prices[symbol] = { price, name: symbol };
  }
  return prices;
}

// ==========================================
// باقي الكود كما هو...
// ==========================================

// ... (باقي الكود يبقى كما هو)
