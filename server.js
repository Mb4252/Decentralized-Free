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
// 🤖 إعداد DeepSeek
// ============================================

const deepseek = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com',
});

// ============================================
// 📋 قاعدة المعرفة الرسمية لسوداني (محدثة بالكامل)
// ============================================

const sudaniInfo = {
    // معلومات الاتصال
    customerService: '120',
    website: 'https://sudani.sd',
    mySudani: 'https://my.sudani.sd',
    sahLink: 'https://sah.sudani.sd',
    
    // أكواد الخدمات الرئيسية
    codes: {
        balance: '*222#',        // معرفة الرصيد
        sah: '*500#',            // خدمة صاح
        internet: '*4#',         // خدمات الإنترنت
        prepaid: '*444#',        // قائمة الدفع الآجل
        transfer: '*303#',       // تحويل الرصيد
        lte: '*4*400#',         // التحويل من 3G إلى 4G
    },
    
    // ============================================
    // 1. باقات المكالمات (ريح بالك - خلي عنك - أحلى يوم)
    // ============================================
    callPackages: {
        // ريح بالك
        rihBalak: {
            daily: { name: 'ريح بالك يوم', minutes: '50 دقيقة داخل الشبكة', code: '*1#', validity: 'يوم' },
            weekly: { name: 'ريح بالك أسبوع', minutes: '500 دقيقة داخل الشبكة', code: '*5#', validity: 'أسبوع' },
            monthly: { name: 'ريح بالك شهر', minutes: '1500 دقيقة داخل الشبكة', code: '*50#', validity: 'شهر' },
            max: { name: 'ريح بالك Max', minutes: '1000 دقيقة داخل الشبكة', code: '*55#', validity: '30 يوم' }
        },
        // أحلى يوم
        ahlaYom: {
            daily: { name: 'أحلى يوم', minutes: '100 دقيقة داخل الشبكة', code: '*60#', validity: 'يوم' }
        },
        // خلي عنك
        khaliAnak: {
            weekly: { name: 'خلي عنك أسبوع', minutes: 'باقة مكالمات أسبوعية', code: '*12#', validity: 'أسبوع' },
            monthly: { name: 'خلي عنك شهر', minutes: 'باقة مكالمات شهرية', code: '*40#', validity: 'شهر' }
        }
    },
    
    // ============================================
    // 2. باقات الإنترنت (الدفع المقدم)
    // ============================================
    internetPackages: {
        // باقات يومية (عبر *4#)
        daily: {
            code: '*4#',
            description: 'باقات يومية - اختر من القائمة'
        },
        // باقات شهرية
        monthly: {
            '1gb': { code: '*4*101#', size: '1 جيجابايت' },
            '2gb': { code: '*4*102#', size: '2 جيجابايت' },
            '5gb': { code: '*4*8#', size: '5 جيجابايت' },
            '10gb': { code: '*4*9#', size: '10 جيجابايت' }
        },
        // باقات LTE (4G)
        lte: {
            '15gb': { code: '*4*115#', size: '15 جيجابايت' },
            '30gb': { code: '*4*130#', size: '30 جيجابايت' },
            '50gb': { code: '*4*150#', size: '50 جيجابايت' },
            '100gb': { code: '*4*1100#', size: '100 جيجابايت' }
        }
    },
    
    // ============================================
    // 3. خدمات صاح
    // ============================================
    sahServices: {
        code: '*500#',
        description: 'خدمة صاح من سوداني - خدمات مالية متكاملة',
        features: [
            'تحويل الأموال من بنك لآخر',
            'دفع الفواتير',
            'شراء رصيد',
            'سحب نقدي'
        ],
        transferCode: '*303#'
    }
};

// ============================================
// 📞 ردود محلية للمعلومات المؤكدة (محدثة بالكامل)
// ============================================

