const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const logger = require('../utils/logger');

class MemoryService {
    constructor() {
        this.dbPath = path.join(__dirname, '../database/db.sqlite');
        this.db = new sqlite3.Database(this.dbPath);
        this.initDatabase();
        this.conversations = new Map();
        this.userProfiles = new Map();
    }

    initDatabase() {
        this.db.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                role TEXT,
                content TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        this.db.run(`
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

        this.db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                question TEXT,
                answer TEXT,
                rating INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    getHistory(userId, limit = 15) {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT role, content FROM conversations 
                 WHERE user_id = ? 
                 ORDER BY timestamp DESC LIMIT ?`,
                [userId, limit],
                (err, rows) => {
                    if (err) {
                        logger.error('❌ خطأ في جلب المحادثة:', err);
                        resolve([]);
                        return;
                    }
                    resolve(rows.reverse());
                }
            );
        });
    }

    addMessage(userId, role, content) {
        this.db.run(
            `INSERT INTO conversations (user_id, role, content) VALUES (?, ?, ?)`,
            [userId, role, content],
            (err) => {
                if (err) logger.error('❌ خطأ في حفظ الرسالة:', err);
            }
        );
    }

    getUserProfile(userId) {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT * FROM user_profiles WHERE user_id = ?`,
                [userId],
                (err, row) => {
                    if (err) {
                        logger.error('❌ خطأ في جلب الملف الشخصي:', err);
                        resolve(null);
                        return;
                    }
                    if (!row) {
                        // إنشاء ملف شخصي جديد
                        this.db.run(
                            `INSERT INTO user_profiles (user_id, last_visit, message_count) VALUES (?, ?, ?)`,
                            [userId, new Date().toISOString(), 0]
                        );
                        resolve({
                            user_id: userId,
                            last_service: null,
                            language: 'arabic',
                            customer_type: null,
                            last_package: null,
                            summary: '',
                            last_visit: new Date(),
                            message_count: 0
                        });
                        return;
                    }
                    resolve(row);
                }
            );
        });
    }

    updateUserProfile(userId, data) {
        const fields = Object.keys(data).map(key => `${key} = ?`).join(', ');
        const values = Object.values(data);
        values.push(userId);
        
        this.db.run(
            `UPDATE user_profiles SET ${fields} WHERE user_id = ?`,
            values,
            (err) => {
                if (err) logger.error('❌ خطأ في تحديث الملف الشخصي:', err);
            }
        );
    }

    saveFeedback(userId, question, answer, rating) {
        this.db.run(
            `INSERT INTO feedback (user_id, question, answer, rating) VALUES (?, ?, ?, ?)`,
            [userId, question, answer, rating],
            (err) => {
                if (err) logger.error('❌ خطأ في حفظ التقييم:', err);
            }
        );
    }

    getStats() {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT 
                    COUNT(*) as total_messages,
                    COUNT(DISTINCT user_id) as total_users,
                    AVG(rating) as avg_rating
                 FROM conversations c
                 LEFT JOIN feedback f ON c.user_id = f.user_id`,
                (err, row) => {
                    if (err) {
                        logger.error('❌ خطأ في جلب الإحصائيات:', err);
                        resolve({ total_messages: 0, total_users: 0, avg_rating: 0 });
                        return;
                    }
                    resolve(row);
                }
            );
        });
    }

    async summarizeHistory(userId) {
        const history = await this.getHistory(userId, 20);
        if (history.length < 5) return null;

        const messages = history.map(h => `${h.role}: ${h.content}`).join('\n');
        return `ملخص المحادثة السابقة:\n${messages.slice(0, 500)}...`;
    }

    async cleanHistory(userId) {
        const history = await this.getHistory(userId, 20);
        if (history.length > 20) {
            const summary = await this.summarizeHistory(userId);
            if (summary) {
                // حذف المحادثة القديمة
                this.db.run(
                    `DELETE FROM conversations WHERE user_id = ? AND timestamp < datetime('now', '-1 day')`,
                    [userId]
                );
                // إضافة الملخص كنظام
                this.addMessage(userId, 'system', summary);
            }
        }
    }
}

module.exports = new MemoryService();
