FROM node:20-alpine

# تعيين مجلد العمل
WORKDIR /app

# نسخ ملفات الحزم
COPY package*.json ./

# تثبيت الحزم (بدون الحاجة إلى package-lock.json)
RUN npm install

# نسخ جميع ملفات المشروع
COPY . .

# بناء مشروع Next.js
RUN npm run build

# تشغيل التطبيق على المنفذ 10000 (منفذ Render الافتراضي)
EXPOSE 10000

# تشغيل الخادم
CMD ["npm", "start"]
