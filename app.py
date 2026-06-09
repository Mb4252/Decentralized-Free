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
from flask import Flask, request, jsonify, send_from_directory, redirect, render_template, session
from flask_cors import CORS
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
    print(f"⚠️ تم استخدام مجلد بديل للبيانات: {DATA_DIR}")

LEDGER_FILE = os.path.join(DATA_DIR, 'ledger.json')
PEERS_FILE = os.path.join(DATA_DIR, 'peers.json')
INVITES_FILE = os.path.join(DATA_DIR, 'invites.json')
PENDING_VERIFICATIONS_FILE = os.path.join(DATA_DIR, 'pending_verifications.json')

# ------------------- نظام الدعوات - السماح لأول 100 مستخدم بدون رمز -------------------
MAX_FREE_USERS = 100  # عدد المستخدمين المسموح لهم بالتسجيل المجاني
FREE_USERS_FILE = os.path.join(DATA_DIR, 'free_users_count.json')

def get_free_users_count():
    """الحصول على عدد المستخدمين الذين سجلوا بدون رمز دعوة"""
    try:
        with open(FREE_USERS_FILE, 'r') as f:
            data = json.load(f)
            return data.get('count', 0)
    except FileNotFoundError:
        return 0

def increment_free_users_count():
    """زيادة عداد المستخدمين المجانيين"""
    count = get_free_users_count() + 1
    with open(FREE_USERS_FILE, 'w') as f:
        json.dump({'count': count}, f)
    return count

def can_register_without_invite():
    """التحقق مما إذا كان التسجيل بدون رمز دعوة لا يزال متاحاً"""
    return get_free_users_count() < MAX_FREE_USERS

# ------------------- إعدادات النظام -------------------
VERIFICATION_STATUS = {
    'PENDING': 'pending',
    'APPROVED': 'approved', 
    'REJECTED': 'rejected'
}

MIN_TRUST_SCORE_TO_VOTE = 50
CONSENSUS_THRESHOLD = 0.6  # 60% موافقة

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

def load_pending_verifications():
    try:
        with open(PENDING_VERIFICATIONS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}

def save_pending_verifications(pending):
    with open(PENDING_VERIFICATIONS_FILE, 'w') as f:
        json.dump(pending, f, indent=2)

ledger_lock = threading.Lock()

# ------------------- دوال مساعدة -------------------
def generate_invite_code():
    """توليد رمز دعوة فريد"""
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
@app.route('/invite', methods=['POST'])
def create_invite():
    data = request.get_json()
    inviter = data.get('inviter')
    
    is_verified = False
    for block in blockchain.chain:
        if block.name == inviter and block.status == 'approved':
            is_verified = True
            break
    
    if not is_verified:
        return jsonify({"error": "Only verified users can invite others"}), 403
    
    invites = load_invites()
    invite_code = generate_invite_code()
    invites[invite_code] = {
        "inviter": inviter,
        "created_at": str(datetime.datetime.now()),
        "used": False,
        "used_by": None
    }
    save_invites(invites)
    
    return jsonify({"invite_code": invite_code}), 200

@app.route('/verify-invite', methods=['POST'])
def verify_invite():
    data = request.get_json()
    invite_code = data.get('invite_code')
    
    invites = load_invites()
    
    if invite_code not in invites:
        return jsonify({"valid": False, "error": "Invalid invite code"}), 404
    
    if invites[invite_code]['used']:
        return jsonify({"valid": False, "error": "Invite code already used"}), 409
    
    return jsonify({
        "valid": True,
        "inviter": invites[invite_code]['inviter'],
        "created_at": invites[invite_code]['created_at']
    }), 200

@app.route('/propose-verification', methods=['POST'])
def propose_verification():
    data = request.get_json()
    required = ['name', 'face_hash', 'document_hash', 'document_type']
    
    if not all(k in data for k in required):
        return jsonify({"error": "بيانات ناقصة"}), 400
    
    invite_code = data.get('invite_code')
    free_users_count = get_free_users_count()
    
    # ✅ المنطق الجديد: أول 100 مستخدم بدون رمز دعوة
    if free_users_count < MAX_FREE_USERS:
        # لا حاجة لرمز دعوة
        pass
    elif not invite_code:
        remaining = MAX_FREE_USERS - free_users_count
        return jsonify({"error": f"⚠️ تم الوصول للحد الأقصى ({MAX_FREE_USERS}) مستخدم مجاني. يلزم رمز دعوة. المقاعد المتبقية: {remaining}"}), 403
    else:
        # التحقق من رمز الدعوة للمستخدمين الجدد
        invites = load_invites()
        if invite_code not in invites or invites[invite_code]['used']:
            return jsonify({"error": "رمز دعوة غير صالح أو مستخدم"}), 403
        
        # تحديث حالة رمز الدعوة
        invites[invite_code]['used'] = True
        invites[invite_code]['used_by'] = data['name']
        save_invites(invites)
    
    # ✅ زيادة العداد إذا كان هذا مستخدم جديد
    registered_before = False
    for block in blockchain.chain:
        if block.name == data['name']:
            registered_before = True
            break
    
    if not registered_before and free_users_count < MAX_FREE_USERS:
        increment_free_users_count()
        new_count = get_free_users_count()
        print(f"📊 مستخدم جديد مجاني! المستخدم رقم {new_count} من {MAX_FREE_USERS}")
    
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

