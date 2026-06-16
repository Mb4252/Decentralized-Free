const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();

// ==========================================
// إعدادات Render (مهم جداً)
// ==========================================

// الثقة بـ proxy (لـ Rate Limiting على Render)
app.set('trust proxy', 1);

// ==========================================
// Security Headers (Helmet)
// ==========================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.supabase.co"],
      fontSrc: ["'self'", "data:"],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// ==========================================
// CORS
// ==========================================
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://crypto-api-c2v8.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000'
];

app.use(cors({
  origin: function(origin, callback) {
    // السماح للطلبات بدون origin (مثل Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('app'));

// ==========================================
// Rate Limiting
// ==========================================

// حد عام: 100 طلب في 15 دقيقة
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
  standardHeaders: true,
  legacyHeaders: false,
});

// حد لتسجيل الدخول: 5 محاولات في الدقيقة
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: '⚠️太多 محاولات تسجيل الدخول. يرجى الانتظار دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

// حد للـ API العامة: 30 طلب في الدقيقة
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
});

// تطبيق الحدود
app.use('/api/', generalLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/register', loginLimiter);
app.use('/api/products', apiLimiter);

// ========================================
// إجبار HTTPS (لـ Render)
// ========================================
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// ========================================
// Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ========================================
// JWT
// ========================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const SALT_ROUNDS = 10;

// ========================================
// دوال مساعدة
// ========================================

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// Audit Log
// ==========================================
async function logAudit(userId, action, details = {}, req = null) {
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        user_id: userId,
        action: action,
        details: details,
        ip_address: req?.ip || req?.connection?.remoteAddress || 'unknown',
        user_agent: req?.headers?.['user-agent'] || 'unknown',
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// ==========================================
// Middleware للمصادقة
// ==========================================

function authenticateToken(req, res, next) {
  // جلب التوكن من Cookie
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح به - يرجى تسجيل الدخول' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'انتهت صلاحية الجلسة' });
      }
      return res.status(403).json({ error: 'رمز غير صالح' });
    }
    req.user = decoded;
    next();
  });
}

function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'صلاحيات أدمن مطلوبة' });
    }
    next();
  });
}

