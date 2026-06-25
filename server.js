// ============================================================
// منصة التكافل السوداني - ملف الخادم الرئيسي
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
// إعداد Session
// ============================================================
app.use(session({
    secret: process.env.SESSION_SECRET || 'sudan_secret_key_2026',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000
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
// دوال الهدية
// ============================================================

// دالة منح الهدية للمستخدم الجديد
async function giveWelcomeGift(userId, username) {
    try {
        const giftAmount = 5000;
        
        const { data, error } = await supabase
            .from('users')
            .update({ 
                gift_received: true,
                gift_date: new Date(),
                gift_balance: giftAmount
            })
            .eq('id', userId)
            .select();

        if (error) {
            console.error('❌ خطأ في منح الهدية:', error);
            return false;
        }

        console.log(`🎁 تم منح هدية ${giftAmount} ج للمستخدم: ${username}`);
        return true;
    } catch (err) {
        console.error('❌ خطأ في giveWelcomeGift:', err);
        return false;
    }
}

// دالة التحقق من حالة الهدية
async function checkGiftStatus(username) {
    try {
        const { data: user, error } = await supabase
            .from('users')
            .select('gift_received, gift_balance, gift_date')
            .eq('username', username)
            .single();

        if (error) {
            console.error('❌ خطأ في التحقق من الهدية:', error);
            return null;
        }

        return user;
    } catch (err) {
        console.error('❌ خطأ:', err);
        return null;
    }
}

// ============================================================
// حذف المنشورات المنتهية (أقدم من 3 أيام)
// ============================================================

async function deleteExpiredPrices() {
    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const { data, error } = await supabase
            .from('prices')
            .delete()
            .lt('created_at', threeDaysAgo.toISOString());

        if (error) {
            console.error('❌ خطأ في حذف المنشورات المنتهية:', error);
            return;
        }

        if (data && data.length > 0) {
            console.log(`✅ تم حذف ${data.length} منشور منتهي (أقدم من 3 أيام)`);
        } else {
            console.log('ℹ️ لا توجد منشورات منتهية للحذف');
        }
    } catch (err) {
        console.error('❌ خطأ في deleteExpiredPrices:', err);
    }
}

// تشغيل الحذف عند بدء السيرفر
setTimeout(() => {
    deleteExpiredPrices();
}, 5000);

// جدولة الحذف كل 3 أيام
setInterval(() => {
    deleteExpiredPrices();
}, 259200000);

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
        const errorMsg = req.query.error || null;
        
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
            error: errorMsg,
            currentUser: currentUser
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
// Routes المستخدمين
// ============================================================

// صفحة تسجيل الدخول
app.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    
    const error = req.query.error || null;
    res.render('login', { error: error });
});

// صفحة إنشاء حساب جديد
app.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }
    
    const error = req.query.error || null;
    res.render('register', { error: error });
});

// صفحة عرض الهدية
app.get('/gift', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login?error=⚠️ يرجى تسجيل الدخول أولاً');
        }

        const username = req.session.user.username;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('gift_received, gift_balance, gift_date')
            .eq('username', username)
            .single();

        if (error) {
            console.error('Gift Error:', error);
            return res.redirect('/profile?error=❌ خطأ في عرض الهدية');
        }

        req.session.user.gift_received = user.gift_received;
        req.session.user.gift_balance = user.gift_balance;
        req.session.user.gift_date = user.gift_date;

        res.render('gift', { currentUser: req.session.user });
        
    } catch (err) {
        console.error('Gift Error:', err);
        res.redirect('/profile?error=❌ حدث خطأ');
    }
});

