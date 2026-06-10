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
import re
from flask import Flask, request, jsonify, send_from_directory, redirect, render_template
from flask_cors import CORS

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
    print(f"⚠️ تم استخدام مجلد بديل للبيانات: {DATA_DIR}")

LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')
INVITES_FILE = os.path.join(DATA_DIR, 'invites.json')
BLACKLIST_FILE = os.path.join(DATA_DIR, 'blacklist.json')

# ------------------- إعدادات الأمان -------------------
MAX_FREE_USERS = 100
MIN_TRUST_SCORE_TO_VOTE = 50
CONSENSUS_THRESHOLD = 0.6
VERIFICATION_STATUS = {
    'PENDING': 'pending',
    'APPROVED': 'approved', 
    'REJECTED': 'rejected'
}

# ------------------- تحميل البيانات -------------------
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

def load_invites():
    try:
        with open(INVITES_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_invites(invites):
    with open(INVITES_FILE, 'w') as f:
        json.dump(invites, f, indent=2)

def load_blacklist():
    try:
        with open(BLACKLIST_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_blacklist(blacklist):
    with open(BLACKLIST_FILE, 'w') as f:
        json.dump(blacklist, f, indent=2)

ledger_lock = threading.Lock()

# ------------------- دوال مساعدة -------------------
def generate_invite_code():
    return ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(12))

def euclidean_distance(a, b):
    if len(a) != len(b):
        return float('inf')
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))

# ------------------- نظام الشهود والثقة -------------------
class TrustScoreManager:
    def __init__(self):
        self.trust_scores = {}
        self.load_trust_scores()
    
    def load_trust_scores(self):
        try:
            with open(os.path.join(DATA_DIR, 'trust_scores.json'), 'r') as f:
                self.trust_scores = json.load(f)
        except FileNotFoundError:
            self.trust_scores = {}
    
    def save_trust_scores(self):
        with open(os.path.join(DATA_DIR, 'trust_scores.json'), 'w') as f:
            json.dump(self.trust_scores, f, indent=2)
    
    def get_trust_score(self, user_id):
        return self.trust_scores.get(user_id, {'score': 100, 'total_votes': 0, 'correct_votes': 0})
    
    def update_trust_score(self, user_id, is_correct_vote):
        if user_id not in self.trust_scores:
            self.trust_scores[user_id] = {'score': 100, 'total_votes': 0, 'correct_votes': 0}
        
        self.trust_scores[user_id]['total_votes'] += 1
        if is_correct_vote:
            self.trust_scores[user_id]['correct_votes'] += 1
            self.trust_scores[user_id]['score'] = min(100, self.trust_scores[user_id]['score'] + 5)
        else:
            self.trust_scores[user_id]['score'] = max(0, self.trust_scores[user_id]['score'] - 10)
        
        self.save_trust_scores()
        return self.trust_scores[user_id]['score']
    
    def can_vote(self, user_id):
        score = self.get_trust_score(user_id)['score']
        return score >= MIN_TRUST_SCORE_TO_VOTE

trust_manager = TrustScoreManager()

