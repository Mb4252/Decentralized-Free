// ============================================================
// منصة التكافل السوداني - مع نظام تسجيل الدخول
// ============================================================

require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');

const app = express();

// ============================================================
// إعداد Supabase
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================
// إعداد Session (تسجيل الدخول)
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'sudan_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,  // true في الإنتاج مع HTTPS
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 يوم
    }
}));

// ============================================================
// إعدادات التطبيق
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// ============================================================
// دوال مساعدة
// ============================================================

function calculateAverage(prices) {
    if (!prices || prices.length === 0) return 0;
    const sum = prices.reduce((acc, p) => acc + parseFloat(p.price), 0);
    return (sum / prices.length).toFixed(2);
}

function getLatest(prices, count = 10) {
    return prices.slice(0, count);
}

const rateLimit = new Map();

// ============================================================
// الصفحة الرئيسية
// ============================================================
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
        
        // ✅ تمرير معلومات المستخدم الحالي إلى الصفحة
        const currentUser = req.session.user || null;

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
            success: success,
            currentUser: currentUser  // ✅ المستخدم الحالي
        });
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ غير متوقع.");
    }
});

// ============================================================
// Routes الأسعار
// ============================================================

app.post('/add_price', async (req, res) => {
    try {
        const { item, price, location, store, category } = req.body;
        
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

        // ✅ استخدام اسم المستخدم من الجلسة إذا كان مسجلاً
        const finalUsername = req.session.user?.username || 'ضيف';
        
        const { data, error } = await supabase
            .from('prices')
            .insert([{ 
                item: item.trim(),
                price: parseFloat(price),
                location: location.trim(),
                store: store?.trim() || 'غير محدد',
                category: category?.trim() || 'عام',
                username: finalUsername
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
// Routes المستخدمين مع تسجيل الدخول
// ============================================================

// صفحة الملف الشخصي - تعرض ملف المستخدم المسجل حالياً
app.get('/profile', async (req, res) => {
    try {
        // ✅ التحقق من وجود مستخدم مسجل
        if (!req.session.user) {
            return res.redirect('/?error=⚠️ يرجى إنشاء ملف شخصي أولاً');
        }

        const username = req.session.user.username;
        
        console.log('📖 جلب ملف المستخدم:', username);
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);

        if (error || !user || user.length === 0) {
            console.log('❌ المستخدم غير موجود:', username);
            req.session.user = null; // مسح الجلسة
            return res.redirect('/?error=❌ المستخدم غير موجود، يرجى إنشاء ملف جديد');
        }

        const userData = user[0];

        const { count: totalAdds } = await supabase
            .from('prices')
            .select('*', { count: 'exact', head: true })
            .eq('username', username);

        const { data: recentPrices } = await supabase
            .from('prices')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(5);

        const success = req.query.success || null;

        res.render('profile', {
            user: userData,
            totalAdds: totalAdds || 0,
            recentPrices: recentPrices || [],
            success: success,
            currentUser: req.session.user
        });
        
    } catch (err) {
        console.error('❌ خطأ عام في الملف الشخصي:', err);
        res.status(500).send("حدث خطأ في تحميل الملف الشخصي");
    }
});

// عرض ملف شخص معين (للزوار)
app.get('/profile/:username', async (req, res) => {
    try {
        const { username } = req.params;
        
        console.log('📖 جلب ملف المستخدم:', username);
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);

        if (error || !user || user.length === 0) {
            return res.status(404).send(`
                <h1>❌ المستخدم غير موجود</h1>
                <p>المستخدم "<strong>${username}</strong>" غير موجود.</p>
                <a href="/">العودة إلى الرئيسية</a>
            `);
        }

        const userData = user[0];

        const { count: totalAdds } = await supabase
            .from('prices')
            .select('*', { count: 'exact', head: true })
            .eq('username', username);

        const { data: recentPrices } = await supabase
            .from('prices')
            .select('*')
            .eq('username', username)
            .order('created_at', { ascending: false })
            .limit(5);

        const success = req.query.success || null;

        res.render('profile', {
            user: userData,
            totalAdds: totalAdds || 0,
            recentPrices: recentPrices || [],
            success: success,
            currentUser: req.session.user || null
        });
        
    } catch (err) {
        console.error('❌ خطأ:', err);
        res.status(500).send("حدث خطأ");
    }
});

// إنشاء مستخدم جديد + تسجيل الدخول تلقائياً
app.post('/create_user', async (req, res) => {
    try {
        const { username, full_name, state, phone } = req.body;
        
        console.log('📝 محاولة إنشاء مستخدم:', { username, full_name, state, phone });
        
        if (!username || !full_name || !state) {
            return res.status(400).send("جميع الحقول مطلوبة");
        }

        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .single();

        if (existingUser) {
            console.log('⚠️ المستخدم موجود بالفعل:', username);
            return res.status(400).send("اسم المستخدم موجود بالفعل");
        }

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
        
        // ✅ تسجيل الدخول تلقائياً بعد إنشاء المستخدم
        req.session.user = {
            username: username.trim(),
            full_name: full_name.trim(),
            state: state.trim()
        };
        
        res.redirect(`/profile?success=✅ تم إنشاء الملف الشخصي بنجاح وتم تسجيل الدخول`);
        
    } catch (err) {
        console.error('❌ خطأ عام:', err);
        res.status(500).send("حدث خطأ في إنشاء المستخدم");
    }
});

// تسجيل الدخول (Login) - للمستخدمين الموجودين
app.post('/login', async (req, res) => {
    try {
        const { username } = req.body;
        
        if (!username) {
            return res.status(400).send("يرجى إدخال اسم المستخدم");
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !user) {
            return res.status(404).send("❌ المستخدم غير موجود");
        }

        // ✅ تسجيل الدخول
        req.session.user = {
            username: user.username,
            full_name: user.full_name,
            state: user.state
        };

        res.redirect('/?success=✅ مرحباً ' + user.full_name + '! تم تسجيل الدخول بنجاح');
        
    } catch (err) {
        console.error('Login Error:', err);
        res.status(500).send("حدث خطأ في تسجيل الدخول");
    }
});

// تسجيل الخروج (Logout)
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout Error:', err);
        }
        res.redirect('/?success=👋 تم تسجيل الخروج بنجاح');
    });
});

// تحديث الملف الشخصي
app.post('/update_profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/?error=⚠️ يرجى تسجيل الدخول أولاً');
        }

        const username = req.session.user.username;
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

        // ✅ تحديث بيانات الجلسة
        req.session.user.full_name = full_name.trim();
        req.session.user.state = state.trim();

        console.log('✅ تم تحديث الملف الشخصي:', username);
        res.redirect(`/profile?success=✅ تم تحديث الملف الشخصي بنجاح`);
        
    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(500).send("حدث خطأ في تحديث الملف الشخصي");
    }
});

// ============================================================
// Routes اختبارية
// ============================================================

app.get('/test', (req, res) => {
    res.json({
        status: '✅ السيرفر يعمل',
        time: new Date().toLocaleString('ar-EG'),
        version: '2.0.0',
        loggedIn: req.session.user ? true : false,
        user: req.session.user || null
    });
});

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
