const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 📝 إعداد التسجيل (Logging)
// ============================================

// التأكد من وجود مجلد logs
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ 
            filename: path.join(logsDir, 'error.log'), 
            level: 'error' 
        }),
        new winston.transports.File({ 
            filename: path.join(logsDir, 'chat.log') 
        }),
        new winston.transports.Console({ 
            format: winston.format.simple() 
        })
    ]
});

// ============================================
// 🛡️ الأمان والحماية
// ============================================

app.use(helmet({
    contentSecurityPolicy: false, // للسماح بـ tel: links
}));
app.use(compression());
app.use(cors());

// ✅ تقديم الملفات الثابتة من مجلد public
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json({ limit: '10mb' }));

// حماية من السبام
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 دقيقة
    max: 10, // 10 رسائل
    message: '❌ تجاوزت الحد الأقصى للرسائل. انتظر 30 ثانية.',
    handler: (req, res) => {
        logger.warn(`🚫 سبام من ${req.ip}`);
        res.status(429).json({ error: 'Too many requests' });
    }
});
app.use('/api/', limiter);

// ============================================
// 💾 الذاكرة والتخزين المؤقت
// ============================================

const conversations = new Map(); // حفظ المحادثات
const cache = new Map(); // التخزين المؤقت
const userAnalytics = new Map(); // تحليل المستخدمين
const suggestions = new Map(); // الاقتراحات

// ============================================
// 📚 تحميل قاعدة المعرفة
// ============================================

// التأكد من وجود مجلد knowledge
const knowledgeDir = path.join(__dirname, 'knowledge');
if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    logger.warn('⚠️ مجلد knowledge غير موجود، تم إنشاؤه');
}

function loadKnowledge() {
    const knowledge = {};
    try {
        const files = fs.readdirSync(knowledgeDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const key = path.basename(file, '.json');
                try {
                    const data = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
                    knowledge[key] = JSON.parse(data);
                    logger.info(`✅ تم تحميل: ${file}`);
                } catch (err) {
                    logger.error(`❌ خطأ في تحميل ${file}:`, err.message);
                }
            }
        });
    } catch (err) {
        logger.error('❌ خطأ في قراءة مجلد knowledge:', err.message);
    }
    return knowledge;
}

const knowledgeBase = loadKnowledge();

// ============================================
// 🧠 اكتشاف نية المستخدم
// ============================================

function detectIntent(message) {
    const msg = message.toLowerCase();
    
    // الأخطاء الإملائية
    const corrections = {
        'يونكص': 'يونكس',
        'يونك': 'يونكس',
        'رصيد': 'balance',
        'انترنت': 'internet',
        'نت': 'internet',
        'انترنيت': 'internet',
        'صاح': 'sah',
        'كاش': 'sah',
        'ريح': 'packages',
        'باقة': 'packages'
    };
    
    for (let [key, value] of Object.entries(corrections)) {
        if (msg.includes(key)) {
            return value;
        }
    }
    
    // نوايا محددة
    if (msg.includes('يونكس') || msg.includes('unix')) return 'unix';
    if (msg.includes('رصيد') || msg.includes('balance')) return 'balance';
    if (msg.includes('انترنت') || msg.includes('internet') || msg.includes('نت')) return 'internet';
    if (msg.includes('صاح') || msg.includes('sah') || msg.includes('كاش')) return 'sah';
    if (msg.includes('باقة') || msg.includes('ريح بالك') || msg.includes('ريح')) return 'packages';
    if (msg.includes('فرع') || msg.includes('مركز') || msg.includes('موقع')) return 'branches';
    if (msg.includes('خدمة العملاء') || msg.includes('رقم') || msg.includes('اتصال')) return 'contact';
    if (msg.includes('4g') || msg.includes('lte')) return 'lte';
    
    return null;
}

// ============================================
// 📊 تحليل المستخدم
// ============================================

function getUserAnalytics(userId) {
    if (!userAnalytics.has(userId)) {
        userAnalytics.set(userId, {
            lastService: null,
            lastVisit: new Date(),
            messageCount: 0,
            history: []
        });
    }
    return userAnalytics.get(userId);
}

// ============================================
// 💬 الحصول على تاريخ المحادثة
// ============================================

