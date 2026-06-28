const LRU = require('lru-cache');

class CacheService {
    constructor() {
        this.cache = new LRU({
            max: 1000,
            ttl: 1000 * 60 * 30 // 30 دقيقة
        });
    }

    get(key) {
        return this.cache.get(key);
    }

    set(key, value) {
        this.cache.set(key, value);
    }

    has(key) {
        return this.cache.has(key);
    }

    clear() {
        this.cache.clear();
    }

    get stats() {
        return {
            size: this.cache.size,
            max: this.cache.max
        };
    }
}

module.exports = new CacheService();
