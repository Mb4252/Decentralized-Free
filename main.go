package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	MaxSupply            int64         = 50_000_000
	MiningCap            int64         = 50_000_000
	BlockReward          int64         = 50
	BaseDifficulty                     = 4
	MaxDifficulty                      = 8
	TargetBlockSecs      int64         = 30
	ActiveUserWindow                   = 5 * time.Minute
	UsersPerDiffStep                   = 5
	MaxDriftSeconds      int64         = 300
	MaxMineIterations    int64         = 25_000_000
	MaxMempoolSize                     = 2000
	MaxBodyBytes         int64         = 2 * 1024 * 1024
	RateLimitWindow                    = time.Minute
	MaxRequestsPerMin                  = 180
	MaxWriteRequestsPerM               = 45
	DefaultChainFile                   = "sdm_chain.json"
	FeeVaultAddress                    = "SDM45e41bcbe77ee00f43b9b8db62722871"
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

type mineJob struct {
	miner  string
	userID string
	result chan mineJobResult
}

type mineJobResult struct {
	status      string
	block       Block
	reward      int64
	difficulty  int
	activeUsers int
	height      int
	err         error
	code        int
}

type rateEntry struct {
	count     int
	windowEnd time.Time
}

type RateLimiter struct {
	mu      sync.Mutex
	entries map[string]rateEntry
	limit   int
}

func NewRateLimiter(limit int) *RateLimiter {
	if limit <= 0 {
		limit = MaxRequestsPerMin
	}
	return &RateLimiter{
		entries: make(map[string]rateEntry),
		limit:   limit,
	}
}

func (rl *RateLimiter) Allow(key string) bool {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if len(rl.entries) > 8192 {
		for k, v := range rl.entries {
			if now.After(v.windowEnd) {
				delete(rl.entries, k)
			}
		}
	}

	cur, ok := rl.entries[key]
	if !ok || now.After(cur.windowEnd) {
		rl.entries[key] = rateEntry{
			count:     1,
			windowEnd: now.Add(RateLimitWindow),
		}
		return true
	}
	if cur.count >= rl.limit {
		return false
	}
	cur.count++
	rl.entries[key] = cur
	return true
}

type Node struct {
	mu            sync.RWMutex
	Chain         []Block          `json:"chain"`
	Mempool       []Transaction    `json:"mempool"`
	ActiveUsers   map[string]int64 `json:"active_users"`
	Peers         map[string]int64 `json:"peers"`
	ChainFile     string           `json:"-"`
	DBUrl         string           `json:"-"`
	AllowedOrigin string           `json:"-"`
	pool          *pgxpool.Pool
	limiter       *RateLimiter
	writeLimiter  *RateLimiter
	mineQueue     chan mineJob

	// ذاكرة تخزين مؤقت للحالة لتجنب مسح كامل السلسلة في كل طلب
	cacheDirty   bool
	cachedHeight int
	cachedBal    map[string]int64
	cachedNonces map[string]uint64
}

func canonicalAddress(addr string) string {
	return strings.ToLower(strings.TrimSpace(addr))
}

func normalizeTxs(txs []Transaction) []Transaction {
	if len(txs) == 0 {
		return []Transaction{}
	}
	out := make([]Transaction, len(txs))
	copy(out, txs)
	return out
}

func computeTransferFee(amount int64) int64 {
	if amount <= 0 {
		return 0
	}
	fee := amount / 100
	if fee < 1 {
		fee = 1
	}
	return fee
}

func deriveAddressFromPubBytes(pubBytes []byte) string {
	pubSum := sha256.Sum256(pubBytes)
	addrHash := sha256.Sum256(pubSum[:])
	return "SDM" + hex.EncodeToString(addrHash[:16])
}

