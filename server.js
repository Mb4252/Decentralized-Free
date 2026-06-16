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
// API: عرض المنتجات المتاحة
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
// API: تفاصيل منتج معين
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
// API: طلب منتج (إيداع في محفظة المنصة)
// ==========================================
app.post('/api/order-product', async (req, res) => {
  const { userId, productId, quantity, location } = req.body;

  if (!userId || !productId || !quantity || !location) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة (المنتج، الكمية، المنطقة)' });
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

    // التحقق من اكتمال العدد
    if (product.status === 'completed') {
      return res.status(400).json({ error: '⚠️ العدد المطلوب اكتمل، لا يمكن تقديم طلبات جديدة' });
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
        error: `⚠️ رصيدك غير كافٍ. تحتاج إلى ${totalAmount} USDT` 
      });
    }

    // خصم المبلغ من رصيد المستخدم (يذهب إلى محفظة المنصة)
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance - ?', totalAmount)
      })
      .eq('id', userId);

    // إضافة المبلغ إلى رصيد المنصة
    await supabaseAdmin
      .from('users')
      .update({ 
        platform_balance: supabaseAdmin.raw('platform_balance + ?', totalAmount)
      })
      .eq('id', userId);

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
      // استعادة الرصيد إذا فشل التسجيل
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: supabaseAdmin.raw('available_balance + ?', totalAmount),
          platform_balance: supabaseAdmin.raw('platform_balance - ?', totalAmount)
        })
        .eq('id', userId);
      throw orderError;
    }

    // تحديث عدد الطلبات الحالية
    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ 
        current_orders: newCurrentOrders
      })
      .eq('id', productId);

    // تحديث إحصائيات المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        total_orders: supabaseAdmin.raw('total_orders + 1'),
        total_spent: supabaseAdmin.raw('total_spent + ?', totalAmount)
      })
      .eq('id', userId);

    let message = `✅ تم طلب ${quantity} × ${product.name} بنجاح!`;
    let isCompleted = false;

    // التحقق من اكتمال العدد المطلوب
    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ` 🎉 اكتمل العدد المطلوب (${product.min_quantity})! سيتم شراء المنتجات وتوزيعها قريباً.`;

      await supabaseAdmin
        .from('products')
        .update({ 
          status: 'completed',
          completed_at: new Date().toISOString()
        })
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
    // جلب الطلب
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(status, min_quantity, current_orders)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }

    // التحقق: هل الطلب ملك لهذا المستخدم؟
    if (order.user_id !== userId) {
      return res.status(403).json({ error: '⚠️ هذا الطلب ليس لك' });
    }

    // التحقق: هل تم اكتمال العدد؟
    if (order.products.status === 'completed') {
      return res.status(400).json({ 
        error: '⚠️ العدد المطلوب اكتمل، لا يمكن سحب الطلب بعد الآن' 
      });
    }

    // التحقق: هل تم استبعاد المستخدم؟
    if (order.is_banned) {
      return res.status(400).json({ 
        error: '⚠️ تم استبعادك من هذا المنتج بسبب كثرة السحب' 
      });
    }

    // رسالة تحذير عند السحب
    const warningMessage = `⚠️ تحذير: أنت على وشك سحب طلبك. إذا قمت بالسحب مرة أخرى، سيتم استبعادك من هذا المنتج نهائياً.`;

    // تحديث عدد مرات السحب
    const newWithdrawCount = (order.withdraw_count || 0) + 1;

    // التحقق: إذا كانت هذه هي المرة الثانية، استبعاد المستخدم
    let isBanned = false;
    if (newWithdrawCount >= 2) {
      isBanned = true;
      await supabaseAdmin
        .from('product_orders')
        .update({ 
          is_banned: true,
          status: 'withdrawn',
          withdrawn_at: new Date().toISOString()
        })
        .eq('id', orderId);
    } else {
      await supabaseAdmin
        .from('product_orders')
        .update({ 
          status: 'withdrawn',
          withdraw_count: newWithdrawCount,
          withdrawn_at: new Date().toISOString()
        })
        .eq('id', orderId);
    }

    // إعادة المبلغ إلى رصيد المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance + ?', order.total_amount),
        platform_balance: supabaseAdmin.raw('platform_balance - ?', order.total_amount)
      })
      .eq('id', userId);

    // تقليل عدد الطلبات الحالية للمنتج
    await supabaseAdmin
      .from('products')
      .update({ 
        current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity)
      })
      .eq('id', order.product_id);

    // تسجيل سجل السحب
    await supabaseAdmin
      .from('withdrawal_logs')
      .insert({
        order_id: orderId,
        user_id: userId,
        amount: order.total_amount,
        reason: isBanned ? 'استبعاد بسبب كثرة السحب' : 'سحب طلب',
        created_at: new Date().toISOString()
      });

    let responseMessage = `✅ تم سحب طلبك بنجاح. تم إعادة ${order.total_amount} USDT إلى رصيدك.`;
    if (isBanned) {
      responseMessage += ` ⚠️ تم استبعادك من هذا المنتج نهائياً بسبب كثرة السحب.`;
    } else if (newWithdrawCount === 1) {
      responseMessage += ` ⚠️ تحذير: إذا قمت بالسحب مرة أخرى، سيتم استبعادك من هذا المنتج نهائياً.`;
    }

    res.json({
      success: true,
      message: responseMessage,
      isBanned: isBanned,
      withdrawCount: newWithdrawCount,
      warning: newWithdrawCount < 2 ? warningMessage : null
    });

  } catch (error) {
    console.error('Withdraw order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: عرض طلبات المستخدم
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

  if (!amount || amount < 1) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للإيداع هو 1 USDT' });
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

    // التحقق من عدم استخدام الهاش مسبقاً
    const { data: existingHash, error: hashError } = await supabaseAdmin
      .from('deposit_requests')
      .select('id, amount, transaction_hash')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();

    if (existingHash) {
      return res.status(400).json({ 
        error: '⚠️ هذا الـ TXID تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس TXID مرتين.'
      });
    }

    // التحقق من المعاملة على الشبكة
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

    // إضافة المبلغ إلى رصيد المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance + ?', actualAmount)
      })
      .eq('id', userId);

    // تسجيل المعاملة
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
      message: `✅ تم إضافة ${actualAmount} USDT إلى رصيدك بنجاح!`,
      depositId: deposit.id,
      verification: verification
    });

  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
  }
});

