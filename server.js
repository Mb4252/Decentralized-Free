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
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance - ?', totalAmount),
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
      await supabaseAdmin
        .from('users')
        .update({ 
          available_balance: supabaseAdmin.raw('available_balance + ?', totalAmount),
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

    // إعادة المبلغ
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance + ?', order.total_amount),
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

  if (!amount || amount < 1) {
    return res.status(400).json({ error: '⚠️ الحد الأدنى للإيداع 1 USDT' });
  }

  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: '⚠️ TXID مطلوب' });
  }

  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (!user) {
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

    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance + ?', actualAmount)
      })
      .eq('id', userId);

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
      message: `✅ تم إضافة ${actualAmount} USDT إلى رصيدك بنجاح!`
    });

  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: التحقق من الإيداع (للأدمن)
// ==========================================
app.post('/api/admin/verify-deposit', async (req, res) => {
  const { adminSecret, transactionHash, amount } = req.body;

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
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();

    if (!user || user.available_balance < amount) {
      return res.status(400).json({ error: '⚠️ الرصيد غير كافٍ' });
    }

    // خصم الرصيد وتسجيل السحب
    await supabaseAdmin
      .from('users')
      .update({ available_balance: supabaseAdmin.raw('available_balance - ?', amount) })
      .eq('id', userId);

    await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount: amount,
        wallet_address: walletAddress,
        status: 'approved',
        created_at: new Date().toISOString()
      });

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
      message: `✅ تم سحب ${amount} USDT بنجاح`
    });

  } catch (error) {
    res.status(500).json({ error: 'حدث خطأ داخلي' });
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
    return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
  }

  res.json({ 
    success: true, 
    user: { id: userId, email: email, name: name },
    referral_code: newReferralCode
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
// ============ APIs الأدمن ============
// ==========================================

// التحقق من صلاحية الأدمن
async function isAdmin(userId) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('is_admin')
    .eq('id', userId)
    .single();
  return data?.is_admin === true;
}

// ==========================================
// API: جعل مستخدم أدمن
// ==========================================
app.post('/api/admin/make-admin', async (req, res) => {
  const { adminSecret, userId } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
  }

  try {
    await supabaseAdmin
      .from('users')
      .update({ is_admin: true })
      .eq('id', userId);

    res.json({ success: true, message: '✅ تم جعل المستخدم أدمن' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  const { adminSecret, name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
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
        delivery_locations: deliveryLocations || ['الخرطوم', 'أم درمان', 'بحري'],
        delivery_date: deliveryDate || null,
        pickup_time: pickupTime || null,
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

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
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

    res.json({
      success: true,
      message: '✅ تم حذف المنتج بنجاح'
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
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