func txSigningDigest(tx Transaction) []byte {
	fee := computeTransferFee(tx.Amount)
	payload := fmt.Sprintf("%s|%s|%d|%d|%d|%d|%s",
		tx.From, tx.To, tx.Amount, fee, tx.Nonce, tx.Timestamp, tx.Note)
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
	txBytes, _ := json.Marshal(normalizeTxs(b.Transactions))
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

func cumulativeDifficulty(chain []Block) *big.Int {
	total := new(big.Int)
	for _, b := range chain {
		diff := b.Difficulty
		if diff < 0 {
			diff = 0
		}
		if diff > 60 {
			diff = 60
		}
		weight := new(big.Int).Lsh(big.NewInt(1), uint(diff))
		total.Add(total, weight)
	}
	return total
}

func computeExpectedBlockDifficulty(prev Block, currentTs int64, activeUsers int) int {
	base := computeDifficulty(activeUsers)
	elapsed := currentTs - prev.Timestamp
	adj := prev.Difficulty
	if adj < BaseDifficulty {
		adj = BaseDifficulty
	}
	if adj > MaxDifficulty {
		adj = MaxDifficulty
	}
	if elapsed > 0 && elapsed < TargetBlockSecs/2 {
		adj++
	} else if elapsed > TargetBlockSecs*2 {
		adj--
	}
	if adj < BaseDifficulty {
		adj = BaseDifficulty
	}
	if adj > MaxDifficulty {
		adj = MaxDifficulty
	}
	if base > adj {
		return base
	}
	return adj
}

func isBlockDifficultyAcceptable(prev Block, b Block) bool {
	if b.Difficulty < BaseDifficulty || b.Difficulty > MaxDifficulty {
		return false
	}
	minAllowed := prev.Difficulty - 1
	if minAllowed < BaseDifficulty {
		minAllowed = BaseDifficulty
	}
	maxAllowed := prev.Difficulty + 1
	if maxAllowed > MaxDifficulty {
		maxAllowed = MaxDifficulty
	}
	return b.Difficulty >= minAllowed && b.Difficulty <= maxAllowed
}

func mineBlockContext(ctx context.Context, index int, txs []Transaction, prevHash string, difficulty int, miner string) (Block, error) {
	normTxs := normalizeTxs(txs)
	var nonce int64 = 0
	for {
		if nonce%50_000 == 0 {
			select {
			case <-ctx.Done():
				return Block{}, ctx.Err()
			default:
			}
			if nonce > MaxMineIterations {
				return Block{}, errors.New("mining iteration limit reached for current difficulty")
			}
		}
		ts := time.Now().UTC().Unix()
		candidate := Block{
			Index:        index,
			Timestamp:    ts,
			Transactions: normTxs,
			PrevHash:     prevHash,
			Nonce:        nonce,
			Difficulty:   difficulty,
			Miner:        miner,
		}
		h := calculateBlockHash(candidate)
		if hasValidProof(h, difficulty) {
			candidate.Hash = h
			return candidate, nil
		}
		nonce++
	}
}

func newGenesisBlock() Block {
	b := Block{
		Index:        0,
		Timestamp:    1735689600,
		Transactions: []Transaction{},
		PrevHash:     strings.Repeat("0", 64),
		Nonce:        0,
		Difficulty:   BaseDifficulty,
		Miner:        FeeVaultAddress,
	}
	b.Hash = calculateBlockHash(b)
	return b
}

func NewNode(chainFile string, dbUrl string, allowedOrigin string) *Node {
	n := &Node{
		ActiveUsers:   make(map[string]int64),
		Peers:         make(map[string]int64),
		ChainFile:     chainFile,
		DBUrl:         strings.TrimSpace(dbUrl),
		AllowedOrigin: strings.TrimSpace(allowedOrigin),
		limiter:       NewRateLimiter(MaxRequestsPerMin),
		writeLimiter:  NewRateLimiter(MaxWriteRequestsPerM),
		mineQueue:     make(chan mineJob, 64),
		cacheDirty:    true,
		cachedBal:     make(map[string]int64),
		cachedNonces:  make(map[string]uint64),
	}

	if n.DBUrl != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		pool, err := pgxpool.New(ctx, n.DBUrl)
		if err != nil {
			log.Printf("db pool connect warning: %v", err)
		} else if pingErr := pool.Ping(ctx); pingErr != nil {
			log.Printf("db pool ping warning: %v", pingErr)
			pool.Close()
		} else {
			n.pool = pool
			if tblErr := n.ensureDBSchema(ctx); tblErr != nil {
				log.Printf("db schema init warning: %v", tblErr)
			} else if loadErr := n.loadFromDB(ctx); loadErr == nil {
				n.rebuildStateCacheLocked()
				cancel()
				return n
			}
		}
		cancel()
	}

	if err := n.loadFromFile(); err == nil {
		n.rebuildStateCacheLocked()
		if n.pool != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			if err := n.saveToDB(ctx); err != nil {
				log.Printf("db initial sync warning: %v", err)
			}
			cancel()
		}
		return n
	}

	n.Chain = []Block{newGenesisBlock()}
	n.Mempool = []Transaction{}
	n.rebuildStateCacheLocked()
	_ = n.persistLocked()
	return n
}

