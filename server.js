// استيراد المكتبات الأساسية
require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// إعداد الاتصال بقاعدة بيانات Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// إعدادات محرك العرض (EJS) وتحديد مسار مجلد views بدقة
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware لمعالجة بيانات النماذج (Forms)
app.use(express.urlencoded({ extended: true }));

// Route: الصفحة الرئيسية (عرض البيانات)
app.get('/', async (req, res) => {
    try {
        // جلب البيانات مع ترتيبها من الأحدث للأقدم
        const { data: prices, error } = await supabase
            .from('prices')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).send("خطأ في الاتصال بقاعدة البيانات.");
        }

        res.render('index', { prices: prices || [] });
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ غير متوقع.");
    }
});

// Route: إضافة سعر جديد
app.post('/add_price', async (req, res) => {
    try {
        const { item, price, location } = req.body;
        
        // إدخال البيانات في الجدول
        const { error } = await supabase
            .from('prices')
            .insert([{ item, price, location }]);

        if (error) {
            console.error("Insert Error:", error);
            return res.status(500).send("خطأ أثناء إضافة البيانات.");
        }

        // إعادة التوجيه للصفحة الرئيسية بعد الإضافة
        res.redirect('/');
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ أثناء تنفيذ الطلب.");
    }
});

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