// ==========================================
// API: صحّة الخادم
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// API: تسجيل الدخول
// ==========================================
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  console.log('🔐 محاولة تسجيل دخول:', email);
  
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبة' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      console.log('❌ مستخدم غير موجود:', email);
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    // التحقق من كلمة المرور
    let passwordValid = false;
    
    try {
      passwordValid = await bcrypt.compare(password, user.password);
    } catch (e) {}
    
    if (!passwordValid && user.password === password) {
      passwordValid = true;
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await supabaseAdmin
        .from('users')
        .update({ password: hashedPassword })
        .eq('id', user.id);
      console.log(`✅ تم تحديث كلمة مرور ${email} إلى النص المشفر`);
    }
    
    if (!passwordValid) {
      console.log('❌ كلمة مرور خاطئة:', email);
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    // إنشاء JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // إرسال التوكن في HttpOnly Cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    
    // تسجيل في Audit Log
    await logAudit(user.id, 'login', { email: user.email }, req);
    
    console.log('✅ تم تسجيل الدخول بنجاح:', email);
    
    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: تسجيل الخروج
// ==========================================
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

// ==========================================
// API: إنشاء حساب
// ==========================================
app.post('/api/register', loginLimiter, async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
  console.log('📝 محاولة إنشاء حساب:', email);
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور 4 أحرف على الأقل' });
  }
  
  try {
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'البريد مسجل بالفعل' });
    }
    
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = generateUUID();
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
    
    const { error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        email,
        password: hashedPassword,
        name,
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
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
    }
    
    // إنشاء JWT token
    const token = jwt.sign(
      { userId, email, name, is_admin: false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    // إرسال التوكن في HttpOnly Cookie
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    
    console.log('✅ تم إنشاء الحساب بنجاح:', email);
    
    res.json({
      success: true,
      user: { id: userId, email, name, is_admin: false },
      referral_code: newReferralCode
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: جلب بيانات المستخدم
// ==========================================
app.post('/api/user', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();
    
    if (error) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    delete data.password;
    res.json(data);
    
  } catch (error) {
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: عرض المنتجات
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
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
// API: تفاصيل منتج
// ==========================================
app.get('/api/product/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: شراء منتج
// ==========================================
app.post('/api/order-product', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { productId, quantity, location, acceptTerms } = req.body;
  
  if (!productId || !quantity || !location) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (!acceptTerms) {
    return res.status(400).json({ error: 'يجب الموافقة على الشروط' });
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
      return res.status(400).json({ error: 'العدد اكتمل' });
    }
    
    const remaining = product.min_quantity - product.current_orders;
    if (quantity > remaining) {
      return res.status(400).json({ error: `المتبقي ${remaining} قطعة فقط` });
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
      return res.status(400).json({ error: `الرصيد غير كافٍ` });
    }
    
    const newBalance = user.available_balance - totalAmount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        quantity,
        total_amount: totalAmount,
        location,
        status: 'pending',
        withdraw_count: 0,
        is_banned: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (orderError) throw orderError;
    
    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ current_orders: newCurrentOrders })
      .eq('id', productId);
    
    // تسجيل في Audit Log
    await logAudit(userId, 'order_product', { productId, quantity, totalAmount }, req);
    
    let message = `✅ تم شراء ${quantity} × ${product.name}`;
    let isCompleted = false;
    
    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ' 🎉 اكتمل العدد!';
      await supabaseAdmin
        .from('products')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', productId);
    }
    
    res.json({ success: true, message, order, isCompleted });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: طلباتي
// ==========================================
app.post('/api/my-orders', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(name, image_url, delivery_date, delivery_locations, status)')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: سحب الطلب
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
      .select('*, products(status)')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    
    if (order.user_id !== userId) {
      return res.status(403).json({ error: 'هذا الطلب ليس لك' });
    }
    
    if (order.products.status === 'completed') {
      return res.status(400).json({ error: 'العدد اكتمل، لا يمكن السحب' });
    }
    
    if (order.is_banned) {
      return res.status(400).json({ error: 'تم استبعادك' });
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
    
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();
    
    const newBalance = (user.available_balance || 0) + order.total_amount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('products')
      .update({ current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity) })
      .eq('id', order.product_id);
    
    // تسجيل في Audit Log
    await logAudit(userId, 'withdraw_order', { orderId, amount: order.total_amount }, req);
    
    let message = `✅ تم سحب الطلب وإعادة ${order.total_amount} USDT`;
    if (isBanned) message += ' ⚠️ تم استبعادك نهائياً';
    
    res.json({ success: true, message, isBanned, withdrawCount: newWithdrawCount });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: الإيداع
// ==========================================
app.post('/api/deposit', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, transactionHash } = req.body;
  
  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'الحد الأدنى 1 USDT' });
  }
  
  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    const { data: existing } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ error: 'هذا TXID مستخدم مسبقاً' });
    }
    
    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    const actualAmount = verification.amount || amount;
    
    await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: userId,
        amount: actualAmount,
        transaction_hash: transactionHash,
        status: 'approved',
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString()
      });
    
    const newBalance = (user.available_balance || 0) + actualAmount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: actualAmount,
        status: 'approved',
        description: `💰 إيداع ${actualAmount} USDT`,
        created_at: new Date().toISOString()
      });
    
    // تسجيل في Audit Log
    await logAudit(userId, 'deposit', { amount: actualAmount, transactionHash }, req);
    
    res.json({ success: true, message: `✅ تم إضافة ${actualAmount} USDT` });
    
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: التحقق من الإيداع
// ==========================================
app.post('/api/verify-deposit', authenticateToken, async (req, res) => {
  const { transactionHash, amount } = req.body;
  
  if (!transactionHash) {
    return res.status(400).json({ success: false, error: 'TXID مطلوب' });
  }
  
  try {
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }
    
    res.json({ success: true, message: 'المعاملة صالحة', verification });
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: سحب رصيد
// ==========================================
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, walletAddress } = req.body;
  
  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى 0.5 USDT' });
  }
  
  if (!walletAddress || !walletAddress.startsWith('0x') || walletAddress.length < 30) {
    return res.status(400).json({ error: 'عنوان محفظة غير صالح' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();
    
    if (!user || user.available_balance < amount) {
      return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    }
    
    const { data: pending } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    
    if (pending) {
      return res.status(400).json({ error: 'لديك طلب سحب قيد المعالجة' });
    }
    
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount,
        wallet_address: walletAddress,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (wError) {
      return res.status(500).json({ error: 'حدث خطأ في تسجيل السحب' });
    }
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount,
        status: 'pending',
        reference_id: withdrawal.id,
        description: `📤 طلب سحب ${amount} USDT`,
        created_at: new Date().toISOString()
      });
    
    // تسجيل في Audit Log
    await logAudit(userId, 'withdraw', { amount, walletAddress }, req);
    
    res.json({ success: true, message: `✅ تم تسجيل طلب سحب ${amount} USDT` });
    
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: المعاملات
// ==========================================
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ============ APIs الأدمن ============
// ==========================================

// إضافة منتج
app.post('/api/admin/add-product', authenticateAdmin, async (req, res) => {
  const { name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;
  
  if (!name || !description || !wholesalePrice || !groupPrice || !minQuantity) {
    return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
  }
  
  try {
    const productData = {
      name,
      description,
      image_url: imageUrl || '',
      wholesale_price: parseFloat(wholesalePrice),
      group_price: parseFloat(groupPrice),
      min_quantity: parseInt(minQuantity),
      current_orders: 0,
      delivery_locations: deliveryLocations || ['الخرطوم', 'أم درمان', 'بحري'],
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    if (deliveryDate) productData.delivery_date = deliveryDate;
    if (pickupTime) productData.pickup_time = pickupTime;
    
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(productData)
      .select()
      .single();
    
    if (error) throw error;
    
    // تسجيل في Audit Log
    await logAudit(req.user.userId, 'add_product', { name, wholesalePrice, groupPrice }, req);
    
    res.json({ success: true, message: `✅ تم إضافة ${name}`, product: data });
    
  } catch (error) {
    console.error('Add product error:', error);
    res.status(500).json({ error: error.message });
  }
});

// حذف منتج
app.post('/api/admin/delete-product', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;
  
  try {
    const { data: orders } = await supabaseAdmin
      .from('product_orders')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'pending');
    
    if (orders && orders.length > 0) {
      return res.status(400).json({ error: 'يوجد طلبات معلقة' });
    }
    
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);
    
    // تسجيل في Audit Log
    await logAudit(req.user.userId, 'delete_product', { productId }, req);
    
    res.json({ success: true, message: '✅ تم حذف المنتج' });
    
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: error.message });
  }
});

// طلبات المنتج
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

// تحديث حالة الطلب
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
        status,
        confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined,
        delivered_at: status === 'delivered' ? new Date().toISOString() : undefined
      })
      .eq('id', orderId);
    
    // تسجيل في Audit Log
    await logAudit(req.user.userId, 'update_order_status', { orderId, status }, req);
    
    res.json({ success: true, message: `✅ تم تحديث الحالة إلى ${status}` });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// فحص TXID للأدمن
app.post('/api/admin/verify-deposit', authenticateAdmin, async (req, res) => {
  const { transactionHash, amount } = req.body;
  
  if (!transactionHash) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }
  
  try {
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }
    
    res.json({ success: true, message: 'المعاملة صالحة', verification });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// عرض جميع المستخدمين
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
// تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🛍️  منصة الشراء الجماعي - النسخة الآمنة                     ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 ${process.env.CLIENT_URL || `http://localhost:${PORT}`}     ║
  ║   🔐 JWT + HttpOnly Cookies                                    ║
  ║   🛡️ Helmet + Rate Limiting + Audit Log                        ║
  ║   ✅ متوافق مع Render                                           ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
