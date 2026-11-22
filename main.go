package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	CoinName       = "sdm.coin"
	CoinSymbol     = "SDM"
	BaseUnit       = int64(100_000_000) // 1 SDM = 10^8 usdm
	MaxSupplySDM   = int64(50_000_000)  // الحد الأقصى الثابت: 50 مليون SDM
	MiningCapSDM   = int64(10_000_000)  // حد التعدين: 10 مليون SDM فقط
	GenesisSDM     = MaxSupplySDM - MiningCapSDM // 40 مليون SDM في البداية
	BlockRewardSDM = int64(25)          // مكافأة كل كتلة معدّنة (25 SDM)

	// صعوبة التعدين: 5 أصفار تعطي وقت تعدين واضحاً، ويمكن زيادتها إلى 6 لجعل التعدين أبطأ
	InitialDifficulty = 5
	TargetBlockTime   = 45 * time.Second
	ChainFilePath     = "sdm_chain.json"
)

type Wallet struct {
	Address    string `json:"address"`
	PublicKey  string `json:"public_key"`
	PrivateKey string `json:"private_key"`
}

type Transaction struct {
	ID        string `json:"id"`
	From      string `json:"from"` // "MINING_REWARD" للكتل المعدّنة أو عنوان محفظة
	To        string `json:"to"`
	Amount    int64  `json:"amount"` // بوحدة usdm
	Timestamp int64  `json:"timestamp"`
	PublicKey string `json:"public_key,omitempty"`
	Signature string `json:"signature,omitempty"`
}

type Block struct {
	Index        int           `json:"index"`
	Timestamp    int64         `json:"timestamp"`
	Transactions []Transaction `json:"transactions"`
	PrevHash     string        `json:"prev_hash"`
	Hash         string        `json:"hash"`
	Nonce        uint64        `json:"nonce"`
	Difficulty   int           `json:"difficulty"`
	Miner        string        `json:"miner"`
}

type PersistedState struct {
	Chain        []Block          `json:"chain"`
	Balances     map[string]int64 `json:"balances"`
	MinedSupply  int64            `json:"mined_supply"`
	Difficulty   int              `json:"difficulty"`
	Peers        []string         `json:"peers"`
	GenesisVault string           `json:"genesis_vault"`
}

type Blockchain struct {
	mu           sync.RWMutex
	Chain        []Block          `json:"chain"`
	PendingTxs   []Transaction    `json:"pending_txs"`
	Balances     map[string]int64 `json:"balances"`
	MinedSupply  int64            `json:"mined_supply"`
	Difficulty   int              `json:"difficulty"`
	Peers        []string         `json:"peers"`
	GenesisVault string           `json:"genesis_vault"`
}

func GenerateWallet() (Wallet, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return Wallet{}, err
	}
	pubHex := hex.EncodeToString(pub)
	privHex := hex.EncodeToString(priv)
	sum := sha256.Sum256(pub)
	addr := "SDM1" + strings.ToUpper(hex.EncodeToString(sum[:])[:32])
	return Wallet{
		Address:    addr,
		PublicKey:  pubHex,
		PrivateKey: privHex,
	}, nil
}

func AddressFromPublicKeyHex(pubHex string) (string, error) {
	pubBytes, err := hex.DecodeString(pubHex)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return "", errors.New("مفتاح عام غير صالح")
	}
	sum := sha256.Sum256(pubBytes)
	return "SDM1" + strings.ToUpper(hex.EncodeToString(sum[:])[:32]), nil
}

func txSigningPayload(tx Transaction) string {
	return fmt.Sprintf("%s|%s|%d|%d|%s", tx.From, tx.To, tx.Amount, tx.Timestamp, tx.PublicKey)
}

func SignTransaction(privHex string, tx *Transaction) error {
	privBytes, err := hex.DecodeString(privHex)
	if err != nil || len(privBytes) != ed25519.PrivateKeySize {
		return errors.New("مفتاح خاص غير صالح")
	}
	pub := ed25519.PrivateKey(privBytes).Public().(ed25519.PublicKey)
	tx.PublicKey = hex.EncodeToString(pub)
	sig := ed25519.Sign(ed25519.PrivateKey(privBytes), []byte(txSigningPayload(*tx)))
	tx.Signature = hex.EncodeToString(sig)
	tx.ID = calculateTxID(*tx)
	return nil
}

