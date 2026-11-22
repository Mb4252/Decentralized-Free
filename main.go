package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	MaxSupply        int64 = 50_000_000
	GenesisSupply    int64 = 40_000_000
	MiningCap        int64 = 10_000_000
	BlockReward      int64 = 50
	BaseDifficulty         = 4
	MaxDifficulty          = 8
	ActiveUserWindow       = 5 * time.Minute
	UsersPerDiffStep       = 5
	MaxDriftSeconds  int64 = 300
	DefaultChainFile       = "sdm_chain.json"
	GenesisAddress         = "SDM_GENESIS_VAULT_0001"
)

type Transaction struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Amount    int64  `json:"amount"`
	Nonce     uint64 `json:"nonce"`
	Timestamp int64  `json:"timestamp"`
	Note      string `json:"note,omitempty"`
	PublicKey string `json:"public_key,omitempty"`
	Signature string `json:"signature,omitempty"`
}

type Block struct {
	Index        int           `json:"index"`
	Timestamp    int64         `json:"timestamp"`
	Transactions []Transaction `json:"transactions"`
	PrevHash     string        `json:"prev_hash"`
	Hash         string        `json:"hash"`
	Nonce        int64         `json:"nonce"`
	Difficulty   int           `json:"difficulty"`
	Miner        string        `json:"miner,omitempty"`
}

type PersistedState struct {
	Chain       []Block          `json:"chain"`
	Mempool     []Transaction    `json:"mempool"`
	ActiveUsers map[string]int64 `json:"active_users"`
	Peers       map[string]int64 `json:"peers"`
}

type Node struct {
	mu          sync.RWMutex
	Chain       []Block          `json:"chain"`
	Mempool     []Transaction    `json:"mempool"`
	ActiveUsers map[string]int64 `json:"active_users"`
	Peers       map[string]int64 `json:"peers"`
	ChainFile   string           `json:"-"`
	DBUrl       string           `json:"-"`
}

func deriveAddressFromPubBytes(pubBytes []byte) string {
	pubSum := sha256.Sum256(pubBytes)
	addrHash := sha256.Sum256(pubSum[:])
	return "SDM" + hex.EncodeToString(addrHash[:16])
}

func txSigningDigest(tx Transaction) []byte {
	payload := fmt.Sprintf("%s|%s|%d|%d|%d|%s",
		tx.From, tx.To, tx.Amount, tx.Nonce, tx.Timestamp, tx.Note)
	sum := sha256.Sum256([]byte(payload))
	return sum[:]
}

func verifyTransactionSignature(tx Transaction) bool {
	if tx.From == "GENESIS" || tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
		return true
	}
	if tx.PublicKey == "" || tx.Signature == "" || tx.From == "" {
		return false
	}
	pubBytes, err := hex.DecodeString(strings.TrimSpace(tx.PublicKey))
	if err != nil {
		return false
	}
	expectedAddr := deriveAddressFromPubBytes(pubBytes)
	if !strings.EqualFold(expectedAddr, tx.From) {
		return false
	}
	x, y := elliptic.UnmarshalCompressed(elliptic.P256(), pubBytes)
	if x == nil || y == nil {
		x, y = elliptic.Unmarshal(elliptic.P256(), pubBytes)
		if x == nil || y == nil {
			return false
		}
	}
	pubKey := &ecdsa.PublicKey{Curve: elliptic.P256(), X: x, Y: y}

	sigBytes, err := hex.DecodeString(strings.TrimSpace(tx.Signature))
	if err != nil || len(sigBytes) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(sigBytes[:32])
	s := new(big.Int).SetBytes(sigBytes[32:])
	if r.Sign() <= 0 || s.Sign() <= 0 {
		return false
	}
	return ecdsa.Verify(pubKey, txSigningDigest(tx), r, s)
}

func calculateBlockHash(b Block) string {
	txBytes, _ := json.Marshal(b.Transactions)
	record := fmt.Sprintf("%d|%d|%s|%s|%d|%d|%s",
		b.Index, b.Timestamp, string(txBytes), b.PrevHash, b.Nonce, b.Difficulty, b.Miner)
	sum := sha256.Sum256([]byte(record))
	return hex.EncodeToString(sum[:])
}

func hasValidProof(hash string, difficulty int) bool {
	if difficulty <= 0 {
		return true
	}
	prefix := strings.Repeat("0", difficulty)
	return strings.HasPrefix(hash, prefix)
}

