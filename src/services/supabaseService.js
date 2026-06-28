const { createClient } = require('@supabase/supabase-js');

class SupabaseService {
  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY
    );
  }

  // حفظ محادثة
  async saveConversation(userId, message, response) {
    try {
      const { data, error } = await this.supabase
        .from('conversations')
        .insert([
          {
            user_id: userId,
            user_message: message,
            bot_response: response,
            timestamp: new Date().toISOString()
          }
        ]);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Supabase Save Error:', error);
      return null;
    }
  }

  // جلب تاريخ المحادثات
  async getConversationHistory(userId, limit = 10) {
    try {
      const { data, error } = await this.supabase
        .from('conversations')
        .select('*')
        .eq('user_id', userId)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Supabase Fetch Error:', error);
      return [];
    }
  }

  // حفظ تفضيلات المستخدم
  async saveUserPreferences(userId, preferences) {
    try {
      const { data, error } = await this.supabase
        .from('users')
        .upsert([
          {
            id: userId,
            preferences: preferences,
            updated_at: new Date().toISOString()
          }
        ]);

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Supabase Preferences Error:', error);
      return null;
    }
  }

  // تحليل الإحصائيات (للعرض على الشركة)
  async getAnalytics(startDate, endDate) {
    try {
      const { data, error } = await this.supabase
        .from('conversations')
        .select('*')
        .gte('timestamp', startDate)
        .lte('timestamp', endDate);

      if (error) throw error;

      // تحليل بسيط
      const analytics = {
        totalConversations: data.length,
        uniqueUsers: new Set(data.map(d => d.user_id)).size,
        mostCommonQuestions: this.getMostCommonQuestions(data),
        averageResponseTime: this.calculateAverageResponse(data),
      };

      return analytics;
    } catch (error) {
      console.error('Supabase Analytics Error:', error);
      return null;
    }
  }

  getMostCommonQuestions(data) {
    // تحليل الأسئلة الأكثر تكراراً
    const questions = {};
    data.forEach(d => {
      const q = d.user_message.toLowerCase();
      questions[q] = (questions[q] || 0) + 1;
    });
    
    return Object.entries(questions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([question, count]) => ({ question, count }));
  }

  calculateAverageResponse(data) {
    // حساب متوسط وقت الرد (إذا كان متاحاً)
    // يمكنك إضافة time_stamp في قاعدة البيانات
    return 1.2; // مثال: 1.2 ثانية
  }
}

module.exports = SupabaseService;
