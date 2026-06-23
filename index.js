const { Web3 } = require('web3');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

// إعداد الاتصال بـ BSC
const web3 = new Web3('https://bsc-dataseed.binance.org/');

// خادم بسيط لإبقاء الخدمة تعمل على Render
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Server listening on port ${port}`));

// منطق الفحص
async function scanContracts() {
    const targetContracts = ["0x..."]; // ضع قائمة العناوين هنا
    
    console.log("بدء دورة الفحص...");
    
    for (const address of targetContracts) {
        try {
            const balance = await web3.eth.getBalance(address);
            const balanceInBnb = web3.utils.fromWei(balance, 'ether');
            
            if (parseFloat(balanceInBnb) > 0) {
                console.log(`[!] تم العثور على رصيد في ${address}: ${balanceInBnb} BNB`);
            }
        } catch (err) {
            console.error(`خطأ في فحص ${address}`);
        }
    }
}

// تشغيل الفحص كل 60 ثانية
setInterval(scanContracts, 60000);
