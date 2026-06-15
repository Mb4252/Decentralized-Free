const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
  <title>رسالة مهمة</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      min-height: 100vh;
      background: linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 100%);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Cairo', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
      overflow-x: hidden;
    }

    .card {
      background: rgba(26, 26, 46, 0.95);
      backdrop-filter: blur(12px);
      border-radius: 32px;
      padding: 40px 28px;
      max-width: 500px;
      width: 100%;
      border: 1px solid #ff4444;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
      text-align: center;
      z-index: 10;
      transition: all 0.5s ease;
    }

    .card.hidden {
      opacity: 0;
      visibility: hidden;
      transform: scale(0.8);
    }

    .icon {
      font-size: 64px;
      margin-bottom: 24px;
    }

    h1 {
      color: #ff4444;
      font-size: 24px;
      margin-bottom: 20px;
      font-weight: bold;
    }

    .message {
      color: #eeeeee;
      font-size: 22px;
      line-height: 1.6;
      margin-bottom: 30px;
      font-weight: 500;
    }

    .message small {
      font-size: 16px;
      color: #ff8888;
      display: block;
      margin-top: 15px;
    }

    .button {
      background: linear-gradient(135deg, #ff4444, #cc0000);
      color: white;
      border: none;
      padding: 14px 28px;
      border-radius: 60px;
      font-size: 16px;
      font-weight: bold;
      cursor: pointer;
      transition: all 0.3s;
      width: 100%;
      max-width: 200px;
      margin: 0 auto;
      display: block;
    }

    .button:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 25px -5px rgba(255,68,68,0.4);
    }

    .footer {
      margin-top: 24px;
      color: #8899aa;
      font-size: 12px;
    }

    .sticker {
      position: fixed;
      font-size: 50px;
      pointer-events: none;
      z-index: 100;
      animation: fallDown 3s ease-in forwards;
    }

    @keyframes fallDown {
      0% {
        transform: translateY(-100px) rotate(0deg);
        opacity: 1;
      }
      100% {
        transform: translateY(100vh) rotate(360deg);
        opacity: 0;
      }
    }

    .reward-message {
      position: fixed;
      bottom: -100px;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #00aa55, #00cc77);
      color: white;
      text-align: center;
      padding: 20px;
      font-size: 20px;
      font-weight: bold;
      z-index: 200;
      transition: bottom 0.5s ease;
      box-shadow: 0 -5px 30px rgba(0,255,100,0.3);
    }

    .reward-message.show {
      bottom: 0;
    }

    .reward-message span {
      display: block;
      font-size: 14px;
      margin-top: 8px;
      color: #d4ffd4;
    }
  </style>
</head>
<body>
  <div class="card" id="mainCard">
    <div class="icon">⚠️</div>
    <h1>تنبيه مهم</h1>
    <div class="message">
      يا ابراهيم<br>
      دا حرام عديل<br>
      <small>وربا واكل اموال ناس بي الباطل<br>الله بينا وبينو</small>
    </div>
    <button class="button" id="understandBtn">فهمت</button>
    <div class="footer">هذه رسالة تحذيرية</div>
  </div>

  <div class="reward-message" id="rewardMessage">
    🤲 من ترك شيئاً لله عوضه خير منه 🤲
    <span>اللهم ارزقه التوبة والهداية</span>
  </div>

  <script>
    const sadStickers = [
      '😢', '😭', '💔', '😞', '😔', '🥺', '😿', '💧', 
      '😫', '😩', '😪', '🌧️', '⚡', '☁️', '💫', '✨',
      '🕊️', '🤲', '🙏', '💚', '🫂', '❤️‍🩹', '🕯️'
    ];

    const cryingStickers = [
      '😭😭😭', '💔💔💔', '😢😢😢', '🥺🥺🥺', '😭💔😭', 
      '💧😭💧', '😫😫😫', '😩😩😩', '💔🫂💔', '🕊️🤲🕊️'
    ];

    function createSticker(stickerText, delay = 0) {
      setTimeout(() => {
        const sticker = document.createElement('div');
        sticker.className = 'sticker';
        sticker.textContent = stickerText;
        const randomX = Math.random() * (window.innerWidth - 60);
        sticker.style.left = randomX + 'px';
        sticker.style.fontSize = (Math.random() * 40 + 40) + 'px';
        sticker.style.position = 'fixed';
        sticker.style.top = '-50px';
        document.body.appendChild(sticker);
        setTimeout(() => sticker.remove(), 3000);
      }, delay);
    }

    function startStickersRain() {
      for (let i = 0; i < 25; i++) {
        const randomSticker = sadStickers[Math.floor(Math.random() * sadStickers.length)];
        createSticker(randomSticker, i * 80);
      }
      
      setTimeout(() => {
        for (let i = 0; i < 20; i++) {
          const randomCry = cryingStickers[Math.floor(Math.random() * cryingStickers.length)];
          createSticker(randomCry, i * 100);
        }
      }, 2000);
      
      setTimeout(() => {
        for (let i = 0; i < 15; i++) {
          const randomSticker = sadStickers[Math.floor(Math.random() * sadStickers.length)];
          createSticker(randomSticker, i * 120);
        }
      }, 4000);
    }

    function showRewardMessage() {
      const rewardMsg = document.getElementById('rewardMessage');
      rewardMsg.classList.add('show');
      setTimeout(() => rewardMsg.classList.remove('show'), 8000);
    }

    document.getElementById('understandBtn').onclick = () => {
      const card = document.getElementById('mainCard');
      card.classList.add('hidden');
      startStickersRain();
      setTimeout(() => showRewardMessage(), 2000);
      setTimeout(() => document.title = '🤲 من ترك شيئاً لله عوضه خير منه 🤲', 1000);
    };
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔════════════════════════════════════════════════╗
  ║   🚀 صفحة التحذير تعمل بنجاح                   ║
  ║   📡 المنفذ: ${PORT}                              ║
  ║   🌐 http://localhost:${PORT}                    ║
  ╚════════════════════════════════════════════════╝
  `);
});
