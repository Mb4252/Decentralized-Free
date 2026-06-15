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
// دالة لتوليد UUID صحيح
// ========================================
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ========================================
// دالة لتحديث مستوى VIP بناءً على إجمالي الإيداع
// ========================================
async function updateVIPLevel(userId, totalDeposits) {
  const { data: vipPackages } = await supabaseAdmin
    .from('vip_packages')
    .select('*')
    .order('level', { ascending: false });
  
  let newVipLevel = 0;
  let unlockedPackage = null;
  
  if (vipPackages && vipPackages.length > 0) {
    for (const pkg of vipPackages) {
      if (totalDeposits >= pkg.price) {
        newVipLevel = pkg.level;
        unlockedPackage = pkg;
        break;
      }
    }
  }
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('vip_level, total_invested, current_package_started_at')
    .eq('id', userId)
    .single();
  
  if (newVipLevel > (user?.vip_level || 0) && unlockedPackage) {
    await supabaseAdmin
      .from('users')
      .update({ 
        vip_level: newVipLevel,
        current_package_started_at: new Date().toISOString()
      })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('package_subscriptions')
      .insert({
        user_id: userId,
        package_level: newVipLevel,
        package_name: unlockedPackage.name,
        amount_paid: 0,
        total_invested_at_time: user?.total_invested || 0,
        roi_percent: unlockedPackage.roi_percent,
        created_at: new Date().toISOString()
      });
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'vip_upgrade',
        amount: 0,
        status: 'approved',
        description: `🎉 فتح تلقائي لباقة ${unlockedPackage.name} (${unlockedPackage.roi_percent}% أرباح يومية)`,
        created_at: new Date().toISOString()
      });
    
    return { newLevel: newVipLevel, unlockedPackage, byDeposit: true };
  }
  
  return { newLevel: user?.vip_level || 0, unlockedPackage: null, byDeposit: false };
}

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
// API: جلب باقات VIP
// ========================================
app.get('/api/vip-packages', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('vip_packages')
      .select('*')
      .order('level', { ascending: true });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: ترقية VIP
// ========================================
app.post('/api/upgrade-vip', async (req, res) => {
  const { userId, packageLevel } = req.body;
  
  try {
    const { data: package, error: packageError } = await supabaseAdmin
      .from('vip_packages')
      .select('*')
      .eq('level', packageLevel)
      .single();
    
    if (packageError || !package) {
      return res.status(404).json({ error: 'الباقة غير موجودة' });
    }
    
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('vip_level, available_balance, total_deposits, total_invested')
      .eq('id', userId)
      .single();
    
    if (userError) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    if (user.vip_level >= packageLevel) {
      return res.status(400).json({ error: 'أنت بالفعل في هذا المستوى أو أعلى' });
    }
    
    if (packageLevel > user.vip_level + 1) {
      return res.status(400).json({ error: '⚠️ يجب ترقية المستويات السابقة أولاً!' });
    }
    
    const isUnlockedByDeposit = user.total_deposits >= package.price;
    let amountToPay = package.price;
    let message = '';
    
    if (isUnlockedByDeposit) {
      amountToPay = 0;
      message = `🎉 تم فتح باقة ${package.name} تلقائياً بناءً على إيداعاتك!`;
    } else if (user.available_balance < amountToPay) {
      const needed = amountToPay - user.available_balance;
      return res.status(400).json({ 
        error: `⚠️ رصيدك غير كافٍ! تحتاج إلى ${needed.toFixed(2)} USDT إضافية لفتح هذه الباقة.`,
        needed: needed,
        currentBalance: user.available_balance,
        packagePrice: package.price
      });
    }
    
    let newBalance = user.available_balance;
    let newTotalInvested = user.total_invested || 0;
    
    if (amountToPay > 0) {
      newBalance = user.available_balance - amountToPay;
      newTotalInvested = (user.total_invested || 0) + amountToPay;
    } else {
      newTotalInvested = (user.total_invested || 0) + user.total_deposits;
    }
    
    await supabaseAdmin
      .from('users')
      .update({
        vip_level: packageLevel,
        available_balance: newBalance,
        total_invested: newTotalInvested,
        active_deposit: newTotalInvested,
        current_package_started_at: new Date().toISOString()
      })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('package_subscriptions')
      .insert({
        user_id: userId,
        package_level: packageLevel,
        package_name: package.name,
        amount_paid: amountToPay,
        total_invested_at_time: newTotalInvested,
        roi_percent: package.roi_percent,
        created_at: new Date().toISOString()
      });
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'vip_upgrade',
        amount: amountToPay,
        status: 'approved',
        description: amountToPay > 0 
          ? `✨ ترقية إلى ${package.name} (${package.roi_percent}% أرباح يومية)`
          : `🎉 فتح تلقائي لباقة ${package.name} (${package.roi_percent}% أرباح يومية)`,
        created_at: new Date().toISOString()
      });
    
    res.json({
      success: true,
      message: message || `✅ تم الترقية إلى ${package.name} بنجاح! نسبة الربح: ${package.roi_percent}% يومياً`,
      newLevel: packageLevel,
      newBalance: newBalance,
      totalInvested: newTotalInvested,
      roiPercent: package.roi_percent
    });
    
  } catch (error) {
    console.error('VIP upgrade error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// API: الإيداع
// ========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount, transactionHash } = req.body;
  
  if (!amount || amount < 1) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للإيداع هو 1 USDT' });
  }
  
  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: '⚠️ Transaction Hash مطلوب' });
  }
  
  try {
    // التحقق من عدم استخدام الهاش مسبقاً
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, amount, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existingHash) {
      return res.status(400).json({ 
        error: '⚠️ هذا Transaction Hash تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس الهاش مرتين.',
        usedBefore: true,
        previousAmount: existingHash.amount
      });
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
      return res.status(500).json({ error: depositError.message });
    }
    
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('active_deposit, total_deposits, available_balance, vip_level, total_invested, qualifying_deposit')
      .eq('id', userId)
      .single();
    
    const newTotalDeposits = (user?.total_deposits || 0) + actualAmount;
    
    await supabaseAdmin
      .from('users')
      .update({ total_deposits: newTotalDeposits })
      .eq('id', userId);
    
    const qualifies = newTotalDeposits >= 10;
    let message = `✅ تم إضافة ${actualAmount} USDT إلى حسابك!`;
    
    if (!qualifies) {
      const remaining = 10 - newTotalDeposits;
      message += ` ⚠️ تحتاج إلى إيداع ${remaining.toFixed(2)} USDT إضافية لتفعيل الأرباح اليومية.`;
      
      await supabaseAdmin
        .from('users')
        .update({ available_balance: (user?.available_balance || 0) + actualAmount })
        .eq('id', userId);
        
    } else if (qualifies && !user?.qualifying_deposit) {
      const newActiveDeposit = newTotalDeposits;
      await supabaseAdmin
        .from('users')
        .update({ 
          qualifying_deposit: true,
          active_deposit: newActiveDeposit,
          total_invested: newActiveDeposit,
          available_balance: (user?.available_balance || 0) + actualAmount,
          last_profit_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', userId);
      message += ` 🎉 تهانينا! أصبحت مؤهلاً للأرباح اليومية بنسبة 2%!`;
    } else if (qualifies && user?.qualifying_deposit) {
      const newActiveDeposit = (user?.active_deposit || 0) + actualAmount;
      const newTotalInvested = (user?.total_invested || 0) + actualAmount;
      await supabaseAdmin
        .from('users')
        .update({ 
          active_deposit: newActiveDeposit,
          total_invested: newTotalInvested,
          available_balance: (user?.available_balance || 0) + actualAmount
        })
        .eq('id', userId);
      message += ` 💰 تم إضافة المبلغ إلى استثمارك النشط.`;
    }
    
    const { newLevel, unlockedPackage } = await updateVIPLevel(userId, newTotalDeposits);
    
    if (newLevel > (user?.vip_level || 0) && unlockedPackage) {
      message += ` 🎉🎉🎉 تم فتح باقة ${unlockedPackage.name} تلقائياً! نسبة أرباحك الآن ${unlockedPackage.roi_percent}% يومياً!`;
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
      message: message,
      depositId: deposit.id,
      verification: verification,
      qualifies: qualifies,
      totalDeposits: newTotalDeposits,
      remainingToQualify: qualifies ? 0 : (10 - newTotalDeposits),
      newVipLevel: newLevel
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
    return res.status(400).json({ error: '⚠️ الحد الأدنى للسحب 0.5 USDT' });
  }
  
  if (!walletAddress) {
    return res.status(400).json({ error: '⚠️ عنوان المحفظة مطلوب' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance, total_withdrawn')
      .eq('id', userId)
      .single();
    
    if (!user || user.available_balance < amount) {
      return res.status(400).json({ error: '⚠️ الرصيد غير كافٍ' });
    }
    
    const botUSDTBalance = await bsc.getUSDTBalance();
    if (botUSDTBalance < amount) {
      return res.status(400).json({ error: '⚠️ رصيد المحفظة غير كافٍ، يرجى المحاولة لاحقاً' });
    }
    
    const bnbStatus = await bsc.checkBNBBalance();
    if (bnbStatus.isLow) {
      return res.status(400).json({ error: '⚠️ نظام السحب مؤقتاً، يرجى المحاولة لاحقاً' });
    }
    
    const transferResult = await bsc.transferUSDT(walletAddress, amount);
    
    if (!transferResult.success) {
      return res.status(500).json({ error: '❌ فشل تحويل الأموال، يرجى المحاولة لاحقاً' });
    }
    
    await supabaseAdmin
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
        description: `📤 سحب ${amount} USDT`,
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
// API: التحقق من الإيداع (معدل)
// ========================================
app.post('/api/verify-deposit', async (req, res) => {
  const { userId, transactionHash, amount } = req.body;
  
  // تعديل: جعل amount اختيارياً للتحقق فقط
  if (!userId || !transactionHash) {
    return res.status(400).json({ error: 'userId و transactionHash مطلوبان' });
  }
  
  try {
    // التحقق من عدم استخدام الهاش مسبقاً
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, amount, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا Transaction Hash تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس الهاش مرتين.',
        usedBefore: true,
        previousAmount: existingHash.amount
      });
    }
    
    // التحقق من صحة المعاملة على الشبكة
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    res.json({
      success: true,
      message: 'المعاملة صالحة',
      verification
    });
    
  } catch (error) {
    console.error('Verify error:', error);
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
  
  const userId = generateUUID();
  
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
      total_deposits: 0,
      total_invested: 0,
      total_withdrawn: 0,
      qualifying_deposit: false,
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
    const { data: vipPackages } = await supabaseAdmin
      .from('vip_packages')
      .select('*');
    
    const vipRoiMap = {};
    if (vipPackages) {
      vipPackages.forEach(pkg => {
        vipRoiMap[pkg.level] = pkg.roi_percent;
      });
    }
    
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, total_invested, vip_level, available_balance, qualifying_deposit, last_profit_date')
      .eq('qualifying_deposit', true)
      .gt('total_invested', 0);
    
    const today = new Date().toISOString().split('T')[0];
    let totalDistributed = 0;
    let usersProcessed = 0;
    
    for (const user of users) {
      if (user.last_profit_date === today) continue;
      
      let roi = 2;
      if (user.vip_level > 0 && vipRoiMap[user.vip_level]) {
        roi = vipRoiMap[user.vip_level];
      }
      
      const profit = (user.total_invested * roi) / 100;
      
      if (profit <= 0) continue;
      
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: (user.available_balance || 0) + profit,
          last_profit_date: today
        })
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
          description: `📈 أرباح يومية ${roi}%`,
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
// API: جلب سجل المعاملات
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
// API: جلب جميع المعاملات للمستخدم
// ========================================
app.post('/api/my-transactions', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  const { data: deposits } = await supabaseAdmin
    .from('deposit_requests')
    .select('id, amount, created_at, status, transaction_hash')
    .eq('user_id', userId);
  
  const { data: withdrawals } = await supabaseAdmin
    .from('withdrawals')
    .select('id, amount, created_at, status, wallet_address')
    .eq('user_id', userId);
  
  const { data: profits } = await supabaseAdmin
    .from('transactions')
    .select('id, amount, created_at, status, description')
    .eq('user_id', userId)
    .eq('type', 'profit');
  
  const { data: vipUpgrades } = await supabaseAdmin
    .from('package_subscriptions')
    .select('*')
    .eq('user_id', userId);
  
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
  
  if (vipUpgrades) {
    vipUpgrades.forEach(v => {
      transactions.push({
        id: v.id,
        type: 'vip_upgrade',
        type_ar: '👑 ترقية VIP',
        type_en: '👑 VIP Upgrade',
        amount: v.amount_paid,
        date: v.created_at,
        status: 'approved',
        reference: `${v.package_name} - ${v.roi_percent}%`
      });
    });
  }
  
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

cron.schedule('0 * * * *', async () => {
  console.log('🔄 [Cron] جاري فحص رصيد BNB...');
  const bnbStatus = await bsc.checkBNBBalance();
  if (bnbStatus.isLow) {
    await bsc.sendAlert(`⚠️ تنبيه: رصيد BNB منخفض! ${bnbStatus.balance} BNB متاح (الحد الأدنى: ${bnbStatus.minRequired} BNB)`);
  }
});
