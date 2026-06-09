import os
import json
import hashlib
import datetime
import threading
import requests
import socket
import base64
import io
import logging
import numpy as np
from flask import Flask, request, jsonify, send_from_directory, redirect
from flask_cors import CORS
from scipy.spatial.distance import euclidean
from PIL import Image

# ------------------- تهيئة التطبيق -------------------
app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

# ------------------- نظام التسجيل (Logging) -------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ------------------- الإعدادات -------------------
PORT = int(os.environ.get('PORT', 5000))

DATA_DIR = os.environ.get('DATA_DIR', '/data')
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except PermissionError:
    DATA_DIR = os.path.join(os.getcwd(), 'ledger_data')
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"⚠️ تم استخدام مجلد بديل للبيانات: {DATA_DIR}")

LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')

# ------------------- إدارة العقد (P2P) -------------------
PEERS = set()
env_peers = os.environ.get('PEERS', '')
if env_peers:
    for peer in env_peers.split(','):
        peer = peer.strip()
        if peer:
            PEERS.add(peer)

def load_peers():
    global PEERS
    try:
        with open(PEERS_FILE, 'r') as f:
            saved_peers = json.load(f)
            PEERS.update(saved_peers)
    except FileNotFoundError:
        pass
    save_peers()

def save_peers():
    with open(PEERS_FILE, 'w') as f:
        json.dump(list(PEERS), f, indent=2)

ledger_lock = threading.Lock()

# ------------------- المعايير العالمية للقياسات الحيوية -------------------
class BiometricStandards:
    """
    معايير المطابقة البيومترية وفقاً لـ NIST FRVT و ISO/IEC 30107-3
    """
    THRESHOLDS = {
        'high_security': 0.45,
        'standard': 0.54,
        'low_security': 0.65
    }
    
    MIN_IMAGE_RESOLUTION = (300, 300)
    MIN_FACE_SIZE = 100
    MAX_IMAGE_SIZE_MB = 5
    
    @staticmethod
    def calculate_confidence_score(distance):
        raw_score = (1 - min(distance, 1)) * 100
        return round(raw_score, 2)
    
    @staticmethod
    def estimate_fnmr(distance):
        if distance < 0.3:
            return 0.001
        elif distance < 0.45:
            return 0.01
        elif distance < 0.54:
            return 0.05
        elif distance < 0.65:
            return 0.15
        else:
            return 0.50
    
    @staticmethod
    def get_threshold(security_level='standard'):
        return BiometricStandards.THRESHOLDS.get(security_level, 0.54)

# ------------------- دوال التحقق من صحة الصور -------------------
def validate_image_quality(image_base64):
    try:
        if ',' in image_base64:
            image_base64 = image_base64.split(',')[1]
        
        image_data = base64.b64decode(image_base64)
        
        image_size_mb = len(image_data) / (1024 * 1024)
        if image_size_mb > BiometricStandards.MAX_IMAGE_SIZE_MB:
            return {
                'is_valid': False,
                'message': f'حجم الصورة كبير جداً ({image_size_mb:.2f}MB)'
            }
        
        image = Image.open(io.BytesIO(image_data))
        width, height = image.size
        
        min_width, min_height = BiometricStandards.MIN_IMAGE_RESOLUTION
        if width < min_width or height < min_height:
            return {
                'is_valid': False,
                'message': f'دقة الصورة منخفضة ({width}x{height})'
            }
        
        aspect_ratio = width / height
        if aspect_ratio < 0.5 or aspect_ratio > 2.0:
            return {
                'is_valid': False,
                'message': f'نسبة أبعاد الصورة غير طبيعية'
            }
        
        return {
            'is_valid': True,
            'message': 'الصورة تلبي معايير الجودة',
            'resolution': (width, height),
            'aspect_ratio': aspect_ratio,
            'size_mb': round(image_size_mb, 2)
        }
        
    except Exception as e:
        logger.error(f"خطأ في تحليل الصورة: {str(e)}")
        return {
            'is_valid': False,
            'message': f'خطأ في تحليل الصورة: {str(e)}'
        }

def validate_face_descriptor(descriptor):
    if not isinstance(descriptor, list) and not isinstance(descriptor, np.ndarray):
        return False, "تنسيق المتجه غير صالح"
    
    if isinstance(descriptor, np.ndarray):
        descriptor = descriptor.tolist()
    
    if len(descriptor) not in [128, 512]:
        return False, f"طول المتجه غير صحيح: {len(descriptor)}"
    
    valid_range = all(-1.5 <= val <= 1.5 for val in descriptor)
    if not valid_range:
        return False, "القيم خارج النطاق المسموح"
    
    std_dev = np.std(descriptor)
    if std_dev < 0.03:
        return False, "المتجه يبدو عشوائياً أو مزيفاً"
    
    if std_dev > 0.5:
        return False, "التباين مرتفع جداً"
    
    return True, "صالح"

