const OpenAI = require('openai');
const logger = require('../utils/logger');
const embeddingsService = require('./embeddings');
const cacheService = require('./cache');
const memoryService = require('./memory');
const { cleanMessage, isBlocked } = require('../utils/helpers');

class AIService {
    constructor() {
        this.groq = new OpenAI({
            apiKey: process.env.GROQ_API_KEY,
            baseURL: 'https://api.groq.com/openai/v1',
        });
    }

    chooseModel(message, words) {
        // اختيار الموديل حسب طول السؤال
        if (words.length < 8) {
            return "llama-3.1-8b"; // موديل سريع للأسئلة البسيطة
        }
        return "openai/gpt-oss-120b"; // موديل قوي للأسئلة المعقدة
    }

    async getResponse(userMessage, userId, knowledgeResults = []) {
        const startTime = Date.now();
        const msg = cleanMessage(userMessage);
        const words = msg.split(/\s+/);

        // التحقق من الحظر
        if (isBlocked(msg)) {
            logger.warn(`🚫 محاولة اختراق من ${userId}`);
            return '❌ عذراً، هذا السؤال غير مسموح.';
        }

        // محاولة من التخزين المؤقت
        const cacheKey = `ai_${userId}_${msg}`;
        const cached = cacheService.get(cacheKey);
        if (cached) {
            logger.info(`💾 من التخزين المؤقت لـ ${userId}`);
            return cached;
        }

        // اختيار الموديل
        const model = this.chooseModel(msg, words);

        // تحضير السياق
        const history = await memoryService.getHistory(userId, 10);
        const profile = await memoryService.getUserProfile(userId);

        let knowledgeContext = '';
        if (knowledgeResults.length > 0) {
            knowledgeContext = knowledgeResults.map(r => 
                `📚 معلومات عن ${r.key} (التشابه: ${(r.similarity * 100).toFixed(0)}%):\n${JSON.stringify(r.data, null, 2)}`
            ).join('\n\n');
        }

        let userContext = '';
        if (profile.last_service) {
            userContext += `آخر خدمة استخدمها: ${profile.last_service}. `;
        }
        if (profile.customer_type) {
            userContext += `نوع العميل: ${profile.customer_type}. `;
        }

        // إعادة المحاولة
        let attempts = 0;
        let lastError = null;

        while (attempts < 3) {
            try {
                logger.info(`🧠 جاري الاتصال بـ Groq (الموديل: ${model})...`);
                logger.info(`📩 الرسالة: ${msg}`);

                const completion = await this.groq.chat.completions.create({
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
                        ...history.map(h => ({
                            role: h.role,
                            content: h.content
                        })),
                        {
                            role: "user",
                            content: msg
                        }
                    ],
                    temperature: 0.5,
                    max_tokens: 600,
                    stream: false // يمكن تفعيل البث عند الحاجة
                });

                const response = completion.choices[0].message.content;
                logger.info(`✅ تم استلام الرد من Groq (${model})`);

                // حفظ في التخزين المؤقت
                if (words.length > 3) {
                    cacheService.set(cacheKey, response);
                }

                // حفظ المحادثة
                memoryService.addMessage(userId, 'user', msg);
                memoryService.addMessage(userId, 'assistant', response);

                // تحديث الملف الشخصي
                const updatedProfile = { ...profile };
                updatedProfile.message_count = (profile.message_count || 0) + 1;
                updatedProfile.last_visit = new Date().toISOString();
                memoryService.updateUserProfile(userId, updatedProfile);

                // تنظيف المحادثة إذا كانت طويلة
                await memoryService.cleanHistory(userId);

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

        // إذا فشلت جميع المحاولات
        logger.error(`❌ فشل جميع المحاولات لـ ${userId}:`, lastError);
        return `عذراً يا حبيبي، واجهتنا مشكلة تقنية.

📞 خدمة العملاء: <a href="tel:120">120</a>
🔗 <a href="https://my.sudani.sd" target="_blank">ماي سوداني</a>

حاول مرة أخرى بعد قليل.`;
    }
}

module.exports = new AIService();