func (n *Node) rebuildStateCacheLocked() {
	balances := make(map[string]int64)
	nonces := make(map[string]uint64)
	vaultKey := canonicalAddress(FeeVaultAddress)

	for _, b := range n.Chain {
		for _, tx := range b.Transactions {
			toKey := canonicalAddress(tx.To)
			fromKey := canonicalAddress(tx.From)
			if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				balances[toKey] += tx.Amount
			} else if tx.From != "GENESIS" {
				fee := computeTransferFee(tx.Amount)
				balances[fromKey] -= (tx.Amount + fee)
				nonces[fromKey] = tx.Nonce + 1
				balances[toKey] += tx.Amount
				balances[vaultKey] += fee
			} else {
				balances[toKey] += tx.Amount
			}
		}
	}

	n.cachedBal = balances
	n.cachedNonces = nonces
	n.cachedHeight = len(n.Chain) - 1
	n.cacheDirty = false
}

func (n *Node) getCachedStatesLocked() (map[string]int64, map[string]uint64) {
	if n.cacheDirty || n.cachedHeight != len(n.Chain)-1 {
		n.rebuildStateCacheLocked()
	}
	balCopy := make(map[string]int64, len(n.cachedBal))
	for k, v := range n.cachedBal {
		balCopy[k] = v
	}
	nonceCopy := make(map[string]uint64, len(n.cachedNonces))
	for k, v := range n.cachedNonces {
		nonceCopy[k] = v
	}
	return balCopy, nonceCopy
}

