const app = require('./src/app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 Sudani AI Assistant Server');
  console.log('=================================');
  console.log(`✅ Server running on port: ${PORT}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/api/chat/health`);
  console.log('=================================');
  console.log('💡 Ready to serve Sudanese users!');
  console.log('=================================');
});

// معالجة إشارات الإيقاف
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down server gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // إعادة التشغيل التلقائي في الإنتاج
  process.exit(1);
});