func VerifyTransactionSignature(tx Transaction) bool {
	if tx.From == "GENESIS" || tx.From == "MINING_REWARD" {
		return true
	}
	derivedAddr, err := AddressFromPublicKeyHex(tx.PublicKey)
	if err != nil || derivedAddr != tx.From {
		return false
	}
	pubBytes, err := hex.DecodeString(tx.PublicKey)
	if err != nil || len(pubBytes) != ed25519.PublicKeySize {
		return false
	}
	sigBytes, err := hex.DecodeString(tx.Signature)
	if err != nil || len(sigBytes) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pubBytes), []byte(txSigningPayload(tx)), sigBytes)
}

func calculateBlockHash(b Block) string {
	txBytes, _ := json.Marshal(b.Transactions)
	record := fmt.Sprintf("%d|%d|%s|%s|%d|%d|%s",
		b.Index, b.Timestamp, string(txBytes), b.PrevHash, b.Nonce, b.Difficulty, b.Miner)
	sum := sha256.Sum256([]byte(record))
	return hex.EncodeToString(sum[:])
}

func calculateTxID(tx Transaction) string {
	record := fmt.Sprintf("%s|%s|%d|%d|%s", tx.From, tx.To, tx.Amount, tx.Timestamp, tx.Signature)
	sum := sha256.Sum256([]byte(record))
	return hex.EncodeToString(sum[:])
}

func isHashValid(hash string, difficulty int) bool {
	return strings.HasPrefix(hash, strings.Repeat("0", difficulty))
}

func NewOrLoadBlockchain(genesisVault string, bootstrapPeers []string) *Blockchain {
	if data, err := os.ReadFile(ChainFilePath); err == nil {
		var saved PersistedState
		if err := json.Unmarshal(data, &saved); err == nil && len(saved.Chain) > 0 {
			bc := &Blockchain{
				Chain:        saved.Chain,
				PendingTxs:   []Transaction{},
				Balances:     saved.Balances,
				MinedSupply:  saved.MinedSupply,
				Difficulty:   saved.Difficulty,
				Peers:        mergePeers(saved.Peers, bootstrapPeers),
				GenesisVault: saved.GenesisVault,
			}
			if bc.Balances == nil {
				bc.Balances = make(map[string]int64)
			}
			if bc.Difficulty < InitialDifficulty {
				bc.Difficulty = InitialDifficulty
			}
			log.Printf("📂 تم تحميل السلسلة من القرص (%s) | الارتفاع: %d", ChainFilePath, len(bc.Chain)-1)
			return bc
		}
	}

	genesisAmountUsdm := GenesisSDM * BaseUnit
	balances := map[string]int64{
		genesisVault: genesisAmountUsdm,
	}

	genesisTx := Transaction{
		From:      "GENESIS",
		To:        genesisVault,
		Amount:    genesisAmountUsdm,
		Timestamp: time.Now().UTC().Unix(),
	}
	genesisTx.ID = calculateTxID(genesisTx)

	genesisBlock := Block{
		Index:        0,
		Timestamp:    genesisTx.Timestamp,
		Transactions: []Transaction{genesisTx},
		PrevHash:     strings.Repeat("0", 64),
		Nonce:        0,
		Difficulty:   InitialDifficulty,
		Miner:        "GENESIS",
	}
	genesisBlock.Hash = calculateBlockHash(genesisBlock)

	bc := &Blockchain{
		Chain:        []Block{genesisBlock},
		PendingTxs:   []Transaction{},
		Balances:     balances,
		MinedSupply:  0,
		Difficulty:   InitialDifficulty,
		Peers:        mergePeers(nil, bootstrapPeers),
		GenesisVault: genesisVault,
	}
	bc.saveToDiskLocked()
	return bc
}

