const rateLimit = require('express-rate-limit');

// حد الطلبات لكل IP (منع الهجمات)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 100, // حد أقصى 100 طلب لكل IP
  message: {
    error: 'Too many requests',
    message: 'هدّي شوية يا حبيب! انت أرسلت طلبات كتيرة، استنى شوية وارجع.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// التحقق من التوكن (للإصدارات المستقبلية)
const validateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  
  if (!token) {
    // في النسخة التجريبية، نسمح بمرور الطلبات بدون توكن
    req.userId = 'anonymous';
    return next();
  }

  // تحقق من التوكن (تطبيق بسيط)
  try {
    // هنا يمكنك فك تشفير JWT
    req.userId = 'authenticated_user';
    next();
  } catch (error) {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'توكن غير صحيح، حاول مرة أخرى'
    });
  }
};

module.exports = { limiter, validateToken };
