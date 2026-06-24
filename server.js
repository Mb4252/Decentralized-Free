// ============================================================
// منصة التكافل السوداني - ملف الخادم الرئيسي
// ============================================================

// استيراد المكتبات الأساسية
require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================================
// إعداد الاتصال بقاعدة بيانات Supabase
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// إعدادات التطبيق
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// دوال مساعدة
// ============================================================

// حساب متوسط الأسعار
function calculateAverage(prices) {
    if (!prices || prices.length === 0) return 0;
    const sum = prices.reduce((acc, p) => acc + parseFloat(p.price), 0);
    return (sum / prices.length).toFixed(2);
}

// جلب أحدث الإضافات
function getLatest(prices, count = 10) {
    return prices.slice(0, count);
}

// منع الإضافات المتكررة
const rateLimit = new Map();

// ============================================================
// Routes الرئيسية
// ============================================================

// الصفحة الرئيسية
app.get('/', async (req, res) => {
    try {
        const { data: prices, error } = await supabase
            .from('prices')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).send("خطأ في الاتصال بقاعدة البيانات.");
        }

        const totalItems = prices.length;
        const uniqueItems = [...new Set(prices.map(p => p.item))];
        const avgPrice = calculateAverage(prices);
        
        let highestPrice = null;
        let lowestPrice = null;
        if (prices.length > 0) {
            const sortedByPrice = [...prices].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            highestPrice = sortedByPrice[0];
            lowestPrice = sortedByPrice[sortedByPrice.length - 1];
        }

        const latestPrices = getLatest(prices, 10);
        const locations = [...new Set(prices.map(p => p.location))];

        const itemAverages = {};
        prices.forEach(p => {
            if (!itemAverages[p.item]) {
                itemAverages[p.item] = { total: 0, count: 0, prices: [] };
            }
            itemAverages[p.item].total += parseFloat(p.price);
            itemAverages[p.item].count += 1;
            itemAverages[p.item].prices.push(parseFloat(p.price));
        });

        Object.keys(itemAverages).forEach(item => {
            const data = itemAverages[item];
            data.average = (data.total / data.count).toFixed(2);
            data.min = Math.min(...data.prices);
            data.max = Math.max(...data.prices);
        });

        const success = req.query.success || null;

        res.render('index', { 
            prices: prices || [],
            stats: {
                total: totalItems,
                uniqueItems: uniqueItems.length,
                avgPrice: avgPrice,
                highest: highestPrice,
                lowest: lowestPrice,
                latest: latestPrices,
                locations: locations,
                itemAverages: itemAverages
            },
            success: success
        });
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ غير متوقع.");
    }
});

// ============================================================
// Routes الأسعار
// ============================================================

// إضافة سعر جديد
app.post('/add_price', async (req, res) => {
    try {
        const { item, price, location, store, category, username } = req.body;
        
        if (!item || !price || !location) {
            return res.status(400).send("جميع الحقول مطلوبة.");
        }

        if (isNaN(price) || parseFloat(price) <= 0) {
            return res.status(400).send("السعر يجب أن يكون رقماً موجباً.");
        }

        const ip = req.ip || req.connection.remoteAddress;
        const now = Date.now();
        if (rateLimit.has(ip) && (now - rateLimit.get(ip) < 30000)) {
            return res.status(429).send("⏳ يرجى الانتظار 30 ثانية بين كل إضافة");
        }
        rateLimit.set(ip, now);

        const blacklist = ['سبام', 'test', 'اختبار', 'spam', 'حرام', 'ممنوع'];
        if (blacklist.some(word => item.toLowerCase().includes(word))) {
            return res.status(400).send("❌ كلمة غير مسموح بها");
        }

        const finalUsername = username || 'ضيف';
        const { data, error } = await supabase
            .from('prices')
            .insert([{ 
                item: item.trim(),
                price: parseFloat(price),
                location: location.trim(),
                store: store?.trim() || 'غير محدد',
                category: category?.trim() || 'عام',
                username: finalUsername.trim()
            }]);

        if (error) {
            console.error("Insert Error:", error);
            return res.status(500).send("خطأ أثناء إضافة البيانات.");
        }

        res.redirect('/?success=✅ تم إضافة السعر بنجاح');
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ أثناء تنفيذ الطلب.");
    }
});

