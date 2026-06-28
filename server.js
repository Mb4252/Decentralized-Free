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
// 🤖 إعداد Groq
// ============================================

const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
});

// ============================================
// 📋 معلومات سوداني (للنظام المحلي الاحتياطي فقط)
// ============================================

const sudaniInfo = {
    customerService: '120',
    website: 'https://sudani.sd',
    mySudani: 'https://my.sudani.sd',
    sahLink: 'https://sah.sudani.sd',
    
    codes: {
        balance: '*222#',
        sah: '*500#',
        internet: '*4#',
        calls: '*6#',
        unix: '*6#',
        prepaid: '*4#',
        transfer: '*303#',
        lte: '*4*400#',
    },
    
    callPackages: {
        rihBalak: {
            daily: { name: 'ريح بالك يوم', minutes: '50 دقيقة داخل الشبكة', code: '*1#', validity: 'يوم' },
            weekly: { name: 'ريح بالك أسبوع', minutes: '500 دقيقة داخل الشبكة', code: '*5#', validity: 'أسبوع' },
            monthly: { name: 'ريح بالك شهر', minutes: '1500 دقيقة داخل الشبكة', code: '*50#', validity: 'شهر' },
            max: { name: 'ريح بالك Max', minutes: '1000 دقيقة داخل الشبكة', code: '*55#', validity: '30 يوم' }
        },
        ahlaYom: {
            daily: { name: 'أحلى يوم', minutes: '100 دقيقة داخل الشبكة', code: '*60#', validity: 'يوم' }
        },
        khaliAnak: {
            weekly: { name: 'خلي عنك أسبوع', minutes: 'باقة مكالمات أسبوعية', code: '*12#', validity: 'أسبوع' },
            monthly: { name: 'خلي عنك شهر', minutes: 'باقة مكالمات شهرية', code: '*40#', validity: 'شهر' }
        }
    },
    
    internetPackages: {
        daily: { code: '*4#', description: 'باقات يومية - اختر من القائمة' },
        monthly: {
            '1gb': { code: '*4*101#', size: '1 جيجابايت' },
            '2gb': { code: '*4*102#', size: '2 جيجابايت' },
            '5gb': { code: '*4*8#', size: '5 جيجابايت' },
            '10gb': { code: '*4*9#', size: '10 جيجابايت' }
        },
        lte: {
            '15gb': { code: '*4*115#', size: '15 جيجابايت' },
            '30gb': { code: '*4*130#', size: '30 جيجابايت' },
            '50gb': { code: '*4*150#', size: '50 جيجابايت' },
            '100gb': { code: '*4*1100#', size: '100 جيجابايت' }
        }
    },
    
    unixSystem: {
        name: 'يونكس',
        description: 'نظام وحدات مرن من شركة سوداني',
        code: '*6#',
        features: [
            'مرونة كاملة: استخدام الوحدات للإنترنت، المكالمات، أو الرسائل',
            '1 وحدة = 5 ميجابايت (باقات يومية)',
            '1 وحدة = 7 ميجابايت (باقات أسبوعية)',
            '1 وحدة = 10 ميجابايت (باقات شهرية)',
            '1 وحدة = 1 دقيقة مكالمة (داخل أو خارج الشبكة)',
            '1 وحدة = 1 رسالة نصية'
        ],
        subscribe: '*6#',
        app: 'تطبيق MySudani'
    },
    
    sahServices: {
        code: '*500#',
        description: 'خدمة صاح من سوداني - خدمات مالية متكاملة',
        features: ['تحويل الأموال من بنك لآخر', 'دفع الفواتير', 'شراء رصيد', 'سحب نقدي'],
        transferCode: '*303#'
    },
    
    apps: {
        mySudani: {
            name: 'ماي سوداني',
            link: 'https://my.sudani.sd',
            download: 'متجر Google Play'
        },
        sah: {
            name: 'صاح',
            link: 'https://sah.sudani.sd',
            download: 'متجر Google Play'
        }
    },
    
    branches: {
        khartoum: 'الخرطوم - شارع النيل، مجمع سوداني',
        omdurman: 'أمدرمان - السوق الشعبي',
        bahri: 'الخرطوم بحري - منطقة كافوري',
        portSudan: 'بورتسودان - وسط المدينة',
        wadMadani: 'ودمدني - شارع الجمهورية',
        elObeid: 'الأبيض - السوق المركزي'
    }
};

// ============================================
// 📞 النظام المحلي الاحتياطي (في حالة فشل API فقط)
// ============================================

