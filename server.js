const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();

// ==========================================
// إعدادات
// ==========================================
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('app'));

// ========================================
// Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
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
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
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
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token: token,
      user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false }
    });
    
  } catch (error) {
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: إنشاء حساب
// ==========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
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
      return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
    }
    
    const token = jwt.sign(
      { userId, email, name, is_admin: false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: { id: userId, email, name, is_admin: false },
      referral_code: newReferralCode
    });
    
  } catch (error) {
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
// API: تفاصيل منتج
// ==========================================
app.get('/api/product/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
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
      return res.status(400).json({ error: `الرصيد غير كافٍ: ${user.available_balance} < ${totalAmount}` });
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
      return res.status(400).json({ error: 'تم استبعادك من هذا المنتج' });
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
    
    let message = `✅ تم سحب الطلب وإعادة ${order.total_amount} USDT`;
    if (isBanned) {
      message += ' ⚠️ تم استبعادك نهائياً';
    }
    
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
    
    res.json({ success: true, message: `✅ تم إضافة ${actualAmount} USDT` });
    
  } catch (error) {
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
    
    res.json({ success: true, message: `✅ تم تسجيل طلب سحب ${amount} USDT` });
    
  } catch (error) {
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
    
    res.json({ success: true, message: `✅ تم إضافة ${name}`, product: data });
    
  } catch (error) {
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
      return res.status(400).json({ error: 'يوجد طلبات معلقة لهذا المنتج' });
    }
    
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);
    
    res.json({ success: true, message: '✅ تم حذف المنتج' });
    
  } catch (error) {
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
  ║   🛍️  منصة الشراء الجماعي - تعمل بنجاح                       ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   🔐 نظام مصادقة JWT آمن                                      ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