func (n *Node) ensureDBSchema(ctx context.Context) error {
	if n.pool == nil {
		return errors.New("db pool not initialized")
	}
	_, err := n.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS sdm_node_state (
			id INT PRIMARY KEY,
			state_json TEXT NOT NULL,
			updated_at BIGINT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS sdm_blocks (
			block_index INT PRIMARY KEY,
			block_hash TEXT NOT NULL,
			prev_hash TEXT NOT NULL,
			difficulty INT NOT NULL,
			block_timestamp BIGINT NOT NULL,
			block_json TEXT NOT NULL
		);
	`)
	return err
}

func (n *Node) loadFromDB(ctx context.Context) error {
	if n.pool == nil {
		return errors.New("db pool not initialized")
	}
	var raw string
	err := n.pool.QueryRow(ctx, `SELECT state_json FROM sdm_node_state WHERE id = 1`).Scan(&raw)
	if err != nil {
		return err
	}
	return n.applyPersistedJSON([]byte(raw))
}

func (n *Node) saveToDB(ctx context.Context) error {
	if n.pool == nil {
		return nil
	}
	snap := PersistedState{
		Chain:       append([]Block{}, n.Chain...),
		Mempool:     normalizeTxs(n.Mempool),
		ActiveUsers: cloneInt64Map(n.ActiveUsers),
		Peers:       cloneInt64Map(n.Peers),
	}
	payload, err := json.Marshal(snap)
	if err != nil {
		return err
	}
	_, err = n.pool.Exec(ctx, `
		INSERT INTO sdm_node_state (id, state_json, updated_at)
		VALUES (1, $1, $2)
		ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = EXCLUDED.updated_at
	`, string(payload), time.Now().UTC().Unix())
	if err != nil {
		return err
	}

	if len(snap.Chain) > 0 {
		b := snap.Chain[len(snap.Chain)-1]
		bJSON, bErr := json.Marshal(b)
		if bErr != nil {
			return bErr
		}
		_, bExecErr := n.pool.Exec(ctx, `
			INSERT INTO sdm_blocks (block_index, block_hash, prev_hash, difficulty, block_timestamp, block_json)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (block_index) DO UPDATE SET
				block_hash = EXCLUDED.block_hash,
				prev_hash = EXCLUDED.prev_hash,
				difficulty = EXCLUDED.difficulty,
				block_timestamp = EXCLUDED.block_timestamp,
				block_json = EXCLUDED.block_json
		`, b.Index, b.Hash, b.PrevHash, b.Difficulty, b.Timestamp, string(bJSON))
		if bExecErr != nil {
			return bExecErr
		}
	}
	return nil
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
	n.Mempool = normalizeTxs(loaded.Mempool)
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
	n.cacheDirty = true
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
		Mempool:     normalizeTxs(n.Mempool),
		ActiveUsers: n.ActiveUsers,
		Peers:       n.Peers,
	}
	payload, err := json.MarshalIndent(snap, "", "  ")
	if err == nil {
		_ = os.WriteFile(n.ChainFile, payload, 0600)
	}
	if n.pool != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if tblErr := n.ensureDBSchema(ctx); tblErr != nil {
			log.Printf("db ensure schema error: %v", tblErr)
			return tblErr
		}
		if saveErr := n.saveToDB(ctx); saveErr != nil {
			log.Printf("db write error: %v", saveErr)
			return saveErr
		}
	}
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
	for _, b := range chain {
		for _, tx := range b.Transactions {
			if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				minedSupply += tx.Amount
				totalSupply += tx.Amount
			}
		}
	}
	return totalSupply, minedSupply
}

func txKey(tx Transaction) string {
	return fmt.Sprintf("%s|%s|%d|%d|%d|%s",
		canonicalAddress(tx.From),
		canonicalAddress(tx.To),
		tx.Amount,
		tx.Nonce,
		tx.Timestamp,
		tx.Signature,
	)
}

func (n *Node) pruneMempoolAgainstChainLocked(candidates []Transaction) []Transaction {
	if len(candidates) == 0 {
		return []Transaction{}
	}
	balances, nonces := n.getCachedStatesLocked()
	vaultKey := canonicalAddress(FeeVaultAddress)

	sorted := make([]Transaction, len(candidates))
	copy(sorted, candidates)
	sort.Slice(sorted, func(i, j int) bool {
		fi := canonicalAddress(sorted[i].From)
		fj := canonicalAddress(sorted[j].From)
		if fi != fj {
			return fi < fj
		}
		if sorted[i].Nonce != sorted[j].Nonce {
			return sorted[i].Nonce < sorted[j].Nonce
		}
		return sorted[i].Timestamp < sorted[j].Timestamp
	})

	valid := make([]Transaction, 0, len(sorted))
	seen := make(map[string]bool)

	for _, tx := range sorted {
		if len(valid) >= MaxMempoolSize {
			break
		}
		if tx.Amount <= 0 || !verifyTransactionSignature(tx) {
			continue
		}
		fromKey := canonicalAddress(tx.From)
		toKey := canonicalAddress(tx.To)
		if fromKey == "" || toKey == "" || fromKey == toKey {
			continue
		}
		key := txKey(tx)
		if seen[key] {
			continue
		}
		expectedNonce := nonces[fromKey]
		if tx.Nonce != expectedNonce {
			continue
		}
		fee := computeTransferFee(tx.Amount)
		totalCost := tx.Amount + fee
		if balances[fromKey] < totalCost {
			continue
		}
		balances[fromKey] -= totalCost
		balances[toKey] += tx.Amount
		balances[vaultKey] += fee
		nonces[fromKey] = expectedNonce + 1
		seen[key] = true
		valid = append(valid, tx)
	}
	return valid
}

func isValidChain(chain []Block) bool {
	if len(chain) == 0 {
		return false
	}
	now := time.Now().UTC().Unix()
	var totalSupply int64
	var minedSupply int64
	balances := make(map[string]int64)
	expectedNonce := make(map[string]uint64)
	vaultKey := canonicalAddress(FeeVaultAddress)

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
			if b.Difficulty < BaseDifficulty || b.Difficulty > MaxDifficulty {
				return false
			}
		} else {
			prev := chain[i-1]
			if b.PrevHash != prev.Hash {
				return false
			}
			if b.Timestamp < prev.Timestamp || b.Timestamp > now+MaxDriftSeconds {
				return false
			}
			if !isBlockDifficultyAcceptable(prev, b) {
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
			fromKey := canonicalAddress(tx.From)
			toKey := canonicalAddress(tx.To)
			if tx.From == "COINBASE" || tx.From == "MINING_REWARD" {
				coinbaseCount++
				if coinbaseCount > 1 || tx.Nonce != 0 || tx.Amount > BlockReward {
					return false
				}
				if strings.TrimSpace(b.Miner) == "" || toKey != canonicalAddress(b.Miner) {
					return false
				}
				if minedSupply+tx.Amount > MiningCap || totalSupply+tx.Amount > MaxSupply {
					return false
				}
				minedSupply += tx.Amount
				totalSupply += tx.Amount
				balances[toKey] += tx.Amount
			} else if tx.From == "GENESIS" {
				if totalSupply+tx.Amount > MaxSupply {
					return false
				}
				totalSupply += tx.Amount
				balances[toKey] += tx.Amount
			} else {
				fee := computeTransferFee(tx.Amount)
				totalCost := tx.Amount + fee
				exp := expectedNonce[fromKey]
				if tx.Nonce != exp {
					return false
				}
				if balances[fromKey] < totalCost {
					return false
				}
				balances[fromKey] -= totalCost
				balances[toKey] += tx.Amount
				balances[vaultKey] += fee
				expectedNonce[fromKey] = exp + 1
			}
		}
	}

	if minedSupply > MiningCap || totalSupply > MaxSupply {
		return false
	}
	return true
}

func clientIP(r *http.Request) string {
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		first := strings.TrimSpace(parts[0])
		if net.ParseIP(first) != nil {
			return first
		}
	}
	if xrip := strings.TrimSpace(r.Header.Get("X-Real-IP")); xrip != "" && net.ParseIP(xrip) != nil {
		return xrip
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func validatePeerURL(raw string) (string, error) {
	clean := strings.TrimSpace(strings.TrimRight(raw, "/"))
	u, err := url.Parse(clean)
	if err != nil {
		return "", errors.New("invalid peer URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("peer_url must use http or https")
	}
	host := strings.ToLower(u.Hostname())
	if host == "" || host == "localhost" || host == "0.0.0.0" {
		return "", errors.New("disallowed peer host")
	}
	if ip := net.ParseIP(host); ip != nil {
		if ip.IsLoopback() || ip.IsPrivate() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
			return "", errors.New("disallowed private or loopback IP")
		}
	}
	return u.String(), nil
}

func (n *Node) checkCommonHeadersAndLimit(w http.ResponseWriter, r *http.Request, requireWriteLimit bool) bool {
	if n.AllowedOrigin != "" {
		w.Header().Set("Access-Control-Allow-Origin", n.AllowedOrigin)
		w.Header().Set("Vary", "Origin")
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Id")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	if r.Body != nil {
		r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
	}
	ip := clientIP(r)
	if n.limiter != nil && !n.limiter.Allow(ip) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "rate limit exceeded"})
		return true
	}
	if requireWriteLimit && r.Method == http.MethodPost && n.writeLimiter != nil && !n.writeLimiter.Allow("write:"+ip) {
		writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "write rate limit exceeded"})
		return true
	}
	return false
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (n *Node) handleTxDigest(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, false) {
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON body"})
		return
	}
	ts := req.Timestamp
	if ts == 0 {
		ts = time.Now().UTC().Unix()
	}
	tx := Transaction{
		From:      strings.TrimSpace(req.From),
		To:        strings.TrimSpace(req.To),
		Amount:    req.Amount,
		Nonce:     req.Nonce,
		Timestamp: ts,
		Note:      req.Note,
	}
	digest := txSigningDigest(tx)
	writeJSON(w, http.StatusOK, map[string]any{
		"digest_hex": hex.EncodeToString(digest),
		"fee":        computeTransferFee(tx.Amount),
		"timestamp":  ts,
	})
}

func (n *Node) handleStatus(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, false) {
		return
	}
	userID := r.URL.Query().Get("user")
	if userID == "" {
		userID = r.Header.Get("X-User-Id")
	}

	n.mu.Lock()
	activeUsers := n.touchUserLocked(userID)
	height := len(n.Chain) - 1
	latest := n.Chain[height]
	diff := computeExpectedBlockDifficulty(latest, time.Now().UTC().Unix(), activeUsers)
	totalSupply, minedSupply := computeSupplyStatsLocked(n.Chain)
	remainingMining := MiningCap - minedSupply
	if remainingMining < 0 {
		remainingMining = 0
	}
	mempoolCount := len(n.Mempool)
	peerCount := len(n.Peers)
	n.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":               "SDM",
		"name":                 "sdm.coin",
		"max_supply":           MaxSupply,
		"mining_cap":           MiningCap,
		"total_supply":         totalSupply,
		"mined_supply":         minedSupply,
		"remaining_mining_cap": remainingMining,
		"block_reward":         BlockReward,
		"fee_recipient":        FeeVaultAddress,
		"height":               height,
		"blocks_count":         len(n.Chain),
		"difficulty":           diff,
		"base_difficulty":      BaseDifficulty,
		"max_difficulty":       MaxDifficulty,
		"users_per_diff_step":  UsersPerDiffStep,
		"active_users":         activeUsers,
		"mempool_count":        mempoolCount,
		"peers_count":          peerCount,
		"latest_hash":          latest.Hash,
	})
}

func (n *Node) handleBalance(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, false) {
		return
	}
	addr := strings.TrimSpace(r.URL.Query().Get("address"))
	if addr == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "address query parameter is required"})
		return
	}
	addrKey := canonicalAddress(addr)

	n.mu.Lock()
	balances, nonces := n.getCachedStatesLocked()
	var pendingNonce uint64
	for _, m := range n.Mempool {
		if canonicalAddress(m.From) == addrKey && m.Nonce >= pendingNonce {
			pendingNonce = m.Nonce + 1
		}
	}
	nextNonce := nonces[addrKey]
	if pendingNonce > nextNonce {
		nextNonce = pendingNonce
	}
	bal := balances[addrKey]
	confirmedNonce := nonces[addrKey]
	n.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"address":    addr,
		"balance":    bal,
		"nonce":      confirmedNonce,
		"next_nonce": nextNonce,
	})
}

func (n *Node) handleTransfer(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, true) {
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
	fromKey := canonicalAddress(req.From)
	toKey := canonicalAddress(req.To)
	if fromKey == toKey {
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

	fee := computeTransferFee(tx.Amount)
	totalCost := tx.Amount + fee

	n.mu.Lock()
	defer n.mu.Unlock()

	if len(n.Mempool) >= MaxMempoolSize {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mempool is full, please try again later"})
		return
	}

	n.touchUserLocked(req.UserID)
	balances, nonces := n.getCachedStatesLocked()

	expectedNonce := nonces[fromKey]
	var pendingOutgoing int64
	for _, m := range n.Mempool {
		if canonicalAddress(m.From) == fromKey {
			if txKey(m) == txKey(tx) {
				writeJSON(w, http.StatusConflict, map[string]any{"error": "duplicate transaction already in mempool"})
				return
			}
			pendingOutgoing += m.Amount + computeTransferFee(m.Amount)
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

	available := balances[fromKey] - pendingOutgoing
	if available < totalCost {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error":     "insufficient balance",
			"available": available,
			"required":  totalCost,
			"fee":       fee,
		})
		return
	}

	n.Mempool = append(n.Mempool, tx)
	if err := n.persistLocked(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist transaction"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "queued",
		"transaction": tx,
		"fee":         fee,
		"total_cost":  totalCost,
		"next_nonce":  expectedNonce + 1,
	})
}

func (n *Node) executeMineJob(parentCtx context.Context, miner string, userID string) mineJobResult {
	n.mu.Lock()
	activeUsers := n.touchUserLocked(userID)
	prev := n.Chain[len(n.Chain)-1]
	diff := computeExpectedBlockDifficulty(prev, time.Now().UTC().Unix(), activeUsers)
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

	batchTxs := n.pruneMempoolAgainstChainLocked(n.Mempool)
	txs := make([]Transaction, 0, len(batchTxs)+1)
	if reward > 0 {
		txs = append(txs, Transaction{
			From:      "COINBASE",
			To:        miner,
			Amount:    reward,
			Nonce:     0,
			Timestamp: time.Now().UTC().Unix(),
			Note:      "PoW Block Reward & Network Security",
		})
	}
	txs = append(txs, batchTxs...)

	nextIndex := prev.Index + 1
	prevHash := prev.Hash
	n.mu.Unlock()

	mineCtx, cancel := context.WithTimeout(parentCtx, 25*time.Second)
	defer cancel()

	mined, err := mineBlockContext(mineCtx, nextIndex, txs, prevHash, diff, miner)
	if err != nil {
		return mineJobResult{err: err, code: http.StatusRequestTimeout}
	}

	n.mu.Lock()
	defer n.mu.Unlock()

	latest := n.Chain[len(n.Chain)-1]
	if latest.Hash != prevHash || latest.Index+1 != mined.Index {
		return mineJobResult{err: errors.New("chain tip changed while mining, please retry"), code: http.StatusConflict}
	}

	candidateChain := append(append([]Block{}, n.Chain...), mined)
	if !isValidChain(candidateChain) {
		return mineJobResult{err: errors.New("mined block violated supply or chain rules"), code: http.StatusBadRequest}
	}

	includedKeys := make(map[string]bool, len(batchTxs))
	for _, btx := range batchTxs {
		includedKeys[txKey(btx)] = true
	}
	remainingPool := make([]Transaction, 0, len(n.Mempool))
	for _, mtx := range n.Mempool {
		if !includedKeys[txKey(mtx)] {
			remainingPool = append(remainingPool, mtx)
		}
	}

	n.Chain = candidateChain
	n.cacheDirty = true
	n.rebuildStateCacheLocked()
	n.Mempool = n.pruneMempoolAgainstChainLocked(remainingPool)
	if err := n.persistLocked(); err != nil {
		return mineJobResult{err: errors.New("failed to persist mined block"), code: http.StatusInternalServerError}
	}

	return mineJobResult{
		status:      "mined",
		block:       mined,
		reward:      reward,
		difficulty:  diff,
		activeUsers: activeUsers,
		height:      len(n.Chain) - 1,
	}
}

func (n *Node) startMiningWorker() {
	for job := range n.mineQueue {
		res := n.executeMineJob(context.Background(), job.miner, job.userID)
		if job.result != nil {
			job.result <- res
			close(job.result)
		}
	}
}

func (n *Node) handleMine(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, true) {
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
		miner = FeeVaultAddress
	}
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		userID = miner
	}

	resCh := make(chan mineJobResult, 1)
	job := mineJob{miner: miner, userID: userID, result: resCh}
	select {
	case n.mineQueue <- job:
	default:
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "mining queue is busy, try again shortly"})
		return
	}

	select {
	case res := <-resCh:
		if res.err != nil {
			writeJSON(w, res.code, map[string]any{"error": res.err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       res.status,
			"block":        res.block,
			"reward":       res.reward,
			"difficulty":   res.difficulty,
			"active_users": res.activeUsers,
			"height":       res.height,
		})
	case <-r.Context().Done():
		writeJSON(w, http.StatusRequestTimeout, map[string]any{"error": "client disconnected while mining"})
	}
}

func parseSinceHeight(raw string) int {
	clean := strings.TrimSpace(raw)
	if clean == "" {
		return -1
	}
	v, err := strconv.Atoi(clean)
	if err != nil || v < -1 {
		return -1
	}
	return v
}

func (n *Node) handleChain(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, false) {
		return
	}
	since := parseSinceHeight(r.URL.Query().Get("since"))

	n.mu.RLock()
	height := len(n.Chain) - 1
	latest := n.Chain[height]
	totalSupply, minedSupply := computeSupplyStatsLocked(n.Chain)
	activeUsers := n.pruneAndCountActiveUsersLocked(time.Now().UTC().Unix())
	diff := computeExpectedBlockDifficulty(latest, time.Now().UTC().Unix(), activeUsers)

	var sliceBlocks []Block
	if since >= 0 {
		startIdx := since + 1
		if startIdx < 0 {
			startIdx = 0
		}
		if startIdx < len(n.Chain) {
			sliceBlocks = append([]Block{}, n.Chain[startIdx:]...)
		} else {
			sliceBlocks = []Block{}
		}
	} else {
		sliceBlocks = append([]Block{}, n.Chain...)
	}
	n.mu.RUnlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"symbol":       "SDM",
		"height":       height,
		"since":        since,
		"difficulty":   diff,
		"active_users": activeUsers,
		"total_supply": totalSupply,
		"mined_supply": minedSupply,
		"mining_cap":   MiningCap,
		"chain":        sliceBlocks,
	})
}

func (n *Node) handleSync(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, true) {
		return
	}
	if r.Method == http.MethodGet {
		since := parseSinceHeight(r.URL.Query().Get("since"))
		summaryOnly := r.URL.Query().Get("summary") == "1"

		n.mu.RLock()
		height := len(n.Chain) - 1
		latest := n.Chain[height]
		mempoolCount := len(n.Mempool)
		activeUsers := n.pruneAndCountActiveUsersLocked(time.Now().UTC().Unix())
		diff := computeExpectedBlockDifficulty(latest, time.Now().UTC().Unix(), activeUsers)

		var deltaChain []Block
		if !summaryOnly {
			if since >= 0 {
				startIdx := since + 1
				if startIdx < len(n.Chain) {
					deltaChain = append([]Block{}, n.Chain[startIdx:]...)
				} else {
					deltaChain = []Block{}
				}
			} else {
				deltaChain = append([]Block{}, n.Chain...)
			}
		}
		n.mu.RUnlock()

		resp := map[string]any{
			"height":        height,
			"since":         since,
			"difficulty":    diff,
			"active_users":  activeUsers,
			"mempool_count": mempoolCount,
			"latest_hash":   latest.Hash,
		}
		if !summaryOnly {
			resp["chain"] = deltaChain
		}
		writeJSON(w, http.StatusOK, resp)
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
		if cumulativeDifficulty(req.Chain).Cmp(cumulativeDifficulty(n.Chain)) > 0 {
			n.Chain = append([]Block{}, req.Chain...)
			n.cacheDirty = true
			n.rebuildStateCacheLocked()
			n.Mempool = n.pruneMempoolAgainstChainLocked(n.Mempool)
			adopted = true
			if err := n.persistLocked(); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist synced chain"})
				return
			}
		}

		latest := n.Chain[len(n.Chain)-1]
		writeJSON(w, http.StatusOK, map[string]any{
			"adopted":      adopted,
			"height":       len(n.Chain) - 1,
			"difficulty":   computeExpectedBlockDifficulty(latest, time.Now().UTC().Unix(), activeUsers),
			"active_users": activeUsers,
			"chain":        n.Chain,
		})
		return
	}

	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "GET or POST required"})
}

func (n *Node) handlePeers(w http.ResponseWriter, r *http.Request) {
	if n.checkCommonHeadersAndLimit(w, r, true) {
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
		peer, err := validatePeerURL(req.PeerURL)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
			return
		}

		n.mu.Lock()
		n.Peers[peer] = time.Now().UTC().Unix()
		err = n.persistLocked()
		n.mu.Unlock()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to persist peer"})
			return
		}

		go n.pullFromPeer(peer)
		writeJSON(w, http.StatusOK, map[string]any{"status": "registered", "peer_url": peer})
		return
	}
	writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "GET or POST required"})
}

func (n *Node) pullFromPeer(peerURL string) {
	validURL, err := validatePeerURL(peerURL)
	if err != nil {
		return
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(validURL + "/sync")
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
	if cumulativeDifficulty(remote.Chain).Cmp(cumulativeDifficulty(n.Chain)) > 0 {
		n.Chain = append([]Block{}, remote.Chain...)
		n.cacheDirty = true
		n.rebuildStateCacheLocked()
		n.Mempool = n.pruneMempoolAgainstChainLocked(n.Mempool)
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
	allowedOrigin := os.Getenv("ALLOWED_ORIGIN")

	node := NewNode(chainFile, dbUrl, allowedOrigin)
	if node.pool != nil {
		defer node.pool.Close()
	}
	go node.startMiningWorker()
	go node.startPeerSyncLoop()

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if node.checkCommonHeadersAndLimit(w, r, false) {
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
			"endpoints": []string{"/status", "/balance", "/tx/digest", "/transfer", "/mine", "/chain", "/sync", "/peers"},
		})
	})
	mux.HandleFunc("/status", node.handleStatus)
	mux.HandleFunc("/balance", node.handleBalance)
	mux.HandleFunc("/tx/digest", node.handleTxDigest)
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
	log.Printf("SDM Go Node listening on %s (chain file: %s, db enabled: %v)", addr, chainFile, node.pool != nil)

	srv := &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      35 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
