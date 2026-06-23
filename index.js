const { Web3 } = require('web3');
const express = require('express');
const path = require('path');
const app = express();
const port = process.env.PORT || 3000;

// الاتصال بالشبكة
const web3 = new Web3('https://bsc-dataseed.binance.org/');

// مصفوفة لتخزين النتائج
let scanResults = [];

// إعداد تقديم الملفات الثابتة (Static Files)
app.use(express.static('public'));

// مسار API لجلب البيانات
app.get('/api/results', (req, res) => {
    res.json(scanResults);
});

// منطق الفحص (تحديث المصفوفة)
async function scanContracts() {
    const targetContracts = ["0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"]; // ضع العناوين هنا
    for (const address of targetContracts) {
        try {
            const balance = await web3.eth.getBalance(address);
            const balanceInBnb = web3.utils.fromWei(balance, 'ether');
            
            if (parseFloat(balanceInBnb) > 0) {
                // إضافة النتيجة للمصفوفة إذا لم تكن موجودة
                if (!scanResults.find(r => r.address === address)) {
                    scanResults.push({ address, balance: balanceInBnb, time: new Date().toLocaleTimeString() });
                }
            }
        } catch (err) { console.error(err); }
    }
}

setInterval(scanContracts, 60000); // فحص كل دقيقة
app.listen(port, () => console.log(`Dashboard running on port ${port}`));
