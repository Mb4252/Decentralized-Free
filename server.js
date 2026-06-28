const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

// ============================================
// 🤖 إعداد DeepSeek (بدلاً من OpenAI)
// ============================================

// استخدام نفس مكتبة OpenAI ولكن مع تغيير الإعدادات
const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY, // استخدم مفتاح DeepSeek
    baseURL: 'https://api.deepseek.com',   // رابط DeepSeek API
});

// ============================================
// 📋 قاعدة ردود بديلة (في حالة فشل API)
// ============================================

function getLocalResponse(message) {
    const msg = message.toLowerCase();
    
    if (msg.includes('باقة') || msg.includes('نت') || msg.includes('إنترنت')) {
        return `📱 **باقات سوداني للإنترنت:**\n\n` +
               `📶 **يومية:**\n` +
               `• 500 ميجا: *555# (100 ج)\n` +
               `• 1 جيجا: *556# (200 ج)\n\n` +
               `📶 **أسبوعية:**\n` +
               `• 3 جيجا: *567# (500 ج)\n` +
               `• 5 جيجا: *568# (800 ج)\n\n` +
               `📶 **شهرية:**\n` +
               `• 15 جيجا: *789# (1500 ج)\n` +
               `• 30 جيجا: *790# (2500 ج)\n\n` +
               `💬 أخبرني أي باقة تناسبك.`;
    }
    
    if (msg.includes('رصيد') || msg.includes('شحن')) {
        return `💰 **خدمات الرصيد في سوداني:**\n\n` +
               `💳 **شحن الرصيد:** *123#\n` +
               `📊 **معرفة الرصيد:** *444#\n` +
               `🔄 **تجديد تلقائي:** *777#\n\n` +
               `💡 استخدم *444# أولاً عشان تعرف رصيدك.`;
    }
    
    if (msg.includes('كاش') || msg.includes('تحويل')) {
        return `💵 **سوداني كاش:**\n\n` +
               `• تحويل فلوس: *555#\n` +
               `• سحب نقدي من الوكلاء\n` +
               `• شراء رصيد\n` +
               `• دفع الفواتير\n\n` +
               `🔐 لا تشارك رقمك السري مع أحد.`;
    }
    
    if (msg.includes('عرض') || msg.includes('عروض')) {
        return `🎁 **عروض سوداني:**\n\n` +
               `🔥 10 جيجا: 1000 جنيه (شهرياً)\n` +
               `🌙 عرض الليالي: 200 جنيه (5 جيجا)\n` +
               `📱 تواصل اجتماعي: 300 جنيه (أسبوعياً)\n\n` +
               `📞 اتصل 123 للتأكد من أحدث العروض.`;
    }
    
    return `🤔 آسف يا حبيبي، ما فهمت سؤالك.\n\n` +
           `📱 **اسألني عن:**\n` +
           `• باقات الإنترنت\n` +
           `• الرصيد والشحن\n` +
           `• سوداني كاش\n` +
           `• العروض\n\n` +
           `📞 أو اتصل 123.`;
}

// ============================================
// 🤖 دالة الرد (DeepSeek + بديل محلي)
// ============================================

