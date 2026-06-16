const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==========================================
// 1. عرض المنتجات المتاحة
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
// 2. تفاصيل منتج معين
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
// 3. طلب منتج (إيداع في محفظة المنصة)
// ==========================================
app.post('/api/order-product', async (req, res) => {
  const { userId, productId, quantity, location, transactionHash } = req.body;

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

    // ✅ التحقق من الرصيد
    if (user.available_balance < totalAmount) {
      return res.status(400).json({ 
        error: `⚠️ رصيدك غير كافٍ. تحتاج إلى ${totalAmount} USDT` 
      });
    }

    // ✅ خصم المبلغ من رصيد المستخدم (يذهب إلى محفظة المنصة)
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance - ?', totalAmount)
      })
      .eq('id', userId);

    // ✅ إضافة المبلغ إلى رصيد المنصة
    await supabaseAdmin
      .from('users')
      .update({ 
        platform_balance: supabaseAdmin.raw('platform_balance + ?', totalAmount)
      })
      .eq('id', userId);

    // ✅ تسجيل الطلب
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        quantity: quantity,
        total_amount: totalAmount,
        location: location,
        transaction_hash: transactionHash || 'MANUAL_' + Date.now(),
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

    // ✅ تحديث عدد الطلبات الحالية
    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ 
        current_orders: newCurrentOrders
      })
      .eq('id', productId);

    let message = `✅ تم طلب ${quantity} × ${product.name} بنجاح!`;
    let isCompleted = false;

    // ✅ التحقق من اكتمال العدد المطلوب
    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ` 🎉 اكتمل العدد المطلوب (${product.min_quantity})! سيتم شراء المنتجات وتوزيعها قريباً.`;

      // تحديث حالة المنتج إلى completed
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
// 4. سحب الطلب (قبل اكتمال العدد)
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

    // ✅ التحقق: هل الطلب ملك لهذا المستخدم؟
    if (order.user_id !== userId) {
      return res.status(403).json({ error: '⚠️ هذا الطلب ليس لك' });
    }

    // ✅ التحقق: هل تم اكتمال العدد؟
    if (order.products.status === 'completed') {
      return res.status(400).json({ 
        error: '⚠️ العدد المطلوب اكتمل، لا يمكن سحب الطلب بعد الآن' 
      });
    }

    // ✅ التحقق: هل تم استبعاد المستخدم؟
    if (order.is_banned) {
      return res.status(400).json({ 
        error: '⚠️ تم استبعادك من هذا المنتج بسبب كثرة السحب' 
      });
    }

    // ✅ رسالة تحذير عند السحب
    const warningMessage = `⚠️ تحذير: أنت على وشك سحب طلبك. إذا قمت بالسحب مرة أخرى، سيتم استبعادك من هذا المنتج نهائياً.`;

    // ✅ تحديث عدد مرات السحب
    const newWithdrawCount = (order.withdraw_count || 0) + 1;

    // ✅ التحقق: إذا كانت هذه هي المرة الثانية، استبعاد المستخدم
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
      // تحديث حالة الطلب إلى withdrawn
      await supabaseAdmin
        .from('product_orders')
        .update({ 
          status: 'withdrawn',
          withdraw_count: newWithdrawCount,
          withdrawn_at: new Date().toISOString()
        })
        .eq('id', orderId);
    }

    // ✅ إعادة المبلغ إلى رصيد المستخدم
    await supabaseAdmin
      .from('users')
      .update({ 
        available_balance: supabaseAdmin.raw('available_balance + ?', order.total_amount),
        platform_balance: supabaseAdmin.raw('platform_balance - ?', order.total_amount)
      })
      .eq('id', userId);

    // ✅ تقليل عدد الطلبات الحالية للمنتج
    await supabaseAdmin
      .from('products')
      .update({ 
        current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity)
      })
      .eq('id', order.product_id);

    // ✅ تسجيل سجل السحب
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
// 5. تأكيد استلام المنتج وتوزيعه (للأدمن)
// ==========================================
app.post('/api/admin/confirm-delivery', async (req, res) => {
  const { productId, adminSecret } = req.body;

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'غير مصرح به' });
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

    if (product.status !== 'completed') {
      return res.status(400).json({ error: '⚠️ العدد لم يكتمل بعد، لا يمكن التوزيع' });
    }

    // جلب جميع الطلبات المؤكدة لهذا المنتج
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

    // تحديث حالة الطلبات إلى delivered
    for (const order of orders) {
      await supabaseAdmin
        .from('product_orders')
        .update({ 
          status: 'delivered',
          delivered_at: new Date().toISOString()
        })
        .eq('id', order.id);
    }

    // تحديث حالة المنتج
    await supabaseAdmin
      .from('products')
      .update({ 
        delivery_date: new Date().toISOString()
      })
      .eq('id', productId);

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
// 6. عرض طلبات المستخدم
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
// 7. عرض تفاصيل طلب معين
// ==========================================
app.post('/api/order-details', async (req, res) => {
  const { userId, orderId } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(*)')
      .eq('id', orderId)
      .eq('user_id', userId)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 8. سحب الأرباح (نظام السحب القديم)
// ==========================================
app.post('/api/withdraw', async (req, res) => {
  const { userId, amount, walletAddress } = req.body;

  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى للسحب 0.5 USDT' });
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
      return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    }

    // خصم المبلغ
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
        created_at: new Date().toISOString()
      });

    res.json({
      success: true,
      message: `✅ تم سحب ${amount} USDT إلى محفظتك بنجاح`
    });

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 9. (للأدمن) إضافة منتج جديد
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
// 10. (للأدمن) تحديد موعد التسليم
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
