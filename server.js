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
    const bnbStatus = await bsc.checkBNBBalance();
    if (bnbStatus.isLow) {
      return res.status(400).json({ error: 'رصيد BNB منخفض' });
    }
    
    const currentUSDTBalance = await bsc.getUSDTBalance();
    const TRANSFER_PERCENTAGE = parseFloat(process.env.TRANSFER_PERCENTAGE || 70);
    const amountToTransfer = (currentUSDTBalance * TRANSFER_PERCENTAGE) / 100;
    
    if (amountToTransfer < 10) {
      return res.json({ message: 'المبلغ أقل من 10 USDT، لم يتم التحويل', amount: amountToTransfer });
    }
    
    const transferResult = await bsc.transferUSDT(bsc.INVESTMENT_WALLET, amountToTransfer);
    
    if (transferResult.success) {
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
// API: الإيداع مع التحقق التلقائي
// ========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount, transactionHash } = req.body;
  
  if (!amount || amount < 10) {
    return res.status(400).json({ error: 'الحد الأدنى للإيداع 10 USDT' });
  }
  
  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: 'Transaction Hash مطلوب' });
  }
  
  try {
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existingHash) {
      return res.status(400).json({ error: 'تم استخدام هذا الـ Transaction Hash مسبقاً' });
    }
    
    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    const { data: deposit, error: depositError } = await supabaseAdmin
      .from('deposit_requests')
      .insert({ 
        user_id: userId, 
        amount: amount,
        transaction_hash: transactionHash,
        status: 'approved',
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (depositError) {
      return res.status(500).json({ error: depositError.message });
    }
    
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('active_deposit, total_deposited, available_balance, vip_level')
      .eq('id', userId)
      .single();
    
    const newActiveDeposit = (user?.active_deposit || 0) + amount;
    const newTotalDeposited = (user?.total_deposited || 0) + amount;
    
    await supabaseAdmin
      .from('users')
      .update({ 
        active_deposit: newActiveDeposit,
        total_deposited: newTotalDeposited
      })
      .eq('id', userId);
    
    const vipLevels = [0, 10, 20, 30, 40, 50, 1000];
    let newVipLevel = 0;
    for (let i = vipLevels.length - 1; i >= 0; i--) {
      if (newActiveDeposit >= vipLevels[i]) {
        newVipLevel = i;
        break;
      }
    }
    
    if (newVipLevel > (user?.vip_level || 0)) {
      await supabaseAdmin
        .from('users')
        .update({ vip_level: newVipLevel })
        .eq('id', userId);
    }
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: amount,
        status: 'approved',
        reference_id: deposit.id,
        description: `إيداع عبر البوت - Tx: ${transactionHash.substring(0, 15)}...`,
        created_at: new Date().toISOString()
      });
    
    res.json({ 
      success: true, 
      message: `✅ تم التحقق والإيداع بنجاح! تم إضافة ${amount} USDT إلى رصيدك.`,
      depositId: deposit.id,
      verification: verification
    });
    
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
});

// ========================================
// API: السحب
// ========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;
  
  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى للسحب 0.5 USDT' });
  }
  
  if (!walletAddress) {
    return res.status(400).json({ error: 'عنوان المحفظة مطلوب' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance, total_withdrawn')
      .eq('id', userId)
      .single();
    
    if (!user || user.available_balance < amount) {
      return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    }
    
    const botUSDTBalance = await bsc.getUSDTBalance();
    if (botUSDTBalance < amount) {
      return res.status(400).json({ error: 'رصيد المحفظة غير كافٍ، يرجى المحاولة لاحقاً' });
    }
    
    const bnbStatus = await bsc.checkBNBBalance();
    if (bnbStatus.isLow) {
      return res.status(400).json({ error: 'نظام السحب مؤقتاً، يرجى المحاولة لاحقاً' });
    }
    
    const transferResult = await bsc.transferUSDT(walletAddress, amount);
    
    if (!transferResult.success) {
      return res.status(500).json({ error: 'فشل تحويل الأموال، يرجى المحاولة لاحقاً' });
    }
    
    const { error: withdrawError } = await supabaseAdmin
      .from('withdrawals')
      .insert({ 
        user_id: userId, 
        amount: amount, 
        wallet_address: walletAddress, 
        status: 'approved',
        tx_hash: transferResult.hash,
        created_at: new Date().toISOString(),
        processed_at: new Date().toISOString()
      });
    
    if (withdrawError) {
      console.error('Withdraw log error:', withdrawError);
    }
    
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: user.available_balance - amount,
        total_withdrawn: (user.total_withdrawn || 0) + amount
      })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount: amount,
        status: 'approved',
        description: `سحب إلى ${walletAddress.substring(0, 15)}...`,
        created_at: new Date().toISOString()
      });
    
    res.json({ 
      success: true, 
      message: `✅ تم سحب ${amount} USDT إلى محفظتك بنجاح`,
      txHash: transferResult.hash
    });
    
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
});

