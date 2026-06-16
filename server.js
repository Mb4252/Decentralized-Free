const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();

// ==========================================
// إعدادات الأمان
// ==========================================

// Helmet - حماية الرؤوس (Headers)
app.use(helmet());

// CORS - تحديد النطاقات المسموحة
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('app'));

// ==========================================
// Rate Limiting - حماية من هجمات Brute Force
// ==========================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // 100 طلب لكل IP
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
  standardHeaders: true,
  legacyHeaders: false,
});

// تطبيق على جميع الطلبات
app.use('/api/', limiter);

// حد خاص لتسجيل الدخول (5 محاولات في الدقيقة)
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 5,
  message: { error: '⚠️太多 محاولات تسجيل الدخول. يرجى الانتظار دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ========================================
// تهيئة Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ========================================
// JWT - المصادقة
// ========================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 10;

// Middleware للتحقق من JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح به - يرجى تسجيل الدخول' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً' });
      }
      return res.status(403).json({ error: 'رمز غير صالح' });
    }
    req.user = decoded;
    next();
  });
}

// Middleware للتحقق من صلاحيات الأدمن
function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'غير مصرح به - صلاحيات أدمن مطلوبة' });
    }
    next();
  });
}

// ========================================
// دالة لتوليد UUID
// ========================================
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// API: صحّة الخادم
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// API: تسجيل الدخول (مع تشفير كلمة المرور)
// ==========================================
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });
  }

  try {
    // جلب المستخدم
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // مقارنة كلمة المرور المشفرة
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // إنشاء JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        name: user.name,
        is_admin: user.is_admin || false
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true,
      token: token,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        is_admin: user.is_admin || false
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: إنشاء حساب جديد (مع تشفير كلمة المرور)
// ==========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
  }

  try {
    // التحقق من وجود المستخدم
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'هذا البريد مسجل بالفعل' });
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newReferralCode = Math.random().toString(36).substring(2, 10).toUpperCase();

    let referrerId = null;
    if (referralCode) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referralCode.toUpperCase())
        .single();
      if (referrer) referrerId = referrer.id;
    }

    const userId = generateUUID();

    const { error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        email: email,
        password: hashedPassword, // ⭐ مشفرة!
        name: name,
        referral_code: newReferralCode,
        referrer_id: referrerId,
        is_admin: false,
        available_balance: 0,
        platform_balance: 0,
        total_orders: 0,
        total_spent: 0,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      console.error('Register error:', insertError);
      return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
    }

    // إنشاء JWT token
    const token = jwt.sign(
      { 
        userId: userId, 
        email: email, 
        name: name,
        is_admin: false
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ 
      success: true,
      token: token,
      user: { id: userId, email: email, name: name },
      referral_code: newReferralCode
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: جلب بيانات المستخدم (محمي بـ JWT)
// ==========================================
app.post('/api/user', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // إزالة كلمة المرور قبل الإرسال
    delete data.password;
    
    res.json(data);

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: عرض المنتجات المتاحة للمستخدمين
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تفاصيل منتج معين
// ==========================================
app.get('/api/product/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: طلب منتج (شراء) - محمي
// ==========================================
app.post('/api/order-product', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { productId, quantity, location, acceptTerms } = req.body;

  if (!productId || !quantity || !location) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة (المنتج، الكمية، المنطقة)' });
  }

  if (!acceptTerms) {
    return res.status(400).json({ error: '⚠️ يجب الموافقة على شروط الشراء' });
  }

  try {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }

    if (product.status === 'completed') {
      return res.status(400).json({ error: '⚠️ العدد المطلوب اكتمل' });
    }

    const remaining = product.min_quantity - product.current_orders;
    if (quantity > remaining) {
      return res.status(400).json({ 
        error: `⚠️ العدد المتبقي فقط ${remaining} قطعة` 
      });
    }

    const totalAmount = product.group_price * quantity;

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (user.available_balance < totalAmount) {
      return res.status(400).json({ 
        error: `⚠️ رصيدك غير كافٍ. المطلوب: ${totalAmount} USDT، المتاح: ${user.available_balance} USDT` 
      });
    }

    const newBalance = user.available_balance - totalAmount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: newBalance,
        platform_balance: supabaseAdmin.raw('platform_balance + ?', totalAmount)
      })
      .eq('id', userId);

    if (updateError) throw updateError;

    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        quantity: quantity,
        total_amount: totalAmount,
        location: location,
        status: 'pending',
        withdraw_count: 0,
        is_banned: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (orderError) {
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: user.available_balance,
          platform_balance: supabaseAdmin.raw('platform_balance - ?', totalAmount)
        })
        .eq('id', userId);
      throw orderError;
    }

    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ current_orders: newCurrentOrders })
      .eq('id', productId);

    await supabaseAdmin
      .from('users')
      .update({ 
        total_orders: supabaseAdmin.raw('total_orders + 1'),
        total_spent: supabaseAdmin.raw('total_spent + ?', totalAmount)
      })
      .eq('id', userId);

    let message = `✅ تم شراء ${quantity} × ${product.name} بنجاح!`;
    let isCompleted = false;

    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ` 🎉 اكتمل العدد المطلوب! سيتم الشراء والتوزيع قريباً.`;
      await supabaseAdmin
        .from('products')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', productId);
    }

    res.json({
      success: true,
      message: message,
      order: order,
      isCompleted: isCompleted,
      remainingToComplete: Math.max(0, product.min_quantity - newCurrentOrders),
      currentOrders: newCurrentOrders,
      minQuantity: product.min_quantity
    });

  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: سحب الطلب - محمي