def verify_biometric_match(descriptor1, descriptor2, security_level='standard'):
    try:
        arr1 = np.array(descriptor1)
        arr2 = np.array(descriptor2)
        
        distance = float(euclidean(arr1, arr2))
        threshold = BiometricStandards.get_threshold(security_level)
        confidence_score = BiometricStandards.calculate_confidence_score(distance)
        fnmr_estimate = BiometricStandards.estimate_fnmr(distance)
        is_match = distance < threshold
        
        security_levels_display = {
            'high_security': 'عالي (FNMR ~0.1%)',
            'standard': 'قياسي (FNMR ~1%)',
            'low_security': 'منخفض (FNMR ~5%)'
        }
        
        return {
            'is_match': is_match,
            'distance': round(distance, 4),
            'threshold': threshold,
            'confidence_score': confidence_score,
            'fnmr_estimate': fnmr_estimate,
            'security_level': security_level,
            'security_level_display': security_levels_display.get(security_level, 'قياسي')
        }
        
    except Exception as e:
        logger.error(f"خطأ في مقارنة المتجهات: {str(e)}")
        return {
            'is_match': False,
            'distance': 1.0,
            'confidence_score': 0,
            'fnmr_estimate': 0.99,
            'error': str(e)
        }

def compute_face_hash_from_descriptor(descriptor):
    arr = np.array(descriptor)
    norm = np.linalg.norm(arr)
    if norm > 0:
        normalized = arr / norm
    else:
        normalized = arr
    
    rounded = [round(v, 6) for v in normalized]
    descriptor_str = json.dumps(rounded, sort_keys=True)
    return hashlib.sha256(descriptor_str.encode()).hexdigest()

# ------------------- Block و Blockchain -------------------
class Block:
    def __init__(self, index, name, face_hash, document_hash, document_type, timestamp, previous_hash, node_id=None):
        self.index = index
        self.name = name
        self.face_hash = face_hash
        self.document_hash = document_hash
        self.document_type = document_type
        self.timestamp = timestamp
        self.previous_hash = previous_hash
        self.node_id = node_id or socket.gethostname()
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
            "node_id": self.node_id
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
                        block_data.get('node_id', 'unknown')
                    )
                    block.hash = block_data['hash']
                    self.chain.append(block)
        except FileNotFoundError:
            genesis = Block(0, "Genesis", "0", "0", "genesis", str(datetime.datetime.now()), "0", "genesis")
            self.chain = [genesis]
            self.save_chain()

    def save_chain(self):
        with ledger_lock:
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
                    "hash": block.hash
                })
            with open(self.ledger_file, 'w') as f:
                json.dump(data, f, indent=2)

    def get_last_block(self):
        return self.chain[-1]

    def add_block(self, name, face_hash, document_hash, document_type, biometric_verified, node_id):
        if not biometric_verified:
            raise ValueError("التحقق البيومتري مطلوب")
        last_block = self.get_last_block()
        new_block = Block(
            last_block.index + 1,
            name,
            face_hash,
            document_hash,
            document_type,
            str(datetime.datetime.now()),
            last_block.hash,
            node_id
        )
        self.chain.append(new_block)
        self.save_chain()
        return new_block

    def is_chain_valid(self, chain=None):
        target_chain = chain if chain is not None else self.chain
        for i in range(1, len(target_chain)):
            current = target_chain[i]
            previous = target_chain[i-1]
            if current.hash != current.compute_hash():
                return False
            if current.previous_hash != previous.hash:
                return False
        return True

    def replace_chain(self, new_chain):
        if len(new_chain) > len(self.chain) and self.is_chain_valid(new_chain):
            with ledger_lock:
                self.chain = new_chain
                self.save_chain()
            return True
        return False

blockchain = Blockchain()

# ------------------- وظائف المزامنة بين العقد -------------------
def sync_with_peer(peer_url):
    try:
        response = requests.get(f"{peer_url}/chain", timeout=5)
        if response.status_code == 200:
            data = response.json()
            peer_chain_data = data.get('chain', [])
            peer_chain = []
            for bd in peer_chain_data:
                b = Block(
                    bd['index'], bd['name'], bd['face_hash'], bd['document_hash'],
                    bd.get('document_type', 'غير محدد'), bd['timestamp'], bd['previous_hash'], bd.get('node_id', 'unknown')
                )
                b.hash = bd['hash']
                peer_chain.append(b)
            if blockchain.replace_chain(peer_chain):
                logger.info(f"✅ تم تحديث السلسلة من {peer_url}")
                return True
    except Exception as e:
        logger.warning(f"⚠️ فشل المزامنة مع {peer_url}: {e}")
    return False