// ========================================
// API: التحقق اليدوي من الإيداع
// ========================================
app.post('/api/verify-deposit', async (req, res) => {
  const { userId, transactionHash, amount } = req.body;
  
  if (!userId || !transactionHash || !amount) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  try {
    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    res.json({
      success: true,
      message: 'المعاملة صالحة',
      verification
    });
    
  } catch (error) {
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
    user: { id: user.id, email: user.email, name: user.name },
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
  
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'mb425262@gmail.com';
  const isAdmin = (email === ADMIN_EMAIL);
  
  // إصلاح خطأ إنشاء ID المستخدم
  const userId = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 10);
  
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
    return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب: ' + insertError.message });
  }
  
  res.json({ 
    success: true, 
    user: { id: userId, email: email, name: name },
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
// API: توزيع الأرباح اليومية
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
      1: { roi: 2.2 },
      2: { roi: 2.5 },
      3: { roi: 2.8 },
      4: { roi: 3.2 },
      5: { roi: 3.5 },
      6: { roi: 4.0 }
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
      
      let roi = 2;
      if (user.vip_level > 0 && vipLevels[user.vip_level]) {
        roi = vipLevels[user.vip_level].roi;
      }
      
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
          description: `Daily profit ${roi}%`,
          created_at: new Date().toISOString()
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
  
  res.json({ referrals, count: referrals.length, groupBalance });
});

// ========================================
// API: جلب سجل المعاملات (للمستخدم)
// ========================================
app.post('/api/transactions', async (req, res) => {
  const { userId } = req.body;
  
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data || []);
});

// ========================================
// API: جلب إيداعات المستخدم
// ========================================
app.post('/api/my-deposits', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  const { data, error } = await supabaseAdmin
    .from('deposit_requests')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data || []);
});

// ========================================
// API: جلب سحوبات المستخدم
// ========================================
app.post('/api/my-withdrawals', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  const { data, error } = await supabaseAdmin
    .from('withdrawals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data || []);
});

// ========================================
// API: جلب أرباح المستخدم
// ========================================
app.post('/api/my-profits', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  const { data, error } = await supabaseAdmin
    .from('daily_profit_log')
    .select('*')
    .eq('user_id', userId)
    .order('calculated_date', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  res.json(data || []);
});

// ========================================
// API: جلب جميع المعاملات (مدمجة) للمستخدم
// ========================================
app.post('/api/my-transactions', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  // جلب الإيداعات
  const { data: deposits } = await supabaseAdmin
    .from('deposit_requests')
    .select('id, amount, created_at, status, transaction_hash')
    .eq('user_id', userId);
  
  // جلب السحوبات
  const { data: withdrawals } = await supabaseAdmin
    .from('withdrawals')
    .select('id, amount, created_at, status, wallet_address')
    .eq('user_id', userId);
  
  // جلب الأرباح من جدول المعاملات
  const { data: profits } = await supabaseAdmin
    .from('transactions')
    .select('id, amount, created_at, status, description')
    .eq('user_id', userId)
    .eq('type', 'profit');
  
  // دمج وتنسيق المعاملات
  const transactions = [];
  
  if (deposits) {
    deposits.forEach(d => {
      transactions.push({
        id: d.id,
        type: 'deposit',
        type_ar: '💰 إيداع',
        type_en: '💰 Deposit',
        amount: d.amount,
        date: d.created_at,
        status: d.status,
        reference: d.transaction_hash
      });
    });
  }
  
  if (withdrawals) {
    withdrawals.forEach(w => {
      transactions.push({
        id: w.id,
        type: 'withdraw',
        type_ar: '📤 سحب',
        type_en: '📤 Withdrawal',
        amount: w.amount,
        date: w.created_at,
        status: w.status,
        reference: w.wallet_address
      });
    });
  }
  
  if (profits) {
    profits.forEach(p => {
      transactions.push({
        id: p.id,
        type: 'profit',
        type_ar: '📈 ربح',
        type_en: '📈 Profit',
        amount: p.amount,
        date: p.created_at,
        status: p.status || 'approved',
        reference: null
      });
    });
  }
  
  // ترتيب من الأحدث إلى الأقدم
  transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  res.json(transactions);
});

// ========================================
// API: جلب طلبات الإيداع (للمدير)
// ========================================
app.post('/api/admin/deposits', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('deposit_requests')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

// ========================================
// API: جلب طلبات السحب (للمدير)
// ========================================
app.post('/api/admin/withdrawals', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('withdrawals')
    .select('*, users(name, email)')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
});

// ========================================
// API: جلب جميع المستخدمين (للمدير)
// ========================================
app.post('/api/admin/users', async (req, res) => {
  const { data } = await supabaseAdmin
    .from('users')
    .select('*')
    .order('created_at', { ascending: false });
  
  res.json(data || []);
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
  ║   💰 محفظة البوت: ${bsc.HOT_WALLET_ADDRESS?.substring(0, 20) || 'N/A'}... ║
  ║   🏦 محفظة الاستثمار: ${bsc.INVESTMENT_WALLET?.substring(0, 20) || 'N/A'}...  ║
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