# ------------------- Block و Blockchain -------------------
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
            genesis = Block(0, "Genesis", "0", "0", "genesis", str(datetime.datetime.now()), "0", 
                           "genesis", 'approved', {'approve': [], 'reject': []}, 0)
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
                    "status": block.status,
                    "witness_votes": block.witness_votes,
                    "trust_score_required": block.trust_score_required,
                    "hash": block.hash
                })
            with open(self.ledger_file, 'w') as f:
                json.dump(data, f, indent=2)

    def get_last_block(self):
        return self.chain[-1]

    def add_pending_block(self, name, face_hash, document_hash, document_type, node_id, trust_score_required=0):
        last_block = self.get_last_block()
        new_block = Block(
            last_block.index + 1,
            name,
            face_hash,
            document_hash,
            document_type,
            str(datetime.datetime.now()),
            last_block.hash,
            node_id,
            'pending',
            {'approve': [], 'reject': []},
            trust_score_required
        )
        return new_block
    
    def approve_block(self, block_index, witness_id, approved):
        for block in self.chain:
            if block.index == block_index:
                if approved:
                    if witness_id not in block.witness_votes['approve']:
                        block.witness_votes['approve'].append(witness_id)
                else:
                    if witness_id not in block.witness_votes['reject']:
                        block.witness_votes['reject'].append(witness_id)
                
                total_votes = len(block.witness_votes['approve']) + len(block.witness_votes['reject'])
                if total_votes > 0:
                    approval_rate = len(block.witness_votes['approve']) / total_votes
                    if approval_rate >= CONSENSUS_THRESHOLD:
                        block.status = 'approved'
                        self.save_chain()
                        return True, 'approved'
                    elif len(block.witness_votes['reject']) > total_votes * 0.5:
                        block.status = 'rejected'
                        self.save_chain()
                        return False, 'rejected'
                
                self.save_chain()
                return None, 'pending'
        return False, 'not_found'
    
    def get_pending_blocks(self):
        return [block for block in self.chain if block.status == 'pending']
    
    def get_approved_blocks(self):
        return [block for block in self.chain if block.status == 'approved']

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
                            bd.get('document_type', 'غير محدد'), bd['timestamp'], bd['previous_hash'],
                            bd.get('node_id'), bd.get('status', 'approved'),
                            bd.get('witness_votes', {'approve': [], 'reject': []}),
                            bd.get('trust_score_required', 0)
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
            "status": block.status,
            "hash": block.hash
        })
    return jsonify({"chain": chain_data, "length": len(chain_data)}), 200

@app.route('/add_block_peer', methods=['POST'])
def add_block_peer():
    data = request.get_json()
    required = ['index', 'name', 'face_hash', 'document_hash', 'document_type',
                'timestamp', 'previous_hash', 'hash', 'node_id', 'status']
    
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
            data['document_type'], data['timestamp'], data['previous_hash'], 
            data['node_id'], data.get('status', 'pending'),
            data.get('witness_votes', {'approve': [], 'reject': []}),
            data.get('trust_score_required', 0)
        )
        new_block.hash = data['hash']

        blockchain.chain.append(new_block)
        blockchain.save_chain()
        return jsonify({"message": "تمت الإضافة"}), 201

@app.route('/propose-verification', methods=['POST'])
def propose_verification():
    data = request.get_json()
    required = ['name', 'face_hash', 'document_hash', 'document_type']
    
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400
    
    invite_code = data.get('invite_code')
    
    if invite_code:
        invites = load_invites()
        if invite_code not in invites or invites[invite_code]['used']:
            return jsonify({"error": "رمز دعوة غير صالح"}), 403
        
        invites[invite_code]['used'] = True
        invites[invite_code]['used_by'] = data['name']
        save_invites(invites)
    
    trust_score_required = 0 if not PEERS else MIN_TRUST_SCORE_TO_VOTE
    new_block = blockchain.add_pending_block(
        data['name'],
        data['face_hash'],
        data['document_hash'],
        data['document_type'],
        request.remote_addr,
        trust_score_required
    )
    
    with ledger_lock:
        blockchain.chain.append(new_block)
        blockchain.save_chain()
    
    block_dict = {
        "index": new_block.index,
        "name": new_block.name,
        "face_hash": new_block.face_hash,
        "document_hash": new_block.document_hash,
        "document_type": new_block.document_type,
        "timestamp": new_block.timestamp,
        "previous_hash": new_block.previous_hash,
        "node_id": new_block.node_id,
        "status": new_block.status,
        "trust_score_required": new_block.trust_score_required,
        "hash": new_block.hash
    }
    
    if len(PEERS) > 0:
        threading.Thread(target=broadcast_block, args=(block_dict,)).start()
        return jsonify({
            "message": "Verification proposed. Waiting for witness approval.",
            "block_index": new_block.index,
            "status": "pending"
        }), 202
    else:
        new_block.status = 'approved'
        blockchain.save_chain()
        return jsonify({
            "message": "Auto-verified (AI Validator). No witnesses available.",
            "block_index": new_block.index,
            "status": "approved"
        }), 201