// حذف سعر
app.post('/delete_price/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('prices')
            .delete()
            .eq('id', id);

        if (error) {
            console.error("Delete Error:", error);
            return res.status(500).send("خطأ أثناء حذف البيانات.");
        }

        res.redirect('/?success=🗑️ تم حذف السعر بنجاح');
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ أثناء تنفيذ الطلب.");
    }
});

// تحديث سعر
app.post('/update_price/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { price, location, store } = req.body;

        if (!price || isNaN(price) || parseFloat(price) <= 0) {
            return res.status(400).send("السعر يجب أن يكون رقماً موجباً.");
        }

        const { error } = await supabase
            .from('prices')
            .update({ 
                price: parseFloat(price),
                location: location?.trim() || undefined,
                store: store?.trim() || undefined,
                updated_at: new Date()
            })
            .eq('id', id);

        if (error) {
            console.error("Update Error:", error);
            return res.status(500).send("خطأ أثناء تحديث البيانات.");
        }

        res.redirect('/?success=✏️ تم تحديث السعر بنجاح');
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ أثناء تنفيذ الطلب.");
    }
});

// ============================================================
// Routes المستخدمين (الملف الشخصي) - النسخة المعدلة
// ============================================================

// صفحة الملف الشخصي
app.get('/profile/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        console.log('📖 جلب ملف المستخدم:', username);
        console.log('🔍 البحث في جدول users عن:', username);
        
        // جلب بيانات المستخدم
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);

        console.log('📊 نتيجة البحث:', { user, error });

        if (error) {
            console.error('❌ خطأ في الاستعلام:', error);
            return res.status(500).send("خطأ في قاعدة البيانات: " + error.message);
        }

        if (!user || user.length === 0) {
            console.log('❌ المستخدم غير موجود:', username);
            
            // عرض جميع المستخدمين للمساعدة في التصحيح
            const { data: allUsers } = await supabase
                .from('users')
                .select('username');
            console.log('📋 المستخدمين الموجودين:', allUsers);
            
            return res.status(404).send(`
                <h1>❌ المستخدم غير موجود</h1>
                <p>المستخدم "<strong>${username}</strong>" غير موجود في قاعدة البيانات.</p>
                <p>🔍 المستخدمين الموجودين: ${allUsers?.map(u => u.username).join(', ') || 'لا يوجد'}</p>
                <a href="/">العودة إلى الرئيسية</a>
            `);
        }

        // استخراج المستخدم الأول
        const userData = user[0];

        // جلب إحصائيات المستخدم
        const { count: totalAdds, error: countError } = await supabase
            .from('prices')
            .select('*', { count: 'exact', head: true })
            .eq('username', username);

        // جلب آخر 5 إضافات للمستخدم
        const { data: recentPrices, error: pricesError } = await supabase
            .from('prices')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(5);

        const success = req.query.success || null;

        console.log('✅ تم جلب الملف الشخصي بنجاح:', userData.username);

        res.render('profile', {
            user: userData,
            totalAdds: totalAdds || 0,
            recentPrices: recentPrices || [],
            success: success
        });
        
    } catch (err) {
        console.error('❌ خطأ عام في الملف الشخصي:', err);
        res.status(500).send(`
            <h1>❌ حدث خطأ</h1>
            <p>${err.message}</p>
            <a href="/">العودة إلى الرئيسية</a>
        `);
    }
});

