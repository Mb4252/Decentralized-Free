const OpenAIService = require('../services/openaiService');
const SupabaseService = require('../services/supabaseService');

class ChatController {
  constructor() {
    this.openAIService = new OpenAIService();
    this.supabaseService = new SupabaseService();
  }

  // معالجة رسالة جديدة
  async handleMessage(req, res) {
    try {
      const { message, userId, sessionId } = req.body;

      // التحقق من صحة المدخلات
      if (!message) {
        return res.status(400).json({
          error: 'الرسالة مطلوبة',
          message: 'يا هلا، ممكن تكتب سؤالك؟'
        });
      }

      // الحصول على تاريخ المحادثة (آخر 5 رسائل)
      const history = await this.supabaseService.getConversationHistory(userId || 'anonymous', 5);
      
      // تحويل التاريخ إلى صيغة OpenAI
      const conversationHistory = history.map(h => ({
        role: 'user',
        content: h.user_message
      })).reverse();

      // توليد الرد
      const response = await this.openAIService.generateResponse(message, conversationHistory);

      // تحليل نية المستخدم
      const intent = this.openAIService.analyzeIntent(message);

      // حفظ المحادثة
      if (userId) {
        await this.supabaseService.saveConversation(userId, message, response);
      }

      // إعادة الرد مع معلومات إضافية
      return res.status(200).json({
        success: true,
        response: response,
        intent: intent,
        timestamp: new Date().toISOString(),
        suggestions: this.generateSuggestions(intent.type)
      });

    } catch (error) {
      console.error('Chat Controller Error:', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        response: 'آسف، حصل مشكلة. حاول مرة أخرى أو اتصل بنا على 123.'
      });
    }
  }

  // توليد اقتراحات للمستخدم
  generateSuggestions(intentType) {
    const suggestions = {
      'package_inquiry': ['شوف الباقات اليومية', 'عايز باقة أسبوعية', 'باقة الشهرية كم؟'],
      'balance_recharge': ['كيف أشحن؟', 'رصيدي كم؟', 'كود الشحن'],
      'sudani_cash': ['تحويل فلوس', 'سحب من سوداني كاش', 'شراء رصيد'],
      'general': ['عايز باقة نت', 'رصيدي خلص', 'كيف أفعّل سوداني كاش؟']
    };

    return suggestions[intentType] || suggestions['general'];
  }

  // الحصول على إحصائيات (للشركة)
  async getAnalytics(req, res) {
    try {
      const { startDate, endDate } = req.query;
      
      const analytics = await this.supabaseService.getAnalytics(
        startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString(),
        endDate || new Date().toISOString()
      );

      return res.status(200).json({
        success: true,
        analytics: analytics,
        message: 'تم جلب الإحصائيات بنجاح'
      });

    } catch (error) {
      return res.status(500).json({
        error: 'Failed to get analytics',
        message: 'عذراً، حدث خطأ في جلب الإحصائيات'
      });
    }
  }

  // الحصول على إجابة من قاعدة المعرفة مباشرة (بدون AI)
  async getQuickAnswer(req, res) {
    try {
      const { question } = req.query;
      
      // استخدام خدمة OpenAI للبحث في قاعدة المعرفة فقط
      const localResults = this.openAIService.searchKnowledgeBase(question);
      
      if (localResults.length > 0) {
        return res.status(200).json({
          success: true,
          response: localResults.join('\n'),
          source: 'knowledge_base'
        });
      }

      return res.status(404).json({
        success: false,
        response: 'ما عندي معلومات عن سؤالك، لكن تقدر تتصل على 123.',
        source: 'fallback'
      });

    } catch (error) {
      return res.status(500).json({
        error: 'Error fetching quick answer'
      });
    }
  }
}

module.exports = ChatController;
