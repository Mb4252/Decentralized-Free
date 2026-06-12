-- =====================================================
-- قاعدة بيانات منصة التعدين السحابي
-- Cloud Mining Platform Database Schema
-- =====================================================

-- 1. جدول المستويات (Tiers)
CREATE TABLE IF NOT EXISTS tiers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  min_deposit DECIMAL(20,8) NOT NULL,
  roi_percentage DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. جدول المستخدمين (Users)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  password TEXT,
  wallet_address VARCHAR(255),
  referral_code VARCHAR(20) UNIQUE NOT NULL,
  referrer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tier_id INT REFERENCES tiers(id) ON DELETE SET NULL,
  available_balance DECIMAL(20,8) DEFAULT 0,
  active_deposit DECIMAL(20,8) DEFAULT 0,
  withdraw_pin VARCHAR(255),
  firebase_uid VARCHAR(255),
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  total_deposited DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. جدول الاستثمارات (Investments)
CREATE TABLE IF NOT EXISTS investments (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  activated_at TIMESTAMP,
  closed_at TIMESTAMP
);

-- 4. جدول المعاملات (Transactions)
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  reference_id INT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id)
);

-- 5. جدول سجل الأرباح اليومية (Daily Profit Log)
CREATE TABLE IF NOT EXISTS daily_profit_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  profit_amount DECIMAL(20,8) NOT NULL,
  roi_percent DECIMAL(5,2) NOT NULL,
  calculated_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, calculated_date)
);

-- 6. جدول طلبات السحب (Withdrawals)
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  pin_verified BOOLEAN DEFAULT FALSE,
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  processed_by UUID REFERENCES users(id)
);

-- 7. جدول الإحالات (Referrals)
CREATE TABLE IF NOT EXISTS referrals (
  id SERIAL PRIMARY KEY,
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES users(id) ON DELETE CASCADE,
  bonus_amount DECIMAL(20,8) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  UNIQUE(referrer_id, referred_id)
);

-- 8. جدول الإشعارات (Notifications)
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. جدول طلبات الإيداع (Deposit Requests)
CREATE TABLE IF NOT EXISTS deposit_requests (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  transaction_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id)
);

-- =====================================================
-- إدراج المستويات الافتراضية (Tiers)
-- =====================================================
INSERT INTO tiers (name, min_deposit, roi_percentage) VALUES
('مبتدئ', 10, 2.0),
('محترف', 100, 2.5),
('VIP', 500, 3.0),
('دياموند', 1000, 3.5)
ON CONFLICT (id) DO UPDATE SET
  roi_percentage = EXCLUDED.roi_percentage;

-- =====================================================
-- تحديث رمز الإحالة للمستخدمين الحاليين (إذا كان فارغاً)
-- =====================================================
UPDATE users 
SET referral_code = UPPER(SUBSTRING(MD5(random()::text), 1, 8)) 
WHERE referral_code IS NULL OR referral_code = '';

-- =====================================================
-- دوال مساعدة (Helper Functions)
-- =====================================================

-- دالة تحديث updated_at تلقائياً
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث updated_at في جدول users
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- دالة إضافة الأرباح اليومية (Daily Profit Function)
-- =====================================================
CREATE OR REPLACE FUNCTION add_daily_profit(
  p_user_id UUID,
  p_profit DECIMAL,
  p_date DATE,
  p_roi_percent DECIMAL
)
RETURNS VOID AS $$
BEGIN
  -- إدراج سجل الربح اليومي
  INSERT INTO daily_profit_log (user_id, profit_amount, calculated_date, roi_percent)
  VALUES (p_user_id, p_profit, p_date, p_roi_percent);
  
  -- تحديث الرصيد المتاح للمستخدم
  UPDATE users
  SET available_balance = available_balance + p_profit
  WHERE id = p_user_id;
  
  -- تسجيل حركة الربح في المعاملات
  INSERT INTO transactions (user_id, type, amount, status, description)
  VALUES (p_user_id, 'profit', p_profit, 'approved', 
          CONCAT('Daily profit ', p_roi_percent, '% on active deposit'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- دالة تحديث مستوى المستخدم تلقائياً
-- =====================================================
CREATE OR REPLACE FUNCTION update_user_tier()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET tier_id = (
    SELECT id FROM tiers 
    WHERE min_deposit <= NEW.active_deposit 
    ORDER BY min_deposit DESC 
    LIMIT 1
  )
  WHERE id = NEW.id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger لتحديث المستوى عند تغيير active_deposit
DROP TRIGGER IF EXISTS update_tier_on_deposit ON users;
CREATE TRIGGER update_tier_on_deposit
  AFTER UPDATE OF active_deposit ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_user_tier();

-- =====================================================
-- سياسات الأمان (RLS) - معطلة حالياً
-- =====================================================
-- تعطيل RLS على جميع الجداول (لأننا نستخدم service_role)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE investments DISABLE ROW LEVEL SECURITY;
ALTER TABLE transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_profit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE referrals DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- إنشاء فهارس (Indexes) لتحسين الأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_investments_user_id ON investments(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_profit_log_user_id ON daily_profit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_profit_log_date ON daily_profit_log(calculated_date);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id);

-- =====================================================
-- عرض جميع الجداول للتأكد
-- =====================================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
