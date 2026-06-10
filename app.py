import os
import json
import hashlib
import datetime
import threading
import requests
import socket
import math
import secrets
import string
import io
import base64
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, redirect, render_template, session
from flask_cors import CORS
from PIL import Image, ImageFilter, ImageStat
from scipy.spatial.distance import euclidean
from scipy.fft import fft2, fftshift
from skimage.feature import local_binary_pattern
from skimage.filters import sobel, gabor
from skimage.transform import radon
from datetime import datetime as dt
from functools import wraps

app = Flask(__name__, static_folder='static', static_url_path='/static', template_folder='templates')
app.secret_key = os.environ.get('SECRET_KEY', secrets.token_hex(32))
CORS(app)

# ------------------- الإعدادات -------------------
PORT = int(os.environ.get('PORT', 5000))

DATA_DIR = os.environ.get('DATA_DIR', '/data')
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except PermissionError:
    DATA_DIR = os.path.join(os.getcwd(), 'ledger_data')
    os.makedirs(DATA_DIR, exist_ok=True)

# ملفات التخزين (للبيانات المشفرة فقط، لا صور)
LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')
INVITES_FILE = os.path.join(DATA_DIR, 'invites.json')
FREE_USERS_FILE = os.path.join(DATA_DIR, 'free_users_count.json')

# ------------------- إعدادات الأمان -------------------
MAX_FREE_USERS = 100
MIN_TRUST_SCORE_TO_VOTE = 50
CONSENSUS_THRESHOLD = 0.6
BIOMETRIC_THRESHOLD = 0.4
MATCH_PERCENTAGE_REQUIRED = 85
SESSION_TIMEOUT = 300  # 5 دقائق

# ------------------- إدارة الجلسات والتوكن -------------------
active_sessions = {}

def generate_session_token():
    """توليد توكن جلسة مشفر"""
    return secrets.token_urlsafe(32)

def verify_session_token(token):
    """التحقق من صحة توكن الجلسة"""
    if token not in active_sessions:
        return False
    if (dt.now() - active_sessions[token]).total_seconds() > SESSION_TIMEOUT:
        del active_sessions[token]
        return False
    return True

