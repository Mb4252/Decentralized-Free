const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { OpenAI } = require('openai');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 📝 نظام التسجيل (Logging)
// ============================================

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

const winston = require('winston');
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

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'src', 'public')));

// حماية من السبام
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 15,
    message: '❌ تجاوزت الحد الأقصى للرسائل. انتظر 30 ثانية.',
    handler: (req, res) => {
        logger.warn(`🚫 سبام من ${req.ip}`);
        res.status(429).json({ error: 'Too many requests' });
    }
});
app.use('/api/', limiter);

// ============================================
// 📚 تحميل قاعدة المعرفة
// ============================================

const knowledgeDir = path.join(__dirname, 'src', 'knowledge');
if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
}

let knowledgeBase = {};

function loadKnowledge() {
    try {
        const files = fs.readdirSync(knowledgeDir);
        files.forEach(file => {
            if (file.endsWith('.json')) {
                const key = path.basename(file, '.json');
                try {
                    const data = fs.readFileSync(path.join(knowledgeDir, file), 'utf8');
                    knowledgeBase[key] = JSON.parse(data);
                    logger.info(`✅ تم تحميل: ${file}`);
                } catch (err) {
                    logger.error(`❌ خطأ في تحميل ${file}:`, err.message);
                }
            }
        });
    } catch (err) {
        logger.error('❌ خطأ في قراءة مجلد knowledge:', err.message);
    }
    return knowledgeBase;
}

loadKnowledge();

// ============================================
// 💾 نظام التخزين المؤقت (Cache)
// ============================================

const LRU = require('lru-cache');
const cache = new LRU({
    max: 1000,
    ttl: 1000 * 60 * 30
});

// ============================================
// 🧠 نظام Embeddings
// ============================================

class EmbeddingsService {
    constructor() {
        this.embeddings = new Map();
        this.openai = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1',
        });
        this.isReady = false;
    }

    async createEmbedding(text) {
        try {
            const response = await this.openai.embeddings.create({
                model: "text-embedding-3-small",
                input: text,
                encoding_format: "float"
            });
            return response.data[0].embedding;
        } catch (error) {
            logger.error('❌ خطأ في إنشاء Embedding:', error.message);
            return null;
        }
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async buildEmbeddings() {
        logger.info('🧠 جاري بناء Embeddings...');
        for (const [key, data] of Object.entries(knowledgeBase)) {
            const text = JSON.stringify(data);
            const vector = await this.createEmbedding(text);
            if (vector) {
                this.embeddings.set(key, { vector, data });
                logger.info(`✅ تم بناء Embedding: ${key}`);
            }
        }
        this.isReady = true;
        logger.info('✅ تم بناء جميع Embeddings');
    }

    async search(query, threshold = 0.3) {
        if (!this.isReady || this.embeddings.size === 0) {
            return this.textSearch(query);
        }

        const queryVector = await this.createEmbedding(query);
        if (!queryVector) return [];

        const results = [];
        for (const [key, entry] of this.embeddings) {
            const similarity = this.cosineSimilarity(queryVector, entry.vector);
            if (similarity > threshold) {
                results.push({ key, data: entry.data, similarity });
            }
        }
        results.sort((a, b) => b.similarity - a.similarity);
        return results;
    }

    textSearch(query) {
        const results = [];
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        for (const [key, data] of Object.entries(knowledgeBase)) {
            const jsonStr = JSON.stringify(data).toLowerCase();
            let found = false;
            for (const keyword of keywords) {
                if (jsonStr.includes(keyword)) { found = true; break; }
            }
            if (found) results.push({ key, data, similarity: 0.5 });
        }
        return results;
    }
}

const embeddingsService = new EmbeddingsService();
embeddingsService.buildEmbeddings();

// ============================================
// 💾 نظام الذاكرة (SQLite)
// ============================================