def sync_with_peers():
    if not PEERS:
        logger.info("لا توجد عقد أخرى للمزامنة")
        return
    longest_chain = None
    max_len = len(blockchain.chain)
    for peer in PEERS:
        try:
            resp = requests.get(f"{peer}/chain", timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                if data['length'] > max_len:
                    max_len = data['length']
                    longest_chain = data['chain']
        except:
            continue
    if longest_chain:
        new_chain = []
        for bd in longest_chain:
            b = Block(
                bd['index'], bd['name'], bd['face_hash'], bd['document_hash'],
                bd.get('document_type', 'غير محدد'), bd['timestamp'], bd['previous_hash'], bd.get('node_id')
            )
            b.hash = bd['hash']
            new_chain.append(b)
        if blockchain.replace_chain(new_chain):
            logger.info(f"✅ تمت المزامنة بنجاح، طول السلسلة الجديد: {len(new_chain)}")

def broadcast_block(block_dict):
    for peer in PEERS:
        try:
            requests.post(f"{peer}/add_block_peer", json=block_dict, timeout=3)
            logger.info(f"📡 تم بث الكتلة إلى {peer}")
        except Exception as e:
            logger.warning(f"⚠️ فشل البث إلى {peer}: {e}")

# ------------------- مسارات API الرئيسية -------------------
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
            "previous_hash": block.previous_hash,
            "node_id": block.node_id,
            "hash": block.hash
        })
    return jsonify({"chain": chain_data, "length": len(chain_data)}), 200

@app.route('/verify-biometric', methods=['POST'])
def verify_biometric():
    data = request.get_json()
    
    if not data:
        return jsonify({"error": "بيانات غير صالحة"}), 400
    
    doc_descriptor = data.get('doc_descriptor')
    face_descriptor = data.get('face_descriptor')
    security_level = data.get('security_level', 'standard')
    
    if not doc_descriptor or not face_descriptor:
        return jsonify({"error": "المتجهات البيومترية مطلوبة"}), 400
    
    is_valid_doc, msg_doc = validate_face_descriptor(doc_descriptor)
    is_valid_face, msg_face = validate_face_descriptor(face_descriptor)
    
    if not is_valid_doc:
        logger.warning(f"محاولة اختراق: متجه وثيقة غير صالح - {msg_doc}")
        return jsonify({"error": f"متجه الوثيقة غير صالح: {msg_doc}"}), 400
    
    if not is_valid_face:
        logger.warning(f"محاولة اختراق: متجه وجه غير صالح - {msg_face}")
        return jsonify({"error": f"متجه الوجه غير صالح: {msg_face}"}), 400
    
    result = verify_biometric_match(doc_descriptor, face_descriptor, security_level)
    
    doc_hash = compute_face_hash_from_descriptor(doc_descriptor)
    face_hash = compute_face_hash_from_descriptor(face_descriptor)
    
    response = {
        "verified": result['is_match'],
        "distance": result['distance'],
        "confidence_score": result['confidence_score'],
        "fnmr_estimate": result['fnmr_estimate'],
        "security_level": result['security_level'],
        "security_level_display": result.get('security_level_display', ''),
        "doc_hash": doc_hash,
        "face_hash": face_hash
    }
    
    if result['is_match']:
        response["message"] = "تم التحقق بنجاح"
        logger.info(f"تحقق بيومتري ناجح - الثقة: {result['confidence_score']}%")
    else:
        response["message"] = "الوجوه غير متطابقة"
        logger.warning(f"فشل التحقق البيومتري - المسافة: {result['distance']}")
    
    return jsonify(response), 200 if result['is_match'] else 401