func mergePeers(existing, added []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(existing)+len(added))
	for _, p := range existing {
		p = strings.TrimSpace(strings.TrimRight(p, "/"))
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	for _, p := range added {
		p = strings.TrimSpace(strings.TrimRight(p, "/"))
		if p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

func (bc *Blockchain) saveToDiskLocked() {
	state := PersistedState{
		Chain:        bc.Chain,
		Balances:     bc.Balances,
		MinedSupply:  bc.MinedSupply,
		Difficulty:   bc.Difficulty,
		Peers:        bc.Peers,
		GenesisVault: bc.GenesisVault,
	}
	b, err := json.MarshalIndent(state, "", "  ")
	if err == nil {
		_ = os.WriteFile(ChainFilePath, b, 0600)
	}
}

func (bc *Blockchain) SubmitSignedTransfer(tx Transaction, amountSDM float64) (Transaction, error) {
	if tx.From == "" || tx.To == "" || tx.From == tx.To {
		return Transaction{}, errors.New("عناوين المرسل والمستلم غير صالحة")
	}
	if amountSDM <= 0 {
		return Transaction{}, errors.New("المبلغ يجب أن يكون أكبر من الصفر")
	}
	amountUsdm := int64(amountSDM * float64(BaseUnit))
	if amountUsdm <= 0 {
		return Transaction{}, errors.New("المبلغ صغير جداً")
	}
	tx.Amount = amountUsdm
	if tx.Timestamp == 0 {
		tx.Timestamp = time.Now().UTC().Unix()
	}
	if !VerifyTransactionSignature(tx) {
		return Transaction{}, errors.New("التوقيع الرقمي أو المفتاح العام غير صحيح")
	}
	tx.ID = calculateTxID(tx)

	bc.mu.Lock()
	defer bc.mu.Unlock()

	var pendingOutgoing int64
	for _, p := range bc.PendingTxs {
		if p.From == tx.From {
			pendingOutgoing += p.Amount
		}
	}
	if bc.Balances[tx.From] < pendingOutgoing+amountUsdm {
		return Transaction{}, errors.New("الرصيد غير كافٍ بعد احتساب المعاملات المعلقة")
	}

	bc.PendingTxs = append(bc.PendingTxs, tx)
	return tx, nil
}

func (bc *Blockchain) MineNextBlock(minerAddress string) (Block, error) {
	if minerAddress == "" {
		return Block{}, errors.New("يرجى إدخال عنوان محفظة المعدّن")
	}

	bc.mu.RLock()
	lastBlock := bc.Chain[len(bc.Chain)-1]
	difficulty := bc.Difficulty
	minedSoFar := bc.MinedSupply
	maxMiningUsdm := MiningCapSDM * BaseUnit
	pending := append([]Transaction(nil), bc.PendingTxs...)
	bc.mu.RUnlock()

	txsToInclude := make([]Transaction, 0, len(pending)+1)

	remainingMiningUsdm := maxMiningUsdm - minedSoFar
	if remainingMiningUsdm > 0 {
		rewardUsdm := BlockRewardSDM * BaseUnit
		if rewardUsdm > remainingMiningUsdm {
			rewardUsdm = remainingMiningUsdm
		}
		rewardTx := Transaction{
			From:      "MINING_REWARD",
			To:        minerAddress,
			Amount:    rewardUsdm,
			Timestamp: time.Now().UTC().Unix(),
		}
		rewardTx.ID = calculateTxID(rewardTx)
		txsToInclude = append(txsToInclude, rewardTx)
	}

	txsToInclude = append(txsToInclude, pending...)

	newBlock := Block{
		Index:        lastBlock.Index + 1,
		Timestamp:    time.Now().UTC().Unix(),
		Transactions: txsToInclude,
		PrevHash:     lastBlock.Hash,
		Nonce:        0,
		Difficulty:   difficulty,
		Miner:        minerAddress,
	}

	for {
		newBlock.Timestamp = time.Now().UTC().Unix()
		hash := calculateBlockHash(newBlock)
		if isHashValid(hash, newBlock.Difficulty) {
			newBlock.Hash = hash
			break
		}
		newBlock.Nonce++
		if newBlock.Nonce%40000 == 0 {
			time.Sleep(20 * time.Millisecond)
		}
	}

	bc.mu.Lock()
	defer bc.mu.Unlock()

	currentLast := bc.Chain[len(bc.Chain)-1]
	if newBlock.PrevHash != currentLast.Hash || newBlock.Index != currentLast.Index+1 {
		return Block{}, errors.New("تغيرت السلسلة أثناء التعدين، أعد المحاولة")
	}

	includedIDs := make(map[string]bool)
	for _, tx := range newBlock.Transactions {
		if tx.From == "MINING_REWARD" {
			if bc.MinedSupply+tx.Amount > maxMiningUsdm {
				return Block{}, errors.New("تم بلوغ حد التعدين الأقصى (10 مليون SDM)")
			}
			bc.MinedSupply += tx.Amount
			bc.Balances[tx.To] += tx.Amount
		} else {
			if !VerifyTransactionSignature(tx) || bc.Balances[tx.From] < tx.Amount {
				continue
			}
			bc.Balances[tx.From] -= tx.Amount
			bc.Balances[tx.To] += tx.Amount
			includedIDs[tx.ID] = true
		}
	}

	bc.Chain = append(bc.Chain, newBlock)

	remainingPending := make([]Transaction, 0, len(bc.PendingTxs))
	for _, ptx := range bc.PendingTxs {
		if !includedIDs[ptx.ID] {
			remainingPending = append(remainingPending, ptx)
		}
	}
	bc.PendingTxs = remainingPending

	elapsed := time.Duration(newBlock.Timestamp-currentLast.Timestamp) * time.Second
	if elapsed < TargetBlockTime/2 && bc.Difficulty < 8 {
		bc.Difficulty++
	} else if elapsed > TargetBlockTime*3 && bc.Difficulty > InitialDifficulty {
		bc.Difficulty--
	}

	bc.saveToDiskLocked()
	return newBlock, nil
}

func RebuildState(chain []Block) (map[string]int64, int64, error) {
	balances := make(map[string]int64)
	var minedSupply int64
	maxMiningUsdm := MiningCapSDM * BaseUnit

	for i, b := range chain {
		if i > 0 {
			prev := chain[i-1]
			if b.PrevHash != prev.Hash || b.Index != prev.Index+1 {
				return nil, 0, errors.New("السلسلة غير مترابطة")
			}
		}
		if calculateBlockHash(b) != b.Hash || !isHashValid(b.Hash, b.Difficulty) {
			return nil, 0, fmt.Errorf("تجزئة غير صحيحة في الكتلة %d", b.Index)
		}
		for _, tx := range b.Transactions {
			if tx.From == "GENESIS" {
				balances[tx.To] += tx.Amount
			} else if tx.From == "MINING_REWARD" {
				if minedSupply+tx.Amount > maxMiningUsdm {
					return nil, 0, errors.New("تجاوز حد التعدين 10 مليون SDM")
				}
				minedSupply += tx.Amount
				balances[tx.To] += tx.Amount
			} else {
				if !VerifyTransactionSignature(tx) || balances[tx.From] < tx.Amount {
					return nil, 0, fmt.Errorf("معاملة غير صالحة في الكتلة %d", b.Index)
				}
				balances[tx.From] -= tx.Amount
				balances[tx.To] += tx.Amount
			}
		}
	}
	return balances, minedSupply, nil
}

func (bc *Blockchain) SyncWithPeers() int {
	bc.mu.RLock()
	peers := append([]string(nil), bc.Peers...)
	currentLen := len(bc.Chain)
	bc.mu.RUnlock()

	replaced := 0
	client := &http.Client{Timeout: 5 * time.Second}
	for _, peer := range peers {
		resp, err := client.Get(strings.TrimRight(peer, "/") + "/chain")
		if err != nil {
			continue
		}
		var remote struct {
			Chain []Block `json:"chain"`
		}
		err = json.NewDecoder(resp.Body).Decode(&remote)
		resp.Body.Close()
		if err != nil || len(remote.Chain) <= currentLen {
			continue
		}

		newBalances, newMined, err := RebuildState(remote.Chain)
		if err != nil {
			continue
		}

		bc.mu.Lock()
		if len(remote.Chain) > len(bc.Chain) {
			bc.Chain = remote.Chain
			bc.Balances = newBalances
			bc.MinedSupply = newMined
			currentLen = len(bc.Chain)
			bc.saveToDiskLocked()
			replaced++
		}
		bc.mu.Unlock()
	}
	return replaced
}

func withCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next(w, r)
	}
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	genesisVault := os.Getenv("SDM_GENESIS_VAULT")
	if genesisVault == "" {
		genesisVault = "SDM1GENESISMAINVAULT000000000000001"
	}

	var bootstrap []string
	if envPeers := os.Getenv("SDM_PEERS"); envPeers != "" {
		bootstrap = strings.Split(envPeers, ",")
	}

	bc := NewOrLoadBlockchain(genesisVault, bootstrap)

	go func() {
		ticker := time.NewTicker(20 * time.Second)
		for range ticker.C {
			bc.SyncWithPeers()
		}
	}()

	http.HandleFunc("/status", withCORS(func(w http.ResponseWriter, r *http.Request) {
		bc.mu.RLock()
		defer bc.mu.RUnlock()

		minedSDM := float64(bc.MinedSupply) / float64(BaseUnit)
		miningLeftSDM := float64(MiningCapSDM) - minedSDM
		circulatingSDM := float64(GenesisSDM) + minedSDM

		writeJSON(w, map[string]any{
			"coin":                   CoinName,
			"symbol":                 CoinSymbol,
			"fixed_max_supply_sdm":   MaxSupplySDM,
			"mining_cap_sdm":         MiningCapSDM,
			"genesis_allocation_sdm": GenesisSDM,
			"mined_supply_sdm":       minedSDM,
			"mining_remaining_sdm":   miningLeftSDM,
			"circulating_supply_sdm": circulatingSDM,
			"block_height":           len(bc.Chain) - 1,
			"current_difficulty":     bc.Difficulty,
			"pending_transactions":   len(bc.PendingTxs),
			"peers":                  bc.Peers,
			"genesis_vault":          bc.GenesisVault,
		})
	}))

	http.HandleFunc("/wallet/new", withCORS(func(w http.ResponseWriter, r *http.Request) {
		wallet, err := GenerateWallet()
		if err != nil {
			http.Error(w, "تعذر إنشاء المحفظة", http.StatusInternalServerError)
			return
		}
		writeJSON(w, wallet)
	}))

	http.HandleFunc("/balance", withCORS(func(w http.ResponseWriter, r *http.Request) {
		addr := strings.TrimSpace(r.URL.Query().Get("address"))
		if addr == "" {
			http.Error(w, "يرجى تمرير address", http.StatusBadRequest)
			return
		}
		bc.mu.RLock()
		balUsdm := bc.Balances[addr]
		bc.mu.RUnlock()

		writeJSON(w, map[string]any{
			"address":     addr,
			"balance_usdm": balUsdm,
			"balance_sdm":  float64(balUsdm) / float64(BaseUnit),
		})
	}))

	http.HandleFunc("/transfer", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "استخدم POST", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			From       string  `json:"from"`
			To         string  `json:"to"`
			Amount     float64 `json:"amount"`
			Timestamp  int64   `json:"timestamp"`
			PublicKey  string  `json:"public_key"`
			Signature  string  `json:"signature"`
			PrivateKey string  `json:"private_key"` // اختياري للتوقيع المباشر من العميل إن أُرسل
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "بيانات JSON غير صالحة", http.StatusBadRequest)
			return
		}

		tx := Transaction{
			From:      strings.TrimSpace(req.From),
			To:        strings.TrimSpace(req.To),
			Amount:    int64(req.Amount * float64(BaseUnit)),
			Timestamp: req.Timestamp,
			PublicKey: req.PublicKey,
			Signature: req.Signature,
		}
		if tx.Timestamp == 0 {
			tx.Timestamp = time.Now().UTC().Unix()
		}
		if req.PrivateKey != "" && tx.Signature == "" {
			if err := SignTransaction(req.PrivateKey, &tx); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
		}

		accepted, err := bc.SubmitSignedTransfer(tx, req.Amount)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		writeJSON(w, map[string]any{
			"status":      "queued",
			"transaction": accepted,
		})
	}))

	http.HandleFunc("/mine", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "استخدم POST", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Miner string `json:"miner"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Miner) == "" {
			http.Error(w, "يرجى إرسال عنوان المعدّن miner", http.StatusBadRequest)
			return
		}
		start := time.Now()
		block, err := bc.MineNextBlock(strings.TrimSpace(req.Miner))
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		writeJSON(w, map[string]any{
			"status":      "mined",
			"elapsed_sec": time.Since(start).Seconds(),
			"block":       block,
		})
	}))

	http.HandleFunc("/chain", withCORS(func(w http.ResponseWriter, r *http.Request) {
		bc.mu.RLock()
		defer bc.mu.RUnlock()
		writeJSON(w, map[string]any{
			"chain": bc.Chain,
		})
	}))

	http.HandleFunc("/peers/add", withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "استخدم POST", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Peer string `json:"peer"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Peer) == "" {
			http.Error(w, "يرجى إرسال رابط العقدة peer", http.StatusBadRequest)
			return
		}
		bc.mu.Lock()
		bc.Peers = mergePeers(bc.Peers, []string{req.Peer})
		bc.saveToDiskLocked()
		peersCopy := append([]string(nil), bc.Peers...)
		bc.mu.Unlock()

		synced := bc.SyncWithPeers()
		writeJSON(w, map[string]any{
			"status":        "peer_added",
			"synced_chains": synced,
			"peers":         peersCopy,
		})
	}))

	http.HandleFunc("/sync", withCORS(func(w http.ResponseWriter, r *http.Request) {
		synced := bc.SyncWithPeers()
		writeJSON(w, map[string]any{
			"status":        "synced",
			"synced_chains": synced,
		})
	}))

	log.Printf("🚀 %s (%s) Node running on :%s | Fixed: %d SDM | Mining Cap: %d SDM",
		CoinName, CoinSymbol, port, MaxSupplySDM, MiningCapSDM)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(payload)
}