// ==========================================
app.post('/api/withdraw-order', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'معرف الطلب مطلوب' });
  }

  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(status, min_quantity, current_orders)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    if (order.user_id !== userId) {
      return res.status(403).json({ error: '⚠️ هذا الطلب ليس لك' });
    }

    if (order.products.status === 'completed') {
      return res.status(400).json({ error: '⚠️ العدد اكتمل، لا يمكن السحب' });
    }

    if (order.is_banned) {
      return res.status(400).json({ error: '⚠️ تم استبعادك من هذا المنتج' });
    }

    const newWithdrawCount = (order.withdraw_count || 0) + 1;
    let isBanned = false;

    if (newWithdrawCount >= 2) {
      isBanned = true;
      await supabaseAdmin
        .from('product_orders')
        .update({ is_banned: true, status: 'withdrawn', withdrawn_at: new Date().toISOString() })
        .eq('id', orderId);
    } else {
      await supabaseAdmin
        .from('product_orders')
        .update({ status: 'withdrawn', withdraw_count: newWithdrawCount, withdrawn_at: new Date().toISOString() })
        .eq('id', orderId);
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    const newBalance = (user.available_balance || 0) + order.total_amount;
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: newBalance,
        platform_balance: supabaseAdmin.raw('platform_balance - ?', order.total_amount)
      })
      .eq('id', userId);

    await supabaseAdmin
      .from('products')
      .update({ current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity) })
      .eq('id', order.product_id);

    await supabaseAdmin
      .from('withdrawal_logs')
      .insert({
        order_id: orderId,
        user_id: userId,
        amount: order.total_amount,
        reason: isBanned ? 'استبعاد بسبب كثرة السحب' : 'سحب طلب',
        created_at: new Date().toISOString()
      });

    let responseMessage = `✅ تم سحب طلبك. تم إعادة ${order.total_amount} USDT.`;
    if (isBanned) {
      responseMessage += ` ⚠️ تم استبعادك من هذا المنتج نهائياً.`;
    } else if (newWithdrawCount === 1) {
      responseMessage += ` ⚠️ تحذير: إذا سحبت مرة أخرى، سيتم استبعادك.`;
    }

    res.json({
      success: true,
      message: responseMessage,
      isBanned: isBanned,
      withdrawCount: newWithdrawCount
    });

  } catch (error) {
    console.error('Withdraw order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: طلبات المستخدم - محمي
// ==========================================
app.post('/api/my-orders', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(name, image_url, delivery_date, delivery_locations, status)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: الإيداع - محمي
// ==========================================
app.post('/api/deposit', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, transactionHash } = req.body;

  console.log('💰 Deposit request:', { userId, amount, transactionHash });

  if (!amount || amount < 1) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للإيداع 1 USDT' });
  }

  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: '⚠️ TXID مطلوب' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ error: '⚠️ هذا الـ TXID مستخدم مسبقاً' });
    }

    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);

    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }

    const actualAmount = verification.amount || amount;

    const { data: deposit, error: depositError } = await supabaseAdmin
      .from('deposit_requests')
      .insert({ 
        user_id: userId, 
        amount: actualAmount,
        transaction_hash: transactionHash,
        status: 'approved',
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString()
      })
      .select()
      .single();

    if (depositError) {
      console.error('Deposit insert error:', depositError);
      return res.status(500).json({ error: 'حدث خطأ في تسجيل الإيداع' });
    }

    const newBalance = (user.available_balance || 0) + actualAmount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Update balance error:', updateError);
      return res.status(500).json({ error: 'حدث خطأ في تحديث الرصيد' });
    }

    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: actualAmount,
        status: 'approved',
        reference_id: deposit.id,
        description: `💰 إيداع ${actualAmount} USDT`,
        created_at: new Date().toISOString()
      });

    res.json({ 
      success: true, 
      message: `✅ تم إضافة ${actualAmount} USDT إلى رصيدك بنجاح!`
    });

  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: التحقق من الإيداع (للمستخدم) - محمي