func mineBlock(index int, txs []Transaction, prevHash string, difficulty int, miner string) Block {
	var nonce int64 = 0
	for {
		ts := time.Now().UTC().Unix()
		candidate := Block{
			Index:        index,
			Timestamp:    ts,
			Transactions: txs,
			PrevHash:     prevHash,
			Nonce:        nonce,
			Difficulty:   difficulty,
			Miner:        miner,
		}
		h := calculateBlockHash(candidate)
		if hasValidProof(h, difficulty) {
			candidate.Hash = h
			return candidate
		}
		nonce++
	}
}

func newGenesisBlock() Block {
	genesisTx := Transaction{
		From:      "GENESIS",
		To:        GenesisAddress,
		Amount:    GenesisSupply,
		Nonce:     0,
		Timestamp: 1735689600,
		Note:      "SDM Genesis Allocation (40,000,000 SDM)",
	}
	b := Block{
		Index:        0,
		Timestamp:    1735689600,
		Transactions: []Transaction{genesisTx},
		PrevHash:     strings.Repeat("0", 64),
		Nonce:        0,
		Difficulty:   BaseDifficulty,
		Miner:        "GENESIS",
	}
	b.Hash = calculateBlockHash(b)
	return b
}

func NewNode(chainFile string, dbUrl string) *Node {
	n := &Node{
		ActiveUsers: make(map[string]int64),
		Peers:       make(map[string]int64),
		ChainFile:   chainFile,
		DBUrl:       strings.TrimSpace(dbUrl),
	}
	if n.DBUrl != "" {
		_ = n.ensureDBTable()
		if err := n.loadFromDB(); err == nil {
			return n
		}
	}
	if err := n.loadFromFile(); err == nil {
		if n.DBUrl != "" {
			_ = n.saveToDB()
		}
		return n
	}
	n.Chain = []Block{newGenesisBlock()}
	_ = n.persistLocked()
	return n
}

func (n *Node) ensureDBTable() error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, n.DBUrl)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sdm_node_state (
			id INT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at BIGINT NOT NULL
		)
	`)
	return err
}

func (n *Node) loadFromDB() error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, n.DBUrl)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	var raw string
	err = conn.QueryRow(ctx, `SELECT state_json FROM sdm_node_state WHERE id = 1`).Scan(&raw)
	if err != nil {
		return err
	}
	return n.applyPersistedJSON([]byte(raw))
}

func (n *Node) saveToDB() error {
	if n.DBUrl == "" {
		return nil
	}
	snap := PersistedState{
		Chain:       append([]Block{}, n.Chain...),
		Mempool:     append([]Transaction{}, n.Mempool...),
		ActiveUsers: cloneInt64Map(n.ActiveUsers),
		Peers:       cloneInt64Map(n.Peers),
	}
	payload, err := json.Marshal(snap)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, n.DBUrl)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, err = conn.Exec(ctx, `
		INSERT INTO sdm_node_state (id, state_json, updated_at)
		VALUES (1, $1, $2)
		ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at
	`, string(payload), time.Now().UTC().Unix())
	return err
}

func cloneInt64Map(src map[string]int64) map[string]int64 {
	dst := make(map[string]int64, len(src))
	for k, v := range src {
		dst[k] = v
	}
	return dst
}

func (n *Node) applyPersistedJSON(data []byte) error {
	var loaded PersistedState
	if err := json.Unmarshal(data, &loaded); err != nil {
		return err
	}
	if len(loaded.Chain) == 0 {
		return errors.New("empty chain")
	}
	if !isValidChain(loaded.Chain) {
		return errors.New("invalid chain")
	}
	n.Chain = loaded.Chain
	n.Mempool = loaded.Mempool
	if loaded.ActiveUsers != nil {
		n.ActiveUsers = loaded.ActiveUsers
	} else {
		n.ActiveUsers = make(map[string]int64)
	}
	if loaded.Peers != nil {
		n.Peers = loaded.Peers
	} else {
		n.Peers = make(map[string]int64)
	}
	return nil
}

func (n *Node) loadFromFile() error {
	data, err := os.ReadFile(n.ChainFile)
	if err != nil {
		return err
	}
	return n.applyPersistedJSON(data)
}

func (n *Node) persistLocked() error {
	snap := PersistedState{
		Chain:       n.Chain,
		Mempool:     n.Mempool,
		ActiveUsers: n.ActiveUsers,
		Peers:       n.Peers,
	}
	payload, err := json.MarshalIndent(snap, "", "  ")
	if err == nil {
		_ = os.WriteFile(n.ChainFile, payload, 0600)
	}
	if n.DBUrl != "" {
		go func(b []byte) {
			_ = n.writeRawToDB(b)
		}(payload)
	}
	return err
}

func (n *Node) writeRawToDB(raw []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, n.DBUrl)
	if err != nil {
		return err
	}
	defer conn.Close(ctx)

	_, _ = conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sdm_node_state (
			id INT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at BIGINT NOT NULL
		)
	`)
	_, err = conn.Exec(ctx, `
		INSERT INTO sdm_node_state (id, state_json, updated_at)
		VALUES (1, $1, $2)
		ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at
	`, string(raw), time.Now().UTC().Unix())
	return err
}

