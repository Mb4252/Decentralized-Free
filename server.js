const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('app')); // خدمة الملفات الثابتة

// ========================================
// المفاتيح هنا (آمنة - تُقرأ من متغيرات البيئة)
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
// API: تسجيل الدخول
// ========================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email, password
  });
  
  if (error) return res.status(401).json({ error: error.message });
  res.json({ user: data.user });
});

// ========================================
// API: إنشاء حساب
// ========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
  // إنشاء المستخدم في Auth
  const { data, error } = await supabase.auth.signUp({
    email, password
  });
  
  if (error) return res.status(400).json({ error: error.message });
  
  // إضافة بيانات المستخدم في جدول users
  const newReferralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  
  let referrerId = null;
  if (referralCode) {
    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('referral_code', referralCode)
      .single();
    if (referrer) referrerId = referrer.id;
  }
  
  await supabaseAdmin.from('users').insert({
    id: data.user.id,
    email: email,
    name: name,
    referral_code: newReferralCode,
    referrer_id: referrerId,
    is_admin: (email === 'admin@example.com') // حدد المدير هنا
  });
  
  res.json({ user: data.user, referral_code: newReferralCode });
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
  
  if (error) return res.status(404).json({ error: 'User not found' });
  res.json(data);
});

// ========================================
// API: تقديم طلب إيداع
// ========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount } = req.body;
  
  const { error } = await supabaseAdmin
    .from('deposit_requests')
    .insert({ user_id: userId, amount, status: 'pending' });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ========================================
// API: تقديم طلب سحب
// ========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  
  const { error } = await supabaseAdmin
    .from('withdrawals')
    .insert({ user_id: userId, amount, wallet_address: walletAddress, status: 'pending' });
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
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
  
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ========================================
// API: إدارة المدير - جلب الطلبات
// ========================================
app.get('/api/admin/deposits', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('deposit_requests')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  res.json(data);
});

app.get('/api/admin/withdrawals', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('withdrawals')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  res.json(data);
});

app.get('/api/admin/users', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  res.json(data);
});

// ========================================
// API: إدارة المدير - الموافقة/الرفض
// ========================================
app.post('/api/admin/approve-deposit', async (req, res) => {
  const { depositId, userId, amount } = req.body;
  
  // تحديث حالة طلب الإيداع
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'approved' })
    .eq('id', depositId);
  
  // تحديث رصيد المستخدم
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('active_deposit, available_balance')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ 
      active_deposit: (user?.active_deposit || 0) + amount,
      available_balance: (user?.available_balance || 0) + (amount * 0.02)
    })
    .eq('id', userId);
  
  res.json({ success: true });
});

app.post('/api/admin/reject-deposit', async (req, res) => {
  const { depositId } = req.body;
  await supabaseAdmin
    .from('deposit_requests')
    .update({ status: 'rejected' })
    .eq('id', depositId);
  res.json({ success: true });
});

app.post('/api/admin/approve-withdraw', async (req, res) => {
  const { withdrawalId, userId, amount } = req.body;
  
  await supabaseAdmin
    .from('withdrawals')
    .update({ status: 'approved' })
    .eq('id', withdrawalId);
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ available_balance: (user?.available_balance || 0) - amount })
    .eq('id', userId);
  
  res.json({ success: true });
});

app.post('/api/admin/reject-withdraw', async (req, res) => {
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

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
