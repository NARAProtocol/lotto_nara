# PRD: NARA Lucky Epoch — "No-Loss Yield Lottery"

## 1. Overview
**What it is:** A sticky, high-engagement "No-Loss Yield Lottery" built on top of the NARA Protocol. Every epoch, all enrolled Lockers have a chance to win a massive combined **NARA Drip + ETH** yield prize pool. If they lose, they do not lose their NARA principal — they simply forgo that specific epoch's yield.

**The "Aha" Moment:** The prize pool isn't just ETH. NARA's core Engine generates a continuous native base emission ("The Drip") from the `NARARewardReserve`. The Lottery aggregates *both* the substantial NARA Drip and any external ETH rewards accumulated during the epoch by all participants. 

**Why it works:**
- **No-Loss:** Nobody loses their principal NARA lock, making it an easy sell to mainstream crypto users.
- **Massive Expected Value for Winners:** Winning the aggregate NARA+ETH yield of hundreds of users in a single epoch creates immense FOMO and daily check-in behavior.
- **Pure Ecosystem Synergy:** This acts as a black hole for NARA supply while heavily gamifying the waiting period of locking.

---

## 2. Core Mechanics

1. **Direct Token Locking (The Lotto Vault):** 
   - A user goes to the Lotto UI and deposits NARA directly into the `NaraLottoPool` contract.
   - The `NaraLottoPool` creates a dedicated `NaraLockAccount` (a lightweight EIP-1167 clone) underneath it to lock the user's NARA natively into `NaraEngineV2`.
   - The user receives an internal receipt/balance mapping in the Lotto contract, ensuring they always own their principal. No NFTs are involved.

2. **Yield Aggregation ("The Pot"):**
   - Because the `NaraLottoPool` is the `factory` (owner) of all those `NaraLockAccount` clones, it has the exclusive right to call `claimRewards()` on them.
   - Throughout the epoch, the deployed `NaraLottoPool` acts as an immense aggregated yield sink. 
   - A public `harvest()` function cranks the yield from all user locks directly into the Lotto Pool. The Pool accumulates massive balances of NARA (The Drip) and ETH.

3. **Winner Selection (Chainlink VRF):**
   - At the beginning of a new epoch, a Chainlink VRF on Base is triggered.
   - "More NARA locked + longer duration = more tickets." The contract uses the `weight` parameter from the NARA Engine to give users proportional winning odds.
   - Example: If the total weight of the pool is 1,000,000, and my position's weight is 50,000, I have a 5% chance to win the entire epoch's yield.

4. **Reward Distribution:**
   - The winning user is credited the ENTIRE Pot (100% of accumulated NARA and ETH yield generated over the epoch).
   - There are ZERO extra "Lotto" fees. The protocol is purely an engagement mechanism; the winner takes everything.

5. **Loser Experience & Re-Entry:**
   - Losers earn 0 NARA/ETH for that epoch but safely retain their underlying NARA principal.
   - Losers simply stay in the pool. Their NARA remains locked in the Engine doing its thing, and they are automatically re-entered in the next epoch's lotto draw.

---

## 3. Tiered Leagues & Draw Frequencies (Fee Maximization)

Because `NARAEngineV2` generates its flat ETH fees explicitly through `lock` and `unlock` actions, the Lotto is designed to encourage **shorter, high-turnover lock cycles** (Max 100 epochs) to drive continuous fee generation for the Treasury. 

To create different user experiences, each `NaraLottoPool` is configured with a specific **Draw Frequency** (how many epochs pass before a winner is selected):

- 🥉 **The Daily Flash (Bronze)**: 
  - **Req**: 100 NARA, 7 Epoch lock limit. 
  - **Draw Frequency**: Every 1 Epoch.
  - **Vibe**: Fast-paced, high churn, frequent lock/unlock fees generated.
- 🥈 **The Weekly Build-up (Silver)**: 
  - **Req**: 1,000 NARA, ~30 Epoch lock limit. 
  - **Draw Frequency**: Every 7 Epochs.
  - **Vibe**: The Pot builds up for 7 epochs before a massive winner is drawn.
