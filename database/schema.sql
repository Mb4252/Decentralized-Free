-- جدول عمليات التحويل التلقائي
CREATE TABLE IF NOT EXISTS auto_transfers (
  id SERIAL PRIMARY KEY,
  from_address VARCHAR(255) NOT NULL,
  to_address VARCHAR(255) NOT NULL,
  amount DECIMAL(20,8) NOT NULL,
  percentage INTEGER DEFAULT 70,
  tx_hash VARCHAR(255) UNIQUE,
  gas_used DECIMAL(20,8),
  block_number INTEGER,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول الإيداعات التي تمت معالجتها
CREATE TABLE IF NOT EXISTS processed_deposits (
  id SERIAL PRIMARY KEY,
  amount DECIMAL(20,8) NOT NULL,
  tx_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول توزيعات الأرباح
CREATE TABLE IF NOT EXISTS profit_distributions (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  total_amount DECIMAL(20,8) DEFAULT 0,
  users_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- إضافة عمود vip_level إذا لم يكن موجوداً
ALTER TABLE users ADD COLUMN IF NOT EXISTS vip_level INTEGER DEFAULT 0;

-- تحديث المستخدمين الحاليين
UPDATE users SET vip_level = 0 WHERE vip_level IS NULL;
