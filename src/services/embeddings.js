const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

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
            console.error('❌ خطأ في إنشاء Embedding:', error.message);
            return null;
        }
    }

    cosineSimilarity(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    async buildEmbeddings(knowledgeBase) {
        console.log('🧠 جاري بناء Embeddings...');
        for (const [key, data] of Object.entries(knowledgeBase)) {
            const text = JSON.stringify(data);
            const vector = await this.createEmbedding(text);
            if (vector) {
                this.embeddings.set(key, { vector, data });
                console.log(`✅ تم بناء Embedding: ${key}`);
            }
        }
        this.isReady = true;
        console.log('✅ تم بناء جميع Embeddings');
    }

    async search(query, knowledgeBase, threshold = 0.3) {
        if (!this.isReady) {
            // إذا لم تكن Embeddings جاهزة، استخدم البحث النصي
            return this.textSearch(query, knowledgeBase);
        }

        const queryVector = await this.createEmbedding(query);
        if (!queryVector) return [];

        const results = [];
        for (const [key, entry] of this.embeddings) {
            const similarity = this.cosineSimilarity(queryVector, entry.vector);
            if (similarity > threshold) {
                results.push({
                    key,
                    data: entry.data,
                    similarity
                });
            }
        }

        results.sort((a, b) => b.similarity - a.similarity);
        return results;
    }

    textSearch(query, knowledgeBase) {
        const results = [];
        const keywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        
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
                results.push({ key, data, similarity: 1 });
            }
        }
        return results;
    }
}

module.exports = new EmbeddingsService();
