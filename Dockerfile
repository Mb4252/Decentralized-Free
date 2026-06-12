FROM node:20-alpine

WORKDIR /app

# نسخ ملفات الحزم
COPY package*.json ./
RUN npm ci --only=production

# نسخ باقي الملفات
COPY . .

# بناء المشروع
RUN npm run build

# تشغيل التطبيق
EXPOSE 10000
CMD ["npm", "start"]