@app.route('/add_block', methods=['POST'])
def add_block_local():
    data = request.get_json()
    required = ['name', 'face_hash', 'document_hash', 'document_type', 'biometric_verified', 'previous_hash']
    
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400

    if not data['biometric_verified']:
        logger.warning("محاولة إضافة كتلة بدون تحقق بيومتري")
        return jsonify({"error": "فشل التحقق البيومتري"}), 403

    last_block = blockchain.get_last_block()
    if data['previous_hash'] != last_block.hash:
        logger.warning(f"محاولة إضافة كتلة مع previous_hash غير صحيح")
        return jsonify({"error": "سلسلة الكتل غير متطابقة"}), 409

    try:
        new_block = blockchain.add_block(
            data['name'],
            data['face_hash'],
            data['document_hash'],
            data['document_type'],
            data['biometric_verified'],
            node_id=request.remote_addr
        )
        block_dict = {
            "index": new_block.index,
            "name": new_block.name,
            "face_hash": new_block.face_hash,
            "document_hash": new_block.document_hash,
            "document_type": new_block.document_type,
            "timestamp": new_block.timestamp,
            "previous_hash": new_block.previous_hash,
            "node_id": new_block.node_id,
            "hash": new_block.hash
        }
        threading.Thread(target=broadcast_block, args=(block_dict,)).start()
        logger.info(f"✅ تمت إضافة كتلة جديدة - الاسم: {data['name']}, الرقم: {new_block.index}")
        return jsonify({"message": "تمت إضافة الكتلة", "block_index": new_block.index}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@app.route('/add_block_peer', methods=['POST'])
def add_block_peer():
    data = request.get_json()
    required = ['index', 'name', 'face_hash', 'document_hash', 'document_type', 'timestamp', 'previous_hash', 'hash', 'node_id']
    
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400

    with ledger_lock:
        for block in blockchain.chain:
            if block.hash == data['hash']:
                return jsonify({"message": "موجودة"}), 200

        last = blockchain.get_last_block()
        if data['previous_hash'] != last.hash:
            return jsonify({"error": "غير متطابقة"}), 409

        new_block = Block(
            data['index'], data['name'], data['face_hash'], data['document_hash'],
            data['document_type'], data['timestamp'], data['previous_hash'], data['node_id']
        )
        new_block.hash = data['hash']
        if new_block.hash != new_block.compute_hash():
            return jsonify({"error": "هاش غير صحيح"}), 400

        blockchain.chain.append(new_block)
        blockchain.save_chain()
        logger.info(f"📥 تم استقبال كتلة من العقدة {data['node_id']}")
        return jsonify({"message": "تمت الإضافة"}), 201

@app.route('/peers', methods=['GET', 'POST', 'DELETE'])
def manage_peers():
    global PEERS
    if request.method == 'GET':
        return jsonify(list(PEERS))
    elif request.method == 'POST':
        new_peer = request.json.get('peer')
        if new_peer and new_peer not in PEERS:
            PEERS.add(new_peer)
            save_peers()
            threading.Thread(target=sync_with_peer, args=(new_peer,)).start()
            logger.info(f"➕ تمت إضافة عقدة جديدة: {new_peer}")
            return jsonify({"message": "تمت الإضافة", "peers": list(PEERS)})
        return jsonify({"error": "خطأ"}), 400
    elif request.method == 'DELETE':
        peer = request.json.get('peer')
        if peer in PEERS:
            PEERS.remove(peer)
            save_peers()
            logger.info(f"➖ تمت إزالة عقدة: {peer}")
        return jsonify({"message": "تم الحذف", "peers": list(PEERS)})

@app.route('/sync', methods=['POST'])
def sync_trigger():
    threading.Thread(target=sync_with_peers).start()
    return jsonify({"message": "جاري المزامنة"}), 202

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "chain_length": len(blockchain.chain),
        "peers_count": len(PEERS),
        "version": "3.0.0"
    }), 200

@app.route('/verify_person', methods=['POST'])
def verify_person():
    data = request.get_json()
    if not data:
        return jsonify({"error": "بيانات غير صالحة"}), 400
    
    query_type = data.get('query_type')
    query_value = data.get('query_value', '').strip()
    
    if query_type == "name":
        results = []
        for block in blockchain.chain:
            if block.name.lower() == query_value.lower():
                results.append({
                    "index": block.index,
                    "name": block.name,
                    "face_hash": block.face_hash,
                    "document_hash": block.document_hash,
                    "document_type": block.document_type,
                    "timestamp": block.timestamp,
                    "node_id": block.node_id
                })
        if results:
            return jsonify({"verified": True, "message": "تم العثور", "records": results}), 200
        return jsonify({"verified": False, "message": "لم يتم العثور"}), 404
    else:
        return jsonify({"error": "نوع بحث غير صحيح"}), 400

# ------------------- صفحات الواجهة -------------------
@app.route('/')
def index():
    return redirect('/verify')

@app.route('/verify')
def verify_page():
    return send_from_directory('static', 'verify.html')

@app.route('/witness')
def witness_page():
    return send_from_directory('static', 'witness.html')

@app.route('/profile')
def profile_page():
    return send_from_directory('static', 'profile.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# ------------------- بدء التشغيل -------------------
if __name__ == '__main__':
    load_peers()
    threading.Thread(target=sync_with_peers).start()
    logger.info(f"🚀 بدء تشغيل الخادم على المنفذ {PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
