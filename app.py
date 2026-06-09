import os
import json
import hashlib
import datetime
import threading
import requests
import socket
import math
from flask import Flask, request, jsonify, send_from_directory, redirect, render_template
from flask_cors import CORS

app = Flask(__name__, 
            static_folder='static', 
            static_url_path='/static',
            template_folder='templates')  # ✅ تحديد مجلد القوالب

CORS(app)

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

# ------------------- إدارة العقد -------------------
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

# ------------------- دوال المساعدة -------------------
def euclidean_distance(a, b):
    """حساب المسافة الإقليدية بين متجهين"""
    if len(a) != len(b):
        return float('inf')
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

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

blockchain = Blockchain()

# ------------------- وظائف المزامنة -------------------
def sync_with_peers():
    if not PEERS:
        return
    for peer in PEERS:
        try:
            resp = requests.get(f"{peer}/chain", timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                if data['length'] > len(blockchain.chain):
                    peer_chain = []
                    for bd in data['chain']:
                        b = Block(
                            bd['index'], bd['name'], bd['face_hash'], bd['document_hash'],
                            bd.get('document_type', 'غير محدد'), bd['timestamp'],
                            bd['previous_hash'], bd.get('node_id')
                        )
                        b.hash = bd['hash']
                        peer_chain.append(b)
                    if len(peer_chain) > len(blockchain.chain):
                        with ledger_lock:
                            blockchain.chain = peer_chain
                            blockchain.save_chain()
        except Exception as e:
            pass

def broadcast_block(block_dict):
    for peer in PEERS:
        try:
            requests.post(f"{peer}/add_block_peer", json=block_dict, timeout=3)
        except Exception as e:
            pass

# ------------------- مسارات API -------------------
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

@app.route('/add_block', methods=['POST'])
def add_block_local():
    data = request.get_json()
    required = ['name', 'face_hash', 'document_hash', 'document_type', 'biometric_verified', 'previous_hash']

    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400

    if not data['biometric_verified']:
        return jsonify({"error": "فشل التحقق"}), 403

    last_block = blockchain.get_last_block()
    if data['previous_hash'] != last_block.hash:
        return jsonify({"error": "السلسلة غير متطابقة"}), 409

    try:
        new_block = blockchain.add_block(
            data['name'], data['face_hash'], data['document_hash'],
            data['document_type'], data['biometric_verified'], request.remote_addr
        )
        block_dict = {
            "index": new_block.index, "name": new_block.name,
            "face_hash": new_block.face_hash, "document_hash": new_block.document_hash,
            "document_type": new_block.document_type, "timestamp": new_block.timestamp,
            "previous_hash": new_block.previous_hash, "node_id": new_block.node_id,
            "hash": new_block.hash
        }
        threading.Thread(target=broadcast_block, args=(block_dict,)).start()
        return jsonify({"message": "تمت الإضافة", "block_index": new_block.index}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@app.route('/add_block_peer', methods=['POST'])
def add_block_peer():
    data = request.get_json()
    required = ['index', 'name', 'face_hash', 'document_hash', 'document_type',
                'timestamp', 'previous_hash', 'hash', 'node_id']

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

        blockchain.chain.append(new_block)
        blockchain.save_chain()
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
            return jsonify({"message": "تمت الإضافة", "peers": list(PEERS)})
        return jsonify({"error": "خطأ"}), 400
    elif request.method == 'DELETE':
        peer = request.json.get('peer')
        if peer in PEERS:
            PEERS.remove(peer)
            save_peers()
        return jsonify({"message": "تم الحذف", "peers": list(PEERS)})

@app.route('/sync', methods=['POST'])
def sync_trigger():
    threading.Thread(target=sync_with_peers).start()
    return jsonify({"message": "جاري المزامنة"}), 202

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "chain_length": len(blockchain.chain)}), 200

@app.route('/verify_person', methods=['POST'])
def verify_person():
    data = request.get_json()
    if not data:
        return jsonify({"error": "بيانات غير صالحة"}), 400

    query_value = data.get('query_value', '').strip()
    results = []
    for block in blockchain.chain:
        if block.name.lower() == query_value.lower():
            results.append({
                "index": block.index, "name": block.name,
                "face_hash": block.face_hash, "document_hash": block.document_hash,
                "document_type": block.document_type, "timestamp": block.timestamp,
                "node_id": block.node_id
            })
    if results:
        return jsonify({"verified": True, "records": results}), 200
    return jsonify({"verified": False}), 404

# ============================================================
# ✅ مسارات الصفحات (باستخدام render_template من مجلد templates)
# ============================================================

@app.route('/')
def index():
    """الصفحة الرئيسية - إعادة توجيه إلى /verify"""
    return redirect('/verify')

@app.route('/verify')
def verify_page():
    """صفحة التوثيق الرئيسية"""
    return render_template('verify.html')

@app.route('/witness')
def witness_page():
    """صفحة الشهود والتصويت الجماعي"""
    return render_template('witness.html')

@app.route('/profile')
def profile_page():
    """الملف الشخصي ونظام السمعة"""
    return render_template('profile.html')

# مسار للملفات الثابتة (CSS, JS, icons, manifest)
@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# ------------------- بدء التشغيل -------------------
if __name__ == '__main__':
    load_peers()
    threading.Thread(target=sync_with_peers).start()
    print("=" * 50)
    print("🚀 وثاق - نظام التوثيق اللامركزي")
    print("=" * 50)
    print(f"📁 مجلد البيانات: {DATA_DIR}")
    print(f"📁 مجلد القوالب: templates/")
    print(f"📁 مجلد الملفات الثابتة: static/")
    print(f"🌐 الخادم يعمل على المنفذ: {PORT}")
    print("-" * 50)
    print("📍 المسارات المتاحة:")
    print(f"   ✅ http://localhost:{PORT}/verify     → صفحة التوثيق")
    print(f"   ✅ http://localhost:{PORT}/witness    → صفحة الشهود")
    print(f"   ✅ http://localhost:{PORT}/profile    → الملف الشخصي")
    print(f"   ✅ http://localhost:{PORT}/chain      → API سلسلة الكتل")
    print(f"   ✅ http://localhost:{PORT}/health     → نقطة صحية")
    print("=" * 50)
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