// ==========================================
app.post('/api/verify-deposit', authenticateToken, async (req, res) => {
  const { transactionHash, amount } = req.body;

  console.log('🔍 Verify deposit request:', { transactionHash, amount });

  if (!transactionHash) {
    return res.status(400).json({ success: false, error: 'TXID مطلوب' });
  }

  try {
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا الـ TXID مستخدم مسبقاً'
      });
    }

    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);

    console.log('Verification result:', verification);

    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    res.json({
      success: true,
      message: 'المعاملة صالحة',
      verification: verification
    });

  } catch (error) {
    console.error('Verify deposit error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: السحب - محمي
// ==========================================
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, walletAddress } = req.body;

  console.log('💸 Withdraw request:', { userId, amount, walletAddress });

  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للسحب 0.5 USDT' });
  }

  if (!walletAddress) {
    return res.status(400).json({ error: '⚠️ عنوان المحفظة مطلوب' });
  }

  if (!walletAddress.startsWith('0x') || walletAddress.length < 30) {
    return res.status(400).json({ error: '⚠️ عنوان محفظة غير صالح' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (user.available_balance < amount) {
      return res.status(400).json({ error: '⚠️ الرصيد غير كافٍ' });
    }

    const { data: pendingWithdrawals } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingWithdrawals) {
      return res.status(400).json({ 
        error: '⚠️ لديك طلب سحب قيد المعالجة حالياً' 
      });
    }

    let botBalance = 0;
    let botBalanceWarning = '';
    try {
      botBalance = await bsc.getUSDTBalance();
      if (botBalance < amount) {
        botBalanceWarning = ` ⚠️ تنبيه: رصيد المحفظة ${botBalance} USDT فقط. سيتم معالجة طلبك خلال 24 ساعة.`;
      }
    } catch (e) {
      console.warn('⚠️ Could not check bot balance:', e.message);
    }

    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        wallet_address: walletAddress,
        status: 'pending',
        created_at: new Date().toISOString(),
        processed_at: null
      })
      .select()
      .single();

    if (wError) {
      console.error('Withdrawal insert error:', wError);
      return res.status(500).json({ error: 'حدث خطأ في تسجيل طلب السحب' });
    }

    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount: amount,
        status: 'pending',
        reference_id: withdrawal.id,
        description: `📤 طلب سحب ${amount} USDT إلى ${walletAddress.substring(0, 10)}...`,
        created_at: new Date().toISOString()
      });

    console.log(`
    📢 طلب سحب جديد!
    👤 المستخدم: ${user.name} (${user.email})
    💰 المبلغ: ${amount} USDT
    📤 العنوان: ${walletAddress}
    📅 التاريخ: ${new Date().toISOString()}
    ${botBalanceWarning}
    `);

    res.json({ 
      success: true, 
      message: `✅ تم تسجيل طلب سحب ${amount} USDT بنجاح. سيتم معالجته خلال 24 ساعة.${botBalanceWarning}`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: المعاملات - محمي
// ==========================================
app.post('/api/transactions', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تحديث بيانات المستخدم - محمي
// ==========================================
app.post('/api/update-user', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { updates } = req.body;

  try {
    const { error } = await supabaseAdmin
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// ============ APIs الأدمن (محمية) ============
// ==========================================

// ==========================================
// API: إضافة منتج جديد (للأدمن فقط)
// ==========================================
app.post('/api/admin/add-product', authenticateAdmin, async (req, res) => {
  const { name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;

  console.log('📦 Add product request:', { name, description });

  if (!name || !description || !wholesalePrice || !groupPrice || !minQuantity) {
    return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
  }

  try {
    const productData = {
      name: name,
      description: description,
      image_url: imageUrl || '',
      wholesale_price: parseFloat(wholesalePrice),
      group_price: parseFloat(groupPrice),
      min_quantity: parseInt(minQuantity),
      current_orders: 0,
      delivery_locations: deliveryLocations || ['الخرطوم', 'أم درمان', 'بحري'],
      status: 'active',
      created_at: new Date().toISOString()
    };

    if (deliveryDate) {
      productData.delivery_date = deliveryDate;
    }
    if (pickupTime) {
      productData.pickup_time = pickupTime;
    }

    console.log('📝 Product data:', productData);

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(productData)
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      throw error;
    }

    console.log('✅ Product added successfully:', data);

    res.json({
      success: true,
      message: `✅ تم إضافة المنتج ${name} بنجاح`,
      product: data
    });

  } catch (error) {
    console.error('Add product error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: حذف منتج (للأدمن فقط)
// ==========================================
app.post('/api/admin/delete-product', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;

  console.log('🗑️ Delete product request:', { productId });

  try {
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('product_orders')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'pending');

    if (ordersError) throw ordersError;

    if (orders && orders.length > 0) {
      return res.status(400).json({ 
        error: '⚠️ لا يمكن حذف المنتج لأن هناك طلبات معلقة' 
      });
    }

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    console.log('✅ Product deleted successfully');
    res.json({
      success: true,
      message: '✅ تم حذف المنتج بنجاح'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: عرض طلبات المنتج (للأدمن فقط)
// ==========================================
app.post('/api/admin/product-orders', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, users!product_orders_user_id_fkey(name, email)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تحديث حالة الطلب (للأدمن فقط)
// ==========================================
app.post('/api/admin/update-order-status', authenticateAdmin, async (req, res) => {
  const { orderId, status } = req.body;

  const validStatuses = ['pending', 'confirmed', 'shipped', 'in_location', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }

  try {
    await supabaseAdmin
      .from('product_orders')
      .update({ 
        status: status,
        confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined,
        delivered_at: status === 'delivered' ? new Date().toISOString() : undefined
      })
      .eq('id', orderId);

    res.json({
      success: true,
      message: `✅ تم تحديث حالة الطلب إلى ${status}`
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: عرض جميع طلبات السحب (للأدمن فقط)
// ==========================================
app.post('/api/admin/withdrawals', authenticateAdmin, async (req, res) => {
  const { status } = req.body;

  try {
    let query = supabaseAdmin
      .from('withdrawals')
      .select('*, users!withdrawals_user_id_fkey(name, email, available_balance)')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: معالجة طلب سحب (للأدمن فقط)
// ==========================================
app.post('/api/admin/process-withdrawal', authenticateAdmin, async (req, res) => {
  const { withdrawalId } = req.body;

  try {
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users!withdrawals_user_id_fkey(available_balance, name, email)')
      .eq('id', withdrawalId)
      .single();

    if (wError || !withdrawal) {
      return res.status(404).json({ error: 'طلب السحب غير موجود' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'هذا الطلب تم معالجته بالفعل' });
    }

    const userId = withdrawal.user_id;
    const amount = withdrawal.amount;
    const walletAddress = withdrawal.wallet_address;

    const botBalance = await bsc.getUSDTBalance();
    if (botBalance < amount) {
      return res.status(400).json({ 
        error: `⚠️ رصيد المحفظة غير كافٍ: ${botBalance} USDT متاح، والمطلوب: ${amount} USDT` 
      });
    }

    const transferResult = await bsc.transferUSDT(walletAddress, amount);

    if (!transferResult.success) {
      return res.status(500).json({ error: 'فشل التحويل: ' + transferResult.error });
    }

    await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        tx_hash: transferResult.hash,
        processed_by: 'admin'
      })
      .eq('id', withdrawalId);

    const newBalance = withdrawal.users.available_balance - amount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);

    await supabaseAdmin
      .from('transactions')
      .update({
        status: 'approved',
        description: `✅ تم سحب ${amount} USDT (TX: ${transferResult.hash.substring(0, 10)}...)`
      })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw');

    res.json({
      success: true,
      message: `✅ تم تحويل ${amount} USDT بنجاح`,
      txHash: transferResult.hash
    });

  } catch (error) {
    console.error('Process withdrawal error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: إلغاء طلب سحب (للأدمن فقط)
// ==========================================
app.post('/api/admin/cancel-withdrawal', authenticateAdmin, async (req, res) => {
  const { withdrawalId, reason } = req.body;

  try {
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users!withdrawals_user_id_fkey(available_balance)')
      .eq('id', withdrawalId)
      .single();

    if (wError || !withdrawal) {
      return res.status(404).json({ error: 'طلب السحب غير موجود' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'هذا الطلب تم معالجته بالفعل' });
    }

    await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'cancelled',
        processed_at: new Date().toISOString(),
        cancellation_reason: reason || 'تم الإلغاء من قبل الأدمن'
      })
      .eq('id', withdrawalId);

    await supabaseAdmin
      .from('transactions')
      .update({
        status: 'cancelled',
        description: `❌ تم إلغاء سحب ${withdrawal.amount} USDT: ${reason || 'تم الإلغاء من قبل الأدمن'}`
      })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw');

    res.json({
      success: true,
      message: `✅ تم إلغاء طلب السحب بنجاح`
    });

  } catch (error) {
    console.error('Cancel withdrawal error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: عرض جميع المستخدمين (للأدمن فقط)
// ==========================================
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, available_balance, platform_balance, total_orders, total_spent, is_admin, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: فحص TXID (للأدمن فقط)
// ==========================================
app.post('/api/admin/verify-deposit', authenticateAdmin, async (req, res) => {
  const { transactionHash, amount } = req.body;

  console.log('🔍 Admin verify deposit:', { transactionHash, amount });

  if (!transactionHash) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }

  try {
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا الـ TXID مستخدم مسبقاً'
      });
    }

    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);

    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }

    res.json({
      success: true,
      message: 'المعاملة صالحة',
      verification
    });

  } catch (error) {
    console.error('Admin verify error:', error);
    res.status(500).json({ success: false, error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// المهمة التلقائية - معالجة الطلبات المعلقة كل 5 دقائق
// ==========================================
async function processPendingWithdrawals() {
  console.log('🔄 جاري معالجة طلبات السحب المعلقة...');
  
  try {
    const { data: pendingWithdrawals, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users!withdrawals_user_id_fkey(available_balance, name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!pendingWithdrawals || pendingWithdrawals.length === 0) {
      console.log('✅ لا توجد طلبات سحب معلقة');
      return;
    }

    console.log(`📋 عدد الطلبات المعلقة: ${pendingWithdrawals.length}`);

    const botBalance = await bsc.getUSDTBalance();
    console.log(`💰 رصيد محفظة البوت: ${botBalance} USDT`);

    let processedCount = 0;
    let failedCount = 0;

    for (const withdrawal of pendingWithdrawals) {
      const amount = withdrawal.amount;
      const walletAddress = withdrawal.wallet_address;
      const withdrawalId = withdrawal.id;
      const userId = withdrawal.user_id;

      if (botBalance < amount) {
        console.log(`⚠️ رصيد غير كافٍ للطلب ${withdrawalId}: يحتاج ${amount} USDT`);
        continue;
      }

      console.log(`🔄 جاري معالجة الطلب ${withdrawalId}: ${amount} USDT`);

      const transferResult = await bsc.transferUSDT(walletAddress, amount);

      if (transferResult.success) {
        await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
            tx_hash: transferResult.hash,
            processed_by: 'auto'
          })
          .eq('id', withdrawalId);

        await supabaseAdmin
          .from('transactions')
          .update({
            status: 'approved',
            description: `✅ تم سحب ${amount} USDT (TX: ${transferResult.hash.substring(0, 10)}...)`
          })
          .eq('reference_id', withdrawalId)
          .eq('type', 'withdraw');

        const newBalance = withdrawal.users.available_balance - amount;
        await supabaseAdmin
          .from('users')
          .update({ available_balance: newBalance })
          .eq('id', userId);

        processedCount++;
        console.log(`✅ تم معالجة الطلب ${withdrawalId} بنجاح`);
      } else {
        failedCount++;
        console.error(`❌ فشل معالجة الطلب ${withdrawalId}: ${transferResult.error}`);
      }
    }

    console.log(`📊 ملخص المعالجة: ${processedCount} تمت بنجاح، ${failedCount} فشلت`);

  } catch (error) {
    console.error('❌ خطأ في معالجة الطلبات المعلقة:', error);
  }
}

// تشغيل المهمة كل 5 دقائق
setInterval(processPendingWithdrawals, 5 * 60 * 1000);
setTimeout(processPendingWithdrawals, 5000);

// ==========================================
// تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🛍️  منصة الشراء الجماعي تعمل بنجاح                         ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   🤲 نظام متوافق مع الشريعة الإسلامية                         ║
  ║   🔐 جميع APIs محمية بـ JWT                                    ║
  ║   🔄 معالجة الطلبات المعلقة كل 5 دقائق                       ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
