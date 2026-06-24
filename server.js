require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

// الصفحة الرئيسية - عرض البيانات
app.get('/', async (req, res) => {
    const { data: prices, error } = await supabase.from('prices').select('*');
    res.render('index', { prices: prices || [] });
});

// إضافة سعر جديد
app.post('/add_price', async (req, res) => {
    const { item, price, location } = req.body;
    await supabase.from('prices').insert([{ item, price, location }]);
    res.redirect('/');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
