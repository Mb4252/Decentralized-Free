const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('app'));

// ========================================
// تهيئة Supabase (بدون Auth)
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
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
  
  const { data: user, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('email', email)
    .eq('password', password)
    .single();
  
  if (error || !user) {
    return res.status(401).json({ error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
  }
  
  res.json({ 
    success: true,
    user: { id: user.id, email: user.email },
    profile: user
  });
});

// ========================================
// API: إنشاء حساب جديد (أول مستخدم يصبح مديراً)
// ========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
  }
  
  // التحقق من عدم وجود البريد مسبقاً
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .single();
  
  if (existingUser) {
    return res.status(400).json({ error: 'هذا البريد مسجل بالفعل' });
  }
  
  // التحقق من عدد المستخدمين في النظام
  const { count, error: countError } = await supabaseAdmin
    .from('users')
    .select('*', { count: 'exact', head: true });
  
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
  
  // **المفتاح: أول مستخدم في النظام يصبح مديراً تلقائياً**
  const isAdmin = (count === 0 || countError);
  
  // إنشاء معرف فريد للمستخدم
  const userId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
  
  // إضافة المستخدم مباشرة إلى جدول users
  const { error: insertError } = await supabaseAdmin
    .from('users')
    .insert({
      id: userId,
      email: email,
      password: password,
      name: name,
      referral_code: newReferralCode,
      referrer_id: referrerId,
      is_admin: isAdmin,
      package: 'basic',
      available_balance: 0,
      active_deposit: 0,
      total_withdrawn: 0,
      total_deposited: 0,
      created_at: new Date().toISOString()
    });
  
  if (insertError) {
    console.error('Insert error:', insertError);
    return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
  }
  
  res.json({ 
    success: true, 
    user: { id: userId, email: email },
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
// API: الإحالات - جلب المحالين
// ========================================
app.post('/api/referrals', async (req, res) => {
  const { userId } = req.body;
  
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('referrer_id', userId);
  
  const referrals = data || [];
  const groupBalance = referrals.reduce((sum, u) => sum + (u.active_deposit || 0), 0);
  
  res.json({ referrals: referrals, count: referrals.length, groupBalance });
});

// ========================================
// ========== ADMIN APIs ==================
// ========================================

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

app.post('/api/admin/deposits', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('deposit_requests')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

app.post('/api/admin/withdrawals', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('withdrawals')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

app.post('/api/admin/users', checkAdmin, async (req, res) => {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

app.post('/api/admin/approve-deposit', checkAdmin, async (req, res) => {
  const { depositId, userId, amount } = req.body;
  
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'approved' })
    .eq('id', depositId);
  
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

app.post('/api/admin/reject-deposit', checkAdmin, async (req, res) => {
  const { depositId } = req.body;
  
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'rejected' })
    .eq('id', depositId);
  
  res.json({ success: true });
});

app.post('/api/admin/approve-withdraw', checkAdmin, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  
  await supabaseAdmin
    .from('withdrawals')
    .update({ status: 'approved' })
    .eq('id', withdrawalId);
  
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

app.post('/api/admin/reject-withdraw', checkAdmin, async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  
  await supabaseAdmin
    .from('withdrawals')
    .update({ status: 'rejected' })
    .eq('id', withdrawalId);
  
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
