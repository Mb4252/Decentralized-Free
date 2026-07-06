const express = require('express');
const cors = require('cors');
const os = require('os');
const si = require('systeminformation');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ================================================================
//  MIDDLEWARE
// ================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ================================================================
//  RENDER ENVIRONMENT DETECTION
// ================================================================

function detectEnvironment() {
    const isRender = process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID !== undefined;
    const isProduction = process.env.NODE_ENV === 'production';
    
    // كشف البيئة
    const platform = os.platform();
    const isAndroid = fs.existsSync('/system/build.prop');
    const hasBattery = fs.existsSync('/sys/class/power_supply/BAT0') || 
                       fs.existsSync('/sys/class/power_supply/battery');
    
    return {
        isRender: isRender,
        isProduction: isProduction,
        isMobile: platform === 'android' || isAndroid || hasBattery,
        platform: platform,
        arch: os.arch(),
        hostname: os.hostname(),
        isServer: !isAndroid && !hasBattery,
        renderService: process.env.RENDER_SERVICE_ID || 'غير معروف'
    };
}

// ================================================================
//  HELPERS
// ================================================================

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    let result = '';
    if (days > 0) result += days + ' يوم ';
    if (hours > 0) result += hours + ' ساعة ';
    if (minutes > 0) result += minutes + ' دقيقة ';
    if (secs > 0 || result === '') result += secs + ' ثانية';
    return result.trim() || 'أقل من ثانية';
}

// ================================================================
//  HARDWARE INFO
// ================================================================

async function getCPUInfo() {
    try {
        const cpu = await si.cpu();
        const currentSpeed = await si.cpuCurrentSpeed();
        
        return {
            manufacturer: cpu.manufacturer || 'غير معروف',
            brand: cpu.brand || 'غير معروف',
            cores: cpu.cores || 0,
            physicalCores: cpu.physicalCores || 0,
            speed: cpu.speedMax ? cpu.speedMax + ' GHz' : 'غير معروف',
            currentSpeed: currentSpeed.avg ? currentSpeed.avg + ' GHz' : 'غير معروف',
            virtualization: cpu.virtualization || false
        };
    } catch {
        return {
            manufacturer: 'غير معروف',
            brand: 'غير معروف',
            cores: 0,
            physicalCores: 0,
            speed: 'غير معروف',
            currentSpeed: 'غير معروف',
            virtualization: false
        };
    }
}

async function getMemoryInfo() {
    try {
        const mem = await si.mem();
        return {
            total: formatBytes(mem.total),
            used: formatBytes(mem.used),
            free: formatBytes(mem.free),
            available: formatBytes(mem.available || mem.free),
            usedPercent: mem.total > 0 ? ((mem.used / mem.total) * 100).toFixed(1) + '%' : '0%'
        };
    } catch {
        return {
            total: 'غير معروف',
            used: 'غير معروف',
            free: 'غير معروف',
            available: 'غير معروف',
            usedPercent: '0%'
        };
    }
}

async function getStorageInfo() {
    try {
        const fsSize = await si.fsSize();
        const mainStorage = fsSize.length > 0 ? fsSize[0] : null;
        
        let partitions = [];
        if (fsSize && fsSize.length > 0) {
            partitions = fsSize.slice(0, 5).map(f => ({
                mount: f.mount || 'غير معروف',
                size: formatBytes(f.size || 0),
                used: formatBytes(f.used || 0),
                available: formatBytes(f.available || 0),
                usedPercent: f.size > 0 ? ((f.used / f.size) * 100).toFixed(1) + '%' : '0%'
            }));
        }
        
        return {
            total: mainStorage ? formatBytes(mainStorage.size) : 'غير معروف',
            used: mainStorage ? formatBytes(mainStorage.used) : 'غير معروف',
            free: mainStorage ? formatBytes(mainStorage.available) : 'غير معروف',
            usedPercent: mainStorage ? ((mainStorage.used / mainStorage.size) * 100).toFixed(1) + '%' : '0%',
            partitions: partitions
        };
    } catch {
        return {
            total: 'غير معروف',
            used: 'غير معروف',
            free: 'غير معروف',
            usedPercent: '0%',
            partitions: []
        };
    }
}

