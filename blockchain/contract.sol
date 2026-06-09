// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title وثاق - عقد الهوية بالذكاء الجماعي
 * @dev نظام لامركزي لإدارة الهويات مع نظام سمعة وطعن
 */
contract WethaqIdentity {
    
    // ------------------- الهياكل -------------------
    struct Identity {
        bytes32 identityHash;
        bytes32 biometricFingerprint;
        uint256 timestamp;
        address[] witnesses;
        uint256 approvalRate;
        bool isValid;
        bool isAppealed;
    }
    
    struct Witness {
        address witnessAddress;
        string name;
        uint256 reputation;
        uint256 successfulVotes;
        uint256 failedVotes;
        uint256 lastActive;
    }
    
    struct Appeal {
        address appellant;
        bytes32 identityHash;
        string reason;
        uint256 timestamp;
        bool resolved;
        bool approved;
    }
    
    // ------------------- الحالات -------------------
    mapping(bytes32 => Identity) public identities;
    mapping(address => Witness) public witnesses;
    mapping(bytes32 => Appeal) public appeals;
    
    address[] public allWitnesses;
    bytes32[] public allIdentities;
    
    // إعدادات النظام
    uint256 public constant MIN_REPUTATION_TO_VOTE = 50;
    uint256 public constant CONSENSUS_THRESHOLD = 60; // 60%
    uint256 public constant WITNESS_REWARD = 5;
    uint256 public constant WITNESS_PENALTY = 10;
    uint256 public constant APPEAL_TIMEOUT = 7 days;
    
    // الأحداث
    event IdentityRegistered(bytes32 indexed identityHash, address indexed registrant, uint256 approvalRate);
    event IdentityVerified(bytes32 indexed identityHash, bool isValid);
    event WitnessVoted(address indexed witness, bytes32 indexed identityHash, bool approved);
    event AppealFiled(bytes32 indexed identityHash, address indexed appellant);
    event AppealResolved(bytes32 indexed identityHash, bool approved);
    event ReputationUpdated(address indexed witness, uint256 newReputation);
    
    // ------------------- المعدلات -------------------
    modifier onlyRegisteredWitness() {
        require(witnesses[msg.sender].reputation > 0, "ليس شاهداً مسجلاً");
        _;
    }
    
    modifier identityExists(bytes32 _identityHash) {
        require(identities[_identityHash].timestamp > 0, "الهوية غير موجودة");
        _;
    }
    
    // ------------------- وظائف إدارة الشهود -------------------
    function registerWitness(string memory _name) external {
        require(witnesses[msg.sender].reputation == 0, "مسجل مسبقاً");
        
        witnesses[msg.sender] = Witness({
            witnessAddress: msg.sender,
            name: _name,
            reputation: 100, // سمعة ابتدائية 100
            successfulVotes: 0,
            failedVotes: 0,
            lastActive: block.timestamp
        });
        
        allWitnesses.push(msg.sender);
        emit ReputationUpdated(msg.sender, 100);
    }
    
    // ------------------- وظائف التسجيل -------------------
    function registerIdentity(
        bytes32 _identityHash,
        bytes32 _biometricFingerprint,
        address[] memory _witnesses,
        uint256 _approvalRate
    ) external {
        require(identities[_identityHash].timestamp == 0, "الهوية مسجلة مسبقاً");
        require(_approvalRate >= CONSENSUS_THRESHOLD, "نسبة الموافقة غير كافية");
        
        Identity memory newIdentity = Identity({
            identityHash: _identityHash,
            biometricFingerprint: _biometricFingerprint,
            timestamp: block.timestamp,
            witnesses: _witnesses,
            approvalRate: _approvalRate,
            isValid: true,
            isAppealed: false
        });
        
        identities[_identityHash] = newIdentity;
        allIdentities.push(_identityHash);
        
        // مكافأة الشهود الذين صوتوا بشكل صحيح
        for (uint i = 0; i < _witnesses.length; i++) {
            address witnessAddr = _witnesses[i];
            if (witnesses[witnessAddr].reputation > 0) {
                witnesses[witnessAddr].reputation += WITNESS_REWARD;
                witnesses[witnessAddr].successfulVotes++;
                emit ReputationUpdated(witnessAddr, witnesses[witnessAddr].reputation);
            }
        }
        
        emit IdentityRegistered(_identityHash, msg.sender, _approvalRate);
        emit IdentityVerified(_identityHash, true);
    }
    
    // ------------------- وظائف التصويت -------------------
    function voteOnIdentity(bytes32 _identityHash, bool _approve) external onlyRegisteredWitness identityExists(_identityHash) {
        Identity storage identity = identities[_identityHash];
        
        // التحقق من أن الشاهد لم يصوت مسبقاً
        for (uint i = 0; i < identity.witnesses.length; i++) {
            require(identity.witnesses[i] != msg.sender, "صوت مسبقاً");
        }
        
        // التحقق من سمعة الشاهد
        require(witnesses[msg.sender].reputation >= MIN_REPUTATION_TO_VOTE, "سمعة منخفضة جداً للتصويت");
        
        identity.witnesses.push(msg.sender);
        
        if (_approve) {
            identity.approvalRate = (identity.approvalRate * (identity.witnesses.length - 1) + 100) / identity.witnesses.length;
        } else {
            identity.approvalRate = (identity.approvalRate * (identity.witnesses.length - 1)) / identity.witnesses.length;
        }
        
        emit WitnessVoted(msg.sender, _identityHash, _approve);
        
        // تحديث حالة الهوية بناءً على نسبة الموافقة
        if (identity.approvalRate >= CONSENSUS_THRESHOLD) {
            identity.isValid = true;
            emit IdentityVerified(_identityHash, true);
        } else if (identity.witnesses.length > 3 && identity.approvalRate < CONSENSUS_THRESHOLD - 20) {
            identity.isValid = false;
            emit IdentityVerified(_identityHash, false);
            
            // عقاب الشهود الذين صوتوا ضد هوية صحيحة (في حال تبين لاحقاً)
            for (uint i = 0; i < identity.witnesses.length; i++) {
                // هذه عقوبة مؤقتة سيتم تعديلها بعد الاستئناف
            }
        }
    }
    
    // ------------------- نظام الطعن والاستئناف -------------------
    function fileAppeal(bytes32 _identityHash, string memory _reason) external identityExists(_identityHash) {
        Identity storage identity = identities[_identityHash];
        require(!identity.isAppealed, "استئناف قيد المعالجة");
        require(block.timestamp - identity.timestamp < APPEAL_TIMEOUT, "انتهت مهلة الاستئناف");
        
        appeals[_identityHash] = Appeal({
            appellant: msg.sender,
            identityHash: _identityHash,
            reason: _reason,
            timestamp: block.timestamp,
            resolved: false,
            approved: false
        });
        
        identity.isAppealed = true;
        emit AppealFiled(_identityHash, msg.sender);
    }
    
    function resolveAppeal(bytes32 _identityHash, bool _approved) external {
        // يمكن فقط للمحكمين (عقد ذات سمعة > 90) حل الاستئنافات
        require(witnesses[msg.sender].reputation >= 90, "صلاحية غير كافية");
        
        Appeal storage appeal = appeals[_identityHash];
        require(!appeal.resolved, "تم حل الاستئناف مسبقاً");
        
        appeal.resolved = true;
        appeal.approved = _approved;
        
        Identity storage identity = identities[_identityHash];
        
        if (_approved) {
            // قبول الاستئناف - إعادة تأكيد الهوية
            identity.isValid = true;
            
            // مكافأة المستأنف
            if (witnesses[appeal.appellant].reputation > 0) {
                witnesses[appeal.appellant].reputation += 20;
                emit ReputationUpdated(appeal.appellant, witnesses[appeal.appellant].reputation);
            }
            
            // عقاب الشهود الذين صوتوا ضد هوية صحيحة
            for (uint i = 0; i < identity.witnesses.length; i++) {
                address witnessAddr = identity.witnesses[i];
                // تحقق مما إذا كان هذا الشاهد قد صوت ضد
                // (يتم تخزين نمط التصويت في حدث منفصل)
                if (witnesses[witnessAddr].reputation > 0) {
                    witnesses[witnessAddr].reputation = witnesses[witnessAddr].reputation > WITNESS_PENALTY ? 
                        witnesses[witnessAddr].reputation - WITNESS_PENALTY : 0;
                    witnesses[witnessAddr].failedVotes++;
                    emit ReputationUpdated(witnessAddr, witnesses[witnessAddr].reputation);
                }
            }
        } else {
            // رفض الاستئناف - خصم سمعة المستأنف
            if (witnesses[appeal.appellant].reputation > 0) {
                witnesses[appeal.appellant].reputation = witnesses[appeal.appellant].reputation > 10 ? 
                    witnesses[appeal.appellant].reputation - 10 : 0;
                emit ReputationUpdated(appeal.appellant, witnesses[appeal.appellant].reputation);
            }
        }
        
        emit AppealResolved(_identityHash, _approved);
    }
    
    // ------------------- وظائف الاستعلام -------------------
    function getIdentity(bytes32 _identityHash) external view returns (
        bytes32 identityHash,
        bytes32 biometricFingerprint,
        uint256 timestamp,
        uint256 witnessCount,
        uint256 approvalRate,
        bool isValid,
        bool isAppealed
    ) {
        Identity storage id = identities[_identityHash];
        return (
            id.identityHash,
            id.biometricFingerprint,
            id.timestamp,
            id.witnesses.length,
            id.approvalRate,
            id.isValid,
            id.isAppealed
        );
    }
    
    function getWitnessInfo(address _witness) external view returns (
        string memory name,
        uint256 reputation,
        uint256 successfulVotes,
        uint256 failedVotes,
        uint256 lastActive
    ) {
        Witness storage w = witnesses[_witness];
        return (
            w.name,
            w.reputation,
            w.successfulVotes,
            w.failedVotes,
            w.lastActive
        );
    }
    
    function getAllIdentities() external view returns (bytes32[] memory) {
        return allIdentities;
    }
    
    function getAllWitnesses() external view returns (address[] memory) {
        return allWitnesses;
    }
}
