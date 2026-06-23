const { Web3 } = require('web3');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// الاتصال بـ BSC
const web3 = new Web3('https://bsc-dataseed.binance.org/');

let scanResults = [];

// 1. وظيفة توليد عنوان عشوائي
function generateRandomAddress() {
    return '0x' + Array.from({length: 40}, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

// 2. وظيفة الفحص
async function scan() {
    console.log("--- بدء دورة فحص جديدة ---");
    
    // أ- محاولة بحث عشوائي (احتمالية ضئيلة جداً لكنها عشوائية)
    const randomAddr = generateRandomAddress();
    await checkAddress(randomAddr);

    // ب- البحث في نشاط الشبكة الحقيقي (أخذ عينة من آخر كتلة)
    try {
        const latestBlock = await web3.eth.getBlock('latest', true);
        const randomTx = latestBlock.transactions[Math.floor(Math.random() * latestBlock.transactions.length)];
        if (randomTx.to) {
            await checkAddress(randomTx.to);
        }
    } catch (err) {
        console.error("خطأ في أخذ العينة من الشبكة");
    }
}

async function checkAddress(address) {
    try {
        const code = await web3.eth.getCode(address);
        // نتأكد أنه عقد (ليس محفظة شخصية)
        if (code !== '0x') {
            const balance = await web3.eth.getBalance(address);
            const balanceInBnb = web3.utils.fromWei(balance, 'ether');
            
            if (parseFloat(balanceInBnb) > 0) {
                console.log(`[!] تم العثور: ${address} | الرصيد: ${balanceInBnb} BNB`);
                scanResults.push({ address, balance: balanceInBnb, time: new Date().toLocaleTimeString() });
            }
        }
    } catch (e) { /* تجاهل الأخطاء */ }
}

// مسارات الويب
app.use(express.static('public'));
app.get('/api/results', (req, res) => res.json(scanResults));
app.listen(port, () => console.log(`Dashboard running on ${port}`));

// تشغيل الفحص كل 10 ثواني (سريع)
setInterval(scan, 10000);