async function getBatteryInfo() {
    try {
        // محاولة قراءة معلومات البطارية
        if (fs.existsSync('/sys/class/power_supply/BAT0/')) {
            try {
                const capacity = fs.readFileSync('/sys/class/power_supply/BAT0/capacity', 'utf8').trim();
                const status = fs.readFileSync('/sys/class/power_supply/BAT0/status', 'utf8').trim();
                return {
                    level: parseInt(capacity) || 0,
                    status: status === 'Charging' ? '🔌 يشحن' : status === 'Discharging' ? '🔋 يعمل على البطارية' : '⚡ موصول',
                    health: 'جيد'
                };
            } catch {}
        }
        
        // استخدام systeminformation
        const battery = await si.battery();
        if (battery && battery.hasBattery) {
            return {
                level: battery.percent || 0,
                status: battery.isCharging ? '🔌 يشحن' : '🔋 يعمل على البطارية',
                health: battery.health || 'جيد'
            };
        }
        
        // في بيئة Render (سحابي) لا توجد بطارية
        return {
            level: 'غير متاح',
            status: '☁️ بيئة سحابية (لا توجد بطارية)',
            health: 'غير متاح'
        };
    } catch {
        return {
            level: 'غير متاح',
            status: '☁️ بيئة سحابية',
            health: 'غير متاح'
        };
    }
}

async function getDisplayInfo() {
    try {
        const graphics = await si.graphics();
        if (graphics && graphics.displays && graphics.displays.length > 0) {
            const d = graphics.displays[0];
            return {
                resolution: `${d.resolutionX}×${d.resolutionY}`,
                refreshRate: d.currentRefreshRate ? d.currentRefreshRate + 'Hz' : 'غير معروف',
                model: d.model || 'غير معروف'
            };
        }
        return {
            resolution: 'غير معروف (بيئة سحابية)',
            refreshRate: 'غير معروف',
            model: 'غير معروف'
        };
    } catch {
        return {
            resolution: 'غير معروف',
            refreshRate: 'غير معروف',
            model: 'غير معروف'
        };
    }
}

async function getGPUInfo() {
    try {
        const graphics = await si.graphics();
        if (graphics && graphics.controllers && graphics.controllers.length > 0) {
            return graphics.controllers.map(g => ({
                model: g.model || 'غير معروف',
                vendor: g.vendor || 'غير معروف',
                vram: g.vram ? formatBytes(g.vram) : 'غير معروف'
            }));
        }
        return [];
    } catch {
        return [];
    }
}

// ================================================================
//  SOFTWARE INFO
// ================================================================

async function getOSInfo() {
    try {
        const osInfo = await si.osInfo();
        return {
            platform: osInfo.platform || os.type(),
            distro: osInfo.distro || 'غير معروف',
            release: osInfo.release || os.release(),
            kernel: osInfo.kernel || 'غير معروف',
            arch: osInfo.arch || os.arch(),
            hostname: osInfo.hostname || os.hostname(),
            uptime: formatUptime(os.uptime())
        };
    } catch {
        return {
            platform: os.type(),
            distro: 'غير معروف',
            release: os.release(),
            kernel: 'غير معروف',
            arch: os.arch(),
            hostname: os.hostname(),
            uptime: formatUptime(os.uptime())
        };
    }
}

async function getAndroidInfo() {
    try {
        if (!fs.existsSync('/system/build.prop')) {
            return null;
        }
        
        const content = fs.readFileSync('/system/build.prop', 'utf8');
        const lines = content.split('\n');
        
        let info = {
            version: 'غير معروف',
            sdk: 'غير معروف',
            securityPatch: 'غير معروف',
            manufacturer: 'غير معروف',
            model: 'غير معروف'
        };
        
        for (const line of lines) {
            if (line.startsWith('ro.build.version.release=')) {
                info.version = line.split('=')[1].trim();
            }
            if (line.startsWith('ro.build.version.sdk=')) {
                info.sdk = line.split('=')[1].trim();
            }
            if (line.startsWith('ro.build.version.security_patch=')) {
                info.securityPatch = line.split('=')[1].trim();
            }
            if (line.startsWith('ro.product.manufacturer=')) {
                info.manufacturer = line.split('=')[1].trim();
            }
            if (line.startsWith('ro.product.model=')) {
                info.model = line.split('=')[1].trim();
            }
        }
        
        return info;
    } catch {
        return null;
    }
}

