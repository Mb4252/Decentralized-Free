const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');

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
// 🤖 إعداد OpenAI
// ============================================

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// ============================================
// 🎨 واجهة الويب (مع أزرار تعمل 100%)
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
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #0a1628, #1A2B4A, #2A3F66); height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
        .chat-container { width: 480px; max-width: 100%; height: 750px; max-height: 98vh; background: #fff; border-radius: 30px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; position: relative; }
        .chat-header { background: linear-gradient(135deg, #0a1628, #1A2B4A); padding: 18px 24px; color: white; display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .chat-header .avatar { width: 48px; height: 48px; background: #f7931e; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 22px; color: #1A2B4A; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .chat-header .info { flex: 1; }
        .chat-header .info h3 { font-size: 20px; font-weight: 700; margin: 0; color: #f7931e; }
        .chat-header .info p { font-size: 13px; opacity: 0.85; margin: 2px 0 0; display: flex; align-items: center; gap: 6px; }
        .chat-header .info p .dot { display: inline-block; width: 8px; height: 8px; background: #4caf50; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.5; transform: scale(0.8); } }
        .chat-header .badge { background: #f7931e; color: #1A2B4A; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; }
        .status-bar { padding: 8px 24px; background: linear-gradient(90deg, #f7931e, #f5a623); text-align: center; font-size: 13px; color: #1A2B4A; border-bottom: 1px solid #e88a1a; flex-shrink: 0; font-weight: 700; }
        .status-bar .ai-badge { background: #1A2B4A; color: #f7931e; padding: 2px 12px; border-radius: 12px; font-size: 11px; margin-left: 8px; }
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
        .message.bot .bubble { background: white; color: #1a1a2e; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-right: 4px solid #f7931e; }
        .message.bot .bubble .ai-tag { font-size: 10px; color: #f7931e; display: block; margin-top: 6px; border-top: 1px solid #eee; padding-top: 6px; font-weight: 600; }
        .message .bubble a { color: #1A2B4A; text-decoration: underline; font-weight: 600; }
        .message .time { font-size: 10px; color: #999; margin: 4px 8px 0; opacity: 0.7; }
        .message.user .time { text-align: right; }
        .typing-indicator { display: none; padding: 12px 20px; background: white; border-radius: 18px; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); align-self: flex-start; border-right: 4px solid #f7931e; }
        .typing-indicator.active { display: inline-block; animation: slideIn 0.3s ease; }
        .typing-indicator span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #999; margin: 0 3px; animation: typingBounce 1.5s infinite; }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); background: #999; } 30% { transform: translateY(-8px); background: #f7931e; } }
        .quick-actions { padding: 10px 18px; background: #f8f9fa; display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid #e8eaed; flex-shrink: 0; }
        .quick-actions button { padding: 8px 16px; border: 2px solid #1A2B4A; border-radius: 20px; background: white; font-size: 13px; cursor: pointer; transition: all 0.25s; font-family: inherit; color: #1A2B4A; font-weight: 600; white-space: nowrap; }
        .quick-actions button:hover { background: #1A2B4A; color: #f7931e; border-color: #f7931e; transform: translateY(-2px); box-shadow: 0 4px 12px rgba(26, 43, 74, 0.3); }
        .quick-actions button:active { transform: translateY(0); }
        .input-area { padding: 14px 18px; background: white; border-top: 1px solid #e8eaed; display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
        .input-area input { flex: 1; padding: 12px 18px; border: 2px solid #e0e4ea; border-radius: 25px; font-size: 15px; font-family: inherit; outline: none; transition: all 0.3s; background: #f8f9fa; color: #1a1a2e; }
        .input-area input:focus { border-color: #f7931e; background: white; box-shadow: 0 0 0 4px rgba(247, 147, 30, 0.1); }
        .input-area input::placeholder { color: #a0a5b0; }
        .input-area input:disabled { opacity: 0.6; }
        .input-area .send-btn { width: 50px; height: 50px; border: none; border-radius: 50%; background: linear-gradient(135deg, #f7931e, #f5a623); color: #1A2B4A; font-size: 22px; cursor: pointer; transition: all 0.25s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 15px rgba(247, 147, 30, 0.4); font-weight: 700; }
        .input-area .send-btn:hover { transform: scale(1.06); box-shadow: 0 6px 25px rgba(247, 147, 30, 0.5); }
        .input-area .send-btn:active { transform: scale(0.92); }
        .input-area .send-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        @media (max-width: 500px) { body { padding: 0; } .chat-container { height: 100vh; max-height: 100vh; border-radius: 0; } }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سوداني بوت</h3>
                <p><span class="dot"></span> متصل الآن <span class="badge">AI v3.0</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="ai-badge">🧠 AI</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">
                    👋 أهلاً وسهلاً بك في <strong>سوداني بوت</strong>!<br><br>
                    🤖 أنا مساعدك الذكي المدعوم بالذكاء الاصطناعي.<br><br>
                    📱 أقدم لك خدمات <strong>شركة سوداني</strong> فقط:<br>
                    • باقات الإنترنت والنت<br>
                    • الرصيد والشحن<br>
                    • سوداني كاش<br>
                    • العروض والخدمات<br><br>
                    💬 <strong>تحدث معي باللهجة السودانية!</strong>
                    <span class="ai-tag">🧠 رد من الذكاء الاصطناعي</span>
                </div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button id="btnNet">📱 باقة نت</button>
            <button id="btnBalance">💰 الرصيد</button>
            <button id="btnRecharge">💳 شحن</button>
            <button id="btnCash">💵 كاش</button>
            <button id="btnOffers">🎁 عروض</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اكتب سؤالك هنا..." autofocus>
            <button class="send-btn" id="sendBtn">➤</button>
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
        let isProcessing = false;

        console.log('🤖 سوداني بوت - النسخة النهائية');
        console.log('📍 API URL:', API_URL);

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

        function addMessage(text, isUser, isAI = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
            const now = new Date();
            const time = now.toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' });
            
            let formattedText = text.replace(/\*(\\d+#)/g, '<a href="tel:$1" style="color: #1A2B4A; font-weight: bold;">*$1</a>');
            
            if (isAI && !isUser) {
                formattedText += '<span class="ai-tag">🧠 رد من الذكاء الاصطناعي</span>';
            }
            
            messageDiv.innerHTML = '<div class="bubble">' + formattedText + '</div><span class="time">' + time + '</span>';
            messagesArea.appendChild(messageDiv);
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }

        // ============================================
        // 💬 دالة sendMessage الرئيسية (تعمل 100%)
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
                    addMessage(data.response, false, true);
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
        // ⚡ إرسال رسالة سريعة (تعمل 100%)
        // ============================================

        function sendQuickMessage(text) {
            messageInput.value = text;
            sendMessage();
        }

        // ============================================
        // 🔧 جعل الدوال متاحة عالمياً
        // ============================================

        // تعريف الدوال في النطاق العالمي
        window.sendMessage = sendMessage;
        window.sendQuickMessage = sendQuickMessage;

        // ============================================
        // 🎯 إعداد الأزرار باستخدام Event Listeners
        // ============================================

        document.addEventListener('DOMContentLoaded', function() {
            // تعيين الأزرار السريعة
            const buttonMessages = {
                'btnNet': 'عايز باقة نت سوداني',
                'btnBalance': 'رصيدي خلص سوداني',
                'btnRecharge': 'كيف أشحن سوداني؟',
                'btnCash': 'سوداني كاش',
                'btnOffers': 'عروض سوداني الجديدة'
            };

            // إضافة مستمعات للأزرار
            Object.keys(buttonMessages).forEach(buttonId => {
                const button = document.getElementById(buttonId);
                if (button) {
                    button.addEventListener('click', function() {
                        const message = buttonMessages[buttonId];
                        messageInput.value = message;
                        sendMessage();
                    });
                }
            });

            // إضافة مستمع لزر الإرسال
            if (sendBtn) {
                sendBtn.addEventListener('click', sendMessage);
            }

            // إضافة مستمع لحقل الإدخال (Enter)
            if (messageInput) {
                messageInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        sendMessage();
                    }
                });
            }

            console.log('✅ تم إعداد جميع الأزرار والمستمعات');
        });

        // ============================================
        // ✅ اختبار الاتصال عند التحميل
        // ============================================

        async function testServerConnection() {
            try {
                const response = await fetch(API_URL + '/health');
                if (response.ok) {
                    console.log('✅ السيرفر يعمل بشكل جيد');
                } else {
                    console.warn('⚠️ السيرفر يعمل ولكن قد تكون هناك مشكلة');
                }
            } catch (error) {
                console.error('❌ لا يمكن الاتصال بالسيرفر:', error);
                setTimeout(() => {
                    addMessage('⚠️ تحذير: لا يمكن الاتصال بالسيرفر. تأكد من تشغيل السيرفر.', false);
                }, 2000);
            }
        }

        // تنفيذ اختبار الاتصال بعد تحميل الصفحة
        setTimeout(testServerConnection, 1000);

        // ============================================
        // 🎯 رسالة ترحيب إضافية
        // ============================================

        setTimeout(function() {
            addMessage('💬 اسألني عن أي خدمة من خدمات سوداني!', false);
        }, 1500);

        console.log('✅ التطبيق جاهز للاستخدام مع الذكاء الاصطناعي!');
        console.log('📱 اسأل عن باقات سوداني، الرصيد، سوداني كاش، والعروض');
    </script>
</body>
</html>
  `);
});

// ============================================
// 🤖 دالة الرد من OpenAI (مخصصة لسوداني فقط)
// ============================================

async function getAIResponse(userMessage) {
    try {
        console.log('🧠 جاري الاتصال بـ OpenAI...');
        console.log('📩 الرسالة:', userMessage);
        
        const completion = await openai.chat.completions.create({
            model: 'gpt-4-turbo-preview',
            messages: [
                {
                    role: 'system',
                    content: `أنت مساعد ذكي رسمي لشركة "سوداني" للاتصالات في السودان.

                    🔴 مهم جداً: أنت متخصص فقط في شركة سوداني. لا تقدم معلومات عن أي شركة أخرى (زين، MTN، إلخ).

                    هويتك:
                    - اسمك "سوداني بوت"
                    - تتحدث باللهجة السودانية البيضاء (واضحة ومفهومة للجميع)
                    - أنت ودود، صبور، ومحترم (استخدم: "يا هلا", "حبيبي", "أهلاً وسهلاً")
                    - لونك البرتقالي (لون سوداني) 🟠

                    خدمات سوداني التي تعرفها بالتفصيل:

                    1. باقات الإنترنت (الصحيحة لسوداني):
                    - باقة اليومية 500 ميجا: *555# (100 جنيه)
                    - باقة اليومية 1 جيجا: *556# (200 جنيه)
                    - باقة الأسبوعية 3 جيجا: *567# (500 جنيه)
                    - باقة الأسبوعية 5 جيجا: *568# (800 جنيه)
                    - باقة الشهرية 15 جيجا: *789# (1500 جنيه)
                    - باقة الشهرية 30 جيجا: *790# (2500 جنيه)
                    - باقة التواصل الاجتماعي: *666# (300 جنيه - غير محدود لفيسبوك، واتساب، تيك توك)

                    2. خدمات الرصيد والشحن:
                    - شحن الرصيد: *123#
                    - معرفة الرصيد: *444#
                    - تجديد الباقة تلقائياً: *777#

                    3. سوداني كاش:
                    - خدمة التحويل والسحب: *555#
                    - تحويل فلوس لأي رقم
                    - سحب نقدي من الوكلاء
                    - شراء رصيد
                    - دفع الفواتير

                    4. عروض سوداني الحالية:
                    - عرض الـ 10 جيجا: 1000 جنيه (شهرياً)
                    - عرض الليالي: 200 جنيه (5 جيجا - ليلاً)
                    - عرض التواصل الاجتماعي: 300 جنيه (أسبوعياً)

                    قواعد الرد:
                    - إذا عرفت الإجابة: قدمها بوضوح مع الكود إن وجد
                    - إذا لم تعرف: قل "آسف يا حبيبي، ما عندي معلومات مؤكدة عن هذا، لكن ممكن تتصل بخدمة العملاء على 123 من أي خط سوداني"
                    - استخدم أمثلة واقعية من الحياة اليومية السودانية
                    - قدم نصائح مفيدة (مثل: أنصحك تشترك في باقة الـ 15 جيجا لأنها أنسب لك)
                    - أكتب الأكواد بالخط العريض مثل: *123#

                    أمثلة على الردود السودانية:
                    - "يا هلا بك، شو الأخبار؟ كيف أقدر أساعدك اليوم في خدمات سوداني؟"
                    - "والله ما تقلق، كود الشحن بسيط جداً، اطلب *123# واتبع الخطوات"
                    - "أهلاً وسهلاً، دايرة تعرف رصيدك في سوداني؟ اطلب *444# هيك"
                    - "يا سيدي، باقة سوداني الـ 15 جيجا ممتازة جداً وتناسبك إذا كنت بتستخدم النت كثير"`,
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            temperature: 0.7,
            max_tokens: 600,
            top_p: 0.9,
            frequency_penalty: 0.5,
            presence_penalty: 0.5,
        });

        const response = completion.choices[0].message.content;
        console.log('✅ تم استلام الرد من OpenAI');
        return response;

    } catch (error) {
        console.error('❌ خطأ في OpenAI:', error);
        
        if (error.code === 'insufficient_quota') {
            return 'آسف يا حبيبي، النظام يواجه ضغط حالياً. لكن تقدر تتصل بخدمة عملاء سوداني على 123 من أي خط، أو تزور أقرب فرع ليك.';
        }
        
        if (error.status === 401) {
            return 'عذراً، هناك مشكلة في مفتاح API. الرجاء التواصل مع الدعم الفني.';
        }
        
        return 'عذراً، حصل خطأ تقني. لكن لا تقلق! تقدر تتواصل مع خدمة عملاء سوداني على 123 أو تزور موقع سوداني الرسمي.';
    }
}

// ============================================
// 🔗 نقطة API للمحادثة (OpenAI فقط)
// ============================================

app.post('/api/chat/message', async (req, res) => {
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

        console.log('🔄 جاري استخدام الذكاء الاصطناعي...');
        const response = await getAIResponse(message);

        console.log('✅ تم إرسال الرد بنجاح من OpenAI');
        
        res.json({
            success: true,
            response: response,
            source: 'ai',
            timestamp: new Date().toISOString()
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

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Sudani AI Assistant',
        version: '3.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: process.uptime(),
        ai_enabled: !!process.env.OPENAI_API_KEY
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سوداني بوت - النسخة النهائية');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 الرابط: http://localhost:' + PORT);
    console.log('=================================');
    console.log('🧠 الذكاء الاصطناعي: ' + (process.env.OPENAI_API_KEY ? '✅ مفعل' : '❌ غير مفعل'));
    console.log('📱 مختص بشركة سوداني فقط');
    console.log('=================================');
    console.log('💡 جاهز لخدمة عملاء سوداني!');
    console.log('=================================');
});

// ============================================
// 📝 معالجة الأخطاء
// ============================================

process.on('uncaughtException', (error) => {
    console.error('💥 خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 رفض غير متوقع:', reason);
});