function getLocalResponse(message) {
    const msg = message.toLowerCase();
    
    // الترحيب
    if (msg.includes('سلام') || msg.includes('مرحب') || msg.includes('هلا')) {
        return `👋 أهلاً وسهلاً بك في خدمات سوداني!

📱 أنا هنا لمساعدتك في:
• نظام يونكس (UNIX) - وحدات مرنة (<a href="tel:*6#">*6#</a>)
• باقات المكالمات (ريح بالك، أحلى يوم، خلي عنك)
• خدمات الإنترنت (يومية، شهرية، LTE)
• خدمة صاح (تحويلات بنكية)

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="${sudaniInfo.mySudani}" target="_blank">ماي سوداني</a>

💬 اسألني عن أي خدمة!`;
    }
    
    // نظام يونكس
    if (msg.includes('يونكس') || msg.includes('unix')) {
        return `📱 نظام يونكس (UNIX) من سوداني:

🔹 ما هو يونكس؟
نظام وحدات مرن يتيح لك التحكم في رصيدك.

✨ المميزات:
• 1 وحدة = 5-10 ميجابايت (حسب الباقة)
• 1 وحدة = 1 دقيقة مكالمة
• 1 وحدة = 1 رسالة نصية

📱 كود الاشتراك: <a href="tel:*6#">*6#</a>
🔗 <a href="${sudaniInfo.mySudani}" target="_blank">ماي سوداني</a>`;
    }
    
    // معرفة الرصيد
    if (msg.includes('رصيد')) {
        return `💰 معرفة الرصيد: <a href="tel:*222#">*222#</a>`;
    }
    
    // خدمة العملاء
    if (msg.includes('خدمة العملاء') || msg.includes('رقم')) {
        return `📞 خدمة العملاء: <a href="tel:120">120</a>`;
    }
    
    return null;
}

// ============================================
// 🤖 دالة الرد الرئيسية - عبر API (أولاً)
// ============================================

async function getAIResponse(userMessage) {
    try {
        console.log('🧠 جاري الاتصال بـ Groq...');
        console.log('📩 الرسالة:', userMessage);

        const completion = await groq.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: [
                {
                    role: "system",
                    content: `أنت مساعد رسمي لشركة سوداني للاتصالات في السودان. أنت خبير بجميع خدمات سوداني وتتحدث باللهجة السودانية بطلاقة.

====================================
📋 معلومات سوداني الرسمية:
====================================

📞 خدمة العملاء: 120
🔗 ماي سوداني: https://my.sudani.sd
🔗 صاح: https://sah.sudani.sd
🔗 الموقع الرسمي: https://sudani.sd

====================================
📱 1. نظام يونكس (UNIX):
====================================
• نظام وحدات مرن
• كود الاشتراك: *6#
• 1 وحدة = 5-10 ميجابايت (حسب الباقة)
• 1 وحدة = 1 دقيقة مكالمة
• 1 وحدة = 1 رسالة نصية
• متوفر عبر تطبيق MySudani

====================================
📱 2. باقات المكالمات (ريح بالك):
====================================
• ريح بالك يوم: *1# (50 دقيقة داخل الشبكة)
• ريح بالك أسبوع: *5# (500 دقيقة داخل الشبكة)
• ريح بالك شهر: *50# (1500 دقيقة داخل الشبكة)
• ريح بالك Max: *55# (1000 دقيقة داخل الشبكة - 30 يوم)

====================================
📱 3. باقة أحلى يوم:
====================================
• *60# (100 دقيقة داخل الشبكة)

====================================
📱 4. باقات خلي عنك:
====================================
• أسبوع: *12# (باقة مكالمات أسبوعية)
• شهر: *40# (باقة مكالمات شهرية)

====================================
📶 5. باقات الإنترنت:
====================================
• يومية: *4#
• 1 جيجابايت: *4*101#
• 2 جيجابايت: *4*102#
• 5 جيجابايت: *4*8#
• 10 جيجابايت: *4*9#

====================================
📶 6. باقات LTE (4G):
====================================
• 15 جيجابايت: *4*115#
• 30 جيجابايت: *4*130#
• 50 جيجابايت: *4*150#
• 100 جيجابايت: *4*1100#

====================================
💰 7. خدمات الرصيد:
====================================
• معرفة الرصيد: *222#
• تحويل الرصيد: *303*قيمة الرصيد*رقم المستلم*0000#

====================================
📋 8. خدمات أخرى:
====================================
• التحويل من 3G إلى 4G: *4*400#
• كود الإنترنت: *4#
• كود المكالمات: *6#

====================================
💵 9. خدمة صاح:
====================================
• كود الخدمة: *500#
• تحويل الأموال من بنك لآخر
• دفع الفواتير
• شراء رصيد
• سحب نقدي

====================================
📱 10. تطبيق ماي سوداني:
====================================
• البوابة الرقمية الرسمية
• رابط: https://my.sudani.sd

====================================
📍 11. الفروع الرئيسية:
====================================
• الخرطوم: شارع النيل، مجمع سوداني
• أمدرمان: السوق الشعبي
• الخرطوم بحري: منطقة كافوري
• ود مدني: شارع الجمهورية
• بورتسودان: وسط المدينة

====================================
قواعد الرد:
====================================

1. أنت متخصص فقط في شركة سوداني
2. لا تتحدث عن زين أو MTN أو أي شركة أخرى
3. إذا سألك عن شركة أخرى قل: "آسف، أنا متخصص فقط في خدمات سوداني."
4. أجب باللهجة السودانية الطبيعية (استخدم: يا هلا، حبيبي، كيف أقدر أساعدك)
5. قدم المعلومات بوضوح مع الأكواد
6. الأسعار غير مذكورة لأنها قابلة للتغيير
7. إذا لم تعرف الإجابة فقل: "آسف يا حبيبي، ما عندي معلومة مؤكدة، اتصل بخدمة العملاء 120."
8. كن ودوداً ومحترماً في ردودك
9. استخدم <a href="tel:الكود">الكود</a> للأكواد
10. استخدم <a href="الرابط" target="_blank">الرابط</a> للروابط
11. رحب بالمستخدم واسأله عن الخدمة التي يريدها
12. قدم نصائح مفيدة حسب احتياج المستخدم`
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],
            temperature: 0.7,
            max_tokens: 800
        });

        const response = completion.choices[0].message.content;
        console.log("✅ تم استلام الرد من Groq");
        return response;

    } catch (error) {
        console.error("❌ خطأ في API، استخدام النظام المحلي الاحتياطي:", error.message);
        
        // استخدام النظام المحلي في حالة فشل API
        const localReply = getLocalResponse(userMessage);
        if (localReply) {
            return localReply;
        }
        
        return `عذراً يا حبيبي، واجهتنا مشكلة تقنية.

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="${sudaniInfo.mySudani}" target="_blank">ماي سوداني</a>

حاول مرة أخرى بعد قليل.`;
    }
}

