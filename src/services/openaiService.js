const OpenAI = require('openai');
const SYSTEM_PROMPT = require('../utils/systemPrompt');
const knowledgeBase = require('../utils/knowledgeBase.json');

class OpenAIService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // بحث في قاعدة المعرفة المحلية أولاً (RAG)
  searchKnowledgeBase(query) {
    const results = [];
    
    // البحث في الأسئلة الشائعة
    knowledgeBase.faqs.forEach(faq => {
      if (query.includes(faq.question) || faq.question.includes(query)) {
        results.push(faq.answer);
      }
    });

    // البحث في الباقات
    Object.values(knowledgeBase.buckets).forEach(bucket => {
      if (query.includes(bucket.name) || query.includes('باقة')) {
        results.push(`باقة ${bucket.name}: ${bucket.data} - ${bucket.prices[0]} - صلاحية ${bucket.validity}`);
      }
    });

    // البحث في الخدمات
    Object.values(knowledgeBase.services).forEach(service => {
      if (query.includes(service.description) || query.includes(service.code)) {
        results.push(`${service.description}: ${service.code}`);
      }
    });

    return results;
  }

  // توليد الرد باستخدام OpenAI
  async generateResponse(userMessage, conversationHistory = []) {
    try {
      // أولاً: ابحث في قاعدة المعرفة المحلية
      const localResults = this.searchKnowledgeBase(userMessage);
      
      // بناء السياق مع النتائج المحلية
      let context = '';
      if (localResults.length > 0) {
        context = 'معلومات موثوقة من قاعدة بيانات سوداني:\n' + localResults.join('\n') + '\n\n';
      }

      // بناء رسائل المحادثة
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...conversationHistory,
        { 
          role: 'user', 
          content: `${context}سؤال المستخدم: ${userMessage}`
        }
      ];

      // استدعاء OpenAI
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview', // أو gpt-3.5-turbo للتوفير
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9,
        frequency_penalty: 0.5,
        presence_penalty: 0.5,
      });

      const response = completion.choices[0].message.content;
      
      // إضافة نصائح إضافية إذا كان السؤال عن باقات
      if (userMessage.includes('باقة') || userMessage.includes('نت') || userMessage.includes('إنترنت')) {
        return response + '\n\n💡 نصيحة: أنصحك تشترك في باقة الشهرية لأنها أوفر وأرخص من اليومية.';
      }

      return response;

    } catch (error) {
      console.error('OpenAI Error:', error);
      
      // رد بديل في حالة خطأ
      if (error.code === 'insufficient_quota') {
        return 'آسف يا حبيبي، النظام يواجه ضغط حالياً. لكن تقدر تتصل بنا على 123 من أي خط سوداني، أو تزور أقرب فرع ليك.';
      }
      
      return 'عذراً، حصل خطأ تقني. لكن لا تقلق! تقدر تتواصل مع خدمة العملاء على 123 أو تزور موقع سوداني الرسمي.';
    }
  }

  // تحليل نية المستخدم (Intent Detection)
  analyzeIntent(message) {
    const intent = {
      type: 'general',
      confidence: 0.5
    };

    if (message.includes('باقة') || message.includes('نت') || message.includes('إنترنت')) {
      intent.type = 'package_inquiry';
      intent.confidence = 0.9;
    } else if (message.includes('رصيد') || message.includes('شحن')) {
      intent.type = 'balance_recharge';
      intent.confidence = 0.9;
    } else if (message.includes('سوداني كاش') || message.includes('تحويل')) {
      intent.type = 'sudani_cash';
      intent.confidence = 0.9;
    }

    return intent;
  }
}

module.exports = OpenAIService;