func (n *Node) pruneAndCountActiveUsersLocked(now int64) int {
	cutoff := now - int64(ActiveUserWindow.Seconds())
	for userID, lastSeen := range n.ActiveUsers {
		if lastSeen < cutoff {
			delete(n.ActiveUsers, userID)
		}
	}
	count := len(n.ActiveUsers)
	if count < 1 {
		count = 1
	}
	return count
}

func (n *Node) touchUserLocked(userID string) int {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		userID = "anonymous"
	}
	if len(userID) > 64 {
		userID = userID[:64]
	}
	now := time.Now().UTC().Unix()
	n.ActiveUsers[userID] = now
	return n.pruneAndCountActiveUsersLocked(now)
}

func computeDifficulty(activeUsers int) int {
	if activeUsers < 1 {
		activeUsers = 1
	}
	diff := BaseDifficulty + ((activeUsers - 1) / UsersPerDiffStep)
	if diff < BaseDifficulty {
		diff = BaseDifficulty
	}
	if diff > MaxDifficulty {
		diff = MaxDifficulty
	}
	return diff
}

func computeSupplyStatsLocked(chain []Block) (totalSupply int64, minedSupply int64) {
	for bIdx, b := range chain {
		for _, tx := range b.Transactions {
			if bIdx == 0 || tx.From == "GENESIS" {
				totalSupply += tx.Amount
			} else if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				minedSupply += tx.Amount
				totalSupply += tx.Amount
			}
		}
	}
	return totalSupply, minedSupply
}

func computeAccountStatesLocked(chain []Block) (balances map[string]int64, nonces map[string]uint64) {
	balances = make(map[string]int64)
	nonces = make(map[string]uint64)
	for _, b := range chain {
		for _, tx := range b.Transactions {
			if tx.From != "GENESIS" && tx.From != "COINBASE" && tx.From != "MINING_REWARD" {
				balances[tx.From] -= tx.Amount
				nonces[tx.From] = tx.Nonce + 1
			}
			balances[tx.To] += tx.Amount
		}
	}
	return balances, nonces
}

func isValidChain(chain []Block) bool {
	if len(chain) == 0 {
		return false
	}
	var totalSupply int64
	var minedSupply int64
	balances := make(map[string]int64)
	expectedNonce := make(map[string]uint64)

	for i, b := range chain {
		if b.Index != i {
			return false
		}
		if calculateBlockHash(b) != b.Hash {
			return false
		}
		if i == 0 {
			if b.PrevHash != strings.Repeat("0", 64) {
				return false
			}
		} else {
			prev := chain[i-1]
			if b.PrevHash != prev.Hash {
				return false
			}
			if b.Timestamp < prev.Timestamp {
				return false
			}
			if !hasValidProof(b.Hash, b.Difficulty) {
				return false
			}
		}

		coinbaseCount := 0
		for _, tx := range b.Transactions {
			if tx.Amount <= 0 {
				return false
			}
			if !verifyTransactionSignature(tx) {
				return false
			}
			if i == 0 || tx.From == "GENESIS" {
				totalSupply += tx.Amount
				balances[tx.To] += tx.Amount
			} else if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				coinbaseCount++
				if coinbaseCount > 1 || tx.Amount > BlockReward {
					return false
				}
				minedSupply += tx.Amount
				totalSupply += tx.Amount
				balances[tx.To] += tx.Amount
			} else {
				exp := expectedNonce[tx.From]
				if tx.Nonce != exp {
					return false
				}
				if balances[tx.From] < tx.Amount {
					return false
				}
				balances[tx.From] -= tx.Amount
				balances[tx.To] += tx.Amount
				expectedNonce[tx.From] = exp + 1
			}
		}
	}

	if minedSupply > MiningCap || totalSupply > MaxSupply {
		return false
	}
	return true
}