@app.route('/vote', methods=['POST'])
def vote_on_verification():
    data = request.get_json()
    required = ['block_index', 'approved', 'witness_id', 'trust_score']
    
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400
    
    if data['trust_score'] < MIN_TRUST_SCORE_TO_VOTE:
        return jsonify({"error": f"Insufficient trust score. Minimum required: {MIN_TRUST_SCORE_TO_VOTE}"}), 403
    
    result, status = blockchain.approve_block(data['block_index'], data['witness_id'], data['approved'])
    
    if status == 'approved':
        is_correct = True
        trust_manager.update_trust_score(data['witness_id'], is_correct)
        
        for block in blockchain.chain:
            if block.index == data['block_index']:
                final_block_dict = {
                    "index": block.index,
                    "name": block.name,
                    "face_hash": block.face_hash,
                    "document_hash": block.document_hash,
                    "document_type": block.document_type,
                    "timestamp": block.timestamp,
                    "previous_hash": block.previous_hash,
                    "node_id": block.node_id,
                    "status": block.status,
                    "hash": block.hash
                }
                threading.Thread(target=broadcast_block, args=(final_block_dict,)).start()
                break
        
        return jsonify({"message": f"Verification {status}!", "status": status}), 200
    elif status == 'rejected':
        return jsonify({"message": f"Verification {status}!", "status": status}), 200
    else:
        return jsonify({"message": "Vote recorded. Still pending.", "status": "pending"}), 200

@app.route('/pending-verifications', methods=['GET'])
def get_pending_verifications():
    pending = blockchain.get_pending_blocks()
    result = []
    for block in pending:
        result.append({
            "index": block.index,
            "name": block.name,
            "timestamp": block.timestamp,
            "trust_score_required": block.trust_score_required,
            "approve_count": len(block.witness_votes['approve']),
            "reject_count": len(block.witness_votes['reject'])
        })
    return jsonify({"pending": result}), 200

@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "healthy",
        "chain_length": len(blockchain.chain),
        "peers_count": len(PEERS),
        "pending_count": len(blockchain.get_pending_blocks())
    }), 200

# ============================================================
# ✅ مسارات الصفحات (ROUTES) - هذا هو الحل لمشكلتك ✅
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

@app.route('/static/<path:filename>')
def serve_static(filename):
    """تقديم الملفات الثابتة"""
    return send_from_directory('static', filename)

# ------------------- بدء التشغيل -------------------
if __name__ == '__main__':
    load_peers()
    threading.Thread(target=sync_with_peers).start()
    print("=" * 50)
    print("🔐 وثاق - نظام التوثيق اللامركزي")
    print("=" * 50)
    print(f"👥 عدد الشهود: {len(PEERS)}")
    print(f"📁 مجلد البيانات: {DATA_DIR}")
    print(f"🌐 الخادم: http://localhost:{PORT}")
    print("-" * 50)
    print("📍 المسارات المتاحة:")
    print(f"   ✅ http://localhost:{PORT}/         → الرئيسي")
    print(f"   ✅ http://localhost:{PORT}/verify   → صفحة التوثيق")
    print(f"   ✅ http://localhost:{PORT}/witness  → صفحة الشهود")
    print(f"   ✅ http://localhost:{PORT}/profile  → الملف الشخصي")
    print(f"   ✅ http://localhost:{PORT}/chain    → API سلسلة الكتل")
    print(f"   ✅ http://localhost:{PORT}/health   → نقطة صحية")
    print("=" * 50)
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