// تسجيل الدخول
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        console.log('📝 محاولة تسجيل دخول:', username);
        
        if (!username || !password) {
            return res.redirect('/login?error=⚠️ يرجى إدخال اسم المستخدم وكلمة المرور');
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username)
            .single();

        if (error || !user) {
            console.log('❌ المستخدم غير موجود:', username);
            return res.redirect('/login?error=❌ اسم المستخدم غير صحيح');
        }

        if (user.password !== password) {
            console.log('❌ كلمة مرور خاطئة للمستخدم:', username);
            return res.redirect('/login?error=❌ كلمة المرور غير صحيحة');
        }

        // التحقق من حالة الهدية
        const giftStatus = await checkGiftStatus(username);
        
        req.session.user = {
            username: user.username,
            full_name: user.full_name,
            state: user.state,
            id: user.id,
            gift_received: user.gift_received || false,
            gift_balance: user.gift_balance || 0
        };

        let successMessage = `✅ مرحباً ${user.full_name}! تم تسجيل الدخول بنجاح`;
        
        // إذا لم يستلم الهدية بعد (للمستخدمين القدامى)
        if (!user.gift_received) {
            const giftGiven = await giveWelcomeGift(user.id, user.username);
            if (giftGiven) {
                successMessage = `🎁 مرحباً ${user.full_name}! تم منحك 5000 جنيه كهدية ترحيبية!`;
                req.session.user.gift_received = true;
                req.session.user.gift_balance = 5000;
            }
        }

        console.log('✅ تم تسجيل الدخول بنجاح:', username);
        res.redirect(`/?success=${encodeURIComponent(successMessage)}`);
        
    } catch (err) {
        console.error('Login Error:', err);
        res.redirect('/login?error=❌ حدث خطأ في تسجيل الدخول');
    }
});

// إنشاء مستخدم جديد مع هدية
app.post('/register', async (req, res) => {
    try {
        const { username, full_name, state, phone, password, confirm_password } = req.body;
        
        console.log('📝 محاولة إنشاء مستخدم جديد:', { username, full_name, state });
        
        if (!username || !full_name || !state || !password) {
            return res.redirect('/register?error=⚠️ جميع الحقول مطلوبة');
        }

        if (password.length < 6) {
            return res.redirect('/register?error=⚠️ كلمة المرور يجب أن تكون 6 أحرف على الأقل');
        }

        if (password !== confirm_password) {
            return res.redirect('/register?error=⚠️ كلمة المرور غير متطابقة');
        }

        const { data: existingUser } = await supabase
            .from('users')
            .select('username')
            .eq('username', username)
            .single();

        if (existingUser) {
            console.log('⚠️ المستخدم موجود بالفعل:', username);
            return res.redirect('/register?error=⚠️ اسم المستخدم موجود بالفعل');
        }

        const { data, error } = await supabase
            .from('users')
            .insert([{ 
                username: username.trim(),
                full_name: full_name.trim(),
                state: state.trim(),
                phone: phone?.trim() || null,
                password: password,
                gift_received: false,
                gift_balance: 0
            }])
            .select();

        if (error) {
            console.error('❌ خطأ في الإضافة:', error);
            return res.redirect('/register?error=❌ خطأ في إنشاء الحساب: ' + error.message);
        }

        console.log('✅ تم إنشاء المستخدم بنجاح:', data);
        
        const newUser = data[0];
        
        const giftGiven = await giveWelcomeGift(newUser.id, newUser.username);
        
        if (giftGiven) {
            console.log(`🎁 تم منح 5000 ج للمستخدم: ${newUser.username}`);
        }
        
        req.session.user = {
            username: newUser.username,
            full_name: newUser.full_name,
            state: newUser.state,
            id: newUser.id,
            gift_received: true,
            gift_balance: 5000
        };
        
        res.redirect('/?success=🎁 مرحباً! تم إنشاء حسابك ومنحك 5000 جنيه كهدية ترحيبية!');
        
    } catch (err) {
        console.error('❌ خطأ عام:', err);
        res.redirect('/register?error=❌ حدث خطأ في إنشاء الحساب');
    }
});

