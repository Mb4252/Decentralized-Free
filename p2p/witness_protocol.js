/**
 * بروتوكول الشهود اللامركزي (P2P Witness Protocol)
 * يدير التواصل بين العقد، التصويت الجماعي، ونظام السمعة
 */

class WitnessProtocol {
    constructor(nodeId, nodeName) {
        this.nodeId = nodeId;
        this.nodeName = nodeName;
        this.peers = new Map(); // peerId -> { connection, reputation, lastSeen }
        this.pendingVotes = new Map(); // identityHash -> { votes, startTime }
        this.reputation = 100; // السمعة الابتدائية
        this.eventListeners = new Map();
        
        // إعدادات البروتوكول
        this.config = {
            consensusThreshold: 60, // 60% للموافقة
            voteTimeout: 30000, // 30 ثانية للتصويت
            minPeersForConsensus: 3,
            heartbeatInterval: 5000,
            witnessReward: 5,
            witnessPenalty: 10
        };
        
        this.initialize();
    }
    
    /**
     * تهيئة البروتوكول
     */
    initialize() {
        console.log(`🔐 بروتوكول الشهود - العقدة: ${this.nodeName} (${this.nodeId})`);
        
        // بدء نبضات القلب
        setInterval(() => this.broadcastHeartbeat(), this.config.heartbeatInterval);
        
        // تنظيف العقد غير النشطة
        setInterval(() => this.cleanupInactivePeers(), 60000);
    }
    
    /**
     * إضافة عقدة نظيرة (Peer)
     */
    addPeer(peerId, peerName, peerReputation = 100) {
        if (this.peers.has(peerId)) return false;
        
        this.peers.set(peerId, {
            id: peerId,
            name: peerName,
            reputation: peerReputation,
            lastSeen: Date.now(),
            connection: null,
            successfulVotes: 0,
            failedVotes: 0
        });
        
        this.emit('peerConnected', { peerId, peerName });
        console.log(`➕ تمت إضافة عقدة: ${peerName} (${peerId})`);
        return true;
    }
    
    /**
     * إزالة عقدة نظيرة
     */
    removePeer(peerId) {
        if (!this.peers.has(peerId)) return false;
        this.peers.delete(peerId);
        this.emit('peerDisconnected', { peerId });
        console.log(`➖ تمت إزالة عقدة: ${peerId}`);
        return true;
    }
    
    /**
     * تحديث سمعة العقدة
     */
    updatePeerReputation(peerId, delta) {
        const peer = this.peers.get(peerId);
        if (!peer) return;
        
        peer.reputation = Math.max(0, Math.min(100, peer.reputation + delta));
        if (delta > 0) {
            peer.successfulVotes++;
        } else if (delta < 0) {
            peer.failedVotes++;
        }
        
        this.emit('reputationUpdated', { peerId, newReputation: peer.reputation, delta });
        console.log(`⭐ سمعة ${peer.name}: ${peer.reputation} (${delta > 0 ? '+' : ''}${delta})`);
    }
    
    /**
     * بث نبضات القلب لاكتشاف العقد النشطة
     */
    broadcastHeartbeat() {
        const heartbeat = {
            type: 'heartbeat',
            nodeId: this.nodeId,
            nodeName: this.nodeName,
            reputation: this.reputation,
            timestamp: Date.now()
        };
        
        this.broadcast(heartbeat);
    }
    
    /**
     * بدء جلسة تصويت لهوية جديدة
     */
    startVotingSession(identityHash, biometricData, timeout = null) {
        const sessionTimeout = timeout || this.config.voteTimeout;
        
        this.pendingVotes.set(identityHash, {
            votes: new Map(), // peerId -> { approved, timestamp, reputation }
            startTime: Date.now(),
            biometricData: biometricData,
            status: 'active'
        });
        
        // طلب التصويت من جميع العقد
        const voteRequest = {
            type: 'vote_request',
            identityHash: identityHash,
            biometricFingerprint: biometricData.frequencyFingerprint,
            requestorId: this.nodeId,
            timestamp: Date.now()
        };
        
        this.broadcast(voteRequest);
        
        // تعيين مهلة لجلسة التصويت
        setTimeout(() => {
            this.finalizeVotingSession(identityHash);
        }, sessionTimeout);
        
        console.log(`🗳️ بدء جلسة تصويت للهوية: ${identityHash.substring(0, 16)}...`);
        return identityHash;
    }
    
    /**
     * معالجة طلب التصويت الوارد
     */
    handleVoteRequest(request, fromPeerId) {
        const identityHash = request.identityHash;
        
        // التحقق من صحة البصمة البيومترية
        const isValidBiometric = this.validateBiometricData(request.biometricFingerprint);
        
        // حساب قرار التصويت بناءً على سمعة العقدة وبياناتها
        const peer = this.peers.get(fromPeerId);
        const trustScore = peer ? peer.reputation / 100 : 0.5;
        
        // العقد ذات السمعة العالية تميل إلى الموافقة على الهويات الصحيحة
        const approvalProbability = isValidBiometric ? 0.8 + trustScore * 0.2 : 0.2;
        const approved = Math.random() < approvalProbability;
        
        // إرسال الرد
        const voteResponse = {
            type: 'vote_response',
            identityHash: identityHash,
            approved: approved,
            voterId: this.nodeId,
            voterReputation: this.reputation,
            timestamp: Date.now()
        };
        
        this.sendToPeer(fromPeerId, voteResponse);
        console.log(`🗳️ تم التصويت على ${identityHash.substring(0, 10)}...: ${approved ? '✅ موافق' : '❌ رفض'}`);
    }
    