@app.route('/trust-score', methods=['GET'])
def get_trust_score():
    user_id = request.args.get('user_id')
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    
    score = trust_manager.get_trust_score(user_id)
    return jsonify({"trust_score": score}), 200

@app.route('/witnesses', methods=['GET'])
def get_witnesses():
    witnesses = []
    for peer in PEERS:
        try:
            resp = requests.get(f"{peer}/health", timeout=2)
            if resp.status_code == 200:
                witnesses.append({"url": peer, "status": "active"})
        except:
            witnesses.append({"url": peer, "status": "inactive"})
    
    return jsonify({"witnesses": witnesses, "auto_validator_active": len(PEERS) == 0}), 200

@app.route('/register-witness', methods=['POST'])
def register_witness():
    data = request.get_json()
    witness_url = data.get('witness_url')
    invite_code = data.get('invite_code')
    
    if not witness_url or not invite_code:
        return jsonify({"error": "witness_url and invite_code required"}), 400
    
    invites = load_invites()
    if invite_code not in invites or invites[invite_code]['used']:
        return jsonify({"error": "Invalid invite code"}), 403
    
    PEERS.add(witness_url)
    save_peers()
    
    invites[invite_code]['used'] = True
    invites[invite_code]['used_by'] = witness_url
    save_invites(invites)
    
    return jsonify({"message": "Witness registered successfully", "peers": list(PEERS)}), 200

@app.route('/system-status', methods=['GET'])
def system_status():
    """عرض حالة النظام وعدد المستخدمين المتبقيين"""
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

@app.route('/stats', methods=['GET'])
def public_stats():
    """صفحة عامة لإحصائيات النظام"""
    free_users = get_free_users_count()
    total_users = len([b for b in blockchain.chain if b.status == 'approved' and b.index > 0])
    
    return jsonify({
        "total_verified_users": total_users,
        "free_registrations_used": free_users,
        "free_registrations_remaining": max(0, MAX_FREE_USERS - free_users),
        "invite_only": free_users >= MAX_FREE_USERS
    }), 200

# ------------------- المسارات الأساسية -------------------
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

@app.route('/health', methods=['GET'])
def health():
    free_users = get_free_users_count()
    remaining = MAX_FREE_USERS - free_users
    return jsonify({
        "status": "healthy",
        "chain_length": len(blockchain.chain),
        "peers_count": len(PEERS),
        "auto_validator_active": len(PEERS) == 0,
        "pending_count": len(blockchain.get_pending_blocks()),
        "free_registrations_remaining": max(0, remaining),
        "invite_only_mode": remaining <= 0
    }), 200

@app.route('/verify_person', methods=['POST'])
def verify_person():
    data = request.get_json()
    if not data:
        return jsonify({"error": "بيانات غير صالحة"}), 400

    query_value = data.get('query_value', '').strip()
    results = []
    for block in blockchain.chain:
        if block.name.lower() == query_value.lower() and block.status == 'approved':
            results.append({
                "index": block.index, "name": block.name,
                "face_hash": block.face_hash, "document_hash": block.document_hash,
                "document_type": block.document_type, "timestamp": block.timestamp,
                "node_id": block.node_id, "status": block.status
            })
    if results:
        return jsonify({"verified": True, "records": results}), 200
    return jsonify({"verified": False}), 404

@app.route('/request-invite', methods=['POST'])
def request_invite():
    """طلب رمز دعوة من مستخدم جديد"""
    data = request.get_json()
    email = data.get('email')
    reason = data.get('reason', '')
    
    if not email:
        return jsonify({"error": "Email required"}), 400
    
    INVITE_REQUESTS_FILE = os.path.join(DATA_DIR, 'invite_requests.json')
    try:
        with open(INVITE_REQUESTS_FILE, 'r') as f:
            requests_db = json.load(f)
    except FileNotFoundError:
        requests_db = {}
    
    request_id = str(len(requests_db) + 1)
    requests_db[request_id] = {
        "email": email,
        "reason": reason,
        "status": "pending",
        "created_at": str(datetime.datetime.now())
    }
    
    with open(INVITE_REQUESTS_FILE, 'w') as f:
        json.dump(requests_db, f, indent=2)
    
    print(f"📧 طلب دعوة جديد من: {email}")
    
    return jsonify({"message": "Request submitted. You will receive an invite within 24 hours."}), 200

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
    load_peers()
    threading.Thread(target=sync_with_peers).start()
    free_remaining = MAX_FREE_USERS - get_free_users_count()
    print("=" * 50)
    print("🔐 وثاق - نظام التوثيق بالشهود (Witness-based System)")
    print("=" * 50)
    print(f"🎯 وضع التوثيق الذاتي (AI Validator): {'نشط' if len(PEERS) == 0 else 'غير نشط - يوجد شهود'}")
    print(f"👥 عدد الشهود: {len(PEERS)}")
    print(f"📊 المقاعد المجانية المتبقية: {free_remaining} / {MAX_FREE_USERS}")
    print(f"🔐 وضع الدعوات: {'مغلق (Invite-Only)' if free_remaining <= 0 else 'مفتوح'}")
    print(f"📁 مجلد البيانات: {DATA_DIR}")
    print(f"🌐 الخادم: http://localhost:{PORT}")
    print("=" * 50)
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