const sqlite3 = require('sqlite3').verbose();
const dbPath = path.join(__dirname, 'database', 'db.sqlite');
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        role TEXT,
        content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        last_service TEXT,
        language TEXT,
        customer_type TEXT,
        last_package TEXT,
        summary TEXT,
        last_visit DATETIME,
        message_count INTEGER DEFAULT 0
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        question TEXT,
        answer TEXT,
        rating INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// ============================================
// 📞 دوال مساعدة
// ============================================

const levenshtein = require('levenshtein');

function correctSpelling(word, dictionary) {
    if (dictionary.includes(word)) return word;
    let bestMatch = word, minDistance = Infinity;
    for (const dictWord of dictionary) {
        const distance = new levenshtein(word, dictWord).distance;
        if (distance < minDistance && distance <= 2) {
            minDistance = distance;
            bestMatch = dictWord;
        }
    }
    return bestMatch;
}

function cleanMessage(message) {
    return message.replace(/\s+/g, ' ').trim().normalize('NFKC');
}

const blockedWords = ['ignore previous', 'api key', 'system prompt', 'كلمة السر', 'مفتاح api'];

function isBlocked(message) {
    const msg = message.toLowerCase();
    return blockedWords.some(word => msg.includes(word));
}

// ============================================
// 🎯 اكتشاف النية
// ============================================

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
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    
    let response = null;
    switch(intent) {
        case 'balance':
            response = `💰 معرفة الرصيد: <a href="tel:*222#">*222#</a>`;
            break;
        case 'unix':
            const unixData = knowledgeBase.unix || { features: ['نظام وحدات مرن'], code: '*6#' };
            response = `📱 نظام يونكس (UNIX):\n🔹 كود الاشتراك: <a href="tel:*6#">*6#</a>\n✨ المميزات:\n${unixData.features.map(f => `• ${f}`).join('\n')}`;
            break;
        case 'internet':
            response = `📶 باقات الإنترنت:\n• يومية: <a href="tel:*4#">*4#</a>\n• شهرية: \n  • 1GB: <a href="tel:*4*101#">*4*101#</a>\n  • 5GB: <a href="tel:*4*8#">*4*8#</a>\n  • 10GB: <a href="tel:*4*9#">*4*9#</a>\n• LTE: \n  • 15GB: <a href="tel:*4*115#">*4*115#</a>\n  • 30GB: <a href="tel:*4*130#">*4*130#</a>`;
            break;
        case 'sah':
            response = `💰 خدمة صاح:\n📱 كود الخدمة: <a href="tel:*500#">*500#</a>\n✨ المميزات:\n• تحويل الأموال من بنك لآخر\n• دفع الفواتير\n• شراء رصيد\n• سحب نقدي`;
            break;
        case 'packages':
            response = `📞 باقات المكالمات:\nريح بالك:\n• يوم: <a href="tel:*1#">*1#</a> (50 دقيقة)\n• أسبوع: <a href="tel:*5#">*5#</a> (500 دقيقة)\n• شهر: <a href="tel:*50#">*50#</a> (1500 دقيقة)\n• Max: <a href="tel:*55#">*55#</a> (1000 دقيقة)\nأحلى يوم: <a href="tel:*60#">*60#</a>\nخلي عنك: <a href="tel:*12#">*12#</a> (أسبوع), <a href="tel:*40#">*40#</a> (شهر)`;
            break;
        case 'branches':
            const branches = knowledgeBase.branches?.branches || {};
            response = `📍 الفروع:\n${Object.entries(branches).map(([city, address]) => `• ${city}: ${address}`).join('\n')}`;
            break;
        case 'contact':
            response = `📞 خدمة العملاء: <a href="tel:120">120</a>`;
            break;
        case 'lte':
            response = `📶 التحويل من 3G إلى 4G:\n📱 كود التفعيل: <a href="tel:*4*400#">*4*400#</a>`;
            break;
        default:
            return null;
    }
    if (response) cache.set(cacheKey, response);
    return response;
}