    /**
     * معالجة ردود التصويت
     */
    handleVoteResponse(response, fromPeerId) {
        const session = this.pendingVotes.get(response.identityHash);
        if (!session || session.status !== 'active') return;
        
        // تسجيل التصويت
        session.votes.set(fromPeerId, {
            approved: response.approved,
            timestamp: response.timestamp,
            reputation: response.voterReputation
        });
        
        this.emit('voteReceived', {
            identityHash: response.identityHash,
            fromPeer: fromPeerId,
            approved: response.approved
        });
        
        // التحقق من اكتمال التصويت
        const totalVotes = session.votes.size;
        const activePeers = Array.from(this.peers.values()).filter(p => p.reputation >= 50).length;
        
        if (totalVotes >= Math.min(activePeers, this.config.minPeersForConsensus)) {
            this.finalizeVotingSession(response.identityHash);
        }
    }
    
    /**
     * إنهاء جلسة التصويت وحساب النتيجة
     */
    finalizeVotingSession(identityHash) {
        const session = this.pendingVotes.get(identityHash);
        if (!session || session.status !== 'active') return;
        
        session.status = 'completed';
        
        // حساب نتائج التصويت المرجحة بالسمعة
        let weightedApprove = 0;
        let weightedTotal = 0;
        
        for (const [peerId, vote] of session.votes) {
            const weight = vote.reputation / 100;
            weightedTotal += weight;
            if (vote.approved) {
                weightedApprove += weight;
            }
        }
        
        const approvalRate = weightedTotal > 0 ? (weightedApprove / weightedTotal) * 100 : 0;
        const consensusPassed = approvalRate >= this.config.consensusThreshold;
        
        // تحديث سمعة المشاركين
        for (const [peerId, vote] of session.votes) {
            const peer = this.peers.get(peerId);
            if (!peer) continue;
            
            // إذا كانت الهوية صحيحة والتصويت دقيق
            const isCorrectVote = (consensusPassed && vote.approved) || (!consensusPassed && !vote.approved);
            const delta = isCorrectVote ? this.config.witnessReward : -this.config.witnessPenalty;
            this.updatePeerReputation(peerId, delta);
        }
        
        const result = {
            identityHash: identityHash,
            approvalRate: approvalRate,
            consensusPassed: consensusPassed,
            totalVotes: session.votes.size,
            weightedApprove: weightedApprove,
            timestamp: Date.now()
        };
        
        this.emit('votingCompleted', result);
        this.pendingVotes.delete(identityHash);
        
        console.log(`📊 نتائج التصويت للهوية ${identityHash.substring(0, 16)}...: ${approvalRate.toFixed(1)}% (${consensusPassed ? '✅ مقبولة' : '❌ مرفوضة'})`);
        
        return result;
    }
    
    /**
     * التحقق من صحة البيانات البيومترية
     */
    validateBiometricData(biometricFingerprint) {
        // التحقق من أن البصمة لها تنسيق صحيح
        return biometricFingerprint && biometricFingerprint.length === 32;
    }
    
    /**
     * بث رسالة لجميع العقد النشطة
     */
    broadcast(message) {
        for (const [peerId, peer] of this.peers) {
            this.sendToPeer(peerId, message);
        }
    }
    
    /**
     * إرسال رسالة لعقدة محددة
     */
    sendToPeer(peerId, message) {
        // في التطبيق الحقيقي، يتم استخدام WebSocket أو WebRTC
        const event = new CustomEvent('witnessMessage', {
            detail: { peerId, message, from: this.nodeId }
        });
        window.dispatchEvent(event);
        
        // محاكاة استجابة العقدة
        this.simulatePeerResponse(peerId, message);
    }
    
    /**
     * محاكاة استجابة العقدة (للتطوير)
     */
    simulatePeerResponse(peerId, message) {
        setTimeout(() => {
            const peer = this.peers.get(peerId);
            if (!peer) return;
            
            if (message.type === 'heartbeat') {
                // تحديث وقت آخر ظهور
                peer.lastSeen = Date.now();
                this.emit('peerHeartbeat', { peerId, peer: peer });
            } else if (message.type === 'vote_request') {
                this.handleVoteRequest(message, peerId);
            } else if (message.type === 'vote_response') {
                this.handleVoteResponse(message, peerId);
            }
        }, 50 + Math.random() * 200);
    }
    
    /**
     * تنظيف العقد غير النشطة
     */
    cleanupInactivePeers() {
        const now = Date.now();
        const inactivityThreshold = 120000; // دقيقتين
        
        for (const [peerId, peer] of this.peers) {
            if (now - peer.lastSeen > inactivityThreshold) {
                this.removePeer(peerId);
            }
        }
    }
    
    /**
     * إضافة مستمع للأحداث
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }
    
    /**
     * إطلاق حدث
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            for (const callback of this.eventListeners.get(event)) {
                callback(data);
            }
        }
    }
    
    /**
     * الحصول على إحصائيات الشبكة
     */
    getNetworkStats() {
        const activePeers = Array.from(this.peers.values()).filter(p => Date.now() - p.lastSeen < 60000);
        const totalPeers = this.peers.size;
        const avgReputation = activePeers.reduce((sum, p) => sum + p.reputation, 0) / (activePeers.length || 1);
        
        return {
            totalPeers: totalPeers,
            activePeers: activePeers.length,
            myReputation: this.reputation,
            averageReputation: avgReputation,
            pendingVotes: this.pendingVotes.size
        };
    }
}

// تصدير البروتوكول
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WitnessProtocol;
}
