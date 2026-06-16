const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// ==========================================
// إعدادات CORS
// ==========================================
app.use(cors({
  origin: '*',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static('app'));

// ========================================
// تهيئة Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('✅ Supabase initialized');

// ==========================================
// API: صحّة الخادم (TEST)
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: '🚀 Server is running!'
  });
});

// ==========================================
// API: اختبار بسيط (TEST)
// ==========================================
app.get('/api/test', (req, res) => {
  res.json({
    message: '✅ API is working!',
    env: {
      supabase_url: process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing',
      supabase_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '❌ Missing',
    }
  });
});

// ==========================================
// API: تسجيل الدخول المبسط (TEST)
// ==========================================
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  console.log('🔐 Login attempt:', email);
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    console.log('📊 Query result:', { user: !!user, error: error?.message });
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    res.json({ 
      success: true,
      user: { 
        id: user.id, 
        email: user.email, 
        name: user.name,
        is_admin: user.is_admin || false
      }
    });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal error: ' + error.message });
  }
});

// ==========================================
// API: إنشاء حساب مبسط (TEST)
// ==========================================
app.post('/api/register', async (req, res) => {
  const { email, password, name } = req.body;
  
  console.log('📝 Register attempt:', email);
  
  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields required' });
  }
  
  try {
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    const userId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    
    const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    const { data: newUser, error: insertError } = await supabaseAdmin
      .from('users')
      .insert({
        id: userId,
        email: email,
        password: password,
        name: name,
        referral_code: referralCode,
        is_admin: false,
        available_balance: 0,
        platform_balance: 0,
        total_orders: 0,
        total_spent: 0,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (insertError) {
      console.error('❌ Insert error:', insertError);
      return res.status(500).json({ error: 'Registration failed: ' + insertError.message });
    }
    
    console.log('✅ User registered:', email);
    
    res.json({ 
      success: true,
      user: { 
        id: userId, 
        email: email, 
        name: name,
        is_admin: false
      },
      referral_code: referralCode
    });
    
  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ error: 'Internal error: ' + error.message });
  }
});

// ==========================================
// تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🛍️  CryptoShop API - Version 2.0                           ║
  ║   📡 Port: ${PORT}                                              ║
  ║   🌐 http://localhost:${PORT}                                   ║
  ║   ✅ Supabase: ${process.env.SUPABASE_URL ? 'Connected' : '❌ Not Set'}   ║
  ║   🧪 Test: GET /api/health                                    ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
