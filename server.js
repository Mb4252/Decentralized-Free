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

app.use(helmet());

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com'] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('app'));

// ==========================================
// Rate Limiting
// ==========================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
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
// JWT
// ========================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 10;

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// Middleware للتحقق من JWT
// ==========================================
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

function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'غير مصرح به - صلاحيات أدمن مطلوبة' });
    }
    next();
  });
}

// ==========================================
// API: تسجيل الدخول - إصلاح
// ==========================================
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;

  console.log('🔐 محاولة تسجيل دخول:', email);

  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });
  }

  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      console.log('❌ مستخدم غير موجود:', email);
      return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }

    // التحقق من كلمة المرور المشفرة
    const match = await bcrypt.compare(password, user.password);
    
    if (!match) {
      console.log('❌ كلمة مرور خاطئة:', email);
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

    console.log('✅ تم تسجيل الدخول بنجاح:', email);

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
// API: إنشاء حساب جديد - إصلاح
// ==========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;

  console.log('📝 محاولة إنشاء حساب:', email);

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
        password: hashedPassword,
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

    console.log('✅ تم إنشاء الحساب بنجاح:', email);

    res.json({ 
      success: true,
      token: token,
      user: { 
        id: userId, 
        email: email, 
        name: name,
        is_admin: false
      },
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
// باقي APIs (نفس الكود السابق)
// ==========================================

// API: عرض المنتجات
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

// API: تفاصيل منتج
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
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
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
        error: `⚠️ رصيدك غير كافٍ. المطلوب: ${totalAmount} USDT` 
      });
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

    if (orderError) throw orderError;

    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ current_orders: newCurrentOrders })
      .eq('id', productId);

    let message = `✅ تم شراء ${quantity} × ${product.name} بنجاح!`;
    let isCompleted = false;

    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ` 🎉 اكتمل العدد المطلوب!`;
      await supabaseAdmin
        .from('products')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', productId);
    }

    res.json({
      success: true,
      message: message,
      order: order,
      isCompleted: isCompleted
    });

  } catch (error) {
    console.error('Order error:', error);
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
// API: السحب - محمي
// ==========================================
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, walletAddress } = req.body;

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
        description: `📤 طلب سحب ${amount} USDT`,
        created_at: new Date().toISOString()
      });

    res.json({ 
      success: true, 
      message: `✅ تم تسجيل طلب سحب ${amount} USDT بنجاح. سيتم معالجته خلال 24 ساعة.`
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
// ============ APIs الأدمن ============
// ==========================================

// API: إضافة منتج
app.post('/api/admin/add-product', authenticateAdmin, async (req, res) => {
  const { name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;

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

    if (deliveryDate) productData.delivery_date = deliveryDate;
    if (pickupTime) productData.pickup_time = pickupTime;

    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(productData)
      .select()
      .single();

    if (error) throw error;

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

// API: حذف منتج
app.post('/api/admin/delete-product', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;

  try {
    const { data: orders } = await supabaseAdmin
      .from('product_orders')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'pending');

    if (orders && orders.length > 0) {
      return res.status(400).json({ 
        error: '⚠️ لا يمكن حذف المنتج لأن هناك طلبات معلقة' 
      });
    }

    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);

    res.json({
      success: true,
      message: '✅ تم حذف المنتج بنجاح'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// API: عرض طلبات المنتج
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

// API: تحديث حالة الطلب
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

// API: التحقق من TXID
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
// API: التحقق من الإيداع (للمستخدم)
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
      .update({ available_balance: newBalance })
      .eq('id', userId);

    await supabaseAdmin
      .from('products')
      .update({ current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity) })
      .eq('id', order.product_id);

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
// تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🛍️  منصة الشراء الجماعي تعمل بنجاح                         ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   🔐 نظام مصادقة آمن مع JWT                                    ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