function getHistory(userId) {
    if (!conversations.has(userId)) {
        conversations.set(userId, []);
    }
    return conversations.get(userId);
}

// ============================================
// 🎯 الردود السريعة (بدون AI)
// ============================================

function getQuickResponse(intent) {
    const cacheKey = `quick_${intent}`;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }
    
    let response = null;
    
    switch(intent) {
        case 'balance':
            response = `💰 معرفة الرصيد: <a href="tel:*222#">*222#</a>`;
            break;
        case 'unix':
            const unixData = knowledgeBase.unix || { features: ['نظام وحدات مرن'] };
            response = `📱 نظام يونكس (UNIX):
🔹 كود الاشتراك: <a href="tel:*6#">*6#</a>
✨ المميزات:
${unixData.features.map(f => `• ${f}`).join('\n')}`;
            break;
        case 'internet':
            const internetData = knowledgeBase.internet || {};
            response = `📶 باقات الإنترنت:
• يومية: <a href="tel:*4#">*4#</a>
• شهرية: 
  • 1GB: <a href="tel:*4*101#">*4*101#</a>
  • 5GB: <a href="tel:*4*8#">*4*8#</a>
  • 10GB: <a href="tel:*4*9#">*4*9#</a>
• LTE: 
  • 15GB: <a href="tel:*4*115#">*4*115#</a>
  • 30GB: <a href="tel:*4*130#">*4*130#</a>`;
            break;
        case 'sah':
            response = `💰 خدمة صاح:
📱 كود الخدمة: <a href="tel:*500#">*500#</a>
✨ المميزات:
• تحويل الأموال من بنك لآخر
• دفع الفواتير
• شراء رصيد
• سحب نقدي`;
            break;
        case 'packages':
            response = `📞 باقات المكالمات:
ريح بالك:
• يوم: <a href="tel:*1#">*1#</a> (50 دقيقة)
• أسبوع: <a href="tel:*5#">*5#</a> (500 دقيقة)
• شهر: <a href="tel:*50#">*50#</a> (1500 دقيقة)
• Max: <a href="tel:*55#">*55#</a> (1000 دقيقة)
أحلى يوم: <a href="tel:*60#">*60#</a>
خلي عنك: <a href="tel:*12#">*12#</a> (أسبوع), <a href="tel:*40#">*40#</a> (شهر)`;
            break;
        case 'branches':
            const branches = knowledgeBase.branches?.branches || {
                'الخرطوم': 'شارع النيل، مجمع سوداني',
                'أمدرمان': 'السوق الشعبي'
            };
            response = `📍 الفروع:
${Object.entries(branches).map(([city, address]) => `• ${city}: ${address}`).join('\n')}`;
            break;
        case 'contact':
            response = `📞 خدمة العملاء: <a href="tel:120">120</a>`;
            break;
        case 'lte':
            response = `📶 التحويل من 3G إلى 4G:
📱 كود التفعيل: <a href="tel:*4*400#">*4*400#</a>
💡 بعد تفعيل الخدمة، استمتع بسرعات إنترنت أسرع.`;
            break;
        default:
            return null;
    }
    
    if (response) {
        cache.set(cacheKey, response);
    }
    return response;
}

// ============================================
// 🔍 البحث في قاعدة المعرفة
// ============================================

function searchKnowledge(query) {
    const results = [];
    const msg = query.toLowerCase();
    
    for (const [key, data] of Object.entries(knowledgeBase)) {
        try {
            const jsonStr = JSON.stringify(data).toLowerCase();
            if (jsonStr.includes(msg)) {
                results.push({ key, data });
            }
        } catch (err) {
            // تجاهل الأخطاء
        }
    }
    
    return results;
}

// ============================================
// 🤖 دالة الرد الرئيسية (مع RAG + Cache + Memory)
// ============================================