// ==========================================
// API: التحقق من الإيداع
// ==========================================
app.post('/api/verify-deposit', async (req, res) => {
  const { userId, transactionHash, amount } = req.body;

  if (!userId || !transactionHash) {
    return res.status(400).json({ error: 'userId و TXID مطلوبان' });
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
        error: '⚠️ هذا الـ TXID تم استخدامه مسبقاً في إيداع سابق! لا يمكن استخدام نفس TXID مرتين.'
      });
    }

    // التحقق من المعاملة على الشبكة
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

// ==========================================
// API: السحب
// ==========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للسحب 0.5 USDT' });
  }

  if (!walletAddress) {
    return res.status(400).json({ error: '⚠️ عنوان المحفظة مطلوب' });
  }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    if (user.available_balance < amount) {
      return res.status(400).json({ error: '⚠️ الرصيد غير كافٍ' });
    }

    // خصم المبلغ من رصيد المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance - ?', amount)
      })
      .eq('id', userId);

    // تسجيل السحب
    await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        wallet_address: walletAddress,
        status: 'approved',
        created_at: new Date().toISOString(),
        processed_at: new Date().toISOString()
      });

    // تسجيل المعاملة
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
      message: `✅ تم سحب ${amount} USDT إلى محفظتك بنجاح`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي في الخادم' });
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
    user: { id: user.id, email: user.email, name: user.name },
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
      platform_balance: 0,
      total_orders: 0,
      total_spent: 0,
      total_deposits: 0,
      total_withdrawn: 0,
      qualifying_deposit: false,
      is_exceptional: false,
      custom_min_deposit: 10,
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
  const { adminSecret, name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert({
        name: name,
        description: description,
        image_url: imageUrl,
        wholesale_price: wholesalePrice,
        group_price: groupPrice,
        min_quantity: minQuantity || 10,
        delivery_locations: deliveryLocations || [],
        status: 'active',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: `✅ تم إضافة المنتج ${name} بنجاح`,
      product: data
    });

  } catch (error) {
    console.error('Add product error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تحديد موعد التسليم (للأدمن)
// ==========================================
app.post('/api/admin/set-delivery-date', async (req, res) => {
  const { adminSecret, productId, deliveryDate } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    await supabaseAdmin
      .from('products')
      .update({ 
        delivery_date: deliveryDate
      })
      .eq('id', productId);

    res.json({
      success: true,
      message: `✅ تم تحديد موعد التسليم: ${new Date(deliveryDate).toLocaleDateString()}`
    });

  } catch (error) {
    console.error('Set delivery date error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تأكيد استلام المنتج وتوزيعه (للأدمن)
// ==========================================
app.post('/api/admin/confirm-delivery', async (req, res) => {
  const { adminSecret, productId } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
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

    if (product.status !== 'completed') {
      return res.status(400).json({ error: '⚠️ العدد لم يكتمل بعد، لا يمكن التوزيع' });
    }

    const { data: orders, error: ordersError } = await supabaseAdmin
      .from('product_orders')
      .select('*')
      .eq('product_id', productId)
      .eq('status', 'pending')
      .eq('is_banned', false);

    if (ordersError) throw ordersError;

    if (!orders || orders.length === 0) {
      return res.json({ message: 'لا توجد طلبات للتوزيع' });
    }

    for (const order of orders) {
      await supabaseAdmin
        .from('product_orders')
        .update({ 
          status: 'delivered',
          delivered_at: new Date().toISOString()
        })
        .eq('id', order.id);
    }

    res.json({
      success: true,
      message: `✅ تم توزيع المنتج على ${orders.length} مستخدم`,
      ordersCount: orders.length,
      deliveryDate: new Date().toISOString()
    });

  } catch (error) {
    console.error('Confirm delivery error:', error);
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
  ║   🛍️  منصة الشراء الجماعي تعمل بنجاح                         ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   🤲 نظام متوافق مع الشريعة الإسلامية                         ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
