const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();
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
// دالة لتوليد UUID
// ========================================
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ==========================================
// API: صحّة الخادم
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// API: عرض المنتجات المتاحة للمستخدمين
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
// API: تفاصيل منتج معين (للمستخدم)
// ==========================================
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
// API: طلب منتج (شراء)
// ==========================================
app.post('/api/order-product', async (req, res) => {
  const { userId, productId, quantity, location, acceptTerms } = req.body;

  if (!userId || !productId || !quantity || !location) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة (المنتج، الكمية، المنطقة)' });
  }

  if (!acceptTerms) {
    return res.status(400).json({ error: '⚠️ يجب الموافقة على شروط الشراء' });
  }

  try {
    // جلب المنتج
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

    // التحقق من العدد المتبقي
    const remaining = product.min_quantity - product.current_orders;
    if (quantity > remaining) {
      return res.status(400).json({ 
        error: `⚠️ العدد المتبقي فقط ${remaining} قطعة` 
      });
    }

    const totalAmount = product.group_price * quantity;

    // جلب المستخدم
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // التحقق من الرصيد
    if (user.available_balance < totalAmount) {
      return res.status(400).json({ 
        error: `⚠️ رصيدك غير كافٍ. المطلوب: ${totalAmount} USDT، المتاح: ${user.available_balance} USDT` 
      });
    }

    // خصم المبلغ
    const newBalance = user.available_balance - totalAmount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: newBalance,
        platform_balance: supabaseAdmin.raw('platform_balance + ?', totalAmount)
      })
      .eq('id', userId);

    if (updateError) throw updateError;

    // تسجيل الطلب
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

    if (orderError) {
      // استرجاع المبلغ إذا فشل الطلب
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: user.available_balance,
          platform_balance: supabaseAdmin.raw('platform_balance - ?', totalAmount)
        })
        .eq('id', userId);
      throw orderError;
    }

    // تحديث عدد الطلبات
    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ current_orders: newCurrentOrders })
      .eq('id', productId);

    // تحديث إحصائيات المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        total_orders: supabaseAdmin.raw('total_orders + 1'),
        total_spent: supabaseAdmin.raw('total_spent + ?', totalAmount)
      })
      .eq('id', userId);

    let message = `✅ تم شراء ${quantity} × ${product.name} بنجاح!`;
    let isCompleted = false;

    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ` 🎉 اكتمل العدد المطلوب! سيتم الشراء والتوزيع قريباً.`;
      await supabaseAdmin
        .from('products')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', productId);
    }

    res.json({
      success: true,
      message: message,
      order: order,
      isCompleted: isCompleted,
      remainingToComplete: Math.max(0, product.min_quantity - newCurrentOrders),
      currentOrders: newCurrentOrders,
      minQuantity: product.min_quantity
    });

  } catch (error) {
    console.error('Order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: سحب الطلب (قبل اكتمال العدد)
// ==========================================
app.post('/api/withdraw-order', async (req, res) => {
  const { userId, orderId } = req.body;

  if (!userId || !orderId) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
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

    // جلب المستخدم للحصول على الرصيد الحالي
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (userError) throw userError;

    // إعادة المبلغ
    const newBalance = (user.available_balance || 0) + order.total_amount;
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: newBalance,
        platform_balance: supabaseAdmin.raw('platform_balance - ?', order.total_amount)
      })
      .eq('id', userId);

    // تقليل عدد الطلبات
    await supabaseAdmin
      .from('products')
      .update({ current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity) })
      .eq('id', order.product_id);

    await supabaseAdmin
      .from('withdrawal_logs')
      .insert({
        order_id: orderId,
        user_id: userId,
        amount: order.total_amount,
        reason: isBanned ? 'استبعاد بسبب كثرة السحب' : 'سحب طلب',
        created_at: new Date().toISOString()
      });

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
// API: طلبات المستخدم
// ==========================================
app.post('/api/my-orders', async (req, res) => {
  const { userId } = req.body;

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
// API: الإيداع
// ==========================================
app.post('/api/deposit', async (req, res) => {
  const { userId, amount, transactionHash } = req.body;

  console.log('💰 Deposit request:', { userId, amount, transactionHash });

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

    // التحقق من الهاش
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ error: '⚠️ هذا الـ TXID مستخدم مسبقاً' });
    }

    // التحقق من المعاملة على الشبكة
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
      console.error('Deposit insert error:', depositError);
      return res.status(500).json({ error: 'حدث خطأ في تسجيل الإيداع' });
    }

    // تحديث رصيد المستخدم
    const newBalance = (user.available_balance || 0) + actualAmount;
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Update balance error:', updateError);
      return res.status(500).json({ error: 'حدث خطأ في تحديث الرصيد' });
    }

    // تسجيل المعاملة
    const { error: txError } = await supabaseAdmin
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

    if (txError) {
      console.error('Transaction insert error:', txError);
    }

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
// API: التحقق من الإيداع (للمستخدم)
// ==========================================
app.post('/api/verify-deposit', async (req, res) => {
  const { userId, transactionHash, amount } = req.body;

  console.log('🔍 Verify deposit request:', { userId, transactionHash, amount });

  if (!transactionHash) {
    return res.status(400).json({ success: false, error: 'TXID مطلوب' });
  }

  try {
    // التحقق من الهاش في قاعدة البيانات
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا الـ TXID مستخدم مسبقاً'
      });
    }

    // التحقق من المعاملة على الشبكة
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);

    console.log('Verification result:', verification);

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
// API: التحقق من الإيداع (للأدمن)
// ==========================================
app.post('/api/admin/verify-deposit', async (req, res) => {
  const { adminSecret, transactionHash, amount } = req.body;

  console.log('🔍 Admin verify deposit:', { adminSecret, transactionHash, amount });

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  if (!transactionHash) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }

  try {
    const { data: existingHash } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ 
        success: false, 
        error: '⚠️ هذا الـ TXID مستخدم مسبقاً'
      });
    }

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
// API: السحب - النظام الآمن الجديد
// ==========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  console.log('💸 Withdraw request:', { userId, amount, walletAddress });

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
    // جلب بيانات المستخدم
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance, name, email')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    // التحقق من الرصيد
    if (user.available_balance < amount) {
      return res.status(400).json({ error: '⚠️ الرصيد غير كافٍ' });
    }

    // التحقق من وجود طلبات سحب معلقة (لمنع التكرار)
    const { data: pendingWithdrawals, error: pendingError } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingWithdrawals) {
      return res.status(400).json({ 
        error: '⚠️ لديك طلب سحب قيد المعالجة حالياً. يرجى الانتظار حتى يتم الانتهاء منه.' 
      });
    }

    // التحقق من رصيد محفظة البوت (تحذير فقط)
    let botBalance = 0;
    let botBalanceWarning = '';
    try {
      botBalance = await bsc.getUSDTBalance();
      if (botBalance < amount) {
        botBalanceWarning = ` ⚠️ تنبيه: رصيد المحفظة ${botBalance} USDT فقط. سيتم معالجة طلبك خلال 24 ساعة.`;
      }
    } catch (e) {
      console.warn('⚠️ Could not check bot balance:', e.message);
    }

    // 🔒 لا يتم خصم الرصيد هنا - فقط تسجيل الطلب
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

    // تسجيل المعاملة بحالة "pending"
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount: amount,
        status: 'pending',
        reference_id: withdrawal.id,
        description: `📤 طلب سحب ${amount} USDT إلى ${walletAddress.substring(0, 10)}...`,
        created_at: new Date().toISOString()
      });

    // إشعار للأدمن (في console)
    console.log(`
    📢 طلب سحب جديد!
    👤 المستخدم: ${user.name} (${user.email})
    💰 المبلغ: ${amount} USDT
    📤 العنوان: ${walletAddress}
    📅 التاريخ: ${new Date().toISOString()}
    ${botBalanceWarning}
    `);

    res.json({ 
      success: true, 
      message: `✅ تم تسجيل طلب سحب ${amount} USDT بنجاح. سيتم معالجته خلال 24 ساعة.${botBalanceWarning}`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: معالجة طلبات السحب المعلقة (للأدمن)
// ==========================================
app.post('/api/admin/process-withdrawal', async (req, res) => {
  const { adminSecret, withdrawalId } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    // جلب طلب السحب
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users(available_balance, name, email)')
      .eq('id', withdrawalId)
      .single();

    if (wError || !withdrawal) {
      return res.status(404).json({ error: 'طلب السحب غير موجود' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'هذا الطلب تم معالجته بالفعل' });
    }

    const userId = withdrawal.user_id;
    const amount = withdrawal.amount;
    const walletAddress = withdrawal.wallet_address;

    // التحقق من رصيد محفظة البوت
    const botBalance = await bsc.getUSDTBalance();
    if (botBalance < amount) {
      return res.status(400).json({ 
        error: `⚠️ رصيد المحفظة غير كافٍ: ${botBalance} USDT متاح، والمطلوب: ${amount} USDT` 
      });
    }

    // تنفيذ التحويل الفعلي
    const transferResult = await bsc.transferUSDT(walletAddress, amount);

    if (!transferResult.success) {
      return res.status(500).json({ error: 'فشل التحويل: ' + transferResult.error });
    }

    // تحديث حالة طلب السحب
    await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
        tx_hash: transferResult.hash
      })
      .eq('id', withdrawalId);

    // خصم الرصيد من المستخدم (بعد نجاح التحويل)
    const newBalance = withdrawal.users.available_balance - amount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);

    // تحديث حالة المعاملة
    await supabaseAdmin
      .from('transactions')
      .update({
        status: 'approved',
        description: `✅ تم سحب ${amount} USDT إلى ${walletAddress.substring(0, 10)}... (TX: ${transferResult.hash.substring(0, 10)}...)`
      })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw');

    res.json({
      success: true,
      message: `✅ تم تحويل ${amount} USDT بنجاح إلى ${walletAddress}`,
      txHash: transferResult.hash
    });

  } catch (error) {
    console.error('Process withdrawal error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: إلغاء طلب سحب (للأدمن)
// ==========================================
app.post('/api/admin/cancel-withdrawal', async (req, res) => {
  const { adminSecret, withdrawalId, reason } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users(available_balance)')
      .eq('id', withdrawalId)
      .single();

    if (wError || !withdrawal) {
      return res.status(404).json({ error: 'طلب السحب غير موجود' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ error: 'هذا الطلب تم معالجته بالفعل' });
    }

    // إلغاء الطلب (الرصيد لم يخصم، لذلك لا داعي لإعادته)
    await supabaseAdmin
      .from('withdrawals')
      .update({
        status: 'cancelled',
        processed_at: new Date().toISOString(),
        cancellation_reason: reason || 'تم الإلغاء من قبل الأدمن'
      })
      .eq('id', withdrawalId);

    // تحديث حالة المعاملة
    await supabaseAdmin
      .from('transactions')
      .update({
        status: 'cancelled',
        description: `❌ تم إلغاء سحب ${withdrawal.amount} USDT: ${reason || 'تم الإلغاء من قبل الأدمن'}`
      })
      .eq('reference_id', withdrawalId)
      .eq('type', 'withdraw');

    res.json({
      success: true,
      message: `✅ تم إلغاء طلب السحب بنجاح`
    });

  } catch (error) {
    console.error('Cancel withdrawal error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: عرض جميع طلبات السحب (للأدمن)
// ==========================================
app.post('/api/admin/withdrawals', async (req, res) => {
  const { adminSecret, status } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    let query = supabaseAdmin
      .from('withdrawals')
      .select('*, users(name, email, available_balance)')
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ============ المهمة التلقائية ============
// معالجة طلبات السحب المعلقة كل 5 دقائق
// ==========================================
async function processPendingWithdrawals() {
  console.log('🔄 جاري معالجة طلبات السحب المعلقة...');
  
  try {
    // جلب جميع طلبات السحب المعلقة
    const { data: pendingWithdrawals, error } = await supabaseAdmin
      .from('withdrawals')
      .select('*, users(available_balance, name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!pendingWithdrawals || pendingWithdrawals.length === 0) {
      console.log('✅ لا توجد طلبات سحب معلقة');
      return;
    }

    console.log(`📋 عدد الطلبات المعلقة: ${pendingWithdrawals.length}`);

    // التحقق من رصيد محفظة البوت
    const botBalance = await bsc.getUSDTBalance();
    console.log(`💰 رصيد محفظة البوت: ${botBalance} USDT`);

    let processedCount = 0;
    let failedCount = 0;

    for (const withdrawal of pendingWithdrawals) {
      const amount = withdrawal.amount;
      const walletAddress = withdrawal.wallet_address;
      const withdrawalId = withdrawal.id;
      const userId = withdrawal.user_id;

      // التحقق من كفاية الرصيد
      if (botBalance < amount) {
        console.log(`⚠️ رصيد غير كافٍ للطلب ${withdrawalId}: يحتاج ${amount} USDT، المتاح ${botBalance} USDT`);
        continue;
      }

      console.log(`🔄 جاري معالجة الطلب ${withdrawalId}: ${amount} USDT إلى ${walletAddress.substring(0, 10)}...`);

      // تنفيذ التحويل
      const transferResult = await bsc.transferUSDT(walletAddress, amount);

      if (transferResult.success) {
        // تحديث حالة الطلب
        await supabaseAdmin
          .from('withdrawals')
          .update({
            status: 'completed',
            processed_at: new Date().toISOString(),
            tx_hash: transferResult.hash
          })
          .eq('id', withdrawalId);

        // تحديث حالة المعاملة
        await supabaseAdmin
          .from('transactions')
          .update({
            status: 'approved',
            description: `✅ تم سحب ${amount} USDT (TX: ${transferResult.hash.substring(0, 10)}...)`
          })
          .eq('reference_id', withdrawalId)
          .eq('type', 'withdraw');

        // خصم الرصيد من المستخدم
        const newBalance = withdrawal.users.available_balance - amount;
        await supabaseAdmin
          .from('users')
          .update({ available_balance: newBalance })
          .eq('id', userId);

        processedCount++;
        console.log(`✅ تم معالجة الطلب ${withdrawalId} بنجاح (TX: ${transferResult.hash})`);
      } else {
        failedCount++;
        console.error(`❌ فشل معالجة الطلب ${withdrawalId}: ${transferResult.error}`);
      }
    }

    console.log(`📊 ملخص المعالجة: ${processedCount} تمت بنجاح، ${failedCount} فشلت`);

  } catch (error) {
    console.error('❌ خطأ في معالجة الطلبات المعلقة:', error);
  }
}

// تشغيل المهمة كل 5 دقائق
setInterval(processPendingWithdrawals, 5 * 60 * 1000);

// تشغيلها فور بدء التشغيل
setTimeout(processPendingWithdrawals, 5000);

// ==========================================
// ============ APIs الأدمن الأخرى ============
// ==========================================

// ==========================================
// API: عرض جميع المنتجات (للأدمن)
// ==========================================
app.post('/api/admin/products', async (req, res) => {
  const { adminSecret } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: إضافة منتج جديد (للأدمن)
// ==========================================
app.post('/api/admin/add-product', async (req, res) => {
  const { adminSecret, name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;

  console.log('📦 Add product request:', { adminSecret, name, description });

  if (adminSecret !== process.env.ADMIN_SECRET) {
    console.log('❌ Invalid admin secret');
    return res.status(401).json({ error: 'غير مصرح به - كلمة سر غير صحيحة' });
  }

  if (!name || !description || !wholesalePrice || !groupPrice || !minQuantity) {
    return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: name,
        description: description,
        image_url: imageUrl || '',
        wholesale_price: parseFloat(wholesalePrice),
        group_price: parseFloat(groupPrice),
        min_quantity: parseInt(minQuantity),
        current_orders: 0,
        delivery_locations: deliveryLocations || ['الخرطوم', 'أم درمان', 'بحري'],
        delivery_date: deliveryDate || null,
        pickup_time: pickupTime || null,
        status: 'active',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      console.error('Insert error:', error);
      throw error;
    }

    console.log('✅ Product added successfully:', data);

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

// ==========================================
// API: تحديث منتج (للأدمن)
// ==========================================
app.post('/api/admin/update-product', async (req, res) => {
  const { adminSecret, productId, updates } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const { error } = await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', productId);

    if (error) throw error;

    res.json({
      success: true,
      message: '✅ تم تحديث المنتج بنجاح'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: حذف منتج (للأدمن)
// ==========================================
app.post('/api/admin/delete-product', async (req, res) => {
  const { adminSecret, productId } = req.body;

  console.log('🗑️ Delete product request:', { adminSecret, productId });

  if (adminSecret !== process.env.ADMIN_SECRET) {
    console.log('❌ Invalid admin secret');
    return res.status(401).json({ error: 'غير مصرح به - كلمة سر غير صحيحة' });
  }

  try {
    // التحقق من عدم وجود طلبات معلقة
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('product_orders')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'pending');

    if (ordersError) throw ordersError;

    if (orders && orders.length > 0) {
      return res.status(400).json({ 
        error: '⚠️ لا يمكن حذف المنتج لأن هناك طلبات معلقة' 
      });
    }

    const { error } = await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);

    if (error) throw error;

    console.log('✅ Product deleted successfully');
    res.json({
      success: true,
      message: '✅ تم حذف المنتج بنجاح'
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: تحديد موعد التسليم (للأدمن)
// ==========================================
app.post('/api/admin/set-delivery-date', async (req, res) => {
  const { adminSecret, productId, deliveryDate, pickupTime } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const updates = {};
    if (deliveryDate) updates.delivery_date = deliveryDate;
    if (pickupTime) updates.pickup_time = pickupTime;

    await supabaseAdmin
      .from('products')
      .update(updates)
      .eq('id', productId);

    res.json({
      success: true,
      message: '✅ تم تحديث مواعيد التسليم والاستلام'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: عرض الطلبات حسب المنتج (للأدمن)
// ==========================================
app.post('/api/admin/product-orders', async (req, res) => {
  const { adminSecret, productId } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, users(name, email)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تحديث حالة الطلب (للأدمن)
// ==========================================
app.post('/api/admin/update-order-status', async (req, res) => {
  const { adminSecret, orderId, status } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

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

// ==========================================
// API: عرض جميع المستخدمين (للأدمن)
// ==========================================
app.post('/api/admin/users', async (req, res) => {
  const { adminSecret } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

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
// API: جلب بيانات المستخدم
// ==========================================
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

// ==========================================
// API: تحديث بيانات المستخدم
// ==========================================
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

// ==========================================
// API: المعاملات
// ==========================================
app.post('/api/transactions', async (req, res) => {
  const { userId } = req.body;

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
// API: تسجيل الدخول
// ==========================================
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
    user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false },
    profile: user
  });
});

// ==========================================
// API: إنشاء حساب جديد
// ==========================================
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

  res.json({ 
    success: true, 
    user: { id: userId, email: email, name: name },
    referral_code: newReferralCode
  });
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
  ║   🤲 نظام متوافق مع الشريعة الإسلامية                         ║
  ║   🔄 نظام معالجة الطلبات المعلقة يعمل كل 5 دقائق             ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