// إنشاء مستخدم جديد
app.post('/create_user', async (req, res) => {
    try {
        const { username, full_name, state, phone } = req.body;
        
        console.log('📝 محاولة إنشاء مستخدم:', { username, full_name, state, phone });
        
        if (!username || !full_name || !state) {
            console.log('❌ بيانات ناقصة');
            return res.status(400).send("جميع الحقول مطلوبة");
        }

        // التحقق من أن اسم المستخدم غير مكرر
        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .single();

        if (existingUser) {
            console.log('⚠️ المستخدم موجود بالفعل:', username);
            return res.status(400).send("اسم المستخدم موجود بالفعل");
        }

        // إضافة المستخدم
        const { data, error } = await supabase
            .from('users')
            .insert([{ 
                username: username.trim(),
                full_name: full_name.trim(),
                state: state.trim(),
                phone: phone?.trim() || null
            }])
            .select();

        if (error) {
            console.error('❌ خطأ في الإضافة:', error);
            return res.status(500).send("خطأ في إنشاء المستخدم: " + error.message);
        }

        console.log('✅ تم إنشاء المستخدم بنجاح:', data);
        res.redirect(`/profile/${username}?success=✅ تم إنشاء الملف الشخصي بنجاح`);
        
    } catch (err) {
        console.error('❌ خطأ عام:', err);
        res.status(500).send("حدث خطأ في إنشاء المستخدم");
    }
});

// تحديث الملف الشخصي
app.post('/update_profile/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { full_name, state, phone } = req.body;

        const { data, error } = await supabase
            .from('users')
            .update({ 
                full_name: full_name.trim(),
                state: state.trim(),
                phone: phone?.trim() || null,
                last_active: new Date()
            })
            .eq('username', username)
            .select();

        if (error) {
            console.error("Update Profile Error:", error);
            return res.status(500).send("خطأ في تحديث البيانات");
        }

        console.log('✅ تم تحديث الملف الشخصي:', username);
        res.redirect(`/profile/${username}?success=✅ تم تحديث الملف الشخصي بنجاح`);
        
    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(500).send("حدث خطأ في تحديث الملف الشخصي");
    }
});

// ============================================================
// Routes اختبارية
// ============================================================

// اختبار الاتصال
app.get('/test', (req, res) => {
    res.json({
        status: '✅ السيرفر يعمل',
        time: new Date().toLocaleString('ar-EG'),
        version: '2.0.0'
    });
});

// عرض جميع المستخدمين (للتطوير)
app.get('/api/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// API Routes
// ============================================================

// API: جلب إحصائيات عامة
app.get('/api/stats', async (req, res) => {
    try {
        const { data: prices, error } = await supabase
            .from('prices')
            .select('*');

        if (error) throw error;

        const itemAverages = {};
        prices.forEach(p => {
            if (!itemAverages[p.item]) {
                itemAverages[p.item] = { total: 0, count: 0 };
            }
            itemAverages[p.item].total += parseFloat(p.price);
            itemAverages[p.item].count += 1;
        });

        Object.keys(itemAverages).forEach(item => {
            itemAverages[item].average = (itemAverages[item].total / itemAverages[item].count).toFixed(2);
        });

        res.json({
            total: prices.length,
            items: Object.keys(itemAverages).length,
            averages: itemAverages
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: جلب بيانات مستخدم
app.get('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (error) throw error;
        res.json(user);
    } catch (err) {
        res.status(404).json({ error: "المستخدم غير موجود" });
    }
});

// ============================================================
// معالجة الأخطاء (404)
// ============================================================
app.use((req, res) => {
    res.status(404).send(`
        <h1>❌ 404 - صفحة غير موجودة</h1>
        <p>الصفحة التي تبحث عنها غير موجودة.</p>
        <a href="/">العودة إلى الرئيسية</a>
    `);
});

// ============================================================
// تشغيل السيرفر
// ============================================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Server is running on port ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
    console.log(`🇸🇩 منصة التكافل السوداني جاهزة للعمل`);
});