// ============================================
// 🤖 دالة الرد الرئيسية
// ============================================

async function getAIResponse(userMessage, userId) {
    const startTime = Date.now();
    const msg = cleanMessage(userMessage);
    const words = msg.split(/\s+/);

    if (isBlocked(msg)) {
        logger.warn(`🚫 محاولة اختراق من ${userId}`);
        return '❌ عذراً، هذا السؤال غير مسموح.';
    }

    const intent = detectIntent(msg);
    if (words.length <= 3 && intent) {
        const quickResponse = getQuickResponse(intent);
        if (quickResponse) {
            logger.info(`⚡ رد سريع لـ ${userId}: ${intent}`);
            return quickResponse;
        }
    }

    const cacheKey = `ai_${userId}_${msg}`;
    const cached = cache.get(cacheKey);
    if (cached) {
        logger.info(`💾 من التخزين المؤقت لـ ${userId}`);
        return cached;
    }

    try {
        // البحث في قاعدة المعرفة
        let knowledgeResults = await embeddingsService.search(msg);
        if (knowledgeResults.length === 0) {
            knowledgeResults = embeddingsService.textSearch(msg);
        }

        let knowledgeContext = '';
        if (knowledgeResults.length > 0) {
            knowledgeContext = knowledgeResults.map(r => 
                `📚 معلومات عن ${r.key} (التشابه: ${(r.similarity * 100).toFixed(0)}%):\n${JSON.stringify(r.data, null, 2)}`
            ).join('\n\n');
        }

        // الحصول على تاريخ المحادثة
        const history = await new Promise((resolve) => {
            db.all(
                `SELECT role, content FROM conversations WHERE user_id = ? ORDER BY timestamp DESC LIMIT 10`,
                [userId],
                (err, rows) => {
                    if (err) { resolve([]); return; }
                    resolve(rows.reverse());
                }
            );
        });

        // الحصول على الملف الشخصي
        const profile = await new Promise((resolve) => {
            db.get(`SELECT * FROM user_profiles WHERE user_id = ?`, [userId], (err, row) => {
                if (!row) {
                    db.run(`INSERT INTO user_profiles (user_id, last_visit, message_count) VALUES (?, ?, ?)`,
                        [userId, new Date().toISOString(), 0]);
                    resolve({ user_id: userId, last_service: null, message_count: 0 });
                } else {
                    resolve(row);
                }
            });
        });

        let userContext = '';
        if (profile.last_service) userContext += `آخر خدمة استخدمها: ${profile.last_service}. `;

        const groq = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1',
        });

        // اختيار الموديل حسب طول السؤال
        const model = words.length < 8 ? "llama-3.1-8b" : "openai/gpt-oss-120b";

        logger.info(`🧠 جاري الاتصال بـ Groq (الموديل: ${model})...`);
        logger.info(`📩 الرسالة: ${msg}`);

        let attempts = 0;
        let lastError = null;

        while (attempts < 3) {
            try {
                const completion = await groq.chat.completions.create({
                    model: model,
                    messages: [
                        {
                            role: "system",
                            content: `أنت المساعد الرسمي لشركة سوداني للاتصالات.

القواعد:
1. استخدم قاعدة المعرفة المرفقة أولاً.
2. إذا لم تجد الإجابة فيها فاستخدم معرفتك العامة عن خدمات سوداني.
3. إذا لم تكن متأكداً من الإجابة فاذكر أنها غير مؤكدة واطلب من المستخدم الاتصال بخدمة العملاء 120.
4. لا تخترع أكواد أو أسعار غير مؤكدة.
5. أجب باللهجة السودانية باختصار ووضوح.
6. استخدم <a href="tel:الكود">الكود</a> للأكواد.
7. استخدم <a href="الرابط" target="_blank">الرابط</a> للروابط.

السياق:
${userContext}
${knowledgeContext}`
                        },
                        ...history.map(h => ({ role: h.role, content: h.content })),
                        { role: "user", content: msg }
                    ],
                    temperature: 0.5,
                    max_tokens: 600,
                    stream: false
                });

                const response = completion.choices[0].message.content;
                logger.info(`✅ تم استلام الرد من Groq (${model})`);

                // حفظ المحادثة
                db.run(`INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)`,
                    [userId, 'user', msg]);
                db.run(`INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)`,
                    [userId, 'assistant', response]);

                // تحديث الملف الشخصي
                db.run(
                    `UPDATE user_profiles SET message_count = message_count + 1, last_visit = ?, last_service = ? WHERE user_id = ?`,
                    [new Date().toISOString(), intent || profile.last_service, userId]
                );

                // حفظ في التخزين المؤقت
                if (words.length > 3) {
                    cache.set(cacheKey, response);
                }

                const responseTime = Date.now() - startTime;
                logger.info(`📊 ${userId}: ${responseTime}ms, ${response.length} حروف, الموديل: ${model}`);

                return response;

            } catch (error) {
                lastError = error;
                attempts++;
                logger.error(`❌ محاولة ${attempts} فشلت:`, error.message);
                if (attempts < 3) {
                    await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
                }
            }
        }

        logger.error(`❌ فشل جميع المحاولات لـ ${userId}:`, lastError);
        return `عذراً يا حبيبي، واجهتنا مشكلة تقنية.\n\n📞 خدمة العملاء: <a href="tel:120">120</a>\n🔗 <a href="https://my.sudani.sd" target="_blank">ماي سوداني</a>\n\nحاول مرة أخرى بعد قليل.`;

    } catch (error) {
        logger.error(`❌ خطأ لـ ${userId}:`, error);
        return `عذراً يا حبيبي، واجهتنا مشكلة.\n\n📞 خدمة العملاء: <a href="tel:120">120</a>`;
    }
}