func generateWallet() (address string, publicKeyHex string, privateKeyPKCS8Hex string, err error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", "", err
	}
	pubBytes := elliptic.MarshalCompressed(priv.Curve, priv.PublicKey.X, priv.PublicKey.Y)
	address = deriveAddressFromPubBytes(pubBytes)

	pkcs8Bytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return "", "", "", err
	}
	return address, hex.EncodeToString(pubBytes), hex.EncodeToString(pkcs8Bytes), nil
}

func enableCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Id")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (n *Node) handleStatus(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	userID := r.URL.Query().Get("user")
	if userID == "" {
		userID = r.Header.Get("X-User-Id")
	}

	n.mu.Lock()
	activeUsers := n.touchUserLocked(userID)
	diff := computeDifficulty(activeUsers)
	totalSupply, minedSupply := computeSupplyStatsLocked(n.Chain)
	remainingMining := MiningCap - minedSupply
	if remainingMining < 0 {
		remainingMining = 0
	}
	height := len(n.Chain) - 1
	latest := n.Chain[height]
	mempoolCount := len(n.Mempool)
	peerCount := len(n.Peers)
	_ = n.persistLocked()
	n.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":               "SDM",
		"name":                 "sdm.coin",
		"max_supply":           MaxSupply,
		"genesis_supply":       GenesisSupply,
		"mining_cap":           MiningCap,
		"total_supply":         totalSupply,
		"mined_supply":         minedSupply,
		"remaining_mining_cap": remainingMining,
		"block_reward":         BlockReward,
		"height":               height,
		"blocks_count":         len(n.Chain),
		"difficulty":           diff,
		"base_difficulty":      BaseDifficulty,
		"max_difficulty":       MaxDifficulty,
		"active_users":         activeUsers,
		"mempool_count":        mempoolCount,
		"peers_count":          peerCount,
		"latest_hash":          latest.Hash,
	})
}

func (n *Node) handleWalletNew(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	addr, pub, privPKCS8, err := generateWallet()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"address":     addr,
		"public_key":  pub,
		"private_key": privPKCS8,
		"nonce":       0,
	})
}

func (n *Node) handleBalance(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	addr := strings.TrimSpace(r.URL.Query().Get("address"))
	if addr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "address query parameter is required"})
		return
	}
	n.mu.RLock()
	balances, nonces := computeAccountStatesLocked(n.Chain)
	var pendingNonce uint64
	for _, m := range n.Mempool {
		if m.From == addr && m.Nonce >= pendingNonce {
			pendingNonce = m.Nonce + 1
		}
	}
	nextNonce := nonces[addr]
	if pendingNonce > nextNonce {
		nextNonce = pendingNonce
	}
	n.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"address":    addr,
		"balance":    balances[addr],
		"nonce":      nonces[addr],
		"next_nonce": nextNonce,
	})
}

func (n *Node) handleTransfer(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "POST required"})
		return
	}
	var req struct {
		From      string `json:"from"`
		To        string `json:"to"`
		Amount    int64  `json:"amount"`
		Nonce     uint64 `json:"nonce"`
		Timestamp int64  `json:"timestamp"`
		Note      string `json:"note"`
		PublicKey string `json:"public_key"`
		Signature string `json:"signature"`
		UserID    string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	req.From = strings.TrimSpace(req.From)
	req.To = strings.TrimSpace(req.To)
	if req.From == "" || req.To == "" || req.Amount <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "from, to, and positive amount are required"})
		return
	}
	if req.From == req.To {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "sender and recipient must be different"})
		return
	}

	now := time.Now().UTC().Unix()
	ts := req.Timestamp
	if ts == 0 {
		ts = now
	}
	if ts < now-MaxDriftSeconds || ts > now+MaxDriftSeconds {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "timestamp out of allowed drift window"})
		return
	}

	tx := Transaction{
		From:      req.From,
		To:        req.To,
		Amount:    req.Amount,
		Nonce:     req.Nonce,
		Timestamp: ts,
		Note:      req.Note,
		PublicKey: strings.TrimSpace(req.PublicKey),
		Signature: strings.TrimSpace(req.Signature),
	}

	if !verifyTransactionSignature(tx) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid transaction signature or public key"})
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	n.touchUserLocked(req.UserID)
	balances, nonces := computeAccountStatesLocked(n.Chain)

	expectedNonce := nonces[req.From]
	var pendingOutgoing int64
	for _, m := range n.Mempool {
		if m.From == req.From {
			pendingOutgoing += m.Amount
			if m.Nonce >= expectedNonce {
				expectedNonce = m.Nonce + 1
			}
		}
	}

	if req.Nonce != expectedNonce {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error":          "invalid transaction nonce",
			"expected_nonce": expectedNonce,
		})
		return
	}

	available := balances[req.From] - pendingOutgoing
	if available < req.Amount {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":     "insufficient balance",
			"available": available,
		})
		return
	}

	n.Mempool = append(n.Mempool, tx)
	_ = n.persistLocked()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "queued",
		"transaction": tx,
		"next_nonce":  expectedNonce + 1,
	})
}

