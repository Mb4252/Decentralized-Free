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

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
        new winston.transports.File({ filename: 'logs/chat.log' }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});

// ============================================
// 🛡️ الأمان والحماية
// ============================================

app.use(helmet());
app.use(compression());
app.use(cors());
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

function loadKnowledge() {
    const knowledge = {};
    const files = fs.readdirSync('./knowledge');
    files.forEach(file => {
        const key = path.basename(file, '.json');
        const data = fs.readFileSync(`./knowledge/${file}`, 'utf8');
        knowledge[key] = JSON.parse(data);
    });
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
        'رصيد': 'balance',
        'انترنت': 'internet',
        'نت': 'internet',
        'صاح': 'sah',
        'كاش': 'sah'
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
    if (msg.includes('باقة') || msg.includes('ريح بالك')) return 'packages';
    if (msg.includes('فرع') || msg.includes('مركز') || msg.includes('موقع')) return 'branches';
    if (msg.includes('خدمة العملاء') || msg.includes('رقم') || msg.includes('اتصال')) return 'contact';
    
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
            const unixData = knowledgeBase.unix;
            response = `📱 نظام يونكس (UNIX):
🔹 كود الاشتراك: <a href="tel:*6#">*6#</a>
✨ المميزات:
${unixData.features.map(f => `• ${f}`).join('\n')}`;
            break;
        case 'internet':
            const internetData = knowledgeBase.internet;
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
            const branches = knowledgeBase.branches.branches;
            response = `📍 الفروع:
${Object.entries(branches).map(([city, address]) => `• ${city}: ${address}`).join('\n')}`;
            break;
        case 'contact':
            response = `📞 خدمة العملاء: <a href="tel:120">120</a>`;
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
        const jsonStr = JSON.stringify(data).toLowerCase();
        if (jsonStr.includes(msg)) {
            results.push({ key, data });
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
            stream: true // تفعيل البث
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
    
    return null;
}

// ============================================
// 🎨 واجهة الويب (محسنة)
// ============================================

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
});

process.on('uncaughtException', (error) => {
    logger.error('💥 خطأ غير متوقع:', error);
});