function getLocalResponse(message) {
    const msg = message.toLowerCase();
    
    // ============================================
    // 1. خدمة العملاء
    // ============================================
    if (msg.includes('خدمة العملاء') || msg.includes('اتصال') || msg.includes('رقم') || msg.includes('شكوى')) {
        return `📞 **خدمة عملاء سوداني:**\n\n` +
               `📱 رقم الخدمة: **120** (من أي خط سوداني)\n` +
               `🕐 متاحة 24 ساعة طوال الأسبوع\n\n` +
               `🔗 **روابط مهمة:**\n` +
               `• ماي سوداني: ${sudaniInfo.mySudani}\n` +
               `• موقع سوداني: ${sudaniInfo.website}`;
    }
    
    // ============================================
    // 2. باقات المكالمات (ريح بالك)
    // ============================================
    if (msg.includes('ريح بالك') || msg.includes('ريح')) {
        return `📞 **باقات ريح بالك من سوداني:**\n\n` +
               `📱 **ريح بالك يوم:**\n` +
               `• 50 دقيقة داخل الشبكة\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.rihBalak.daily.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.rihBalak.daily.validity}\n\n` +
               `📱 **ريح بالك أسبوع:**\n` +
               `• 500 دقيقة داخل الشبكة\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.rihBalak.weekly.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.rihBalak.weekly.validity}\n\n` +
               `📱 **ريح بالك شهر:**\n` +
               `• 1500 دقيقة داخل الشبكة\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.rihBalak.monthly.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.rihBalak.monthly.validity}\n\n` +
               `📱 **ريح بالك Max:**\n` +
               `• 1000 دقيقة داخل الشبكة\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.rihBalak.max.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.rihBalak.max.validity}\n\n` +
               `💡 اطلب الكود المناسب لتفعيل الباقة.`;
    }
    
    // ============================================
    // 3. باقة أحلى يوم
    // ============================================
    if (msg.includes('أحلى يوم') || msg.includes('احلى يوم')) {
        return `📞 **باقة أحلى يوم من سوداني:**\n\n` +
               `📱 **أحلى يوم:**\n` +
               `• 100 دقيقة داخل الشبكة\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.ahlaYom.daily.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.ahlaYom.daily.validity}\n\n` +
               `💡 اطلب **${sudaniInfo.callPackages.ahlaYom.daily.code}** لتفعيل الباقة.`;
    }
    
    // ============================================
    // 4. باقات خلي عنك
    // ============================================
    if (msg.includes('خلي عنك')) {
        return `📞 **باقات خلي عنك من سوداني:**\n\n` +
               `📱 **خلي عنك أسبوع:**\n` +
               `• باقة مكالمات أسبوعية\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.khaliAnak.weekly.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.khaliAnak.weekly.validity}\n\n` +
               `📱 **خلي عنك شهر:**\n` +
               `• باقة مكالمات شهرية\n` +
               `• كود التفعيل: **${sudaniInfo.callPackages.khaliAnak.monthly.code}**\n` +
               `• الصلاحية: ${sudaniInfo.callPackages.khaliAnak.monthly.validity}\n\n` +
               `💡 اطلب الكود المناسب لتفعيل الباقة.`;
    }
    
    // ============================================
    // 5. باقات الإنترنت
    // ============================================
    if (msg.includes('الإنترنت') || msg.includes('باقة') || msg.includes('نت') || msg.includes('انترنت')) {
        if (msg.includes('يوم') || msg.includes('يومية')) {
            return `📱 **باقات الإنترنت اليومية من سوداني:**\n\n` +
                   `📶 كود الخدمة: **${sudaniInfo.internetPackages.daily.code}**\n` +
                   `💡 اطلب **${sudaniInfo.internetPackages.daily.code}** واختر الباقة المناسبة لك.\n\n` +
                   `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
        }
        if (msg.includes('شهر') || msg.includes('شهري')) {
            if (msg.includes('4g') || msg.includes('lte')) {
                return `📱 **باقات LTE (4G) الشهرية من سوداني:**\n\n` +
                       `📶 **15 جيجابايت:** ${sudaniInfo.internetPackages.lte['15gb'].code}\n` +
                       `📶 **30 جيجابايت:** ${sudaniInfo.internetPackages.lte['30gb'].code}\n` +
                       `📶 **50 جيجابايت:** ${sudaniInfo.internetPackages.lte['50gb'].code}\n` +
                       `📶 **100 جيجابايت:** ${sudaniInfo.internetPackages.lte['100gb'].code}\n\n` +
                       `💡 اطلب الكود المناسب للاشتراك.\n` +
                       `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
            }
            return `📱 **باقات الإنترنت الشهرية من سوداني:**\n\n` +
                   `📶 **1 جيجابايت:** ${sudaniInfo.internetPackages.monthly['1gb'].code}\n` +
                   `📶 **2 جيجابايت:** ${sudaniInfo.internetPackages.monthly['2gb'].code}\n` +
                   `📶 **5 جيجابايت:** ${sudaniInfo.internetPackages.monthly['5gb'].code}\n` +
                   `📶 **10 جيجابايت:** ${sudaniInfo.internetPackages.monthly['10gb'].code}\n\n` +
                   `📶 **باقات LTE (4G):**\n` +
                   `• 15 جيجا: ${sudaniInfo.internetPackages.lte['15gb'].code}\n` +
                   `• 30 جيجا: ${sudaniInfo.internetPackages.lte['30gb'].code}\n` +
                   `• 50 جيجا: ${sudaniInfo.internetPackages.lte['50gb'].code}\n` +
                   `• 100 جيجا: ${sudaniInfo.internetPackages.lte['100gb'].code}\n\n` +
                   `💡 اطلب الكود المناسب للاشتراك.\n` +
                   `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
        }
        return `📱 **خدمات الإنترنت من سوداني:**\n\n` +
               `📶 كود الخدمة الرئيسي: **${sudaniInfo.codes.internet}**\n\n` +
               `📅 **باقات يومية:** اطلب **${sudaniInfo.internetPackages.daily.code}**\n\n` +
               `📆 **باقات شهرية:**\n` +
               `• 1 جيجا: ${sudaniInfo.internetPackages.monthly['1gb'].code}\n` +
               `• 2 جيجا: ${sudaniInfo.internetPackages.monthly['2gb'].code}\n` +
               `• 5 جيجا: ${sudaniInfo.internetPackages.monthly['5gb'].code}\n` +
               `• 10 جيجا: ${sudaniInfo.internetPackages.monthly['10gb'].code}\n\n` +
               `📶 **باقات LTE (4G):**\n` +
               `• 15 جيجا: ${sudaniInfo.internetPackages.lte['15gb'].code}\n` +
               `• 30 جيجا: ${sudaniInfo.internetPackages.lte['30gb'].code}\n` +
               `• 50 جيجا: ${sudaniInfo.internetPackages.lte['50gb'].code}\n` +
               `• 100 جيجا: ${sudaniInfo.internetPackages.lte['100gb'].code}\n\n` +
               `💡 اسأل عن باقة محددة لمزيد من التفاصيل.\n` +
               `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
    }
    
    // ============================================
    // 6. خدمة صاح
    // ============================================
    if (msg.includes('صاح') || msg.includes('كاش') || msg.includes('تحويل') || msg.includes('فلوس')) {
        return `💰 **خدمة صاح من سوداني:**\n\n` +
               `📱 كود الخدمة: **${sudaniInfo.codes.sah}**\n` +
               `🔗 رابط صاح: ${sudaniInfo.sahLink}\n\n` +
               `✨ **المميزات:**\n` +
               `• تحويل الأموال من بنك لآخر\n` +
               `• دفع الفواتير\n` +
               `• شراء رصيد\n` +
               `• سحب نقدي\n\n` +
               `💳 **تحويل الرصيد:**\n` +
               `• الكود: **${sudaniInfo.codes.transfer}**\n` +
               `• مثال: *303*50*0xxxxxxxxx*0000#\n` +
               `• (رقم المستلم 10 خانات)\n\n` +
               `💡 اطلب **${sudaniInfo.codes.sah}** لاستخدام الخدمة.\n` +
               `🔗 للمزيد: ${sudaniInfo.sahLink}`;
    }
    
    // ============================================
    // 7. الرصيد والشحن
    // ============================================
    if (msg.includes('رصيد') || msg.includes('شحن')) {
        return `💰 **خدمات الرصيد في سوداني:**\n\n` +
               `📊 **معرفة الرصيد:** **${sudaniInfo.codes.balance}**\n` +
               `💳 **شحن الرصيد:** عبر خدمة صاح **${sudaniInfo.codes.sah}**\n\n` +
               `💡 **طرق الشحن:**\n` +
               `1️⃣ عبر خدمة صاح: اطلب **${sudaniInfo.codes.sah}**\n` +
               `2️⃣ عن طريق كروت الشحن\n` +
               `3️⃣ من أي وكيل معتمد\n\n` +
               `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
    }
    
    // ============================================
    // 8. التحويل من 3G إلى 4G
    // ============================================
    if (msg.includes('4g') || msg.includes('lte') || msg.includes('تحويل') && msg.includes('3g')) {
        return `📶 **التحويل من 3G إلى 4G:**\n\n` +
               `📱 كود التفعيل: **${sudaniInfo.codes.lte}**\n\n` +
               `💡 بعد تفعيل الخدمة، استمتع بسرعات إنترنت أسرع.\n\n` +
               `📶 **باقات LTE المتاحة:**\n` +
               `• 15 جيجا: *4*115#\n` +
               `• 30 جيجا: *4*130#\n` +
               `• 50 جيجا: *4*150#\n` +
               `• 100 جيجا: *4*1100#\n\n` +
               `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
    }
    
    // ============================================
    // 9. الدفع الآجل
    // ============================================
    if (msg.includes('دفع آجل') || msg.includes('فاتورة') || msg.includes('الفاتورة')) {
        return `📋 **خدمة الدفع الآجل من سوداني:**\n\n` +
               `📱 كود الخدمة: **${sudaniInfo.codes.prepaid}**\n\n` +
               `💡 **مميزات الخدمة:**\n` +
               `• التحكم في الفاتورة\n` +
               `• اختيار الباقات الإضافية\n` +
               `• متابعة الاستهلاك\n\n` +
               `📞 للاشتراك لأول مرة:\n` +
               `• يفضل زيارة أقرب مركز خدمات سوداني\n\n` +
               `🔗 ماي سوداني: ${sudaniInfo.mySudani}`;
    }
    
    // ============================================
    // 10. الروابط
    // ============================================
    if (msg.includes('رابط') || msg.includes('موقع') || msg.includes('ماي سوداني') || msg.includes('my sudani')) {
        return `🔗 **روابط سوداني الرسمية:**\n\n` +
               `🌐 الموقع الرسمي: ${sudaniInfo.website}\n` +
               `📱 ماي سوداني: ${sudaniInfo.mySudani}\n` +
               `💰 صاح: ${sudaniInfo.sahLink}\n\n` +
               `📞 خدمة العملاء: **120**`;
    }
    
    // ============================================
    // 11. الترحيب
    // ============================================
    if (msg.includes('سلام') || msg.includes('مرحب') || msg.includes('هلا')) {
        return `👋 أهلاً وسهلاً بك في **خدمات سوداني**!\n\n` +
               `📱 **أنا هنا لمساعدتك في:**\n` +
               `• باقات المكالمات (ريح بالك، أحلى يوم، خلي عنك)\n` +
               `• خدمات الإنترنت\n` +
               `• خدمة صاح (تحويلات بنكية)\n` +
               `• معرفة الرصيد والشحن\n` +
               `• التحويل من 3G إلى 4G\n\n` +
               `📞 خدمة العملاء: **120**\n` +
               `🔗 ماي سوداني: ${sudaniInfo.mySudani}\n\n` +
               `💬 اسألني عن أي خدمة!`;
    }
    
    return null;
}

// ============================================
// 🤖 دالة الرد (DeepSeek + قاعدة معرفة)
// ============================================

async function getAIResponse(userMessage) {
    // 1. التحقق من القاعدة المحلية أولاً
    const localReply = getLocalResponse(userMessage);
    if (localReply) {
        console.log('✅ تم الرد من قاعدة المعرفة المؤكدة');
        return localReply;
    }
    
    // 2. استخدام DeepSeek مع تعليمات صارمة
    try {
        console.log('🧠 جاري الاتصال بـ DeepSeek...');
        console.log('📩 الرسالة:', userMessage);
        
        const completion = await deepseek.chat.completions.create({
            model: 'deepseek-chat',
            messages: [
                {
                    role: 'system',
                    content: `أنت مساعد رسمي لشركة **سوداني للاتصالات** في السودان.

                    ⚠️ **قواعد صارمة - لا يمكن تجاوزها:**
                    
                    1. **التخصص الحصري:** أنت متخصص فقط في شركة سوداني. لا تقدم أي معلومات عن شركات أخرى.
                    
                    2. **المعلومات الرسمية:** استخدم فقط المعلومات المزودة لك. لا تختلق معلومات.
                    
                    3. **الرد على الأسئلة خارج النطاق:** إذا سألك عن شركة أخرى، قل: 
                    "آسف يا حبيبي، أنا متخصص فقط في خدمات شركة سوداني."
                    
                    **خدمات سوداني الرسمية:**
                    
                    📞 **خدمة العملاء:** 120
                    
                    📱 **باقات المكالمات:**
                    - ريح بالك يوم: *1# (50 دقيقة)
                    - ريح بالك أسبوع: *5# (500 دقيقة)
                    - ريح بالك شهر: *50# (1500 دقيقة)
                    - ريح بالك Max: *55# (1000 دقيقة)
                    - أحلى يوم: *60# (100 دقيقة)
                    - خلي عنك أسبوع: *12#
                    - خلي عنك شهر: *40#
                    
                    📶 **باقات الإنترنت:**
                    - كود الخدمة الرئيسي: *4#
                    - يومية: *4#
                    - 1 جيجا شهري: *4*101#
                    - 2 جيجا شهري: *4*102#
                    - 5 جيجا شهري: *4*8#
                    - 10 جيجا شهري: *4*9#
                    - 15 جيجا LTE: *4*115#
                    - 30 جيجا LTE: *4*130#
                    - 50 جيجا LTE: *4*150#
                    - 100 جيجا LTE: *4*1100#
                    
                    💰 **خدمة صاح:**
                    - كود الخدمة: *500#
                    - تحويل الأموال من بنك لآخر
                    - دفع الفواتير
                    - شراء رصيد
                    
                    💳 **الرصيد والشحن:**
                    - معرفة الرصيد: *222#
                    - تحويل الرصيد: *303*50*رقم المستلم*0000#
                    
                    📋 **خدمات أخرى:**
                    - التحويل من 3G إلى 4G: *4*400#
                    - الدفع الآجل: *444#
                    
                    🔗 **الروابط:**
                    - ماي سوداني: https://my.sudani.sd
                    - صاح: https://sah.sudani.sd
                    
                    تحدث باللهجة السودانية وكن ودوداً ومحترماً.`,
                },
                {
                    role: 'user',
                    content: userMessage
                }
            ],
            temperature: 0.3,
            max_tokens: 600,
        });

        const response = completion.choices[0].message.content;
        console.log('✅ تم استلام الرد من DeepSeek');
        return response;

    } catch (error) {
        console.error('❌ خطأ في DeepSeek:', error.message);
        return `عذراً يا حبيبي، واجهتنا مشكلة تقنية.\n\n` +
               `📞 لكن تقدر تتواصل مع خدمة عملاء سوداني على **120**\n` +
               `🔗 أو تزور ماي سوداني: https://my.sudani.sd\n\n` +
               `آسف على الإزعاج!`;
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
    <title>سوداني بوت</title>
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
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="avatar">س</div>
            <div class="info">
                <h3>🤖 سوداني بوت</h3>
                <p><span class="dot"></span> متصل <span class="badge" style="background:#f7931e;color:#1A2B4A;padding:2px 10px;border-radius:12px;font-size:11px;">رسمي</span></p>
            </div>
        </div>
        <div class="status-bar">
            <span class="mode">🧠 رسمي</span>
            المساعد الذكي لشركة سوداني
        </div>
        <div class="messages-area" id="messagesArea">
            <div class="message bot">
                <div class="bubble">👋 أهلاً وسهلاً بك في <strong>خدمات سوداني</strong>!

📱 أنا هنا لمساعدتك في:
• باقات المكالمات (ريح بالك، أحلى يوم، خلي عنك)
• خدمات الإنترنت
• خدمة صاح (تحويلات بنكية)
• معرفة الرصيد والشحن
• التحويل من 3G إلى 4G

📞 خدمة العملاء: <strong>120</strong>
🔗 ماي سوداني: https://my.sudani.sd

💬 اسألني عن أي خدمة!</div>
                <span class="time">الآن</span>
            </div>
        </div>
        <div class="quick-actions">
            <button onclick="sendQuickMessage('عايز باقة ريح بالك')">📞 ريح بالك</button>
            <button onclick="sendQuickMessage('عايز باقة إنترنت')">📶 إنترنت</button>
            <button onclick="sendQuickMessage('عايز أعرف رصيدي')">💰 الرصيد</button>
            <button onclick="sendQuickMessage('خدمة صاح سوداني')">💵 صاح</button>
            <button onclick="sendQuickMessage('رابط ماي سوداني')">🔗 ماي سوداني</button>
        </div>
        <div class="input-area">
            <input type="text" id="messageInput" placeholder="✍️ اكتب سؤالك هنا..." autofocus>
            <button class="send-btn" id="sendBtn" onclick="sendMessage()">➤</button>
        </div>
    </div>

    <script>
        // ============================================
        // 🔥 تعريف الدوال في النطاق العالمي
        // ============================================
        
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

        // ============================================
        // 📤 دالة الإرسال الرئيسية
        // ============================================
        
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

        // ============================================
        // ⚡ دالة الإرسال السريع
        // ============================================
        
        window.sendQuickMessage = function(text) {
            messageInput.value = text;
            window.sendMessage();
        };

        // ============================================
        // 🎯 ربط مفتاح Enter
        // ============================================
        
        document.addEventListener('DOMContentLoaded', function() {
            if (messageInput) {
                messageInput.addEventListener('keydown', function(e) {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        window.sendMessage();
                    }
                });
            }
            
            console.log('✅ سوداني بوت جاهز!');
            console.log('📱 جميع البيانات محدثة بالكامل');
        });

        // اختبار الاتصال
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
        service: 'Sudani Bot',
        version: '2.0'
    });
});

// ============================================
// 🚀 بدء السيرفر
// ============================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('=================================');
    console.log('🚀 سوداني بوت - النسخة الرسمية 2.0');
    console.log('=================================');
    console.log('✅ السيرفر يعمل على المنفذ: ' + PORT);
    console.log('🌐 http://localhost:' + PORT);
    console.log('=================================');
    console.log('📱 **خدمات سوداني المحدثة:**');
    console.log('   • خدمة العملاء: 120');
    console.log('   • معرفة الرصيد: *222#');
    console.log('   • باقات ريح بالك: *1#, *5#, *50#, *55#');
    console.log('   • باقة أحلى يوم: *60#');
    console.log('   • باقات خلي عنك: *12#, *40#');
    console.log('   • باقات الإنترنت: *4#');
    console.log('   • خدمة صاح: *500#');
    console.log('=================================');
    console.log('🔗 ماي سوداني: https://my.sudani.sd');
    console.log('=================================');
});

process.on('uncaughtException', (error) => {
    console.error('💥 خطأ:', error);
});
