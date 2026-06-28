const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// استيراد الخدمات
const logger = require('./utils/logger');
const rateLimitMiddleware = require('./middleware/rateLimit');
const embeddingsService = require('./services/embeddings');
const cacheService = require('./services/cache');
const memoryService = require('./services/memory');
const aiService = require('./services/ai');

// ============================================
// 🛡️ الأمان والحماية
// ============================================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiting
app.use('/api/', rateLimitMiddleware);

// ============================================
// 📚 تحميل قاعدة المعرفة
// ============================================

const knowledgeDir = path.join(__dirname, 'knowledge');
if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
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

let knowledgeBase = loadKnowledge();

// مراقبة التغييرات في مجلد المعرفة
fs.watch(knowledgeDir, { recursive: true }, async (eventType, filename) => {
    if (filename && filename.endsWith('.json')) {
        logger.info(`🔄 تغيير في ملف: ${filename}، جاري إعادة التحميل...`);
        knowledgeBase = loadKnowledge();
        // إعادة بناء Embeddings
        await embeddingsService.buildEmbeddings(knowledgeBase);
        cacheService.clear(); // مسح التخزين المؤقت
        logger.info('✅ تم تحديث المعرفة والتخزين المؤقت');
    }
});

// ============================================
// 🧠 بناء Embeddings
// ============================================

(async function initEmbeddings() {
    await embeddingsService.buildEmbeddings(knowledgeBase);
    logger.info('✅ جاهز للاستخدام!');
})();

// ============================================
// 🎯 اكتشاف النية (محسّن مع Levenshtein)
// ============================================

const { correctSpelling } = require('./utils/helpers');

function detectIntent(message) {
    const msg = message.toLowerCase().trim();
    
    const dictionary = ['يونكس', 'رصيد', 'انترنت', 'صاح', 'باقة', 'فرع', 'مركز', 'خدمة العملاء', '4g', 'lte'];
    const words = msg.split(/\s+/);
    
    for (const word of words) {
        const corrected = correctSpelling(word, dictionary);
        if (corrected !== word) {
            logger.info(`🔧 تصحيح إملائي: ${word} → ${corrected}`);
        }
        
        switch(corrected) {
            case 'يونكس': return 'unix';
            case 'رصيد': return 'balance';
            case 'انترنت': return 'internet';
            case 'صاح': return 'sah';
            case 'باقة': return 'packages';
            case 'فرع':
            case 'مركز': return 'branches';
            case 'خدمة العملاء': return 'contact';
            case '4g':
            case 'lte': return 'lte';
            default: break;
        }
    }
    
    // نوايا إضافية
    if (msg.includes('ابي') || msg.includes('عايز') || msg.includes('اريد')) return 'request';
    if (msg.includes('شكوى') || msg.includes('مشكلة')) return 'complaint';
    if (msg.includes('دفع') || msg.includes('فاتورة')) return 'payment';
    if (msg.includes('اعدادات') || msg.includes('ضبط')) return 'technical';
    
    return null;
}

// ============================================
// 📞 الردود السريعة
// ============================================

function getQuickResponse(intent) {
    const cacheKey = `quick_${intent}`;
    const cached = cacheService.get(cacheKey);
    if (cached) return cached;
    
    let response = null;
    
    switch(intent) {
        case 'balance':
            response = `💰 معرفة الرصيد: <a href="tel:*222#">*222#</a>`;
            break;
        case 'unix':
            const unixData = knowledgeBase.unix || { features: ['نظام وحدات مرن'], code: '*6#' };
            response = `📱 نظام يونكس (UNIX):
🔹 كود الاشتراك: <a href="tel:*6#">*6#</a>
✨ المميزات:
${unixData.features.map(f => `• ${f}`).join('\n')}`;
            break;
        case 'internet':
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
            const branches = knowledgeBase.branches?.branches || {};
            response = `📍 الفروع:
${Object.entries(branches).map(([city, address]) => `• ${city}: ${address}`).join('\n')}`;
            break;
        case 'contact':
            response = `📞 خدمة العملاء: <a href="tel:120">120</a>`;
            break;
        case 'lte':
            response = `📶 التحويل من 3G إلى 4G:
📱 كود التفعيل: <a href="tel:*4*400#">*4*400#</a>`;
            break;
        default:
            return null;
    }
    
    if (response) {
        cacheService.set(cacheKey, response);
    }
    return response;
}

