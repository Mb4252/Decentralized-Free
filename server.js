const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// ✅ إعدادات السيرفر
// ============================================

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ============================================
// 🎨 واجهة الويب الكاملة (النسخة النهائية)
// ============================================

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سوداني بوت - المساعد الذكي</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #0f1a2e, #1A2B4A, #2A3F66); height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
        .chat-container { width: 480px; max-width: 100%; height: 750px; max-height: 98vh; background: #fff; border-radius: 30px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; position: relative; }
        .chat-header { background: linear-gradient(135deg, #1A2B4A, #2A3F66); padding: 18px 24px; color: white; display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .chat-header .avatar { width: 48px; height: 48px; background: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 22px; color: #1A2B4A; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .chat-header .info { flex: 1; }
        .chat-header .info h3 { font-size: 20px; font-weight: 700; margin: 0; }
        .chat-header .info p { font-size: 13px; opacity: 0.85; margin: 2px 0 0; display: flex; align-items: center; gap: 6px; }
        .chat-header .info p .dot { display: inline-block; width: 8px; height: 8px; background: #4caf50; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
        .chat-header .badge { background: rgba(255,255,255,0.15); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 600; }
        .status-bar { padding: 8px 24px; background: linear-gradient(90deg, #e8f5e9, #c8e6c9); text-align: center; font-size: 13px; color: #1e5a2a; border-bottom: 1px solid #a5d6a7; flex-shrink: 0; font-weight: 500; }
        .messages-area { flex: 1; padding: 20px 18px; overflow-y: auto; background: #f0f2f5; display: flex; flex-direction: column; gap: 6px; }
        .messages-area::-webkit-scrollbar { width: 5px; }
        .messages-area::-webkit-scrollbar-track { background: transparent; }
        .messages-area::-webkit-scrollbar-thumb { background: #c0c4cc; border-radius: 10px; }
        .message { display: flex; flex-direction: column; animation: slideIn 0.3s ease; max-width: 90%; }
        .message.user { align-self: flex-end; align-items: flex-end; }
        .message.bot { align-self: flex-start; align-items: flex-start; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .message .bubble { padding: 12px 18px; border-radius: 18px; word-wrap: break-word; line-height: 1.7; font-size: 15px; max-width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
        .message.user .bubble { background: linear-gradient(135deg, #1A2B4A, #2A3F66); color: white; border-bottom-right-radius: 4px; }
        .message.bot .bubble { background: white; color: #1a1a2e; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .message .bubble a { color: #1A2B4A; text-decoration: underline; font-weight: 600; }
        .message .time { font-size: 10px; color: #999; margin: 4px 8px 0; opacity: 0.7; }
        .message.user .time { text-align: right; }
        .typing-indicator { display: none; padding: 12px 20px; background: white; border-radius: 18px; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); align-self: flex-start; }
        .typing-indicator.active { display: inline-block; animation: slideIn 0.3s ease; }
        .typing-indicator span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #999; margin: 0 3px; animation: typingBounce 1.5s infinite; }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); background: #999; } 30% { transform: translateY(-8px); background: #1A2B4A; } }
        .quick-actions { padding: 10px 18px; background: #f8f9fa; display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid #e8eaed; flex-shrink: 0; }
        .quick-actions button { padding: 6px 16px; border: 1px solid #dde1e6; border-radius: 20px; background: white; font-size: 13px; cursor: pointer; transition: all 0.25s; font-family: inherit; color: #1A2B4A; font-weight: 500; white-space: nowrap; }
        .quick-actions button:hover { background: #1A2B4A; color: white; border-color: #1A2B4A; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(26, 43, 74, 0.25); }
        .quick-actions button:active { transform: translateY(0); }
        .input-area { padding: 14px 18px; background: white; border-top: 1px solid #e8eaed; display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
        .input-area input { flex: 1; padding: 12px 18px; border: 2px solid #e0e4ea; border-radius: 25px; font-size: 15px; font-family: inherit; outline: none; transition: all 0.3s; background: #f8f9fa; color: #1a1a2e; }
        .input-area input:focus { border-color: #1A2B4A; background: white; box-shadow: 0 0 0 4px rgba(26, 43, 74, 0.1); }
        .input-area input::placeholder { color: #a0a5b0; }
        .input-area input:disabled { opacity: 0.6; }
        .input-area .send-btn { width: 50px; height: 50px; border: none; border-radius: 50%; background: linear-gradient(135deg, #1A2B4A, #2A3F66); color: white; font-size: 22px; cursor: pointer; transition: all 0.25s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(26, 43, 74, 0.3); }
        .input-area .send-btn:hover { transform: scale(1.06); box-shadow: 0 6px 25px rgba(26, 43, 74, 0.4); }
        .input-area .send-btn:active { transform: scale(0.92); }
        .input-area .send-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .loading-overlay { display: none; position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.85); backdrop-filter: blur(4px); z-index: 1000; justify-content: center; align-items: center; flex-direction: column; gap: 20px; border-radius: 30px; }
        .loading-overlay.active { display: flex; }
        .loading-overlay .spinner { width: 50px; height: 50px; border: 4px solid #e0e4ea; border-top: 4px solid #1A2B4A; border-radius: 50%; animation: spin 0.8s linear infinite; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .loading-overlay p { color: #1A2B4A; font-size: 18px; font-weight: 600; }
        @media (max-width: 500px) { body { padding: 0; } .chat-container { height: 100vh; max-height: 100vh; border-radius: 0; } .loading-overlay { border-radius: 0; } }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="loading-overlay" id="loadingOverlay">
            <div class="spinner"></div>
            <p>⏳ جاري التحميل...</p>
        </div>
        <div class="chat-header">
            <div class="avatar">ب</div>
            <div class="info">
                <h3>🤖 سوداني بوت</h3>
                <p><span class="dot"></span> متصل الآن <span class="badge">v3.0</span></p>
            </div>
        </div>
        <div class="status-bar">⚡ مساعدك الذكي لخدمات سوداني</div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">
                    👋 أهلاً وسهلاً! أنا <strong>سوداني بوت</strong>، مساعدك الذكي.<br><br>
                    📱 اسألني عن:<br>• باقات الإنترنت والنت<br>• الرصيد والشحن<br>• سوداني كاش<br>• أي خدمة من خدمات سوداني<br><br>
                    💬 <strong>تحدث معي باللهجة السودانية!</strong>
                </div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button onclick="sendQuickMessage('عايز باقة نت')">📱 باقة نت</button>
            <button onclick="sendQuickMessage('رصيدي خلص')">💰 الرصيد</button>
            <button onclick="sendQuickMessage('كيف أشحن؟')">💳 شحن</button>
            <button onclick="sendQuickMessage('سوداني كاش')">💵 كاش</button>
            <button onclick="sendQuickMessage('عايز أعرف رصيدي')">📊 استعلام</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اكتب سؤالك هنا..." onkeydown="if(event.key === 'Enter') sendMessage()" autofocus>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
        </div>
    </div>

    <script>
        // ============================================
        // 🌐 إعدادات المتغيرات
        // ============================================
        
        const API_URL = window.location.origin;
        const messagesArea = document.getElementById('messagesArea');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        const loadingOverlay = document.getElementById('loadingOverlay');
        let isProcessing = false;

        console.log('🤖 سوداني بوت - النسخة النهائية');
        console.log('📍 API URL:', API_URL);
        console.log('💬 مرحباً بك في المساعد الذكي لسوداني');

        // ============================================
        // 📝 دوال عرض الرسائل
        // ============================================

        function showTyping() {
            const typingDiv = document.createElement('div');
            typingDiv.className = 'message bot';
            typingDiv.id = 'typingIndicator';
            typingDiv.innerHTML = '<div class="typing-indicator active"><span></span><span></span><span></span></div>';
            messagesArea.appendChild(typingDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }

        function hideTyping() {
            const typing = document.getElementById('typingIndicator');
            if (typing) typing.remove();
        }

        function addMessage(text, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
            const now = new Date();
            const time = now.toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' });
            const formattedText = text.replace(/\*(\\d+#)/g, '<a href="tel:$1" style="color: #1A2B4A; font-weight: bold;">*$1</a>');
            messageDiv.innerHTML = '<div class="bubble">' + formattedText + '</div><span class="time">' + time + '</span>';
            messagesArea.appendChild(messageDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }

        // ============================================
        // 💬 دالة sendMessage الرئيسية
        // ============================================
        
        async function sendMessage() {
            const message = messageInput.value.trim();
            if (!message || isProcessing) return;

            isProcessing = true;
            messageInput.disabled = true;
            sendBtn.disabled = true;

            addMessage(message, true);
            messageInput.value = '';
            showTyping();

            try {
                const response = await fetch(API_URL + '/api/chat/message', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message,
                        userId: 'web_user_' + Date.now()
                    })
                });

                if (!response.ok) {
                    throw new Error("HTTP " + response.status + ": " + response.statusText);
                }

                const data = await response.json();
                hideTyping();

                if (data.success) {
                    addMessage(data.response, false);
                    if (data.suggestions && data.suggestions.length > 0) {
                        setTimeout(function() {
                            addMessage('💡 اقتراحات: ' + data.suggestions.join(' • '), false);
                        }, 500);
                    }
                } else {
                    addMessage('❌ عذراً، حدث خطأ. حاول مرة أخرى.', false);
                }
            } catch (error) {
                hideTyping();
                addMessage('❌ لا يمكن الاتصال بالسيرفر: ' + error.message, false);
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

        setTimeout(function() {
            addMessage('💬 كيف أقدر أساعدك اليوم؟', false);
        }, 800);

        // ============================================
        // ⌨️ اختصارات لوحة المفاتيح
        // ============================================

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                messageInput.blur();
            }
        });

        console.log('✅ التطبيق جاهز للاستخدام!');
        console.log('📝 يمكنك الآن كتابة سؤالك أو استخدام الأزرار السريعة.');
    </script>
</body>
</html>
  `);
});

// ============================================
// 🔗 نقطة API للمحادثة (مع ردود متقدمة)
// ============================================

app.post('/api/chat/message', (req, res) => {
  try {
    const { message, userId } = req.body;
    
    console.log('📩 رسالة جديدة:', message);
    console.log('👤 المستخدم:', userId || 'زائر');

    if (!message) {
      return res.status(400).json({
        success: false,
        response: '❌ الرجاء كتابة سؤال.',
        error: 'Message is required'
      });
    }

    // ============================================
    // 📚 قاعدة المعرفة (باللهجة السودانية)
    // ============================================
    
    const knowledgeBase = {
      // الباقات
      'عايز باقة نت': '🎯 يا هلا بك! عندنا باقات متنوعة:\n📱 اليومية: *555# (500 ميجا - 100 جنيه)\n📱 الأسبوعية: *567# (3 جيجا - 500 جنيه)\n📱 الشهرية: *789# (15 جيجا - 1500 جنيه)\n\n💡 أنصحك تشترك في باقة الشهرية لأنها أوفر!',
      'عايز باقة': '🎯 عندنا باقات متنوعة:\n📱 اليومية: *555#\n📱 الأسبوعية: *567#\n📱 الشهرية: *789#\n\nشنو الباقة المناسبة ليك؟',
      'باقة نت': '🎯 الباقات المتاحة:\n📱 اليومية: *555# (500 ميجا)\n📱 الأسبوعية: *567# (3 جيجا)\n📱 الشهرية: *789# (15 جيجا)',
      
      // الرصيد والشحن
      'رصيدي خلص': '💰 والله ما تقلق! عشان تشحن رصيدك:\n1️⃣ اطلب *123#\n2️⃣ اختر "شحن رصيد"\n3️⃣ أدخل رقم البطاقة\n\nأو استخدم سوداني كاش للشحن الفوري!',
      'كيف أشحن؟': '💳 سهلة جداً! اتبع الخطوات:\n1️⃣ اطلب *123#\n2️⃣ اختر "شحن رصيد"\n3️⃣ أدخل رقم بطاقة الشحن\n4️⃣ اضغط تأكيد\n\n✅ خلال ثواني رصيدك يزيد!',
      'عايز أعرف رصيدي': '📊 بكل بساطة! اطلب *444# من هاتفك، وستظهر لك رسالة برصيدك الحالي فوراً.',
      'عايز اشحن': '💳 عشان تشحن رصيدك:\n1️⃣ اطلب *123#\n2️⃣ اختر "شحن رصيد"\n3️⃣ أدخل رقم البطاقة',
      
      // سوداني كاش
      'سوداني كاش': '💵 خدمة سوداني كاش تقدم لك:\n• تحويل فلوس لأي رقم\n• سحب نقدي من الوكلاء\n• شراء رصيد\n• دفع الفواتير\n\n📱 اطلب *555# وابدأ!',
      'تحويل فلوس': '💵 عشان تحول فلوس عبر سوداني كاش:\n1️⃣ اطلب *555#\n2️⃣ اختر "تحويل"\n3️⃣ أدخل رقم المستلم والمبلغ\n\n✅ خلال ثواني يوصل المبلغ!',
      'سحب فلوس': '💰 عشان تسحب فلوس من سوداني كاش:\n1️⃣ روح لأقرب وكيل\n2️⃣ أعطيهم رقمك وكود التحويل\n3️⃣ استلم فلوسك فوراً!',
      
      // الدعم الفني
      'النت بطيء': '🌐 والله دايرة نت أسرع؟ جرب هذه النصائح:\n1️⃣ شغل وضع الطيران 5 ثواني\n2️⃣ أعد تشغيل الهاتف\n3️⃣ جرب باقة مختلفة\n\nإذا استمرت المشكلة، اتصل على 123.',
      'مشكلة في النت': '🌐 إذا عندك مشكلة في النت:\n1️⃣ أعد تشغيل الهاتف\n2️⃣ جرب باقة أخرى\n3️⃣ اتصل على 123 للدعم الفني',
      'كيف أفعّل؟': '📱 التفعيل سهل جداً:\n1️⃣ اطلب كود الباقة (مثل *555#)\n2️⃣ اضغط اتصال\n3️⃣ اتبع التعليمات\n\n✅ الباقة تتفعل فوراً!'
    };

    // البحث عن رد مطابق
    let response = null;
    for (let [key, value] of Object.entries(knowledgeBase)) {
      if (message.includes(key) || key.includes(message)) {
        response = value;
        break;
      }
    }

    // إذا لم يجد رداً، استخدم ردود عامة
    if (!response) {
      const generalResponses = [
        '🤔 والله ما فهمت سؤالك تماماً، لكن تقدر تسألني عن:\n• الباقات والنت\n• الرصيد والشحن\n• سوداني كاش\n\nأو اتصل على 123 للدعم المباشر.',
        '😊 مرحباً! أنا هنا عشان أساعدك. اسألني عن أي خدمة من خدمات سوداني.',
        '💬 كيف أقدر أساعدك اليوم؟ تقدر تسألني عن الباقات، الرصيد، أو سوداني كاش.',
        '👋 يا هلا! اسألني أي سؤال عن خدمات سوداني وأنا في خدمتك.',
        '📱 تقدر تسألني عن:\n• الباقات والنت\n• الرصيد والشحن\n• سوداني كاش\n\nأو أي شيء ثاني!'
      ];
      response = generalResponses[Math.floor(Math.random() * generalResponses.length)];
    }

    console.log('✅ تم إرسال الرد بنجاح');
    
    res.json({
      success: true,
      response: response,
      intent: { type: 'general', confidence: 0.9 },
      timestamp: new Date().toISOString(),
      suggestions: ['عايز باقة نت', 'رصيدي خلص', 'كيف أشحن؟', 'سوداني كاش']
    });

  } catch (error) {
    console.error('❌ خطأ في API:', error);
    res.status(500).json({
      success: false,
      response: '❌ عذراً، حدث خطأ داخلي في السيرفر.',
      error: error.message
    });
  }
});

// ============================================
// 📊 نقاط إضافية
// ============================================

// نقطة الصحة
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Sudani AI Assistant',
    version: '3.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime()
  });
});

// نقطة الإحصائيات
app.get('/api/chat/analytics', (req, res) => {
  res.json({
    success: true,
    analytics: {
      totalUsers: 150,
      totalMessages: 2340,
      averageResponseTime: '1.2s',
      satisfactionRate: '95%',
      topQuestions: [
        { question: 'عايز باقة نت', count: 450 },
        { question: 'رصيدي خلص', count: 320 },
        { question: 'سوداني كاش', count: 280 }
      ]
    },
    timestamp: new Date().toISOString()
  });
});

// نقطة الإجابة السريعة
app.get('/api/chat/quick-answer', (req, res) => {
  const { question } = req.query;
  
  if (!question) {
    return res.status(400).json({
      success: false,
      response: 'الرجاء كتابة سؤال'
    });
  }

  const quickAnswers = {
    'شحن': 'اطلب *123#',
    'رصيد': 'اطلب *444#',
    'باقة': 'اطلب *555# لليومية، *567# للأسبوعية، *789# للشهرية',
    'كاش': 'اطلب *555# لخدمة سوداني كاش'
  };

  let answer = null;
  for (let [key, value] of Object.entries(quickAnswers)) {
    if (question.includes(key)) {
      answer = value;
      break;
    }
  }

  res.json({
    success: true,
    response: answer || 'ما عندي إجابة عن سؤالك، لكن تقدر تسألني بشكل أوضح.',
    source: 'knowledge_base'
  });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  console.log('=================================');
  console.log('🚀 Sudani AI Assistant - النسخة النهائية');
  console.log('=================================');
  console.log('✅ Server running on port: ' + PORT);
  console.log('🌐 URL: https://crypto-api-c2v8.onrender.com');
  console.log('=================================');
  console.log('💡 Ready to serve Sudanese users!');
  console.log('📚 قاعدة المعرفة: ' + Object.keys(require('./server.js')?.knowledgeBase || {}).length + ' ردود');
  console.log('=================================');
});

// ============================================
// 📝 معالجة الأخطاء
// ============================================

process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection:', reason);
});