async function getAIResponse(userMessage, userId) {
    const startTime = Date.now();
    
    // 1. تحليل المستخدم
    const analytics = getUserAnalytics(userId);
    analytics.messageCount++;
    analytics.lastVisit = new Date();
    
    // 2. اكتشاف النية
    const intent = detectIntent(userMessage);
    if (intent) {
        const quickResponse = getQuickResponse(intent);
        if (quickResponse) {
            logger.info(`⚡ رد سريع لـ ${userId}: ${intent}`);
            analytics.lastService = intent;
            return quickResponse;
        }
    }
    
    // 3. البحث في قاعدة المعرفة
    const knowledgeResults = searchKnowledge(userMessage);
    
    // 4. التحقق من التخزين المؤقت
    const cacheKey = `ai_${userId}_${userMessage}`;
    if (cache.has(cacheKey)) {
        logger.info(`💾 من التخزين المؤقت لـ ${userId}`);
        return cache.get(cacheKey);
    }
    
    // 5. استخدام الـ API
    try {
        // تحضير السياق من المحادثة السابقة
        const history = getHistory(userId);
        const lastMessages = history.slice(-10);
        
        // تحضير المعرفة المطلوبة
        let knowledgeContext = '';
        if (knowledgeResults.length > 0) {
            knowledgeContext = knowledgeResults.map(r => 
                `📚 معلومات عن ${r.key}:\n${JSON.stringify(r.data, null, 2)}`
            ).join('\n\n');
        }
        
        // تحضير تحليل المستخدم
        let userContext = '';
        if (analytics.lastService) {
            userContext = `آخر خدمة استخدمها المستخدم: ${analytics.lastService}`;
        }
        
        console.log('🧠 جاري الاتصال بـ Groq...');
        console.log('📩 الرسالة:', userMessage);
        
        const groq = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1',
        });
        
        const completion = await groq.chat.completions.create({
            model: "openai/gpt-oss-120b",
            messages: [
                {
                    role: "system",
                    content: `أنت المساعد الرسمي لشركة سوداني للاتصالات.

القواعد:
- أجب باختصار وباللهجة السودانية.
- استخدم البيانات المرفقة فقط للإجابة.
- لا تخترع أي معلومة.
- إذا لم تعرف الإجابة اطلب من المستخدم الاتصال بـ 120.
- استخدم <a href="tel:الكود">الكود</a> للأكواد.
- استخدم <a href="الرابط" target="_blank">الرابط</a> للروابط.

معلومات إضافية:
${knowledgeContext}
${userContext}`
                },
                ...lastMessages.map(msg => ({
                    role: msg.role,
                    content: msg.content
                })),
                {
                    role: "user",
                    content: userMessage
                }
            ],
            temperature: 0.5,
            max_tokens: 500,
            stream: true
        });
        
        // جمع الرد من البث
        let fullResponse = '';
        for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content || '';
            fullResponse += content;
        }
        
        console.log("✅ تم استلام الرد من Groq");
        
        // حفظ المحادثة
        history.push({ role: 'user', content: userMessage });
        history.push({ role: 'assistant', content: fullResponse });
        conversations.set(userId, history);
        
        // حفظ في التخزين المؤقت
        cache.set(cacheKey, fullResponse);
        
        // تسجيل الوقت
        const responseTime = Date.now() - startTime;
        logger.info(`📊 ${userId}: ${responseTime}ms, ${fullResponse.length} حروف`);
        
        return fullResponse;
        
    } catch (error) {
        logger.error(`❌ خطأ لـ ${userId}:`, error);
        
        // 6. النظام المحلي الاحتياطي
        const fallbackResponse = getFallbackResponse(userMessage);
        if (fallbackResponse) {
            return fallbackResponse;
        }
        
        return `عذراً يا حبيبي، واجهتنا مشكلة.

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="https://my.sudani.sd" target="_blank">ماي سوداني</a>

حاول مرة أخرى بعد قليل.`;
    }
}

// ============================================
// 📞 النظام المحلي الاحتياطي
// ============================================

function getFallbackResponse(message) {
    const msg = message.toLowerCase();
    
    if (msg.includes('مرحب') || msg.includes('سلام') || msg.includes('هلا')) {
        return `👋 أهلاً وسهلاً بك في سودان بوت!

📱 اسألني عن أي خدمة من سوداني.

📞 خدمة العملاء: <a href="tel:120">120</a>`;
    }
    
    if (msg.includes('رصيد')) {
        return `💰 معرفة الرصيد: <a href="tel:*222#">*222#</a>`;
    }
    
    if (msg.includes('يونكس')) {
        return `📱 نظام يونكس: <a href="tel:*6#">*6#</a>`;
    }
    
    if (msg.includes('صاح')) {
        return `💰 خدمة صاح: <a href="tel:*500#">*500#</a>`;
    }
    
    if (msg.includes('انترنت') || msg.includes('نت')) {
        return `📶 باقات الإنترنت: <a href="tel:*4#">*4#</a>`;
    }
    
    return null;
}

