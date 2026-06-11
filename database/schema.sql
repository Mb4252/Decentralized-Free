-- إنشاء قاعدة البيانات
CREATE DATABASE crypto_investment;
\c crypto_investment;

-- جدول المستويات
CREATE TABLE tiers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  min_deposit DECIMAL(20,8) NOT NULL,
  roi_percentage DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول المستخدمين
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  wallet_address VARCHAR(255),
  referral_code VARCHAR(20) UNIQUE NOT NULL,
  referrer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  tier_id INT REFERENCES tiers(id) ON DELETE SET NULL,
  available_balance DECIMAL(20,8) DEFAULT 0,
  active_deposit DECIMAL(20,8) DEFAULT 0,
  withdraw_pin VARCHAR(255) NOT NULL, -- hashed
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  total_deposited DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الاستثمارات
CREATE TABLE investments (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, active, closed
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  activated_at TIMESTAMP,
  closed_at TIMESTAMP
);

-- جدول المعاملات
CREATE TABLE transactions (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL, -- deposit, withdraw, profit, referral_bonus
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  reference_id INT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  approved_at TIMESTAMP,
  approved_by UUID REFERENCES users(id)
);

-- جدول سجل الأرباح اليومية
CREATE TABLE daily_profit_log (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  profit_amount DECIMAL(20,8) NOT NULL,
  roi_percent DECIMAL(5,2) NOT NULL,
  calculated_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, calculated_date)
);

-- جدول طلبات السحب
CREATE TABLE withdrawals (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
  pin_verified BOOLEAN DEFAULT FALSE,
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  processed_at TIMESTAMP,
  processed_by UUID REFERENCES users(id)
);

-- جدول الإحالات
CREATE TABLE referrals (
  id SERIAL PRIMARY KEY,
  referrer_id UUID REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID REFERENCES users(id) ON DELETE CASCADE,
  bonus_amount DECIMAL(20,8) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  UNIQUE(referrer_id, referred_id)
);

-- جدول سجل الإشعارات
CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(50),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول سجل الإيداعات المؤقتة
CREATE TABLE deposit_requests (
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

-- إدخال المستويات الافتراضية
INSERT INTO tiers (name, min_deposit, roi_percentage) VALUES
('مبتدئ', 10, 2.0),
('محترف', 100, 2.5),
('VIP', 500, 3.0),
('دياموند', 1000, 3.5);

-- إنشاء دوال مساعدة
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- دالة إضافة أرباح يومية
CREATE OR REPLACE FUNCTION add_daily_profit(
  p_user_id UUID,
  p_profit DECIMAL,
  p_date DATE,
  p_roi_percent DECIMAL
)
RETURNS VOID AS $$
DECLARE
  v_current_balance DECIMAL;
BEGIN
  -- إدراج سجل الربح اليومي
  INSERT INTO daily_profit_log (user_id, profit_amount, calculated_date, roi_percent)
  VALUES (p_user_id, p_profit, p_date, p_roi_percent);
  
  -- تحديث الرصيد المتاح
  UPDATE users
  SET available_balance = available_balance + p_profit
  WHERE id = p_user_id
  RETURNING available_balance INTO v_current_balance;
  
  -- تسجيل حركة الربح
  INSERT INTO transactions (user_id, type, amount, status, description)
  VALUES (p_user_id, 'profit', p_profit, 'approved', 
          CONCAT('Daily profit ', p_roi_percent, '% on active deposit'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- دالة تحديث مستوى المستخدم
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
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tier_on_deposit
  AFTER UPDATE OF active_deposit ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_user_tier();

-- تفعيل Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- سياسات الأمان
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can view own investments" ON investments
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own transactions" ON transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own withdrawals" ON withdrawals
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own notifications" ON notifications
  FOR SELECT USING (auth.uid() = user_id);