// ============================================
// 🎨 واجهة الويب
// ============================================

app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'src', 'public', 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>سودان بوت v12</title>
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
        .badge-v12 { background: #f7931e; color: #1A2B4A; padding: 2px 10px; border-radius: 12px; font-size: 10px; }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سودان بوت <span class="badge-v12">v12</span></h3>
                <p><span class="dot"></span> متصل <span class="badge" style="background:#f7931e;color:#1A2B4A;padding:2px 10px;border-radius:12px;font-size:11px;">احترافي</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="mode">🧠 ذكاء اصطناعي + Embeddings</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">👋 أهلاً وسهلاً بك في <strong>سودان بوت v12</strong>!

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
            console.log('✅ سودان بوت v12 جاهز!');
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
    db.get(`SELECT COUNT(*) as total_messages, COUNT(DISTINCT user_id) as total_users FROM conversations`, (err, row) => {
        res.json({
            users: row?.total_users || 0,
            messages: row?.total_messages || 0,
            cache: { size: cache.size, max: 1000 },
            embeddings: { total: embeddingsService.embeddings.size, ready: embeddingsService.isReady },
            uptime: process.uptime()
        });
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
            'Rate Limiting',
            'Logging'
        ]
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سودان بوت - الإصدار 12 (الكامل)');
    console.log('=================================');
    console.log(`✅ السيرفر يعمل على المنفذ: ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('=================================');
    console.log('🧠 الميزات النشطة:');
    console.log('   • Embeddings (تشابه دلالي)');
    console.log('   • Memory (SQLite)');
    console.log('   • Cache (LRU)');
    console.log('   • Auto-retry (3 محاولات)');
    console.log('   • Model Selection (Llama/GPT)');
    console.log('   • Spelling Correction (Levenshtein)');
    console.log('   • Rate Limiting');
    console.log('   • Logging');
    console.log('=================================');
});

process.on('uncaughtException', (error) => {
    console.error('💥 خطأ غير متوقع:', error);
    logger.error('💥 خطأ غير متوقع:', error);
});
