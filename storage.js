// storage.js
const DB_NAME = 'ai-video-db';
const DB_VERSION = 1;
const STORE_IMAGES = 'images';
const STORE_AUDIO = 'audio';
const STORE_VIDEOS = 'videos';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_IMAGES))
                db.createObjectStore(STORE_IMAGES, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_AUDIO))
                db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(STORE_VIDEOS))
                db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

const Storage = {
    async saveImage(id, blob, meta = {}) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            tx.objectStore(STORE_IMAGES).put({
                id, blob, meta, createdAt: Date.now()
            });
            tx.oncomplete = () => res(id);
            tx.onerror = () => rej(tx.error);
        });
    },

    async getImage(id) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_IMAGES, 'readonly');
            const req = tx.objectStore(STORE_IMAGES).get(id);
            req.onsuccess = () => res(req.result);
            req.onerror = () => rej(req.error);
        });
    },

    async getAllImages() {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_IMAGES, 'readonly');
            const req = tx.objectStore(STORE_IMAGES).getAll();
            req.onsuccess = () => res(req.result || []);
            req.onerror = () => rej(req.error);
        });
    },

    async deleteImage(id) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            tx.objectStore(STORE_IMAGES).delete(id);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },

    async clearImages() {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_IMAGES, 'readwrite');
            tx.objectStore(STORE_IMAGES).clear();
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },

    async saveVideo(id, blob, meta = {}) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_VIDEOS, 'readwrite');
            tx.objectStore(STORE_VIDEOS).put({
                id, blob, meta, createdAt: Date.now()
            });
            tx.oncomplete = () => res(id);
            tx.onerror = () => rej(tx.error);
        });
    },

    async getAllVideos() {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_VIDEOS, 'readonly');
            const req = tx.objectStore(STORE_VIDEOS).getAll();
            req.onsuccess = () => {
                const videos = req.result || [];
                videos.sort((a, b) => b.createdAt - a.createdAt);
                res(videos);
            };
            req.onerror = () => rej(req.error);
        });
    },

    async deleteVideo(id) {
        const db = await openDB();
        return new Promise((res, rej) => {
            const tx = db.transaction(STORE_VIDEOS, 'readwrite');
            tx.objectStore(STORE_VIDEOS).delete(id);
            tx.oncomplete = () => res();
            tx.onerror = () => rej(tx.error);
        });
    },
};
