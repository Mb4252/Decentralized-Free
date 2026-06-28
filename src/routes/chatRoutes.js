const express = require('express');
const router = express.Router();
const ChatController = require('../controllers/chatController');

const chatController = new ChatController();

// مسار معالجة الرسائل
router.post('/message', (req, res) => chatController.handleMessage(req, res));

// مسار جلب الإحصائيات
router.get('/analytics', (req, res) => chatController.getAnalytics(req, res));

// مسار الإجابة السريعة
router.get('/quick-answer', (req, res) => chatController.getQuickAnswer(req, res));

// مسار التحقق من صحة السيرفر
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Sudani AI Assistant'
  });
});

module.exports = router;
