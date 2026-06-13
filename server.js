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
// API: جلب رصيد BNB و USDT للمحفظة
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
    
    // 3. جلب آخر إيداع تمت معالجته من قاعدة البيانات
    const { data: lastProcessed } = await supabaseAdmin
      .from('processed_deposits')
      .select('amount, tx_hash')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // 4. حساب المبلغ الجديد (70% للتحويل)
    const TRANSFER_PERCENTAGE = parseFloat(process.env.TRANSFER_PERCENTAGE || 70);
    const amountToTransfer = (currentUSDTBalance * TRANSFER_PERCENTAGE) / 100;
    
    if (amountToTransfer < 10) {
      return res.json({ message: 'المبلغ أقل من 10 USDT، لم يتم التحويل', amount: amountToTransfer });
    }
    
    // 5. تحويل 70% إلى محفظة الاستثمار
    const transferResult = await bsc.transferUSDT(bsc.INVESTMENT_WALLET, amountToTransfer);
    
    if (transferResult.success) {
      // 6. تسجيل العملية في قاعدة البيانات
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
      
      // 7. تحديث آخر إيداع تمت معالجته
      await supabaseAdmin
        .from('processed_deposits')
        .insert({
          amount: amountToTransfer,
          tx_hash: transferResult.hash,
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
// API: توزيع الأرباح اليومية للمستخدمين
// ========================================
app.post('/api/distribute-profits', async (req, res) => {
  const { secret } = req.body;
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    // 1. جلب جميع المستخدمين مع مستوياتهم
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, active_deposit, vip_level');
    
    const vipLevels = {
      0: { roi: 2 }, 1: { roi: 2.2 }, 2: { roi: 2.5 },
      3: { roi: 2.8 }, 4: { roi: 3.2 }, 5: { roi: 3.5 }
    };
    
    const today = new Date().toISOString().split('T')[0];
    let totalDistributed = 0;
    let usersProcessed = 0;
    
    for (const user of users) {
      if (!user.active_deposit || user.active_deposit <= 0) continue;
      
      // التحقق من عدم تكرار الأرباح لليوم
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
      
      // تحديث رصيد المستخدم
      await supabaseAdmin
        .from('users')
        .update({ available_balance: user.available_balance + profit })
        .eq('id', user.id);
      
      // تسجيل الربح
      await supabaseAdmin
        .from('daily_profit_log')
        .insert({
          user_id: user.id,
          profit_amount: profit,
          calculated_date: today,
          roi_percent: roi
        });
      
      // تسجيل المعاملة
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
    
    // 2. تسجيل إجمالي الأرباح الموزعة
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
// API: جلب سجل العمليات (Logging)
// ========================================
app.get('/api/transaction-logs', async (req, res) => {
  const { limit = 50 } = req.query;
  
  try {
    // جلب عمليات التحويل التلقائي
    const { data: autoTransfers } = await supabaseAdmin
      .from('auto_transfers')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    
    // جلب توزيعات الأرباح
    const { data: profitDistributions } = await supabaseAdmin
      .from('profit_distributions')
      .select('*')
      .order('date', { ascending: false })
      .limit(limit);
    
    res.json({
      autoTransfers: autoTransfers || [],
      profitDistributions: profitDistributions || []
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ========================================
// باقي APIs (تسجيل الدخول، الإيداع، السحب، الإدارة)
// ========================================

// ... (ضع هنا ملف server.js السابق كاملاً)

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
    await bsc.sendAlert(`⚠️ رصيد BNB منخفض! ${bnbStatus.balance} BNB متاح (الحد الأدنى: ${bnbStatus.minRequired} BNB)`);
  }
});
