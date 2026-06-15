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
// دالة منح العمولة للمحيل (10% من أول إيداع)
// ========================================
async function giveReferralCommission(referredUserId, depositAmount) {
  try {
    const { data: referredUser } = await supabaseAdmin
      .from('users')
      .select('id, name, referrer_id, first_deposit_commission_paid, first_deposit_amount')
      .eq('id', referredUserId)
      .single();
    
    if (!referredUser || !referredUser.referrer_id) {
      return { success: false, message: 'لا يوجد محيل' };
    }
    
    if (referredUser.first_deposit_commission_paid) {
      return { success: false, message: 'تم دفع العمولة مسبقاً' };
    }
    
    const { data: referrer } = await supabaseAdmin
      .from('users')
      .select('id, name, available_balance, total_commissions_earned')
      .eq('id', referredUser.referrer_id)
      .single();
    
    if (!referrer) {
      return { success: false, message: 'المحيل غير موجود' };
    }
    
    const commissionPercent = 10;
    const commissionAmount = depositAmount * (commissionPercent / 100);
    
    const newBalance = (referrer.available_balance || 0) + commissionAmount;
    const newTotalCommissions = (referrer.total_commissions_earned || 0) + commissionAmount;
    
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: newBalance,
        total_commissions_earned: newTotalCommissions
      })
      .eq('id', referrer.id);
    
    await supabaseAdmin
      .from('users')
      .update({ 
        first_deposit_amount: depositAmount,
        first_deposit_commission_paid: true 
      })
      .eq('id', referredUserId);
    
    await supabaseAdmin
      .from('referral_commissions')
      .insert({
        referrer_id: referrer.id,
        referred_id: referredUserId,
        deposit_amount: depositAmount,
        commission_amount: commissionAmount,
        commission_percent: commissionPercent,
        created_at: new Date().toISOString()
      });
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: referrer.id,
        type: 'commission',
        amount: commissionAmount,
        status: 'approved',
        description: `💰 عمولة 10% من أول إيداع للمستخدم ${referredUser.name} (${depositAmount} USDT)`,
        created_at: new Date().toISOString()
      });
    
    console.log(`✅ تم منح ${commissionAmount.toFixed(2)} USDT عمولة للمحيل ${referrer.name}`);
    
    return { 
      success: true, 
      commissionAmount: commissionAmount,
      referrerName: referrer.name
    };
    
  } catch (error) {
    console.error('خطأ في منح العمولة:', error);
    return { success: false, message: error.message };
  }
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
    .select('vip_level, total_invested')
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
    
    return { newLevel: newVipLevel, unlockedPackage };
  }
  
  return { newLevel: user?.vip_level || 0, unlockedPackage: null };
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
    
    if (packageLevel > user.vip_level + 1 && user.vip_level > 0) {
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
// API: الإيداع (معدل للقبول بأقل من 10$ مع رصيد ولكن بدون أرباح)
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
    // جلب بيانات المستخدم
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    // تحديد الحد الأدنى للمستخدم (استثنائي أو عادي)
    const minDeposit = user.custom_min_deposit || 10;
    const isExceptional = user.is_exceptional || false;
    
    // التحقق من المبلغ بالنسبة للحد الأدنى للمستخدم
    if (amount < minDeposit) {
      return res.status(400).json({ 
        error: `⚠️ الحد الأدنى للإيداع هو ${minDeposit} USDT${isExceptional ? ' (حساب تجريبي)' : ''}` 
      });
    }
    
    // التحقق من عدم استخدام الهاش مسبقاً
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, amount, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existingHash) {
      return res.status(400).json({ 
        error: '⚠️ هذا Transaction Hash تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس الهاش مرتين.',
        usedBefore: true
      });
    }
    
    // التحقق من صحة المعاملة على الشبكة
    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    const actualAmount = verification.amount || amount;
    
    // إنشاء سجل الإيداع
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
    
    const newTotalDeposits = (user?.total_deposits || 0) + actualAmount;
    
    // تحديث إجمالي الإيداعات
    await supabaseAdmin
      .from('users')
      .update({ total_deposits: newTotalDeposits })
      .eq('id', userId);
    
    // التحقق من التأهيل للأرباح (10 دولار للمستخدم العادي، أو تلقائي للمستخدم الاستثنائي)
    const qualifies = (newTotalDeposits >= 10) || isExceptional;
    let message = `✅ تم إضافة ${actualAmount} USDT إلى حسابك!`;
    
    // الحالة 1: المستخدم غير مؤهل بعد (أقل من 10$ وليس استثنائياً)
    if (!qualifies && !isExceptional) {
      const remaining = 10 - newTotalDeposits;
      message += ` ⚠️ تحتاج إلى إيداع ${remaining.toFixed(2)} USDT إضافية لتفعيل الأرباح اليومية.`;
      
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: (user?.available_balance || 0) + actualAmount 
        })
        .eq('id', userId);
        
    } 
    // الحالة 2: أصبح مؤهلاً الآن (وصل لـ10$ أو استثنائي)
    else if (qualifies && !user?.qualifying_deposit) {
      const newActiveDeposit = (user?.active_deposit || 0) + (isExceptional ? newTotalDeposits : actualAmount);
      const newTotalInvested = (user?.total_invested || 0) + (isExceptional ? newTotalDeposits : actualAmount);
      
      await supabaseAdmin
        .from('users')
        .update({ 
          qualifying_deposit: true,
          active_deposit: newActiveDeposit,
          total_invested: newTotalInvested,
          available_balance: (user?.available_balance || 0) + actualAmount,
          last_profit_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', userId);
      
      if (isExceptional) {
        message += ` 🎉 مرحباً بك في الحساب التجريبي! يمكنك الآن سحب أرباحك وتجربة النظام.`;
      } else {
        message += ` 🎉 تهانينا! أصبحت مؤهلاً للأرباح اليومية بنسبة 2%!`;
      }
    } 
    // الحالة 3: مستخدم مؤهل بالفعل
    else if (user?.qualifying_deposit) {
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
    
    // منح العمولة للمحيل (فقط للإيداعات التي تزيد عن 10$ أو للمستخدم الاستثنائي)
    const { data: depositCount, count } = await supabaseAdmin
      .from('deposit_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (count === 1 && (actualAmount >= 10 || isExceptional)) {
      const commissionResult = await giveReferralCommission(userId, actualAmount);
      if (commissionResult.success) {
        message += ` 🎉 تم منح ${commissionResult.commissionAmount.toFixed(2)} USDT عمولة للمحيل الذي دعاك!`;
      }
    }
    
    // تحديث مستوى VIP تلقائياً (للمستخدم العادي فقط)
    if (!isExceptional) {
      const { newLevel, unlockedPackage } = await updateVIPLevel(userId, newTotalDeposits);
      if (newLevel > (user?.vip_level || 0) && unlockedPackage) {
        message += ` 🎉🎉🎉 تم فتح باقة ${unlockedPackage.name} تلقائياً! نسبة أرباحك الآن ${unlockedPackage.roi_percent}% يومياً!`;
      }
    }
    
    // تسجيل معاملة الإيداع
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: actualAmount,
        status: 'approved',
        reference_id: deposit.id,
        description: `💰 إيداع ${actualAmount} USDT${isExceptional ? ' (حساب تجريبي)' : ''}`,
        created_at: new Date().toISOString()
      });
    
    res.json({ 
      success: true, 
      message: message,
      depositId: deposit.id,
      verification: verification,
      qualifies: qualifies,
      totalDeposits: newTotalDeposits,
      isExceptional: isExceptional,
      remainingToQualify: qualifies ? 0 : (10 - newTotalDeposits)
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
// API: التحقق من الإيداع
// ========================================
app.post('/api/verify-deposit', async (req, res) => {
  const { userId, transactionHash, amount } = req.body;
  
  if (!userId || !transactionHash) {
    return res.status(400).json({ error: 'userId و transactionHash مطلوبان' });
  }
  
  try {
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, amount, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا Transaction Hash تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس الهاش مرتين.',
        usedBefore: true
      });
    }
    
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
      custom_min_deposit: 10,
      is_exceptional: false,
      first_deposit_amount: 0,
      first_deposit_commission_paid: false,
      total_commissions_earned: 0,
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
// API: جلب عمولات المستخدم
// ========================================
app.post('/api/my-commissions', async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'userId مطلوب' });
  }
  
  const { data, error } = await supabaseAdmin
    .from('referral_commissions')
    .select('*')
    .eq('referrer_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return res.status(500).json({ error: error.message });
  }
  
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('total_commissions_earned')
    .eq('id', userId)
    .single();
  
  res.json({ 
    commissions: data || [], 
    total_earned: user?.total_commissions_earned || 0 
  });
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
  
  const { data: commissions } = await supabaseAdmin
    .from('referral_commissions')
    .select('*')
    .eq('referrer_id', userId);
  
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
  
  if (commissions) {
    commissions.forEach(c => {
      transactions.push({
        id: c.id,
        type: 'commission',
        type_ar: '🎁 عمولة إحالة',
        type_en: '🎁 Referral Commission',
        amount: c.commission_amount,
        date: c.created_at,
        status: 'approved',
        reference: `من إيداع ${c.deposit_amount} USDT`
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
