const levenshtein = require('levenshtein');

// تصحيح الأخطاء الإملائية
function correctSpelling(word, dictionary) {
    if (dictionary.includes(word)) return word;
    
    let bestMatch = word;
    let minDistance = Infinity;
    
    for (const dictWord of dictionary) {
        const distance = new levenshtein(word, dictWord).distance;
        if (distance < minDistance && distance <= 2) {
            minDistance = distance;
            bestMatch = dictWord;
        }
    }
    
    return bestMatch;
}

// تنظيف الرسالة
function cleanMessage(message) {
    return message
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFKC');
}

// كلمات ممنوعة
const blockedWords = [
    'ignore previous',
    'api key',
    'system prompt',
    'كلمة السر',
    'مفتاح api'
];

function isBlocked(message) {
    const msg = message.toLowerCase();
    return blockedWords.some(word => msg.includes(word));
}

module.exports = {
    correctSpelling,
    cleanMessage,
    isBlocked,
    blockedWords
};
