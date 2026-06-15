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
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h1>تنبيه مهم</h1>
    <div class="message">
      يا ابراهيم<br>
      دا حرام عديل<br>
      <small>وربا ودا اكل مال ناس الله بينا وبينو</small>
    </div>
    <button class="button" onclick="window.close()">فهمت</button>
    <div class="footer">هذه رسالة تحذيرية</div>
  </div>

  <script>
    // يمكن إغلاق النافذة أو العودة للصفحة السابقة
    document.querySelector('.button').onclick = function() {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.close();
      }
    };
  </script>
</body>
</html>