async function getAIResponse(userMessage) {
    // إذا لم يوجد مفتاح DeepSeek
    if (!process.env.DEEPSEEK_API_KEY) {
        console.log('⚠️ DeepSeek غير مفعل، استخدام الردود المحلية');
        return getLocalResponse(userMessage);
    }
    
    try {
        console.log('🧠 جاري الاتصال بـ DeepSeek...');
        console.log('📩 الرسالة:', userMessage);
        
        const completion = await deepseek.chat.completions.create({
            model: 'deepseek-chat', // أو deepseek-v4-flash
            messages: [
                {
                    role: 'system',
                    content: `أنت مساعد شركة سوداني للاتصالات في السودان.
                    
                    خدمات سوداني:
                    1. باقات الإنترنت: يومية، أسبوعية، شهرية
                    2. الرصيد والشحن: *123# للشحن، *444# للرصيد
                    3. سوداني كاش: تحويل وسحب
                    4. العروض: عروض خاصة
                    
                    تحدث باللهجة السودانية. كن ودوداً ومحترماً.`,
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            temperature: 0.7,
            max_tokens: 600,
        });

        const response = completion.choices[0].message.content;
        console.log('✅ تم استلام الرد من DeepSeek');
        return response;

    } catch (error) {
        console.error('❌ خطأ في DeepSeek، استخدام الرد المحلي:', error.message);
        return getLocalResponse(userMessage);
    }
}

// ============================================
// 🎨 واجهة الويب (نفس الكود السابق)
// ============================================

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سوداني بوت - DeepSeek</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: linear-gradient(135deg, #0a1628, #1A2B4A); height: 100vh; display: flex; justify-content: center; align-items: center; padding: 20px; }
        .chat-container { width: 480px; max-width: 100%; height: 750px; max-height: 98vh; background: #fff; border-radius: 30px; box-shadow: 0 30px 80px rgba(0,0,0,0.6); display: flex; flex-direction: column; overflow: hidden; }
        .chat-header { background: linear-gradient(135deg, #0a1628, #1A2B4A); padding: 18px 24px; color: white; display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
        .chat-header .avatar { width: 48px; height: 48px; background: #f7931e; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 22px; color: #1A2B4A; }
        .chat-header .info { flex: 1; }
        .chat-header .info h3 { font-size: 20px; font-weight: 700; margin: 0; color: #f7931e; }
        .chat-header .info p { font-size: 13px; opacity: 0.85; margin: 2px 0 0; display: flex; align-items: center; gap: 6px; }
        .chat-header .info p .dot { display: inline-block; width: 8px; height: 8px; background: #4caf50; border-radius: 50%; animation: pulse 2s infinite; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        .status-bar { padding: 8px 24px; background: linear-gradient(90deg, #f7931e, #f5a623); text-align: center; font-size: 13px; color: #1A2B4A; border-bottom: 1px solid #e88a1a; flex-shrink: 0; font-weight: 700; }
        .status-bar .mode { background: #1A2B4A; color: #f7931e; padding: 2px 12px; border-radius: 12px; font-size: 11px; margin-left: 8px; }
        .messages-area { flex: 1; padding: 20px 18px; overflow-y: auto; background: #f0f2f5; display: flex; flex-direction: column; gap: 6px; }
        .message { display: flex; flex-direction: column; animation: slideIn 0.3s ease; max-width: 90%; }
        .message.user { align-self: flex-end; align-items: flex-end; }
        .message.bot { align-self: flex-start; align-items: flex-start; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .message .bubble { padding: 12px 18px; border-radius: 18px; word-wrap: break-word; line-height: 1.7; font-size: 15px; max-width: 100%; box-shadow: 0 1px 3px rgba(0,0,0,0.08); white-space: pre-wrap; }
        .message.user .bubble { background: linear-gradient(135deg, #1A2B4A, #2A3F66); color: white; border-bottom-right-radius: 4px; }
        .message.bot .bubble { background: white; color: #1a1a2e; border-bottom-left-radius: 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border-right: 4px solid #f7931e; }
        .message .time { font-size: 10px; color: #999; margin: 4px 8px 0; opacity: 0.7; }
        .typing-indicator { display: none; padding: 12px 20px; background: white; border-radius: 18px; border-bottom-left-radius: 4px; align-self: flex-start; border-right: 4px solid #f7931e; }
        .typing-indicator.active { display: inline-block; }
        .typing-indicator span { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #999; margin: 0 3px; animation: typingBounce 1.5s infinite; }
        .typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
        .typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-8px); } }
        .quick-actions { padding: 10px 18px; background: #f8f9fa; display: flex; gap: 8px; flex-wrap: wrap; border-top: 1px solid #e8eaed; flex-shrink: 0; }
        .quick-actions button { padding: 8px 16px; border: 2px solid #1A2B4A; border-radius: 20px; background: white; font-size: 13px; cursor: pointer; transition: all 0.25s; font-family: inherit; color: #1A2B4A; font-weight: 600; }
        .quick-actions button:hover { background: #1A2B4A; color: #f7931e; border-color: #f7931e; transform: translateY(-2px); }
        .input-area { padding: 14px 18px; background: white; border-top: 1px solid #e8eaed; display: flex; gap: 10px; align-items: center; flex-shrink: 0; }
        .input-area input { flex: 1; padding: 12px 18px; border: 2px solid #e0e4ea; border-radius: 25px; font-size: 15px; font-family: inherit; outline: none; transition: all 0.3s; background: #f8f9fa; }
        .input-area input:focus { border-color: #f7931e; background: white; }
        .input-area .send-btn { width: 50px; height: 50px; border: none; border-radius: 50%; background: linear-gradient(135deg, #f7931e, #f5a623); color: #1A2B4A; font-size: 22px; cursor: pointer; transition: all 0.25s; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 15px rgba(247, 147, 30, 0.4); }
        .input-area .send-btn:hover { transform: scale(1.06); }
        .input-area .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        @media (max-width: 500px) { body { padding: 0; } .chat-container { height: 100vh; max-height: 100vh; border-radius: 0; } }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سوداني بوت</h3>
                <p><span class="dot"></span> متصل <span class="badge" style="background:#f7931e;color:#1A2B4A;padding:2px 10px;border-radius:12px;font-size:11px;">DeepSeek</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="mode">🧠 AI</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">👋 أهلاً وسهلاً! أنا سوداني بوت، اسألني عن أي خدمة من خدمات سوداني</div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button data-msg="عايز باقة نت سوداني">📱 باقة نت</button>
            <button data-msg="رصيدي خلص سوداني">💰 الرصيد</button>
            <button data-msg="كيف أشحن سوداني؟">💳 شحن</button>
            <button data-msg="سوداني كاش">💵 كاش</button>
            <button data-msg="عروض سوداني الجديدة">🎁 عروض</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اكتب سؤالك هنا..." autofocus>
            <button class="send-btn" id="sendBtn">➤</button>
        </div>
    </div>

    <script>
        (function() {
            'use strict';
            
            const API_URL = window.location.origin;
            const messagesArea = document.getElementById('messagesArea');
            const messageInput = document.getElementById('messageInput');
            const sendBtn = document.getElementById('sendBtn');
            let isProcessing = false;

            function addMessage(text, isUser) {
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message ' + (isUser ? 'user' : 'bot');
                const now = new Date();
                const time = now.toLocaleTimeString('ar-SD', { hour: '2-digit', minute: '2-digit' });
                messageDiv.innerHTML = '<div class="bubble">' + text + '</div><span class="time">' + time + '</span>';
                messagesArea.appendChild(messageDiv);
                messagesArea.scrollTop = messagesArea.scrollHeight;
            }

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
            
            window.sendMessage = function() {
                const message = messageInput.value.trim();
                if (!message || isProcessing) return;

                isProcessing = true;
                messageInput.disabled = true;
                sendBtn.disabled = true;

                addMessage(message, true);
                messageInput.value = '';
                showTyping();

                fetch(API_URL + '/api/chat/message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: message, userId: 'web_user_' + Date.now() })
                })
                .then(response => {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                })
                .then(data => {
                    hideTyping();
                    if (data.success) {
                        addMessage(data.response, false);
                    } else {
                        addMessage('❌ حدث خطأ، حاول مرة أخرى', false);
                    }
                })
                .catch(error => {
                    hideTyping();
                    addMessage('❌ خطأ في الاتصال: ' + error.message, false);
                    console.error('Error:', error);
                })
                .finally(() => {
                    isProcessing = false;
                    messageInput.disabled = false;
                    sendBtn.disabled = false;
                    messageInput.focus();
                });
            };

            window.sendQuickMessage = function(text) {
                messageInput.value = text;
                window.sendMessage();
            };

            document.addEventListener('DOMContentLoaded', function() {
                document.querySelectorAll('.quick-actions button').forEach(button => {
                    button.addEventListener('click', function(e) {
                        const msg = this.getAttribute('data-msg');
                        if (msg) {
                            window.sendQuickMessage(msg);
                        }
                    });
                });

                if (sendBtn) {
                    sendBtn.addEventListener('click', window.sendMessage);
                }

                if (messageInput) {
                    messageInput.addEventListener('keydown', function(e) {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            window.sendMessage();
                        }
                    });
                }

                console.log('✅ تم إعداد جميع الأزرار بنجاح!');
            });

            setTimeout(() => {
                fetch(API_URL + '/health')
                    .then(r => r.json())
                    .then(data => console.log('✅ السيرفر يعمل:', data))
                    .catch(() => console.warn('⚠️ لا يمكن الاتصال بالسيرفر'));
            }, 1000);

        })();
    </script>
</body>
</html>
  `);
});

// ============================================
// 🔗 نقاط API
// ============================================

app.post('/api/chat/message', async (req, res) => {
    try {
        const { message } = req.body;
        console.log('📩 رسالة:', message);

        if (!message) {
            return res.status(400).json({ 
                success: false, 
                response: '❌ الرجاء كتابة سؤال.' 
            });
        }

        const response = await getAIResponse(message);
        res.json({ 
            success: true, 
            response: response,
            source: 'deepseek'
        });

    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ 
            success: false, 
            response: '❌ حدث خطأ في السيرفر، حاول مرة أخرى.' 
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'DeepSeek',
        api_key: process.env.DEEPSEEK_API_KEY ? '✅ مفعل' : '❌ غير مفعل'
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سوداني بوت - نسخة DeepSeek');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('=================================');
    console.log('🧠 DeepSeek: ' + (process.env.DEEPSEEK_API_KEY ? '✅ مفعل' : '❌ غير مفعل'));
    console.log('📦 النموذج: deepseek-chat');
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
