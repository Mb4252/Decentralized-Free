package main

import (
	"bytes"
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
)

const (
	MaxSupply           int64 = 50_000_000
	GenesisSupply       int64 = 40_000_000
	MiningCap           int64 = 10_000_000
	BlockReward         int64 = 50
	BaseDifficulty            = 4
	MaxDifficulty             = 8
	ActiveUserWindow          = 5 * time.Minute
	UsersPerDiffStep          = 5
	DefaultChainFile          = "sdm_chain.json"
	GenesisAddress            = "SDM_GENESIS_VAULT_0001"
)

type Transaction struct {
	From      string `json:"from"`
	To        string `json:"to"`
	Amount    int64  `json:"amount"`
	Timestamp int64  `json:"timestamp"`
	Note      string `json:"note,omitempty"`
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

type Node struct {
	mu          sync.RWMutex
	Chain       []Block            `json:"chain"`
	Mempool     []Transaction      `json:"mempool"`
	ActiveUsers map[string]int64   `json:"active_users"`
	Peers       map[string]int64   `json:"peers"`
	ChainFile   string             `json:"-"`
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

func NewNode(chainFile string) *Node {
	n := &Node{
		ActiveUsers: make(map[string]int64),
		Peers:       make(map[string]int64),
		ChainFile:   chainFile,
	}
	if err := n.loadFromFile(); err != nil {
		n.Chain = []Block{newGenesisBlock()}
		_ = n.saveToFile()
	}
	if len(n.Chain) == 0 {
		n.Chain = []Block{newGenesisBlock()}
		_ = n.saveToFile()
	}
	return n
}

func (n *Node) loadFromFile() error {
	data, err := os.ReadFile(n.ChainFile)
	if err != nil {
		return err
	}
	var loaded struct {
		Chain       []Block          `json:"chain"`
		Mempool     []Transaction    `json:"mempool"`
		ActiveUsers map[string]int64 `json:"active_users"`
		Peers       map[string]int64 `json:"peers"`
	}
	if err := json.Unmarshal(data, &loaded); err != nil {
		return err
	}
	if len(loaded.Chain) == 0 {
		return errors.New("empty chain")
	}
	if !isValidChain(loaded.Chain) {
		return errors.New("invalid chain in file")
	}
	n.Chain = loaded.Chain
	if loaded.Mempool != nil {
		n.Mempool = loaded.Mempool
	}
	if loaded.ActiveUsers != nil {
		n.ActiveUsers = loaded.ActiveUsers
	}
	if loaded.Peers != nil {
		n.Peers = loaded.Peers
	}
	return nil
}

func (n *Node) saveToFile() error {
	payload, err := json.MarshalIndent(n, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(n.ChainFile, payload, 0600)
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

func computeBalancesLocked(chain []Block) map[string]int64 {
	balances := make(map[string]int64)
	for _, b := range chain {
		for _, tx := range b.Transactions {
			if tx.From != "GENESIS" && tx.From != "COINBASE" && tx.From != "MINING_REWARD" {
				balances[tx.From] -= tx.Amount
			}
			balances[tx.To] += tx.Amount
		}
	}
	return balances
}

func isValidChain(chain []Block) bool {
	if len(chain) == 0 {
		return false
	}
	var totalSupply int64
	var minedSupply int64

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
			if !hasValidProof(b.Hash, b.Difficulty) {
				return false
			}
		}
		for _, tx := range b.Transactions {
			if tx.Amount < 0 {
				return false
			}
			if i == 0 || tx.From == "GENESIS" {
				totalSupply += tx.Amount
			} else if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				minedSupply += tx.Amount
				totalSupply += tx.Amount
			}
		}
	}

	if minedSupply > MiningCap || totalSupply > MaxSupply {
		return false
	}
	return true
}

func generateWallet() (address string, publicKeyHex string, privateKeyHex string, err error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", "", err
	}
	pubBytes := elliptic.MarshalCompressed(priv.Curve, priv.PublicKey.X, priv.PublicKey.Y)
	pubSum := sha256.Sum256(pubBytes)
	addrHash := sha256.Sum256(pubSum[:])
	address = "SDM" + hex.EncodeToString(addrHash[:16])

	privDer, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return "", "", "", err
	}
	return address, hex.EncodeToString(pubBytes), hex.EncodeToString(privDer), nil
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
	_ = n.saveToFile()
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
	addr, pub, priv, err := generateWallet()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"address":     addr,
		"public_key":  pub,
		"private_key": priv,
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
	balances := computeBalancesLocked(n.Chain)
	n.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"address": addr,
		"balance": balances[addr],
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
		From   string `json:"from"`
		To     string `json:"to"`
		Amount int64  `json:"amount"`
		Note   string `json:"note"`
		UserID string `json:"user_id"`
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

	n.mu.Lock()
	defer n.mu.Unlock()

	n.touchUserLocked(req.UserID)
	balances := computeBalancesLocked(n.Chain)

	var pendingOutgoing int64
	for _, tx := range n.Mempool {
		if tx.From == req.From {
			pendingOutgoing += tx.Amount
		}
	}
	available := balances[req.From] - pendingOutgoing
	if available < req.Amount {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":     "insufficient balance",
			"available": available,
		})
		return
	}

	tx := Transaction{
		From:      req.From,
		To:        req.To,
		Amount:    req.Amount,
		Timestamp: time.Now().UTC().Unix(),
		Note:      req.Note,
	}
	n.Mempool = append(n.Mempool, tx)
	_ = n.saveToFile()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "queued",
		"transaction": tx,
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
	_ = n.saveToFile()

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
			_ = n.saveToFile()
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
		_ = n.saveToFile()
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
		_ = n.saveToFile()
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

	node := NewNode(chainFile)
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
			"node":    "sdm-coin Go Node",
			"symbol":  "SDM",
			"status":  "online",
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
	log.Printf("SDM Go Node listening on %s (chain file: %s)", addr, chainFile)

	var _ = bytes.NewReader
	var _ = big.NewInt

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