func (n *Node) handleMine(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	var req struct {
		Miner  string `json:"miner"`
		UserID string `json:"user_id"`
	}
	if r.Method == http.MethodPost {
		_ = json.NewDecoder(r.Body).Decode(&req)
	}
	miner := strings.TrimSpace(req.Miner)
	if miner == "" {
		miner = strings.TrimSpace(r.URL.Query().Get("miner"))
	}
	if miner == "" {
		miner = GenesisAddress
	}
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		userID = miner
	}

	n.mu.Lock()
	activeUsers := n.touchUserLocked(userID)
	diff := computeDifficulty(activeUsers)
	totalSupply, minedSupply := computeSupplyStatsLocked(n.Chain)
	remainingMining := MiningCap - minedSupply
	if remainingMining < 0 {
		remainingMining = 0
	}
	remainingTotal := MaxSupply - totalSupply
	if remainingTotal < 0 {
		remainingTotal = 0
	}

	reward := BlockReward
	if reward > remainingMining {
		reward = remainingMining
	}
	if reward > remainingTotal {
		reward = remainingTotal
	}

	txs := make([]Transaction, 0, len(n.Mempool)+1)
	if reward > 0 {
		txs = append(txs, Transaction{
			From:      "COINBASE",
			To:        miner,
			Amount:    reward,
			Nonce:     0,
			Timestamp: time.Now().UTC().Unix(),
			Note:      "PoW Block Reward",
		})
	}
	txs = append(txs, n.Mempool...)

	prev := n.Chain[len(n.Chain)-1]
	nextIndex := prev.Index + 1
	prevHash := prev.Hash
	n.mu.Unlock()

	mined := mineBlock(nextIndex, txs, prevHash, diff, miner)

	n.mu.Lock()
	defer n.mu.Unlock()

	latest := n.Chain[len(n.Chain)-1]
	if latest.Hash != prevHash || latest.Index+1 != mined.Index {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "chain tip changed while mining, please retry",
		})
		return
	}

	candidateChain := append(append([]Block{}, n.Chain...), mined)
	if !isValidChain(candidateChain) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "mined block violated supply or chain rules",
		})
		return
	}

	n.Chain = candidateChain
	n.Mempool = nil
	_ = n.persistLocked()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":       "mined",
		"block":        mined,
		"reward":       reward,
		"difficulty":   diff,
		"active_users": activeUsers,
		"height":       len(n.Chain) - 1,
	})
}

func (n *Node) handleChain(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	n.mu.RLock()
	chainCopy := append([]Block{}, n.Chain...)
	totalSupply, minedSupply := computeSupplyStatsLocked(chainCopy)
	activeUsers := n.pruneAndCountActiveUsersLocked(time.Now().UTC().Unix())
	diff := computeDifficulty(activeUsers)
	n.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":       "SDM",
		"height":       len(chainCopy) - 1,
		"difficulty":   diff,
		"active_users": activeUsers,
		"total_supply": totalSupply,
		"mined_supply": minedSupply,
		"chain":        chainCopy,
	})
}

