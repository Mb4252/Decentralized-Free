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

// إعدادات محرك العرض (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// ============= دوال مساعدة =============

// حساب متوسط الأسعار
function calculateAverage(prices) {
    if (!prices || prices.length === 0) return 0;
    const sum = prices.reduce((acc, p) => acc + parseFloat(p.price), 0);
    return (sum / prices.length).toFixed(2);
}

// جلب أحدث 10 إضافات
function getLatest(prices, count = 10) {
    return prices.slice(0, count);
}

// ============= Routes =============

// الصفحة الرئيسية
app.get('/', async (req, res) => {
    try {
        // جلب جميع البيانات مرتبة من الأحدث
        const { data: prices, error } = await supabase
            .from('prices')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).send("خطأ في الاتصال بقاعدة البيانات.");
        }

        // حساب الإحصائيات
        const totalItems = prices.length;
        const uniqueItems = [...new Set(prices.map(p => p.item))];
        
        // حساب متوسط السعر الإجمالي
        const avgPrice = calculateAverage(prices);
        
        // أعلى وأقل سعر
        let highestPrice = null;
        let lowestPrice = null;
        if (prices.length > 0) {
            const sortedByPrice = [...prices].sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
            highestPrice = sortedByPrice[0];
            lowestPrice = sortedByPrice[sortedByPrice.length - 1];
        }

        // أحدث 10 إضافات
        const latestPrices = getLatest(prices, 10);

        // تجميع البيانات حسب المنطقة
        const locations = [...new Set(prices.map(p => p.location))];

        // حساب متوسط الأسعار لكل سلعة
        const itemAverages = {};
        prices.forEach(p => {
            if (!itemAverages[p.item]) {
                itemAverages[p.item] = { total: 0, count: 0, prices: [] };
            }
            itemAverages[p.item].total += parseFloat(p.price);
            itemAverages[p.item].count += 1;
            itemAverages[p.item].prices.push(parseFloat(p.price));
        });

        // حساب المتوسطات
        Object.keys(itemAverages).forEach(item => {
            const data = itemAverages[item];
            data.average = (data.total / data.count).toFixed(2);
            data.min = Math.min(...data.prices);
            data.max = Math.max(...data.prices);
        });

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
            }
        });
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ غير متوقع.");
    }
});

// إضافة سعر جديد
app.post('/add_price', async (req, res) => {
    try {
        const { item, price, location, category, store } = req.body;
        
        // التحقق من صحة البيانات
        if (!item || !price || !location) {
            return res.status(400).send("جميع الحقول مطلوبة.");
        }

        if (isNaN(price) || parseFloat(price) <= 0) {
            return res.status(400).send("السعر يجب أن يكون رقماً موجباً.");
        }

        // إدخال البيانات
        const { data, error } = await supabase
            .from('prices')
            .insert([{ 
                item, 
                price: parseFloat(price), 
                location,
                category: category || 'عام',
                store: store || 'غير محدد'
            }]);

        if (error) {
            console.error("Insert Error:", error);
            return res.status(500).send("خطأ أثناء إضافة البيانات.");
        }

        // إعادة التوجيه مع رسالة نجاح
        res.redirect('/?success=تم إضافة السعر بنجاح');
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

        res.redirect('/?success=تم حذف السعر بنجاح');
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
                location: location || undefined,
                store: store || undefined
            })
            .eq('id', id);

        if (error) {
            console.error("Update Error:", error);
            return res.status(500).send("خطأ أثناء تحديث البيانات.");
        }

        res.redirect('/?success=تم تحديث السعر بنجاح');
    } catch (err) {
        console.error("General Error:", err);
        res.status(500).send("حدث خطأ أثناء تنفيذ الطلب.");
    }
});

// الحصول على إحصائيات (API)
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

// تشغيل السيرفر
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🟢 Server is running on port ${PORT}`);
    console.log(`🔗 http://localhost:${PORT}`);
});