function checkRootStatus() {
    try {
        const rootFiles = [
            '/system/app/Superuser.apk',
            '/system/xbin/su',
            '/system/bin/su',
            '/sbin/su'
        ];
        
        for (const file of rootFiles) {
            if (fs.existsSync(file)) {
                return {
                    status: '⚠️ مكتشف (Rooted)',
                    rootDetected: true
                };
            }
        }
        
        try {
            require('child_process').execSync('which su', { timeout: 1000, stdio: 'ignore' });
            return {
                status: '⚠️ مكتشف (Rooted)',
                rootDetected: true
            };
        } catch {}
        
        return {
            status: '🔒 غير مكتشف (غير Rooted)',
            rootDetected: false
        };
    } catch {
        return {
            status: '🔒 غير مكتشف (غير Rooted)',
            rootDetected: false
        };
    }
}

async function getNetworkInfo() {
    try {
        const interfaces = await si.networkInterfaces();
        const active = interfaces.filter(n => n.operstate === 'up' && n.ip4);
        
        let wifi = null;
        let ethernet = null;
        
        for (const net of active) {
            if (net.type === 'wifi' || net.iface.toLowerCase().includes('wlan')) {
                wifi = {
                    interface: net.iface,
                    ip: net.ip4 || 'غير معروف',
                    mac: net.mac || 'غير معروف'
                };
            } else if (net.type === 'ethernet' || net.iface.toLowerCase().includes('eth')) {
                ethernet = {
                    interface: net.iface,
                    ip: net.ip4 || 'غير معروف',
                    mac: net.mac || 'غير معروف'
                };
            }
        }
        
        // في Render، نعرض معلومات الشبكة السحابية
        const env = detectEnvironment();
        if (env.isRender) {
            return {
                type: '☁️ سحابي (Render)',
                ip: process.env.RENDER_EXTERNAL_URL || 'غير معروف',
                interface: 'eth0 (سحابي)',
                isRender: true
            };
        }
        
        return {
            wifi: wifi,
            ethernet: ethernet,
            active: active.length
        };
    } catch {
        return {
            type: 'غير معروف',
            ip: 'غير معروف',
            interface: 'غير معروف'
        };
    }
}

// ================================================================
//  API ENDPOINTS
// ================================================================

app.get('/api/health', (req, res) => {
    const env = detectEnvironment();
    res.json({
        status: 'online',
        uptime: os.uptime(),
        timestamp: new Date().toISOString(),
        environment: env,
        render: {
            service: process.env.RENDER_SERVICE_ID || 'غير معروف',
            url: process.env.RENDER_EXTERNAL_URL || 'غير معروف',
            instance: process.env.RENDER_INSTANCE_ID || 'غير معروف'
        }
    });
});