def require_session(f):
    """Decorator للتحقق من الجلسة"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('X-Session-Token')
        if not token or not verify_session_token(token):
            return jsonify({"error": "جلسة غير صالحة أو منتهية"}), 401
        return f(*args, **kwargs)
    return decorated_function

# ------------------- دوال معالجة الصور في الذاكرة (RAM-only) -------------------
def process_image_in_memory(image_bytes):
    """
    معالجة الصورة بالكامل في الذاكرة (RAM-only)
    لا يتم حفظ أي شيء على القرص
    """
    # تحميل الصورة إلى RAM فقط باستخدام BytesIO
    image_stream = io.BytesIO(image_bytes)
    image = Image.open(image_stream)
    
    # تحويل إلى numpy array للمعالجة الرياضية
    img_array = np.array(image)
    
    # مسح الـ BytesIO فوراً بعد الاستخدام
    image_stream.close()
    
    return image, img_array

def analyze_physical_reflection(img_array):
    """
    تحليل الانعكاس الفيزيائي لتمييز المستند الحقيقي عن الشاشات
    """
    try:
        # تحويل إلى تدرج رمادي
        if len(img_array.shape) == 3:
            gray = np.mean(img_array, axis=2)
        else:
            gray = img_array
        
        # تحليل الانعكاسات الضوئية
        # الصور من الشاشات تظهر انعكاسات منتظمة
        gradient_x = np.gradient(gray, axis=0)
        gradient_y = np.gradient(gray, axis=1)
        gradient_magnitude = np.sqrt(gradient_x**2 + gradient_y**2)
        
        # حساب توزيع الانعكاسات
        reflection_pattern = np.mean(gradient_magnitude)
        reflection_variance = np.var(gradient_magnitude)
        
        # المستندات الحقيقية لها توزيع عشوائي للانعكاسات
        is_physical = reflection_variance > 15 and reflection_pattern > 8
        
        return {
            "is_physical": is_physical,
            "reflection_mean": float(reflection_pattern),
            "reflection_variance": float(reflection_variance),
            "score": min(100, max(0, int((reflection_pattern / 20) * 100)))
        }
    except Exception as e:
        return {"is_physical": False, "error": str(e), "score": 0}

def analyze_frequency_fractals(img_array):
    """
    تحليل الترددات والتفاصيل الكسرية (Fourier Transform)
    لكشف التلاعب الرقمي
    """
    try:
        # تحويل إلى تدرج رمادي
        if len(img_array.shape) == 3:
            gray = np.mean(img_array, axis=2)
        else:
            gray = img_array
        
        # تطبيق تحويل فورييه السريع
        f_transform = fft2(gray)
        f_shift = fftshift(f_transform)
        magnitude_spectrum = np.abs(f_shift)
        
        # تحليل الترددات العالية (التفاصيل الدقيقة)
        rows, cols = gray.shape
        crow, ccol = rows // 2, cols // 2
        
        # حساب متوسط الترددات العالية
        high_freq_zone = magnitude_spectrum[crow-30:crow+30, ccol-30:ccol+30]
        high_freq_mean = np.mean(high_freq_zone)
        high_freq_std = np.std(high_freq_zone)
        
        # حساب الإنتروبي (قياس التعقيد)
        hist, _ = np.histogram(gray.flatten(), 256, [0,256])
        hist = hist / (gray.size + 1e-6)
        entropy = -np.sum(hist * np.log2(hist + 1e-6))
        
        # المستندات الحقيقية لها ترددات عالية متنوعة
        has_valid_fractals = (entropy > 5.5) and (high_freq_std > 20)
        
        return {
            "has_valid_fractals": has_valid_fractals,
            "entropy": float(entropy),
            "high_freq_complexity": float(high_freq_std),
            "score": min(100, max(0, int(entropy * 10)))
        }
    except Exception as e:
        return {"has_valid_fractals": False, "error": str(e), "score": 0}

def analyze_security_printing(img_array):
    """
    تحليل الطباعة الأمنية وتدرج الألوان
    """
    try:
        if len(img_array.shape) != 3:
            return {"is_secure": False, "error": "صورة غير ملونة", "score": 0}
        
        # تحليل تدرج الألوان في المناطق الأمنية
        r_channel = img_array[:, :, 0]
        g_channel = img_array[:, :, 1]
        b_channel = img_array[:, :, 2]
        
        # حساب التباين في كل قناة
        r_variance = np.var(r_channel)
        g_variance = np.var(g_channel)
        b_variance = np.var(b_channel)
        
        # المستندات الحقيقية لها تباين متوازن
        color_balance = (r_variance + g_variance + b_variance) / 3
        is_balanced = (color_balance > 500) and (max(r_variance, g_variance, b_variance) / (min(r_variance, g_variance, b_variance) + 1) < 3)
        
        return {
            "is_secure": is_balanced,
            "color_variance": float(color_balance),
            "balance_ratio": float(max(r_variance, g_variance, b_variance) / (min(r_variance, g_variance, b_variance) + 1)),
            "score": min(100, max(0, int(color_balance / 20)))
        }
    except Exception as e:
        return {"is_secure": False, "error": str(e), "score": 0}

def detect_face_and_get_embedding(img_array):
    """
    استخراج بصمة الوجه باستخدام face-api.js (يتم في المتصفح)
    هذه الدالة تحاكي الاستقبال
    """
    # يتم استخراج الـ Embedding في المتصفح وإرساله للخادم
    pass

def comprehensive_document_verification(image_bytes):
    """
    التحقق الشامل من المستند (في الذاكرة فقط)
    """
    try:
        # تحميل الصورة في الذاكرة
        image, img_array = process_image_in_memory(image_bytes)
        
        # 1. تحليل الانعكاس الفيزيائي
        reflection_result = analyze_physical_reflection(img_array)
        
        # 2. تحليل الترددات الكسرية
        fractal_result = analyze_frequency_fractals(img_array)
        
        # 3. تحليل الطباعة الأمنية
        security_result = analyze_security_printing(img_array)
        
        # حساب النتيجة الإجمالية (وزن لكل عامل)
        total_score = (
            reflection_result.get('score', 0) * 0.4 +
            fractal_result.get('score', 0) * 0.35 +
            security_result.get('score', 0) * 0.25
        )
        
        is_authentic = (
            reflection_result.get('is_physical', False) and
            fractal_result.get('has_valid_fractals', False) and
            security_result.get('is_secure', False) and
            total_score > 60
        )
        
        # مسح الصورة من الذاكرة (تسريح الموارد)
        del image
        del img_array
        
        return {
            "is_authentic": is_authentic,
            "total_score": round(total_score, 2),
            "details": {
                "reflection": reflection_result,
                "fractals": fractal_result,
                "security_printing": security_result
            }
        }
    except Exception as e:
        return {"is_authentic": False, "error": str(e), "total_score": 0}

# ------------------- Blockchain والفئات الأخرى -------------------
class Block:
    def __init__(self, index, name, face_hash, document_hash, document_type, timestamp, previous_hash, 
                 node_id=None, status='pending', witness_votes=None, trust_score_required=0):
        self.index = index
        self.name = name
        self.face_hash = face_hash
        self.document_hash = document_hash
        self.document_type = document_type
        self.timestamp = timestamp
        self.previous_hash = previous_hash
        self.node_id = node_id or socket.gethostname()
        self.status = status
        self.witness_votes = witness_votes or {'approve': [], 'reject': []}
        self.trust_score_required = trust_score_required
        self.hash = self.compute_hash()

    def compute_hash(self):
        block_string = json.dumps({
            "index": self.index,
            "name": self.name,
            "face_hash": self.face_hash,
            "document_hash": self.document_hash,
            "document_type": self.document_type,
            "timestamp": self.timestamp,
            "previous_hash": self.previous_hash,
            "node_id": self.node_id,
            "status": self.status,
            "witness_votes": self.witness_votes,
            "trust_score_required": self.trust_score_required
        }, sort_keys=True).encode()
        return hashlib.sha256(block_string).hexdigest()

class Blockchain:
    def __init__(self, ledger_file=LEDGER_FILE):
        self.ledger_file = ledger_file
        self.chain = []
        self.load_chain()

    def load_chain(self):
        try:
            with open(self.ledger_file, 'r') as f:
                data = json.load(f)
                self.chain = []
                for block_data in data:
                    block = Block(
                        block_data['index'],
                        block_data['name'],
                        block_data['face_hash'],
                        block_data['document_hash'],
                        block_data.get('document_type', 'غير محدد'),
                        block_data['timestamp'],
                        block_data['previous_hash'],
                        block_data.get('node_id', 'unknown'),
                        block_data.get('status', 'approved'),
                        block_data.get('witness_votes', {'approve': [], 'reject': []}),
                        block_data.get('trust_score_required', 0)
                    )
                    block.hash = block_data['hash']
                    self.chain.append(block)
        except FileNotFoundError:
            genesis = Block(0, "Genesis", "0", "0", "genesis", str(dt.now()), "0", "genesis", 'approved')
            self.chain = [genesis]
            self.save_chain()

    def save_chain(self):
        data = []
        for block in self.chain:
            data.append({
                "index": block.index,
                "name": block.name,
                "face_hash": block.face_hash,
                "document_hash": block.document_hash,
                "document_type": block.document_type,
                "timestamp": block.timestamp,
                "previous_hash": block.previous_hash,
                "node_id": block.node_id,
                "status": block.status,
                "witness_votes": block.witness_votes,
                "trust_score_required": block.trust_score_required,
                "hash": block.hash
            })
        with open(self.ledger_file, 'w') as f:
            json.dump(data, f, indent=2)

    def get_last_block(self):
        return self.chain[-1]

    def add_pending_block(self, name, face_hash, document_hash, document_type, node_id):
        last_block = self.get_last_block()
        new_block = Block(
            last_block.index + 1,
            name,
            face_hash,
            document_hash,
            document_type,
            str(dt.now()),
            last_block.hash,
            node_id,
            'pending'
        )
        return new_block

    def add_approved_block(self, name, face_hash, document_hash, document_type, node_id):
        last_block = self.get_last_block()
        new_block = Block(
            last_block.index + 1,
            name,
            face_hash,
            document_hash,
            document_type,
            str(dt.now()),
            last_block.hash,
            node_id,
            'approved'
        )
        self.chain.append(new_block)
        self.save_chain()
        return new_block

blockchain = Blockchain()

# ------------------- دوال مساعدة -------------------
def get_free_users_count():
    try:
        with open(FREE_USERS_FILE, 'r') as f:
            data = json.load(f)
            return data.get('count', 0)
    except FileNotFoundError:
        return 0

def increment_free_users_count():
    count = get_free_users_count() + 1
    with open(FREE_USERS_FILE, 'w') as f:
        json.dump({'count': count}, f)
    return count

# ------------------- مسارات API الآمنة -------------------
@app.route('/init-session', methods=['POST'])
def init_session():
    """بدء جلسة جديدة مع توكن"""
    token = generate_session_token()
    active_sessions[token] = dt.now()
    return jsonify({"session_token": token, "expires_in": SESSION_TIMEOUT}), 200

@app.route('/verify-document', methods=['POST'])
@require_session
def verify_document():
    """
    التحقق من المستند (معالجة في الذاكرة فقط - Zero-Persistence)
    """
    if 'document_image' not in request.files:
        return jsonify({"error": "لا توجد صورة مرفوعة"}), 400
    
    file = request.files['document_image']
    if file.filename == '':
        return jsonify({"error": "لم يتم اختيار ملف"}), 400
    
    # قراءة الصورة مباشرة إلى الذاكرة (بدون حفظ على القرص)
    image_bytes = file.read()
    
    # التحقق الشامل من المستند (في الذاكرة فقط)
    verification_result = comprehensive_document_verification(image_bytes)
    
    # مسح بيانات الصورة من الذاكرة فوراً
    del image_bytes
    
    return jsonify(verification_result), 200

@app.route('/verify-identity', methods=['POST'])
@require_session
def verify_identity():
    """
    التحقق النهائي من الهوية (مطابقة الوجه + التحقق من المستند)
    """
    data = request.get_json()
    
    required = ['name', 'face_embedding', 'document_hash', 'document_type', 'session_data']
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400
    
    # التحقق من صحة embedding الوجه
    face_embedding = data.get('face_embedding')
    if not isinstance(face_embedding, list) or len(face_embedding) != 128:
        return jsonify({"error": "بصمة الوجه غير صالحة"}), 400
    
    # التحقق من بيانات الجلسة (تم التحقق من المستند مسبقاً)
    session_data = data.get('session_data')
    if not session_data.get('document_verified'):
        return jsonify({"error": "لم يتم التحقق من المستند"}), 400
    
    # التحقق من رمز الدعوة
    invite_code = data.get('invite_code')
    free_users_count = get_free_users_count()
    
    if free_users_count >= MAX_FREE_USERS:
        # التحقق من رمز الدعوة
        try:
            with open(INVITES_FILE, 'r') as f:
                invites = json.load(f)
        except FileNotFoundError:
            invites = {}
        
        if not invite_code or invite_code not in invites or invites[invite_code].get('used', False):
            return jsonify({"error": "رمز دعوة غير صالح"}), 403
        
        invites[invite_code]['used'] = True
        invites[invite_code]['used_by'] = data['name']
        with open(INVITES_FILE, 'w') as f:
            json.dump(invites, f, indent=2)
    else:
        increment_free_users_count()
    
    # إنشاء الهاشات للتخزين
    face_hash = hashlib.sha256(json.dumps(face_embedding).encode()).hexdigest()
    doc_hash = data.get('document_hash')
    
    # إضافة كتلة جديدة إلى البلوكشين
    new_block = blockchain.add_approved_block(
        data['name'],
        face_hash,
        doc_hash,
        data['document_type'],
        request.remote_addr
    )
    
    # إزالة الجلسة الحالية
    token = request.headers.get('X-Session-Token')
    if token in active_sessions:
        del active_sessions[token]
    
    return jsonify({
        "success": True,
        "message": "تم تسجيل الهوية بنجاح",
        "block_index": new_block.index,
        "face_hash": face_hash[:16] + "..."
    }), 201

@app.route('/system-status', methods=['GET'])
def system_status():
    free_users = get_free_users_count()
    remaining = MAX_FREE_USERS - free_users
    total_users = len([b for b in blockchain.chain if b.status == 'approved' and b.index > 0])
    
    return jsonify({
        "total_verified_users": total_users,
        "free_registrations_used": free_users,
        "free_registrations_remaining": max(0, remaining),
        "invite_only_mode": remaining <= 0,
        "max_free_users": MAX_FREE_USERS
    }), 200

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "chain_length": len(blockchain.chain),
        "active_sessions": len(active_sessions)
    }), 200

@app.route('/chain', methods=['GET'])
def get_chain():
    chain_data = []
    for block in blockchain.chain:
        chain_data.append({
            "index": block.index,
            "name": block.name,
            "face_hash": block.face_hash,
            "document_hash": block.document_hash,
            "document_type": block.document_type,
            "timestamp": block.timestamp,
            "status": block.status,
            "hash": block.hash
        })
    return jsonify({"chain": chain_data, "length": len(chain_data)}), 200

# ------------------- صفحات الواجهة -------------------
@app.route('/')
def index():
    return redirect('/verify')

@app.route('/verify')
def verify_page():
    return render_template('verify.html')

@app.route('/witness')
def witness_page():
    return render_template('witness.html')

@app.route('/profile')
def profile_page():
    return render_template('profile.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# ------------------- بدء التشغيل -------------------
if __name__ == '__main__':
    print("=" * 50)
    print("🔐 وثاق - Zero-Persistence Identity System")
    print("=" * 50)
    print("🛡️ سياسة الأمان:")
    print("   - Zero-Persistence: لا تخزين صور على القرص")
    print("   - RAM-only Processing: معالجة في الذاكرة فقط")
    print("   - Session Tokens: توكنات مشفرة للجلسات")
    print("   - Physical Reflection Analysis: كشف الانعكاسات")
    print("   - Fourier Fractal Analysis: تحليل الترددات")
    print("   - Security Printing Analysis: تحليل الطباعة")
    print(f"📊 عدد الجلسات النشطة: {len(active_sessions)}")
    print(f"🌐 الخادم: http://localhost:{PORT}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
