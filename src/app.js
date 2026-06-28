const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const chatRoutes = require('./routes/chatRoutes');
const { limiter, validateToken } = require('./middleware/auth');

dotenv.config();

const app = express();

// Middleware
app.use(helmet()); // حماية الأمان
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://yourdomain.com', 'https://app.yourdomain.com']
    : '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate Limiting
app.use('/api', limiter);

// التحقق من التوكن (اختياري)
app.use('/api', validateToken);

// Routes
app.use('/api/chat', chatRoutes);

// مسار الصفحة الرئيسية
app.get('/', (req, res) => {
  res.json({
    service: '🤖 Sudani AI Assistant',
    version: '1.0.0',
    status: 'Online',
    endpoints: {
      chat: '/api/chat/message',
      analytics: '/api/chat/analytics',
      quickAnswer: '/api/chat/quick-answer',
      health: '/api/chat/health'
    }
  });
});

// معالج الأخطاء العالمي
app.use((err, req, res, next) => {
  console.error('Global Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: 'حدث خطأ في السيرفر، حاول مرة أخرى',
    timestamp: new Date().toISOString()
  });
});

module.exports = app;
