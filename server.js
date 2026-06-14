const express = require('express');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('app'));

// ========================================
// تهيئة Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ========================================
// API: صحّة الخادم
// ========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ========================================
// API: جلب رصيد المحفظة
// ========================================
app.get('/api/wallet-balance', async (req, res) => {
  try {
    const bnbBalance = await bsc.getBNBBalance();
    const usdtBalance = await bsc.getUSDTBalance();
    const bnbStatus = await bsc.checkBNBBalance();
    
    res.json({
      hotWallet: bsc.HOT_WALLET_ADDRESS,
      bnbBalance: bnbBalance,
      usdtBalance: usdtBalance,
      isBnbLow: bnbStatus.isLow,
      minBnbRequired: bnbStatus.minRequired
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: معالجة الإيداعات الجديدة (Auto-Sweep)
// ========================================
app.post('/api/process-deposits', async (req, res) => {
  try {
    // 1. التحقق من رصيد BNB
    const bnbStatus = await bsc.checkBNBBalance();
    if (bnbStatus.isLow) {
      return res.status(400).json({ error: 'رصيد BNB منخفض، يرجى إعادة شحن المحفظة' });
    }
    
    // 2. جلب رصيد USDT الحالي في محفظة البوت
    const currentUSDTBalance = await bsc.getUSDTBalance();
    
    // 3. حساب المبلغ الجديد (70% للتحويل)
    const TRANSFER_PERCENTAGE = parseFloat(process.env.TRANSFER_PERCENTAGE || 70);
    const amountToTransfer = (currentUSDTBalance * TRANSFER_PERCENTAGE) / 100;
    
    if (amountToTransfer < 10) {
      return res.json({ message: 'المبلغ أقل من 10 USDT، لم يتم التحويل', amount: amountToTransfer });
    }
    
    // 4. تحويل 70% إلى محفظة الاستثمار
    const transferResult = await bsc.transferUSDT(bsc.INVESTMENT_WALLET, amountToTransfer);
    
    if (transferResult.success) {
      // 5. تسجيل العملية في قاعدة البيانات
      await supabaseAdmin
        .from('auto_transfers')
        .insert({
          from_address: bsc.HOT_WALLET_ADDRESS,
          to_address: bsc.INVESTMENT_WALLET,
          amount: amountToTransfer,
          percentage: TRANSFER_PERCENTAGE,
          tx_hash: transferResult.hash,
          gas_used: transferResult.gasUsed,
          block_number: transferResult.blockNumber,
          status: 'completed',
          created_at: new Date().toISOString()
        });
    }
    
    res.json({
      success: transferResult.success,
      currentBalance: currentUSDTBalance,
      transferPercentage: TRANSFER_PERCENTAGE,
      amountTransferred: amountToTransfer,
      remainingBalance: currentUSDTBalance - amountToTransfer,
      txHash: transferResult.hash,
      gasUsed: transferResult.gasUsed
    });
    
  } catch (error) {
    console.error('Error processing deposits:', error);
    res.status(500).json({ error: error.message });
  }
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
// API: إنشاء حساب جديد
// ========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body;
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
  }
  
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', email)
    .single();
  
  if (existingUser) {
    return res.status(400).json({ error: 'هذا البريد مسجل بالفعل' });
  }
  
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
  
  const ADMIN_EMAIL = 'mb425262@gmail.com';
  const isAdmin = (email === ADMIN_EMAIL);
  
  const userId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
  
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
      vip_level: 0,
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
// API: تقديم طلب إيداع (تلقائي)
// ========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount } = req.body;
  
  if (!amount || amount < 10) {
    return res.status(400).json({ error: 'الحد الأدنى للإيداع 10 USDT' });
  }
  
  // التحقق من رصيد BNB
  const bnbStatus = await bsc.checkBNBBalance();
  if (bnbStatus.isLow) {
    return res.status(400).json({ error: 'نظام الإيداع مؤقتاً، يرجى المحاولة لاحقاً' });
  }
  
  // إنشاء طلب إيداع (موافق عليه تلقائياً)
  const { data: deposit, error: depositError } = await supabaseAdmin
    .from('deposit_requests')
    .insert({ 
      user_id: userId, 
      amount: amount, 
      status: 'approved',  // موافق عليه تلقائياً
      created_at: new Date().toISOString(),
      approved_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (depositError) {
    return res.status(500).json({ error: depositError.message });
  }
  
  // تحديث رصيد المستخدم تلقائياً
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('active_deposit, total_deposited, available_balance')
    .eq('id', userId)
    .single();
  
  await supabaseAdmin
    .from('users')
    .update({ 
      active_deposit: (user?.active_deposit || 0) + amount,
      total_deposited: (user?.total_deposited || 0) + amount
    })
    .eq('id', userId);
  
  res.json({ 
    success: true, 
    message: `تم إيداع ${amount} USDT بنجاح`,
    depositId: deposit.id 
  });
});

// ========================================
// API: تقديم طلب سحب (تلقائي)
// ========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  
  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى للسحب 0.5 USDT' });
  }
  
  if (!walletAddress) {
    return res.status(400).json({ error: 'عنوان المحفظة مطلوب' });
  }
  
  // التحقق من رصيد المستخدم
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('available_balance, total_withdrawn')
    .eq('id', userId)
    .single();
  
  if (!user || user.available_balance < amount) {
    return res.status(400).json({ error: 'الرصيد غير كافٍ' });
  }
  
  // التحقق من رصيد USDT في محفظة البوت
  const botUSDTBalance = await bsc.getUSDTBalance();
  if (botUSDTBalance < amount) {
    return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ، يرجى المحاولة لاحقاً' });
  }
  
  // التحقق من رصيد BNB للرسوم
  const bnbStatus = await bsc.checkBNBBalance();
  if (bnbStatus.isLow) {
    return res.status(400).json({ error: 'نظام السحب مؤقتاً، يرجى المحاولة لاحقاً' });
  }
  
  // تحويل USDT إلى عنوان المستخدم
  const transferResult = await bsc.transferUSDT(walletAddress, amount);
  
  if (!transferResult.success) {
    return res.status(500).json({ error: 'فشل تحويل الأموال، يرجى المحاولة لاحقاً' });
  }
  
  // إنشاء طلب سحب (موافق عليه تلقائياً)
  const { error: withdrawError } = await supabaseAdmin
    .from('withdrawals')
    .insert({ 
      user_id: userId, 
      amount: amount, 
      wallet_address: walletAddress, 
      status: 'approved',  // موافق عليه تلقائياً
      created_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    });
  
  if (withdrawError) {
    console.error('Withdraw log error:', withdrawError);
  }
  
  // تحديث رصيد المستخدم
  await supabaseAdmin
    .from('users')
    .update({ 
      available_balance: user.available_balance - amount,
      total_withdrawn: (user.total_withdrawn || 0) + amount
    })
    .eq('id', userId);
  
  res.json({ 
    success: true, 
    message: `تم سحب ${amount} USDT إلى محفظتك بنجاح`,
    txHash: transferResult.hash
  });
});

// ========================================
// API: توزيع الأرباح اليومية للمستخدمين
// ========================================
app.post('/api/distribute-profits', async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, active_deposit, vip_level, available_balance');
    
    const vipLevels = {
      0: { roi: 2 }, 1: { roi: 2.2 }, 2: { roi: 2.5 },
      3: { roi: 2.8 }, 4: { roi: 3.2 }, 5: { roi: 3.5 }
    };
    
    const today = new Date().toISOString().split('T')[0];
    let totalDistributed = 0;
    let usersProcessed = 0;
    
    for (const user of users) {
      if (!user.active_deposit || user.active_deposit <= 0) continue;
      
      const { data: existingProfit } = await supabaseAdmin
        .from('daily_profit_log')
        .select('id')
        .eq('user_id', user.id)
        .eq('calculated_date', today)
        .single();
      
      if (existingProfit) continue;
      
      const roi = vipLevels[user.vip_level]?.roi || 2;
      const profit = (user.active_deposit * roi) / 100;
      
      if (profit <= 0) continue;
      
      await supabaseAdmin
        .from('users')
        .update({ available_balance: (user.available_balance || 0) + profit })
        .eq('id', user.id);
      
      await supabaseAdmin
        .from('daily_profit_log')
        .insert({
          user_id: user.id,
          profit_amount: profit,
          calculated_date: today,
          roi_percent: roi
        });
      
      await supabaseAdmin
        .from('transactions')
        .insert({
          user_id: user.id,
          type: 'profit',
          amount: profit,
          status: 'approved',
          description: `Daily profit ${roi}%`
        });
      
      totalDistributed += profit;
      usersProcessed++;
    }
    
    await supabaseAdmin
      .from('profit_distributions')
      .insert({
        date: today,
        total_amount: totalDistributed,
        users_count: usersProcessed,
        created_at: new Date().toISOString()
      });
    
    res.json({
      success: true,
      date: today,
      usersProcessed,
      totalDistributed
    });
    
  } catch (error) {
    console.error('Profit distribution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: الإحالات
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
// API: جلب سجل المعاملات للمستخدم
// ========================================
app.post('/api/transactions', async (req, res) => {
  const { userId } = req.body;
  
  const [deposits, withdrawals, profits] = await Promise.all([
    supabaseAdmin.from('deposit_requests').select('*').eq('user_id', userId),
    supabaseAdmin.from('withdrawals').select('*').eq('user_id', userId),
    supabaseAdmin.from('daily_profit_log').select('*').eq('user_id', userId)
  ]);
  
  const allTransactions = [
    ...(deposits.data || []).map(d => ({ ...d, type: 'إيداع', date: d.created_at })),
    ...(withdrawals.data || []).map(w => ({ ...w, type: 'سحب', date: w.created_at })),
    ...(profits.data || []).map(p => ({ ...p, type: 'ربح', amount: p.profit_amount, date: p.calculated_date, status: 'approved' }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));
  
  res.json(allTransactions);
});

// ========================================
// تشغيل الخادم
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🚀 منصة الاستثمار تعمل بنجاح                                ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   💰 محفظة البوت: ${bsc.HOT_WALLET_ADDRESS.substring(0, 20)}... ║
  ║   🏦 محفظة الاستثمار: ${bsc.INVESTMENT_WALLET.substring(0, 20)}...  ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});

// ========================================
// جدولة مهام Cron Job
// ========================================

// مهمة: فحص الإيداعات الجديدة كل 5 دقائق
cron.schedule('*/5 * * * *', async () => {
  console.log('🔄 [Cron] جاري فحص الإيداعات الجديدة...');
  try {
    const response = await fetch(`http://localhost:${PORT}/api/process-deposits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await response.json();
    console.log('✅ [Cron] نتيجة فحص الإيداعات:', result);
  } catch (error) {
    console.error('❌ [Cron] خطأ في فحص الإيداعات:', error);
  }
});

// مهمة: توزيع الأرباح يومياً في منتصف الليل
cron.schedule('0 0 * * *', async () => {
  console.log('🔄 [Cron] جاري توزيع الأرباح اليومية...');
  try {
    const response = await fetch(`http://localhost:${PORT}/api/distribute-profits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.CRON_SECRET })
    });
    const result = await response.json();
    console.log('✅ [Cron] نتيجة توزيع الأرباح:', result);
  } catch (error) {
    console.error('❌ [Cron] خطأ في توزيع الأرباح:', error);
  }
});

// مهمة: فحص رصيد BNB كل ساعة
cron.schedule('0 * * * *', async () => {
  console.log('🔄 [Cron] جاري فحص رصيد BNB...');
  const bnbStatus = await bsc.checkBNBBalance();
  if (bnbStatus.isLow) {
    await bsc.sendAlert(`⚠️ تنبيه: رصيد BNB منخفض! ${bnbStatus.balance} BNB متاح (الحد الأدنى: ${bnbStatus.minRequired} BNB)`);
  }
});