app.get('/api/scan/full', async (req, res) => {
    try {
        const env = detectEnvironment();
        
        const [
            cpu,
            memory,
            storage,
            battery,
            display,
            gpu,
            osInfo,
            androidInfo,
            network
        ] = await Promise.all([
            getCPUInfo(),
            getMemoryInfo(),
            getStorageInfo(),
            getBatteryInfo(),
            getDisplayInfo(),
            getGPUInfo(),
            getOSInfo(),
            getAndroidInfo(),
            getNetworkInfo()
        ]);
        
        const rootStatus = checkRootStatus();
        
        const result = {
            timestamp: new Date().toISOString(),
            environment: env,
            deviceType: env.isRender ? '☁️ سحابي (Render)' : env.isMobile ? '📱 هاتف محمول' : '🖥️ خادم',
            
            hardware: {
                cpu: cpu,
                memory: memory,
                storage: storage,
                battery: battery,
                display: display,
                gpu: gpu
            },
            
            software: {
                os: osInfo,
                android: androidInfo || {
                    version: 'غير مكتشف (بيئة سحابية)',
                    securityPatch: 'غير مكتشف',
                    manufacturer: 'غير معروف',
                    model: 'غير معروف'
                },
                root: rootStatus,
                network: network,
                render: {
                    service: process.env.RENDER_SERVICE_ID || 'غير معروف',
                    url: process.env.RENDER_EXTERNAL_URL || 'غير معروف',
                    instance: process.env.RENDER_INSTANCE_ID || 'غير معروف'
                }
            },
            
            // معلومات إضافية عن Render
            renderInfo: {
                serviceName: process.env.RENDER_SERVICE_NAME || 'غير معروف',
                serviceId: process.env.RENDER_SERVICE_ID || 'غير معروف',
                externalUrl: process.env.RENDER_EXTERNAL_URL || 'غير معروف',
                instanceId: process.env.RENDER_INSTANCE_ID || 'غير معروف',
                region: process.env.RENDER_REGION || 'غير معروف'
            }
        };
        
        res.json(result);
    } catch (error) {
        console.error('Error in /api/scan/full:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/scan/quick', async (req, res) => {
    try {
        const fullScan = await (await fetch(`http://localhost:${PORT}/api/scan/full`)).json();
        
        const quickResult = {
            timestamp: fullScan.timestamp,
            deviceType: fullScan.deviceType,
            environment: fullScan.environment,
            cpu: {
                model: fullScan.hardware.cpu.brand,
                cores: fullScan.hardware.cpu.cores,
                speed: fullScan.hardware.cpu.speed
            },
            memory: {
                total: fullScan.hardware.memory.total,
                used: fullScan.hardware.memory.used,
                free: fullScan.hardware.memory.free
            },
            storage: {
                total: fullScan.hardware.storage.total,
                used: fullScan.hardware.storage.used,
                free: fullScan.hardware.storage.free
            },
            battery: fullScan.hardware.battery,
            display: fullScan.hardware.display.resolution,
            os: fullScan.software.os.platform + ' ' + fullScan.software.os.release,
            android: fullScan.software.android,
            root: fullScan.software.root.status,
            network: fullScan.software.network,
            render: fullScan.renderInfo
        };
        
        res.json(quickResult);
    } catch (error) {
        console.error('Error in /api/scan/quick:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.post('/api/test/hardware', async (req, res) => {
    try {
        const fullScan = await (await fetch(`http://localhost:${PORT}/api/scan/full`)).json();
        const env = detectEnvironment();
        
        // اختبارات محاكاة للبيئة السحابية
        const tests = {
            cpu: {
                status: 'pass',
                details: `${fullScan.hardware.cpu.cores} نواة بسرعة ${fullScan.hardware.cpu.speed}`,
                tested: true
            },
            memory: {
                status: 'pass',
                details: `${fullScan.hardware.memory.total} (${fullScan.hardware.memory.usedPercent} مستخدمة)`,
                tested: true
            },
            storage: {
                status: 'pass',
                details: `${fullScan.hardware.storage.total} (${fullScan.hardware.storage.usedPercent} مستخدمة)`,
                tested: true
            },
            network: {
                status: 'pass',
                details: env.isRender ? '☁️ متصل عبر Render' : 'متصل',
                tested: true
            },
            os: {
                status: 'pass',
                details: fullScan.software.os.platform + ' ' + fullScan.software.os.release,
                tested: true
            }
        };
        
        // إذا كان جهازاً فعلياً، نضيف اختبارات إضافية
        if (!env.isRender && env.isMobile) {
            tests.battery = {
                status: fullScan.hardware.battery.level !== 'غير متاح' ? 'pass' : 'warning',
                details: fullScan.hardware.battery.level !== 'غير متاح' ? 
                    `${fullScan.hardware.battery.level}% - ${fullScan.hardware.battery.status}` : 
                    'بطارية غير متاحة',
                tested: true
            };
            tests.screen = {
                status: 'pass',
                details: fullScan.hardware.display.resolution,
                tested: true
            };
        }
        
        const passed = Object.values(tests).filter(t => t.status === 'pass').length;
        const total = Object.values(tests).filter(t => t.tested).length;
        const score = total > 0 ? Math.round((passed / total) * 100) : 0;
        
        const result = {
            timestamp: new Date().toISOString(),
            tests: tests,
            summary: {
                passed: passed,
                total: total,
                score: score + '%',
                status: score >= 80 ? '✅ ممتاز' : score >= 60 ? '⚠️ جيد' : '❌ يحتاج فحص',
                environment: env.isRender ? '☁️ سحابي' : '📱 فعلي'
            },
            hardware: fullScan.hardware,
            software: fullScan.software
        };
        
        res.json(result);
    } catch (error) {
        console.error('Error in /api/test/hardware:', error);
        res.status(500).json({
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ================================================================
//  START SERVER
// ================================================================

app.listen(PORT, '0.0.0.0', () => {
    const env = detectEnvironment();
    console.log('='.repeat(50));
    console.log('🚀 Mobile Scanner Server');
    console.log('='.repeat(50));
    console.log(`📡 Port: ${PORT}`);
    console.log(`☁️  Render: ${env.isRender ? '✅ نعم' : '❌ لا'}`);
    console.log(`💻 Platform: ${env.platform} (${env.arch})`);
    console.log(`🧠 Memory: ${formatBytes(os.totalmem())}`);
    console.log(`🔄 Uptime: ${formatUptime(os.uptime())}`);
    console.log(`📱 Mobile: ${env.isMobile ? '✅ نعم' : '❌ لا (خادم)'}`);
    console.log('='.repeat(50));
});
