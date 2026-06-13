const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('app')); // خدمة الملفات الثابتة (HTML, CSS, JS)

// ========================================
// تهيئة Supabase
// ========================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ========================================
// API: صحّة الخادم
// ========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========================================
// API: تسجيل الدخول
// ========================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد الإلكتروني وكلمة المرور مطلوبة' });
  }
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email, password
  });
  
  if (error) {
    return res.status(401).json({ error: error.message });
  }
  
  // جلب بيانات المستخدم الإضافية
  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .single();
  
  res.json({ 
    user: data.user,
    profile: userData
  });
});

// ========================================
// API: إنشاء حساب جديد
// ========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
  }
  
  // إنشاء المستخدم في Supabase Auth
  const { data, error } = await supabase.auth.signUp({
    email, password
  });
  
  if (error) {
    return res.status(400).json({ error: error.message });
  }
  
  // توليد رمز دعوة فريد
  const newReferralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  // التحقق من رمز الدعوة (إذا وجد)
  let referrerId = null;
  if (referralCode) {
    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('referral_code', referralCode.toUpperCase())
      .single();
    if (referrer) referrerId = referrer.id;
  }
  
  // تحديد صلاحية المدير (أول مستخدم أو بريد معين)
  let isAdmin = false;
  const { count } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });
  
  if (count === 0 || email === 'admin@example.com') {
    isAdmin = true;
  }
  
  // إضافة المستخدم إلى جدول users
  const { error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      id: data.user.id,
      email: email,
      name: name,
      referral_code: newReferralCode,
      referrer_id: referrerId,
      is_admin: isAdmin,
      package: 'basic',
      available_balance: 0,
      active_deposit: 0,
      total_withdrawn: 0,
      total_deposited: 0
    });
  
  if (insertError) {
    return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
  }
  
  res.json({ 
    success: true, 
    user: data.user, 
    referral_code: newReferralCode,
    is_admin: isAdmin
  });
});

// ========================================
// API: جلب بيانات المستخدم
// ========================================
app.post('/api/user', async (req, res) => {
  const { userId } = req.body;
  
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }
  
  res.json(data);
});

// ========================================
// API: تحديث بيانات المستخدم
// ========================================
app.post('/api/update-user', async (req, res) => {
  const { userId, updates } = req.body;
  
  const { error } = await supabaseAdmin
    .from('users')
    .update(updates)
    .eq('id', userId);
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json({ success: true });
});

// ========================================
// API: تقديم طلب إيداع
// ========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (!amount || amount < 10) {
    return res.status(400).json({ error: 'الحد الأدنى للإيداع 10 USDT' });
  }
  
  const { error } = await supabaseAdmin
    .from('deposit_requests')
    .insert({ 
      user_id: userId, 
      amount: amount, 
      status: 'pending',
      created_at: new Date().toISOString()
    });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json({ success: true, message: 'تم تقديم طلب الإيداع بنجاح' });
});

// ========================================
// API: تقديم طلب سحب
// ========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  
  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى للسحب 0.5 USDT' });
  }
  
  if (!walletAddress) {
    return res.status(400).json({ error: 'عنوان المحفظة مطلوب' });
  }
  
  // التحقق من الرصيد
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance')
    .eq('id', userId)
    .single();
  
  if (!user || user.available_balance < amount) {
    return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  }
  
  const { error } = await supabaseAdmin
    .from('withdrawals')
    .insert({ 
      user_id: userId, 
      amount: amount, 
      wallet_address: walletAddress, 
      status: 'pending',
      created_at: new Date().toISOString()
    });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json({ success: true, message: 'تم تقديم طلب السحب بنجاح' });
});

// ========================================
// API: إضافة أرباح يومية
// ========================================
app.post('/api/add-profit', async (req, res) => {
  const { userId, profit } = req.body;
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance')
    .eq('id', userId)
    .single();
  
  const { error } = await supabaseAdmin
    .from('users')
    .update({ available_balance: (user?.available_balance || 0) + profit })
    .eq('id', userId);
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json({ success: true });
});

// ========================================
// API: الإحالات - جلب المحالين
// ========================================
app.post('/api/referrals', async (req, res) => {
  const { userId } = req.body;
  
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('referrer_id', userId);
  
  const groupBalance = data.reduce((sum, u) => sum + (u.active_deposit || 0), 0);
  
  res.json({ referrals: data, count: data.length, groupBalance });
});

// ========================================
// ========== ADMIN APIs ==================
// ========================================

// التحقق من صلاحية المدير
const checkAdmin = async (req, res, next) => {
  const { userId } = req.body;
  if (!userId) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', userId)
    .single();
  
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'ليس لديك صلاحية' });
  }
  
  next();
};

// جلب جميع طلبات الإيداع
app.post('/api/admin/deposits', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('deposit_requests')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

// جلب جميع طلبات السحب
app.post('/api/admin/withdrawals', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('withdrawals')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

// جلب جميع المستخدمين
app.post('/api/admin/users', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

// الموافقة على إيداع
app.post('/api/admin/approve-deposit', checkAdmin, async (req, res) => {
  const { depositId, userId, amount } = req.body;
  
  // تحديث حالة الطلب
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'approved' })
    .eq('id', depositId);
  
  // تحديث رصيد المستخدم
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('active_deposit, total_deposited')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ 
      active_deposit: (user?.active_deposit || 0) + amount,
      total_deposited: (user?.total_deposited || 0) + amount
    })
    .eq('id', userId);
  
  res.json({ success: true });
});

// رفض إيداع
app.post('/api/admin/reject-deposit', checkAdmin, async (req, res) => {
  const { depositId } = req.body;
  
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'rejected' })
    .eq('id', depositId);
  
  res.json({ success: true });
});

// الموافقة على سحب
app.post('/api/admin/approve-withdraw', checkAdmin, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  
  // تحديث حالة الطلب
  await supabaseAdmin
    .from('withdrawals')
    .update({ status: 'approved' })
    .eq('id', withdrawalId);
  
  // تحديث رصيد المستخدم
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance, total_withdrawn')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ 
      available_balance: (user?.available_balance || 0) - amount,
      total_withdrawn: (user?.total_withdrawn || 0) + amount
    })
    .eq('id', userId);
  
  res.json({ success: true });
});

// رفض سحب (رد الرصيد)
app.post('/api/admin/reject-withdraw', checkAdmin, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  
  // تحديث حالة الطلب
  await supabaseAdmin
    .from('withdrawals')
    .update({ status: 'rejected' })
    .eq('id', withdrawalId);
  
  // رد الرصيد للمستخدم
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ available_balance: (user?.available_balance || 0) + amount })
    .eq('id', userId);
  
  res.json({ success: true });
});

// ========================================
// تشغيل الخادم
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║   🚀 منصة الاستثمار تعمل بنجاح        ║
  ║   📡 الخادم على المنفذ: ${PORT}          ║
  ║   🌐 http://localhost:${PORT}           ║
  ╚═══════════════════════════════════════╝
  `);
});