- 🥇 **The Grand Jackpot (Gold)**: 
  - **Req**: 5,000 NARA, Max 100 Epoch lock limit. 
  - **Draw Frequency**: Every 30 Epochs (1 Month).
  - **Vibe**: Insane accumulation of NARA and ETH over a month into a single life-changing winner.

*Each league operates an independent `NaraLottoPool` smart contract with its own VRF draw and jackpot.*

---

## 4. Technical Architecture Details

### Smart Contracts (New)
1. **`NaraLottoPool.sol` (One per League):**
   - **`deposit(uint256 amount)`**: User sends NARA. The contract deploys a generic `NaraLockAccount` clone. It transfers NARA to the clone, and executes `clone.lock()` into the `NaraEngineV2` with the league's fixed duration.
   - **`harvest()`**: Loops through active clones (or processes them in chunks to avoid gas limits) and calls `claimRewards()`. Both NARA and ETH are routed directly to the Lotto Pool contract.
   - **`drawWinner()`**: Only callable after epoch transition. Requests Chainlink VRF.
   - **`fulfillRandomWords(...)`**: Chainlink VRF callback. Computes winner using an `O(log N)` binary search on a cumulative weight array. Credits all held NARA and ETH to the winner's address internal balance for withdrawal.
   - **`withdrawPrincipal(uint256 positionId)`**: Once the lock duration expires in the Engine, the user can call this to unlock their `NaraLockAccount` clone and retrieve their base NARA.

2. **`LottoRegistry.sol` (Optional):**
   - Factory for creating different league tiers and providing an indexer endpoint for the UI.

### Verification Matrix & Constraints
- **Max Participants (Alpha):** Hardcapped at exactly **300 lockers** per league to keep early risk non-existent and guarantee block gas limits are perfectly safe without needing batch harvests natively yet.
- **Gas Limits on Harvest:** A large number of users means `harvest()` could exceed block gas limits if calling `claimRewards` on thousands of clones. The contract must implement chunked harvesting (e.g. `harvestBatch(uint256 cursor, uint256 count)`).
- **Sybil Resistance:** Because tickets are strictly proportional to mathematically constrained NARA `weight`, splitting a lock into 10 smaller locks grants no advantage.

### Engine Fee Handling Architecture
The Engine enforces native fees for locking and unlocking. The Lotto perfectly passes these through:
- **Lock Fee (ETH):** `deposit()` must be `payable`. The user supplies `msg.value == engine.lockFeeWei()`, which is forwarded to the Engine via the Clone.
- **Lock Fee (NARA):** `engine.lockFeeBps()` takes a cut of the deposited NARA. The Lotto relies entirely on `engine.positionAt()` to derive the user's lottery weight based on the NET amount, ensuring proper mathematically accurate accounting.
- **Claim Fee (ETH):** `engine.claimFeeBps()` takes a slice of the ETH yield. This is handled natively by the engine; the Lotto simply aggregates whatever Net ETH it receives into the jackpot.
- **Unlock Fee (ETH):** `withdraw()` must be `payable`. The user supplies `msg.value == engine.unlockFeeWei()`, which is forwarded to the Engine to free their principal.

### Frontend Elements
- A stunning visually striking "Jackpot" UI displaying live, bubbling NARA and ETH numbers as `harvest()` is continually triggered.
- A "My Tickets" section showing expected odds.
- An intuitive "Withdraw" button that retrieves winnings and unlocked principal.

---

## 5. Security & Legal Considerations

- **Strict No-Loss:** Smart contracts never gamble with the base NARA deposit. The Engine native lock guarantees the amount is fully recoverable after the lock duration.
- **Verifiable Randomness:** Chainlink VRF is non-negotiable to prove fairness.
- **Legal Framing:** Must be strictly framed as a "Prize-Linked Savings Account" where principal is always returned. Because the NARA Drip is given by the protocol natively (rather than being users' deposited funds at risk), it legally avoids classification as gambling in most jurisdictions.
