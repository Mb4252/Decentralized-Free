import os
import json
import hashlib
import datetime
import threading
import requests
import socket
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

app = Flask(__name__, static_folder='static', static_url_path='/static')
CORS(app)

# ------------------------- الإعدادات -------------------------
PORT = int(os.environ.get('PORT', 5000))

# تحديد مجلد البيانات
DATA_DIR = os.environ.get('DATA_DIR', '/data')
try:
    os.makedirs(DATA_DIR, exist_ok=True)
except PermissionError:
    DATA_DIR = os.path.join(os.getcwd(), 'ledger_data')
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"⚠️ تم استخدام مجلد بديل للبيانات: {DATA_DIR}")

LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')

# ------------------------- تحميل قائمة العقد -------------------------
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

# ------------------------- فئة Block و Blockchain -------------------------
class Block:
    def __init__(self, index, name, face_hash, document_hash, timestamp, previous_hash, node_id=None):
        self.index = index
        self.name = name
        self.face_hash = face_hash
        self.document_hash = document_hash
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
                        block_data['timestamp'],
                        block_data['previous_hash'],
                        block_data.get('node_id', 'unknown')
                    )
                    block.hash = block_data['hash']
                    self.chain.append(block)
        except FileNotFoundError:
            genesis = Block(0, "Genesis", "0", "0", str(datetime.datetime.now()), "0", "genesis")
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
                    "timestamp": block.timestamp,
                    "previous_hash": block.previous_hash,
                    "node_id": block.node_id,
                    "hash": block.hash
                })
            with open(self.ledger_file, 'w') as f:
                json.dump(data, f, indent=2)

    def get_last_block(self):
        return self.chain[-1]

    def add_block(self, name, face_hash, document_hash, biometric_verified, node_id):
        if not biometric_verified:
            raise ValueError("التحقق البيومتري مطلوب")
        last_block = self.get_last_block()
        new_block = Block(
            last_block.index + 1,
            name,
            face_hash,
            document_hash,
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

# ------------------------- دوال المزامنة والبث -------------------------
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
                    bd['timestamp'], bd['previous_hash'], bd.get('node_id', 'unknown')
                )
                b.hash = bd['hash']
                peer_chain.append(b)
            if blockchain.replace_chain(peer_chain):
                print(f"✅ تم تحديث السلسلة من {peer_url}")
                return True
    except Exception as e:
        print(f"⚠️ فشل المزامنة مع {peer_url}: {e}")
    return False

def sync_with_peers():
    if not PEERS:
        print("لا توجد عقد أخرى للمزامنة")
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
            b = Block(bd['index'], bd['name'], bd['face_hash'], bd['document_hash'],
                      bd['timestamp'], bd['previous_hash'], bd.get('node_id'))
            b.hash = bd['hash']
            new_chain.append(b)
        if blockchain.replace_chain(new_chain):
            print(f"✅ تمت المزامنة بنجاح، طول السلسلة الجديد: {len(new_chain)}")

def broadcast_block(block_dict):
    for peer in PEERS:
        try:
            requests.post(f"{peer}/add_block_peer", json=block_dict, timeout=3)
            print(f"📡 تم بث الكتلة إلى {peer}")
        except Exception as e:
            print(f"⚠️ فشل البث إلى {peer}: {e}")

# ------------------------- مسارات API -------------------------
@app.route('/chain', methods=['GET'])
def get_chain():
    chain_data = []
    for block in blockchain.chain:
        chain_data.append({
            "index": block.index,
            "name": block.name,
            "face_hash": block.face_hash,
            "document_hash": block.document_hash,
            "timestamp": block.timestamp,
            "previous_hash": block.previous_hash,
            "node_id": block.node_id,
            "hash": block.hash
        })
    return jsonify({"chain": chain_data, "length": len(chain_data)}), 200

@app.route('/add_block', methods=['POST'])
def add_block_local():
    data = request.get_json()
    required = ['name', 'face_hash', 'document_hash', 'biometric_verified', 'previous_hash']
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400

    if not data['biometric_verified']:
        return jsonify({"error": "فشل التحقق البيومتري"}), 403

    last_block = blockchain.get_last_block()
    if data['previous_hash'] != last_block.hash:
        return jsonify({"error": "سلسلة الكتل غير متطابقة، يرجى المزامنة أولاً"}), 409

    try:
        new_block = blockchain.add_block(
            data['name'],
            data['face_hash'],
            data['document_hash'],
            data['biometric_verified'],
            node_id=request.remote_addr
        )
        block_dict = {
            "index": new_block.index,
            "name": new_block.name,
            "face_hash": new_block.face_hash,
            "document_hash": new_block.document_hash,
            "timestamp": new_block.timestamp,
            "previous_hash": new_block.previous_hash,
            "node_id": new_block.node_id,
            "hash": new_block.hash
        }
        threading.Thread(target=broadcast_block, args=(block_dict,)).start()
        return jsonify({"message": "تمت إضافة الكتلة وبثها", "block_index": new_block.index}), 201
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

@app.route('/add_block_peer', methods=['POST'])
def add_block_peer():
    data = request.get_json()
    required = ['index', 'name', 'face_hash', 'document_hash', 'timestamp', 'previous_hash', 'hash', 'node_id']
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات الكتلة غير مكتملة"}), 400

    with ledger_lock:
        for block in blockchain.chain:
            if block.hash == data['hash']:
                return jsonify({"message": "الكتلة موجودة مسبقاً"}), 200

        last = blockchain.get_last_block()
        if data['previous_hash'] != last.hash:
            return jsonify({"error": "الكتلة السابقة غير متطابقة، يرجى المزامنة"}), 409

        new_block = Block(
            data['index'], data['name'], data['face_hash'], data['document_hash'],
            data['timestamp'], data['previous_hash'], data['node_id']
        )
        new_block.hash = data['hash']
        if new_block.hash != new_block.compute_hash():
            return jsonify({"error": "هاش الكتلة غير صحيح"}), 400

        blockchain.chain.append(new_block)
        blockchain.save_chain()
        return jsonify({"message": "تمت إضافة الكتلة من العقدة"}), 201

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
            return jsonify({"message": f"تمت إضافة {new_peer}", "peers": list(PEERS)})
        return jsonify({"error": "يرجى إرسال peer صحيح"}), 400
    elif request.method == 'DELETE':
        peer = request.json.get('peer')
        if peer in PEERS:
            PEERS.remove(peer)
            save_peers()
        return jsonify({"message": "تم الحذف", "peers": list(PEERS)})

@app.route('/sync', methods=['POST'])
def sync_trigger():
    threading.Thread(target=sync_with_peers).start()
    return jsonify({"message": "جارٍ المزامنة في الخلفية"}), 202

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "healthy", "chain_length": len(blockchain.chain)}), 200

# ------------------------- خدمة الواجهة الأمامية -------------------------
@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)

# ------------------------- بدء التشغيل -------------------------
if __name__ == '__main__':
    load_peers()
    threading.Thread(target=sync_with_peers).start()
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
