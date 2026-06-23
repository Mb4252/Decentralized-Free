const { Web3 } = require('web3');
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const web3 = new Web3('https://bsc-dataseed.binance.org/');

let scanResults = [];

// بصمة وظيفة withdraw()
const WITHDRAW_SELECTOR = '3ccfd60b';

async function scanContracts() {
    console.log("🔍 جاري البحث عن عقود بها رصيد ووظيفة سحب...");
    
    // هنا نأخذ عينة من الشبكة (آخر معاملات)
    const latestBlock = await web3.eth.getBlock('latest', true);
    
    for (let tx of latestBlock.transactions) {
        if (!tx.to) continue; // تخطي المعاملات التي لا تتوجه لعقود

        try {
            // 1. التحقق من الرصيد
            const balance = await web3.eth.getBalance(tx.to);
            const balanceInBnb = web3.utils.fromWei(balance, 'ether');
            
            if (parseFloat(balanceInBnb) > 0) {
                // 2. جلب كود العقد للتحقق من وجود وظيفة السحب
                const code = await web3.eth.getCode(tx.to);
                
                // البحث عن البصمة في كود العقد (Bytecode)
                if (code.includes(WITHDRAW_SELECTOR)) {
                    if (!scanResults.find(r => r.address === tx.to)) {
                        scanResults.push({ 
                            address: tx.to, 
                            balance: balanceInBnb, 
                            time: new Date().toLocaleTimeString(),
                            note: "Withdraw Found"
                        });
                        console.log(`[!] وجدنا عقداً مطابقاً: ${tx.to}`);
                    }
                }
            }
        } catch (err) {
            // تجاهل الأخطاء (مثل عناوين لا تحتوي على كود)
        }
    }
}

app.use(express.static('public'));
app.get('/api/results', (req, res) => res.json(scanResults));
app.listen(port, () => console.log(`Scanner running on port ${port}`));

// تشغيل الفحص كل 30 ثانية
setInterval(scanContracts, 30000);
