const app = require('./src/app');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ============================================
// 🎨 واجهة الويب المدمجة (Web Interface)
// ============================================

// صفحة الويب الرئيسية
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سوداني بوت - المساعد الذكي</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Tajawal', 'Segoe UI', 'Arial', sans-serif;
            background: linear-gradient(135deg, #0f1a2e 0%, #1A2B4A 40%, #2A3F66 100%);
            height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            margin: 0;
        }
        
        .chat-container {
            width: 480px;
            max-width: 100%;
            height: 750px;
            max-height: 98vh;
            background: #ffffff;
            border-radius: 30px;
            box-shadow: 0 30px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.1);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }
        
        /* Header */
        .chat-header {
            background: linear-gradient(135deg, #1A2B4A, #2A3F66);
            padding: 18px 24px;
            color: white;
            display: flex;
            align-items: center;
            gap: 14px;
            border-bottom: 2px solid rgba(255,255,255,0.1);
            flex-shrink: 0;
        }
        
        .chat-header .avatar {
            width: 48px;
            height: 48px;
            background: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 22px;
            color: #1A2B4A;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            flex-shrink: 0;
        }
        
        .chat-header .info {
            flex: 1;
        }
        
        .chat-header .info h3 {
            font-size: 20px;
            font-weight: 700;
            margin: 0;
            letter-spacing: 0.5px;
        }
        
        .chat-header .info p {
            font-size: 13px;
            opacity: 0.85;
            margin: 2px 0 0 0;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        .chat-header .info p .dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            background: #4caf50;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.5; transform: scale(0.8); }
        }
        
        .chat-header .badge {
            background: rgba(255,255,255,0.15);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
        }
        
        /* Status Bar */
        .status-bar {
            padding: 8px 24px;
            background: linear-gradient(90deg, #e8f5e9, #c8e6c9);
            text-align: center;
            font-size: 13px;
            color: #1e5a2a;
            border-bottom: 1px solid #a5d6a7;
            flex-shrink: 0;
            font-weight: 500;
        }
        
        /* Messages Area */
        .messages-area {
            flex: 1;
            padding: 20px 18px;
            overflow-y: auto;
            background: #f0f2f5;
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        
        .messages-area::-webkit-scrollbar {
            width: 5px;
        }
        
        .messages-area::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .messages-area::-webkit-scrollbar-thumb {
            background: #c0c4cc;
            border-radius: 10px;
        }
        
        .message {
            display: flex;
            flex-direction: column;
            animation: slideIn 0.3s ease;
            max-width: 90%;
        }
        
        .message.user {
            align-self: flex-end;
            align-items: flex-end;
        }
        
        .message.bot {
            align-self: flex-start;
            align-items: flex-start;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(12px) scale(0.98);
            }
            to {
                opacity: 1;
                transform: translateY(0) scale(1);
            }
        }
        
        .message .bubble {
            padding: 12px 18px;
            border-radius: 18px;
            word-wrap: break-word;
            line-height: 1.7;
            font-size: 15px;
            max-width: 100%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }
        
        .message.user .bubble {
            background: linear-gradient(135deg, #1A2B4A, #2A3F66);
            color: white;
            border-bottom-right-radius: 4px;
        }
        
        .message.bot .bubble {
            background: white;
            color: #1a1a2e;
            border-bottom-left-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        
        .message .bubble a {
            color: #1A2B4A;
            text-decoration: underline;
            font-weight: 600;
        }
        
        .message .time {
            font-size: 10px;
            color: #999;
            margin: 4px 8px 0 8px;
            opacity: 0.7;
        }
        
        .message.user .time {
            text-align: right;
        }
        
        /* Typing Indicator */
        .typing-indicator {
            display: none;
            padding: 12px 20px;
            background: white;
            border-radius: 18px;
            border-bottom-left-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            align-self: flex-start;
        }
        
        .typing-indicator.active {
            display: inline-block;
            animation: slideIn 0.3s ease;
        }
        
        .typing-indicator span {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #999;
            margin: 0 3px;
            animation: typingBounce 1.5s infinite;
        }
        
        .typing-indicator span:nth-child(2) {
            animation-delay: 0.2s;
        }
        
        .typing-indicator span:nth-child(3) {
            animation-delay: 0.4s;
        }
        
        @keyframes typingBounce {
            0%, 60%, 100% { transform: translateY(0); background: #999; }
            30% { transform: translateY(-8px); background: #1A2B4A; }
        }
        
        /* Quick Actions */
        .quick-actions {
            padding: 10px 18px;
            background: #f8f9fa;
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            border-top: 1px solid #e8eaed;
            flex-shrink: 0;
        }
        
        .quick-actions button {
            padding: 6px 16px;
            border: 1px solid #dde1e6;
            border-radius: 20px;
            background: white;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.25s;
            font-family: inherit;
            color: #1A2B4A;
            font-weight: 500;
            white-space: nowrap;
        }
        
        .quick-actions button:hover {
            background: #1A2B4A;
            color: white;
            border-color: #1A2B4A;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(26, 43, 74, 0.25);
        }
        
        .quick-actions button:active {
            transform: translateY(0);
        }
        
        /* Input Area */
        .input-area {
            padding: 14px 18px;
            background: white;
            border-top: 1px solid #e8eaed;
            display: flex;
            gap: 10px;
            align-items: center;
            flex-shrink: 0;
        }
        
        .input-area input {
            flex: 1;
            padding: 12px 18px;
            border: 2px solid #e0e4ea;
            border-radius: 25px;
            font-size: 15px;
            font-family: inherit;
            outline: none;
            transition: all 0.3s;
            background: #f8f9fa;
            color: #1a1a2e;
        }
        
        .input-area input:focus {
            border-color: #1A2B4A;
            background: white;
            box-shadow: 0 0 0 4px rgba(26, 43, 74, 0.1);
        }
        
        .input-area input::placeholder {
            color: #a0a5b0;
        }
        
        .input-area input:disabled {
            opacity: 0.6;
        }
        
        .input-area .send-btn {
            width: 50px;
            height: 50px;
            border: none;
            border-radius: 50%;
            background: linear-gradient(135deg, #1A2B4A, #2A3F66);
            color: white;
            font-size: 22px;
            cursor: pointer;
            transition: all 0.25s;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            box-shadow: 0 4px 15px rgba(26, 43, 74, 0.3);
        }
        
        .input-area .send-btn:hover {
            transform: scale(1.06);
            box-shadow: 0 6px 25px rgba(26, 43, 74, 0.4);
        }
        
        .input-area .send-btn:active {
            transform: scale(0.92);
        }
        
        .input-area .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
        }
        
        /* Loading overlay */
        .loading-overlay {
            display: none;
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(255,255,255,0.85);
            backdrop-filter: blur(4px);
            z-index: 1000;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            gap: 20px;
            border-radius: 30px;
        }
        
        .loading-overlay.active {
            display: flex;
        }
        
        .loading-overlay .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid #e0e4ea;
            border-top: 4px solid #1A2B4A;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .loading-overlay p {
            color: #1A2B4A;
            font-size: 18px;
            font-weight: 600;
        }
        
        /* Responsive */
        @media (max-width: 500px) {
            body {
                padding: 0;
            }
            .chat-container {
                height: 100vh;
                max-height: 100vh;
                border-radius: 0;
            }
            .loading-overlay {
                border-radius: 0;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <!-- Loading Overlay -->
        <div class="loading-overlay" id="loadingOverlay">
            <div class="spinner"></div>
            <p>⏳ جاري التحميل...</p>
        </div>
        
        <!-- Header -->
        <div class="chat-header">
            <div class="avatar">ب</div>
            <div class="info">
                <h3>🤖 سوداني بوت</h3>
                <p>
                    <span class="dot"></span>
                    متصل الآن
                    <span class="badge">v2.0</span>
                </p>
            </div>
        </div>
        
        <!-- Status -->
        <div class="status-bar">
            ⚡ مساعدك الذكي لخدمات سوداني | ${new Date().toLocaleDateString('ar-SD')}
        </div>
        
        <!-- Messages -->
        <div class="messages-area" id="messagesArea">
            <!-- رسالة ترحيب -->
            <div class="message bot">
                <div class="bubble">
                    👋 أهلاً وسهلاً! أنا <strong>سوداني بوت</strong>، مساعدك الذكي.<br><br>
                    📱 اسألني عن:<br>
                    • باقات الإنترنت والنت<br>
                    • الرصيد والشحن<br>
                    • سوداني كاش<br>
                    • أي خدمة من خدمات سوداني<br><br>
                    💬 <strong>تحدث معي باللهجة السودانية!</strong>
                </div>
                <span class="time">الآن</span>
            </div>
        </div>
        
        <!-- Quick Actions -->
        <div class="quick-actions">
            <button onclick="sendQuickMessage('عايز باقة نت')">📱 باقة نت</button>
            <button onclick="sendQuickMessage('رصيدي خلص')">💰 الرصيد</button>
            <button onclick="sendQuickMessage('كيف أشحن؟')">💳 شحن</button>
            <button onclick="sendQuickMessage('سوداني كاش')">💵 كاش</button>
            <button onclick="sendQuickMessage('عايز أعرف رصيدي')">📊 استعلام</button>
        </div>
        
        <!-- Input -->
        <div class="input-area">
            <input 
                type="text" 
                id="messageInput" 
                placeholder="✍️ اكتب سؤالك هنا..."
                onkeydown="if(event.key === 'Enter') sendMessage()"
                autofocus
            >
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
        </div>
    </div>

    <script>
        // ============================================
        // 🔗 API URL - يتكيف تلقائياً مع البيئة
        // ============================================
        const API_URL = window.location.origin; // يستخدم الرابط الحالي تلقائياً
        
        const messagesArea = document.getElementById('messagesArea');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const loadingOverlay = document.getElementById('loadingOverlay');
        
        let isProcessing = false;
        
        // ============================================
        // 📝 وظائف المساعد
        // ============================================
        
        // إظهار مؤشر الكتابة
        function showTyping() {
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message bot';
            typingDiv.id = 'typingIndicator';
            typingDiv.innerHTML = \`
                <div class="typing-indicator active">
                    <span></span>
                    <span></span>
                    <span></span>
                </div>
            \`;
            messagesArea.appendChild(typingDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
        
        // إخفاء مؤشر الكتابة
        function hideTyping() {
            const typing = document.getElementById('typingIndicator');
            if (typing) typing.remove();
        }
        
        // إضافة رسالة
        function addMessage(text, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = \`message \${isUser ? 'user' : 'bot'}\`;
            
            const now = new Date();
            const time = now.toLocaleTimeString('ar-SD', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            // تحويل النص لدعم الروابط
            const formattedText = text.replace(
                /\\*(\\d+#)/g, 
                '<a href="tel:$1" style="color: #1A2B4A; font-weight: bold;">*$1</a>'
            );
            
            messageDiv.innerHTML = \`
                <div class="bubble">\${formattedText}</div>
                <span class="time">\${time}</span>
            \`;
            
            messagesArea.appendChild(messageDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }
        
        // ============================================
        // 💬 إرسال رسالة
        // ============================================
        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message || isProcessing) return;
            
            isProcessing = true;
            messageInput.disabled = true;
            sendBtn.disabled = true;
            
            // إضافة رسالة المستخدم
            addMessage(message, true);
            messageInput.value = '';
            
            // إظهار مؤشر الكتابة
            showTyping();
            
            try {
                // إرسال إلى API
                const response = await fetch(\`\${API_URL}/api/chat/message\`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        message: message,
                        userId: 'web_user_' + Date.now()
                    })
                });
                
                const data = await response.json();
                
                // إخفاء مؤشر الكتابة
                hideTyping();
                
                // عرض رد البوت
                if (data.success) {
                    addMessage(data.response, false);
                    
                    // عرض الاقتراحات إن وجدت
                    if (data.suggestions && data.suggestions.length > 0) {
                        setTimeout(() => {
                            const suggestionsText = '💡 اقتراحات: ' + data.suggestions.join(' • ');
                            addMessage(suggestionsText, false);
                        }, 500);
                    }
                } else {
                    addMessage('❌ عذراً، حدث خطأ. حاول مرة أخرى.', false);
                }
                
            } catch (error) {
                hideTyping();
                addMessage('❌ لا يمكن الاتصال بالسيرفر. تأكد من اتصالك بالإنترنت.', false);
                console.error('Error:', error);
            }
            
            isProcessing = false;
            messageInput.disabled = false;
            sendBtn.disabled = false;
            messageInput.focus();
        }
        
        // ============================================
        // ⚡ إرسال رسالة سريعة
        // ============================================
        function sendQuickMessage(text) {
            messageInput.value = text;
            sendMessage();
        }
        
        // ============================================
        // 🎯 رسالة ترحيب إضافية
        // ============================================
        setTimeout(() => {
            addMessage('💬 كيف أقدر أساعدك اليوم؟', false);
        }, 800);
        
        // ============================================
        // ⌨️ اختصارات لوحة المفاتيح
        // ============================================
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                messageInput.blur();
            }
        });
        
        // ============================================
        // 📱 تحسين للتطبيقات
        // ============================================
        console.log('🤖 سوداني بوت يعمل بنجاح!');
        console.log('📍 API URL:', API_URL);
        console.log('💬 مرحباً بك في المساعد الذكي لسوداني');
    </script>
</body>
</html>
  `);
});

// نقطة الصحة
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Sudani AI Assistant',
    version: '2.0.0',
    environment: process.env.NODE_ENV || 'development'
  });
});

// بدء السيرفر
app.listen(PORT, () => {
  console.log('=================================');
  console.log('🚀 Sudani AI Assistant Server');
  console.log('=================================');
  console.log(\`✅ Server running on port: \${PORT}\`);
  console.log(\`🌐 URL: http://localhost:\${PORT}\`);
  console.log(\`📊 Health Check: http://localhost:\${PORT}/health\`);
  console.log('=================================');
  console.log('💡 Ready to serve Sudanese users!');
  console.log('=================================');
});

// معالجة إشارات الإيقاف
process.on('SIGINT', () => {
  console.log('\\n👋 Shutting down server gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  process.exit(1);
});