// ============================================
// 🎨 واجهة الويب
// ============================================

// ✅ المسار الرئيسي - يعرض ملف index.html من مجلد public
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        // إذا لم يوجد الملف، نعرض واجهة مدمجة
        res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سودان بوت v10</title>
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
        .badge-v10 { background: #f7931e; color: #1A2B4A; padding: 2px 10px; border-radius: 12px; font-size: 10px; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سودان بوت <span class="badge-v10">v10</span></h3>
                <p><span class="dot"></span> متصل <span class="badge" style="background:#f7931e;color:#1A2B4A;padding:2px 10px;border-radius:12px;font-size:11px;">احترافي</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="mode">🧠 ذكاء اصطناعي + RAG</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">👋 أهلاً وسهلاً بك في <strong>سودان بوت v10</strong>!

🤖 أنا المساعد الذكي لشركة <strong>سوداني للاتصالات</strong>.

📱 اسألني عن أي خدمة وسأرد عليك فوراً!

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="https://my.sudani.sd" target="_blank">ماي سوداني</a>

💬 اكتب سؤالك...</div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button onclick="sendQuickMessage('يونكس')">📱 يونكس</button>
            <button onclick="sendQuickMessage('ريح بالك')">📞 ريح بالك</button>
            <button onclick="sendQuickMessage('انترنت')">📶 إنترنت</button>
            <button onclick="sendQuickMessage('رصيدي')">💰 الرصيد</button>
            <button onclick="sendQuickMessage('صاح')">💵 صاح</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اسأل عن أي خدمة..." autofocus>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
        </div>
    </div>

    <script>
        const API_URL = window.location.origin;
        const messagesArea = document.getElementById('messagesArea');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        let isProcessing = false;
        let userId = 'user_' + Date.now();

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
                    userId: userId 
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
            console.log('✅ سودان بوت v10 جاهز!');
            console.log('🆔 معرف المستخدم:', userId);
        });
    </script>
</body>
</html>
        `);
    }
});

// ============================================
// 🔗 نقاط API
// ============================================

app.post('/api/chat/message', async (req, res) => {
    try {
        const { message, userId } = req.body;
        const uid = userId || `user_${Date.now()}`;
        
        logger.info(`📩 ${uid}: ${message}`);
        
        if (!message) {
            return res.status(400).json({ 
                success: false, 
                response: '❌ الرجاء كتابة سؤال.' 
            });
        }
        
        const response = await getAIResponse(message, uid);
        res.json({ 
            success: true, 
            response: response
        });
        
    } catch (error) {
        logger.error('❌ خطأ:', error);
        res.status(500).json({ 
            success: false, 
            response: '❌ حدث خطأ في السيرفر.' 
        });
    }
});

app.get('/api/stats', (req, res) => {
    res.json({
        users: userAnalytics.size,
        conversations: conversations.size,
        cache: cache.size,
        uptime: process.uptime()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Sudan Bot v10',
        version: '10.0.0'
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سودان بوت - الإصدار 10');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('=================================');
    console.log('🧠 الميزات النشطة:');
    console.log('   • حفظ المحادثات (Memory)');
    console.log('   • نظام RAG (قاعدة معرفة)');
    console.log('   • تخزين مؤقت (Cache)');
    console.log('   • اكتشاف النية');
    console.log('   • حماية من السبام');
    console.log('   • تسجيل الأخطاء');
    console.log('   • تحليل المستخدمين');
    console.log('=================================');
    console.log(`📁 مجلد المعرفة: ${knowledgeDir}`);
    console.log(`📁 مجلد السجلات: ${logsDir}`);
    console.log(`📁 مجلد الملفات الثابتة: ${path.join(__dirname, 'public')}`);
    console.log('=================================');
});

process.on('uncaughtException', (error) => {
    logger.error('💥 خطأ غير متوقع:', error);
});