func (n *Node) handleSync(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	if r.Method == http.MethodGet {
		n.mu.RLock()
		chainCopy := append([]Block{}, n.Chain...)
		mempoolCopy := append([]Transaction{}, n.Mempool...)
		activeUsers := n.pruneAndCountActiveUsersLocked(time.Now().UTC().Unix())
		diff := computeDifficulty(activeUsers)
		n.mu.RUnlock()

		writeJSON(w, http.StatusOK, map[string]any{
			"height":       len(chainCopy) - 1,
			"difficulty":   diff,
			"active_users": activeUsers,
			"chain":        chainCopy,
			"mempool":      mempoolCopy,
		})
		return
	}

	if r.Method == http.MethodPost {
		var req struct {
			Chain  []Block `json:"chain"`
			UserID string  `json:"user_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
			return
		}
		if !isValidChain(req.Chain) {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "incoming chain is invalid"})
			return
		}

		n.mu.Lock()
		defer n.mu.Unlock()

		activeUsers := n.touchUserLocked(req.UserID)
		adopted := false
		if len(req.Chain) > len(n.Chain) {
			n.Chain = append([]Block{}, req.Chain...)
			adopted = true
			_ = n.persistLocked()
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"adopted":      adopted,
			"height":       len(n.Chain) - 1,
			"difficulty":   computeDifficulty(activeUsers),
			"active_users": activeUsers,
			"chain":        n.Chain,
		})
		return
	}

	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "GET or POST required"})
}

func (n *Node) handlePeers(w http.ResponseWriter, r *http.Request) {
	if enableCORS(w, r) {
		return
	}
	if r.Method == http.MethodGet {
		n.mu.RLock()
		peers := make([]string, 0, len(n.Peers))
		for p := range n.Peers {
			peers = append(peers, p)
		}
		n.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"peers": peers})
		return
	}
	if r.Method == http.MethodPost {
		var req struct {
			PeerURL string `json:"peer_url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
			return
		}
		peer := strings.TrimSpace(strings.TrimRight(req.PeerURL, "/"))
		if !strings.HasPrefix(peer, "http://") && !strings.HasPrefix(peer, "https://") {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "peer_url must start with http:// or https://"})
			return
		}

		n.mu.Lock()
		n.Peers[peer] = time.Now().UTC().Unix()
		_ = n.persistLocked()
		n.mu.Unlock()

		go n.pullFromPeer(peer)
		writeJSON(w, http.StatusOK, map[string]any{"status": "registered", "peer_url": peer})
		return
	}
	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "GET or POST required"})
}

func (n *Node) pullFromPeer(peerURL string) {
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(peerURL + "/sync")
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var remote struct {
		Chain []Block `json:"chain"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&remote); err != nil {
		return
	}
	if !isValidChain(remote.Chain) {
		return
	}

	n.mu.Lock()
	defer n.mu.Unlock()
	if len(remote.Chain) > len(n.Chain) {
		n.Chain = append([]Block{}, remote.Chain...)
		_ = n.persistLocked()
	}
}

func (n *Node) startPeerSyncLoop() {
	ticker := time.NewTicker(45 * time.Second)
	for range ticker.C {
		n.mu.RLock()
		peers := make([]string, 0, len(n.Peers))
		for p := range n.Peers {
			peers = append(peers, p)
		}
		n.mu.RUnlock()

		for _, p := range peers {
			n.pullFromPeer(p)
		}
	}
}

func main() {
	chainFile := os.Getenv("SDM_CHAIN_FILE")
	if chainFile == "" {
		chainFile = DefaultChainFile
	}
	dbUrl := os.Getenv("DATABASE_URL")

	node := NewNode(chainFile, dbUrl)
	go node.startPeerSyncLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if enableCORS(w, r) {
			return
		}
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"node":      "sdm-coin Go Node",
			"symbol":    "SDM",
			"status":    "online",
			"endpoints": []string{"/status", "/wallet/new", "/balance", "/transfer", "/mine", "/chain", "/sync", "/peers"},
		})
	})
	mux.HandleFunc("/status", node.handleStatus)
	mux.HandleFunc("/wallet/new", node.handleWalletNew)
	mux.HandleFunc("/balance", node.handleBalance)
	mux.HandleFunc("/transfer", node.handleTransfer)
	mux.HandleFunc("/mine", node.handleMine)
	mux.HandleFunc("/chain", node.handleChain)
	mux.HandleFunc("/sync", node.handleSync)
	mux.HandleFunc("/peers", node.handlePeers)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	addr := ":" + port
	log.Printf("SDM Go Node listening on %s (chain file: %s, db enabled: %v)", addr, chainFile, dbUrl != "")

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