// صفحة الملف الشخصي
app.get('/profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login?error=⚠️ يرجى تسجيل الدخول أولاً');
        }

        const username = req.session.user.username;
        
        console.log('📖 جلب ملف المستخدم:', username);
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('username', username);

        if (error || !user || user.length === 0) {
            console.log('❌ المستخدم غير موجود:', username);
            req.session.user = null;
            return res.redirect('/login?error=❌ المستخدم غير موجود');
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
        const errorMsg = req.query.error || null;

        res.render('profile', {
            user: userData,
            totalAdds: totalAdds || 0,
            recentPrices: recentPrices || [],
            success: success,
            error: errorMsg,
            currentUser: req.session.user
        });
        
    } catch (err) {
        console.error('❌ خطأ:', err);
        res.status(500).send("حدث خطأ في تحميل الملف الشخصي");
    }
});

// عرض ملف شخص معين
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

// تحديث الملف الشخصي
app.post('/update_profile', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login?error=⚠️ يرجى تسجيل الدخول أولاً');
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

        req.session.user.full_name = full_name.trim();
        req.session.user.state = state.trim();

        console.log('✅ تم تحديث الملف الشخصي:', username);
        res.redirect(`/profile?success=✅ تم تحديث الملف الشخصي بنجاح`);
        
    } catch (err) {
        console.error("Update Profile Error:", err);
        res.status(500).send("حدث خطأ في تحديث الملف الشخصي");
    }
});

// تغيير كلمة المرور
app.post('/change_password', async (req, res) => {
    try {
        if (!req.session.user) {
            return res.redirect('/login?error=⚠️ يرجى تسجيل الدخول أولاً');
        }

        const username = req.session.user.username;
        const { current_password, new_password, confirm_new_password } = req.body;

        if (!current_password || !new_password || !confirm_new_password) {
            return res.redirect('/profile?error=⚠️ جميع الحقول مطلوبة');
        }

        if (new_password.length < 6) {
            return res.redirect('/profile?error=⚠️ كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل');
        }

        if (new_password !== confirm_new_password) {
            return res.redirect('/profile?error=⚠️ كلمة المرور الجديدة غير متطابقة');
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('password')
            .eq('username', username)
            .single();

        if (error || !user) {
            return res.redirect('/profile?error=❌ المستخدم غير موجود');
        }

        if (user.password !== current_password) {
            return res.redirect('/profile?error=❌ كلمة المرور الحالية غير صحيحة');
        }

        const { error: updateError } = await supabase
            .from('users')
            .update({ password: new_password })
            .eq('username', username);

        if (updateError) {
            console.error("Change Password Error:", updateError);
            return res.redirect('/profile?error=❌ خطأ في تغيير كلمة المرور');
        }

        console.log('✅ تم تغيير كلمة المرور للمستخدم:', username);
        res.redirect('/profile?success=✅ تم تغيير كلمة المرور بنجاح');
        
    } catch (err) {
        console.error("Change Password Error:", err);
        res.redirect('/profile?error=❌ حدث خطأ في تغيير كلمة المرور');
    }
});

// تسجيل الخروج
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout Error:', err);
        }
        res.redirect('/?success=👋 تم تسجيل الخروج بنجاح');
    });
});

// ============================================================
// Route: مسح المنشورات القديمة يدوياً (للمشرفين)
// ============================================================

app.post('/admin/cleanup', async (req, res) => {
    try {
        if (!req.session.user || req.session.user.username !== 'admin') {
            return res.status(403).send('❌ غير مصرح به');
        }

        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const { data, error } = await supabase
            .from('prices')
            .delete()
            .lt('created_at', threeDaysAgo.toISOString())
            .select();

        if (error) {
            console.error('Cleanup Error:', error);
            return res.status(500).send('خطأ في مسح المنشورات');
        }

        res.redirect(`/?success=🗑️ تم حذف ${data?.length || 0} منشور منتهي`);
    } catch (err) {
        console.error('Cleanup Error:', err);
        res.status(500).send('حدث خطأ');
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
            .select('id, username, full_name, state, phone, created_at, last_active, gift_received, gift_balance, gift_date')
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
    console.log(`🗑️ سيتم حذف المنشورات الأقدم من 3 أيام تلقائياً`);
    console.log(`🎁 سيتم منح 5000 ج هدية لكل مستخدم جديد`);
});