// ============================================
// 🔗 نقاط API
// ============================================

// واجهة الويب
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
<!DOCTYPE html>
<html>
<head><title>سودان بوت v12</title></head>
<body>
    <h1>🚀 سودان بوت - الإصدار 12</h1>
    <p>نظام ذكاء اصطناعي متقدم مع Embeddings وذاكرة ذكية</p>
</body>
</html>
        `);
    }
});

// نقاط API
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
        
        // اكتشاف النية
        const intent = detectIntent(message);
        const words = message.split(/\s+/);
        
        // إذا كانت كلمة واحدة → رد سريع
        if (words.length <= 3 && intent) {
            const quickResponse = getQuickResponse(intent);
            if (quickResponse) {
                logger.info(`⚡ رد سريع لـ ${uid}: ${intent}`);
                // تحديث الملف الشخصي
                const profile = await memoryService.getUserProfile(uid);
                profile.last_service = intent;
                profile.message_count = (profile.message_count || 0) + 1;
                profile.last_visit = new Date().toISOString();
                memoryService.updateUserProfile(uid, profile);
                
                return res.json({ success: true, response: quickResponse });
            }
        }
        
        // البحث في قاعدة المعرفة باستخدام Embeddings
        let knowledgeResults = await embeddingsService.search(message, knowledgeBase);
        
        // إذا كانت النتائج قليلة، جرب البحث النصي
        if (knowledgeResults.length === 0) {
            // بحث نصي بسيط
            const keywords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
            for (const [key, data] of Object.entries(knowledgeBase)) {
                const jsonStr = JSON.stringify(data).toLowerCase();
                let found = false;
                for (const keyword of keywords) {
                    if (jsonStr.includes(keyword)) {
                        found = true;
                        break;
                    }
                }
                if (found) {
                    knowledgeResults.push({ key, data, similarity: 0.5 });
                }
            }
        }
        
        // الحصول على الرد من الذكاء الاصطناعي
        const response = await aiService.getResponse(message, uid, knowledgeResults);
        
        res.json({ 
            success: true, 
            response: response,
            intent: intent,
            knowledge_hits: knowledgeResults.length
        });
        
    } catch (error) {
        logger.error('❌ خطأ:', error);
        res.status(500).json({ 
            success: false, 
            response: '❌ حدث خطأ في السيرفر.' 
        });
    }
});

app.get('/api/stats', async (req, res) => {
    const dbStats = await memoryService.getStats();
    res.json({
        users: dbStats.total_users || 0,
        messages: dbStats.total_messages || 0,
        cache: cacheService.stats,
        embeddings: {
            total: embeddingsService.embeddings.size,
            ready: embeddingsService.isReady
        },
        avg_rating: dbStats.avg_rating || 0,
        uptime: process.uptime()
    });
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'Sudan Bot v12',
        version: '12.0.0',
        features: [
            'Embeddings',
            'Memory (SQLite)',
            'Cache (LRU)',
            'Auto-retry',
            'Model Selection',
            'Spelling Correction',
            'Knowledge Watch'
        ]
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سودان بوت - الإصدار 12');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('=================================');
    console.log('🧠 الميزات النشطة:');
    console.log('   • Embeddings (تشابه دلالي)');
    console.log('   • Memory (SQLite)');
    console.log('   • Cache (LRU)');
    console.log('   • Auto-retry (3 محاولات)');
    console.log('   • Model Selection (Llama/GPT)');
    console.log('   • Spelling Correction (Levenshtein)');
    console.log('   • Knowledge Watch (تلقائي)');
    console.log('   • Rate Limiting');
    console.log('   • Logging');
    console.log('=================================');
});

process.on('uncaughtException', (error) => {
    logger.error('💥 خطأ غير متوقع:', error);
});