// ============================================
// 🎨 واجهة الويب
// ============================================

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سودان بوت</title>
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
        .bubble strong { color: #f7931e; }
        .bubble a { color: #f7931e; text-decoration: underline; font-weight: bold; cursor: pointer; }
        .bubble a:hover { color: #d4831a; }
        .bubble a[href^="tel:"] { color: #4caf50; }
        .bubble a[href^="tel:"]:hover { color: #388e3c; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سودان بوت</h3>
                <p><span class="dot"></span> متصل <span class="badge" style="background:#f7931e;color:#1A2B4A;padding:2px 10px;border-radius:12px;font-size:11px;">AI</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="mode">🧠 ذكاء اصطناعي</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">👋 أهلاً وسهلاً بك في <strong>سودان بوت</strong>!

🤖 أنا المساعد الذكي لشركة <strong>سوداني للاتصالات</strong>.

📱 اسألني عن أي خدمة:
• نظام يونكس (UNIX) - <a href="tel:*6#">*6#</a>
• باقات المكالمات (ريح بالك، أحلى يوم، خلي عنك)
• باقات الإنترنت (يومية، شهرية، LTE)
• الرصيد والشحن - <a href="tel:*222#">*222#</a>
• خدمة صاح - <a href="tel:*500#">*500#</a>

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="https://my.sudani.sd" target="_blank">ماي سوداني</a>

💬 اسألني عن أي شيء وسأرد عليك فوراً!</div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button onclick="sendQuickMessage('عايز نظام يونكس سوداني')">📱 يونكس</button>
            <button onclick="sendQuickMessage('عايز باقة ريح بالك')">📞 ريح بالك</button>
            <button onclick="sendQuickMessage('عايز باقة إنترنت')">📶 إنترنت</button>
            <button onclick="sendQuickMessage('عايز أعرف رصيدي')">💰 الرصيد</button>
            <button onclick="sendQuickMessage('خدمة صاح سوداني')">💵 صاح</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اسأل عن أي خدمة من سوداني..." autofocus>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
        </div>
    </div>

    <script>
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
            const formattedText = text.replace(/\\n/g, '<br>');
            messageDiv.innerHTML = '<div class="bubble">' + formattedText + '</div><span class="time">' + time + '</span>';
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
                body: JSON.stringify({ 
                    message: message, 
                    userId: 'web_user_' + Date.now() 
                })
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
            if (messageInput) {
                messageInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        window.sendMessage();
                    }
                });
            }
            console.log('✅ سودان بوت جاهز!');
        });

        setTimeout(() => {
            fetch(API_URL + '/health')
                .then(r => r.json())
                .then(data => console.log('✅ السيرفر يعمل:', data))
                .catch(() => console.warn('⚠️ لا يمكن الاتصال بالسيرفر'));
        }, 1000);
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
            response: response
        });

    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ 
            success: false, 
            response: '❌ حدث خطأ في السيرفر.' 
        });
    }
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Sudan Bot - Groq',
        version: '8.0'
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سودان بوت - Groq');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('=================================');
    console.log('🧠 جميع الردود عبر الذكاء الاصطناعي');
    console.log('📱 النظام المحلي احتياطي فقط');
    console.log('=================================');
});

process.on('uncaughtException', (error) => {
    console.error('💥 خطأ:', error);
});
