# multiBTC Holders- Verification & Authorization Portal

A coordinated‑claim portal for **multiBTC** holders pursuing asset‑specific recovery in the **Multichain Foundation Ltd.** liquidation.

- **Live:** https://7wy2p-aqaaa-aaaah-quska-cai.icp0.io/
- **Court records:**
  - Singapore High Court - **HC/CWU 134/2025** (KPMG liquidator, May 2025)
  - U.S. Bankruptcy Court SDNY - **Case 25‑12340‑DSJ**

Every wallet attestation is cryptographically signed by the holder's EVM key, bound to a continuous **Internet Identity** session, stored with full revision history on the **Internet Computer**, and rendered as an admissible evidentiary record for KPMG and the courts.

---

## What the portal does

The portal collects evidence sufficient for three independent downstream consumers:

| Layer | Purpose | Captured fields |
|---|---|---|
| **1 Identity** | Solicitor retainer | legal name, DOB, nationality, country of residence, email, Telegram, preferred comm channel |
| **2 Wallets & holdings** | Claim quantification | EVM addresses (up to 5 per holder), per‑wallet ECDSA signatures, detected balances on Ethereum / BSC / Polygon / Canto, position type (raw / LP / vault / other) + protocol, bridge‑redemption tx hashes, pre‑/post‑incident timing, post‑incident acquisition history, supporting tx hashes (up to 10) |
| **3 KPMG PoD status** | Liquidator coordination | filed yes/no, date, reference number, needs‑help flag |
| ** Authorization** | Group representation mandate | explicit consent to be represented, fee‑structure ack, group‑coordination ack, penalty‑of‑perjury truthfulness attestation committed by the per‑wallet signature |
| **5 Funding** | Funding model | upfront cost‑share / proportional to claim / litigation funding / undecided + preferred payment method |
| **6 Optional** | Strength of record | naming preference, other Multichain token claims, supporting documentation notes |

Each per‑wallet attestation is signed via **EIP‑191 `personal_sign`** against a canonical message that includes the wallet address, the linked II principal, the revision number, a **SHA‑256 commitment** to every form field, an ISO‑8601 timestamp, and a server‑issued UUID nonce. The backend re‑computes the commitment, re‑builds the canonical message, recovers the signer via `k256`, and only persists the record when the recovered address matches the claimed wallet. Edits never overwrite — each `update_*` call appends a new revision to a stable log so the full audit trail is retrievable per holder and per wallet.

---

## Architecture

```
                  ┌──────────────────────────────────────┐
                  │  id.ai (Internet Identity)           │
                  └──────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend asset canister (React + Vite + Tailwind + wagmi v2)    │
│  • II login → Principal                                          │
│  • EVM wallets via injected/EIP-6963 + WalletConnect + Coinbase  │
│  • balanceOf() on 4 chains via viem fallback() racing many RPCs  │
│  • Canonical message → personal_sign → submit                    │
│  • Multi-wallet add, edit with full revision history             │
└──────────────────────────────────────────────────────────────────┘
                                  │ candid (agent-js, II-authenticated)
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  Backend canister (Rust + ic-cdk + ic-stable-structures + k256)  │
│  • link_wallet (1 principal ↔ N≤5 wallets)                       │
│  • submit_holder / update_holder (revisioned, capped at 20)      │
│  • submit_wallet_attestation / update_wallet_attestation         │
│    (revisioned, capped at 20, EIP-191 signature verified)        │
│  • get_my_*, get_*_revisions, get_public_stats                   │
│  • Controller-configurable dual-factor admin                     │
│    (caller principal == admin AND signature recovers to admin EVM)│
└──────────────────────────────────────────────────────────────────┘
```

### Mainnet deployment

| Canister | ID | Subnet |
|---|---|---|
| backend | `7d7lc-byaaa-aaaah-qusjq-cai` | `re2t4-faa75-v3vhk-kdmdr-uyrkl-aik2l-ixd6u-p3fyr-zlfkc-6c5af-zae` (confidential, SEV‑SNP) |
| frontend | `7wy2p-aqaaa-aaaah-quska-cai` | `pjljw-kztyl-46ud4-ofrj6-nzkhm-3n4nt-wi3jt-ypmav-ijqkt-gjf66-uae` |
| Internet Identity | `rdmx6-jaaaa-aaaaa-aaadq-cai` (id.ai) | — |

The backend runs on a **confidential (AMD SEV‑SNP) subnet**: canister memory is encrypted against the node machines' operators and hosts. It was moved there on 2026‑10‑01 by canister migration, keeping its ID; the service was stopped from 12:14 to 12:37 UTC. Moving the state required a snapshot of the canister's memory to pass through the operator's machine, where it was deleted once the move was verified — disclosed here because no other operation reads holder data outside the canister. SEV‑SNP protects against the infrastructure, not against whoever controls the canister; see *Who controls the backend* below.

The frontend serves only public static assets and stays on its original subnet (`pjljw-…-uae`). The two canisters make no calls to each other — the browser talks to each directly — so they need not share a subnet.

### multiBTC contracts indexed

| Chain | Address | Chain ID |
|---|---|---|
| Ethereum | `0x66eFF5221ca926636224650Fd3B9c497FF828F7D` | 1 |
| BSC | `0xD9907fcDa91aC644F70477B8fC1607ad15b2D7A8` | 56 |
| Polygon | `0xf5b9b4A0534cf508ab9953c64c5310DFa0B303A1` | 137 |
| Canto | `0x80A16016cC4A2E6a2CACA8a4a498b1699fF0f844` | 7700 |

All ERC‑20 with 8 decimals (same as BTC).

---

## Repository layout

```
multichain/
├── dfx.json                       # canister declarations (backend / frontend / II)
├── canister_ids.json              # mainnet canister IDs (pinned)
├── Cargo.toml                     # Rust workspace
├── src/
│   ├── backend/                   # Rust canister
│   │   ├── Cargo.toml
│   │   ├── backend.did            # candid interface
│   │   └── src/
│   │       ├── lib.rs             # endpoints + caller checks
│   │       ├── types.rs           # HolderProfile, WalletAttestation, payloads
│   │       ├── message.rs         # link / attest / admin canonical messages
│   │       ├── commitment.rs      # canonical-form-data serialiser + sha256
│   │       ├── verify.rs          # EIP-191 personal_sign recovery (k256)
│   │       └── nonce.rs           # raw_rand UUID v4
│   └── frontend/                  # React asset canister
│       ├── package.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       └── src/
│           ├── App.tsx
│           ├── main.tsx
│           ├── pages/             # Landing, Verify, Dashboard, Admin
│           ├── components/        # AuthGate, ConnectWalletDialog, HolderForm,
│           │                      # WalletsPanel, WalletAttestationForm,
│           │                      # editors, PrincipalChip, etc.
│           └── lib/               # auth, wagmi (4-chain fallback pools),
│                                  # contracts, backend (IDL + actor),
│                                  # message, dataCommitment, format
└── README.md
```

---

## Build & run

### Prerequisites
- `dfx` ≥ 0.30
- Rust stable with `wasm32-unknown-unknown` target
- Node ≥ 20

### Local development

```bash
# Start a clean local replica
dfx start --background --clean

# Install frontend dependencies (once)
cd src/frontend && npm install && cd ../..

# Deploy backend + frontend + a local Internet Identity canister
dfx deploy

# Build the frontend bundle with the local .env (canister IDs etc.)
cd src/frontend && npm run build && cd ../..

# Re-deploy just the frontend canister with the fresh bundle
dfx deploy frontend
```

The deploy log prints local URLs for each canister. The local II is pinned to a known monolithic dev build via [`dfx.json`](dfx.json) so the certified path serves correctly.

### Tests

```bash
# Backend — unit tests for message construction, canonical commitment,
# EIP-191 signature recovery against an ethers.js golden fixture.
cargo test -p backend

# Frontend — Vitest cross-language parity tests assert byte-equality
# between the TS canonical-message + commit serialisers and the Rust ones.
cd src/frontend && npm test
```

### Deploying

The frontend, by its controller:

```bash
cd src/frontend && npm run build && cd ../..
dfx deploy frontend --network ic
```

The backend has no human controller (see *Who controls the backend*). An upgrade needs a controller added by holder vote; that controller installs the reproducible artifact, never a local `dfx deploy` build, and can then remove itself:

```bash
./scripts/build-backend.sh
dfx canister install 7d7lc-byaaa-aaaah-qusjq-cai --mode upgrade --wasm artifacts/backend.wasm --network ic
dfx canister update-settings 7d7lc-byaaa-aaaah-qusjq-cai --remove-controller <own principal> --network ic
```

### Keeping it running

Anyone can top up the backend with cycles; no permission is needed. Its balance is on the Dashboard, or:

```bash
dfx canister call 7d7lc-byaaa-aaaah-qusjq-cai cycles_balance --network ic
```

Top it up when it falls below 1T cycles, with ICP from any wallet:

```bash
dfx ledger top-up 7d7lc-byaaa-aaaah-qusjq-cai --amount 1 --network ic   # converts 1 ICP to cycles
```

or with "Add cycles" in the NNS app. The freezing threshold is 180 days: the canister stops answering once its balance would last less than that, which leaves half a year to top it up before any data is at risk. A canister that reaches zero cycles has its memory wiped.

Production builds embed `DFX_NETWORK=ic` so the frontend talks to `id.ai` and `icp0.io` rather than the local replica.

---

## Security model

### Per-wallet attestation
1. User authenticates via Internet Identity → gets a Principal P.
2. User connects an EOA, calls `get_link_nonce(addr)`; backend stores a single‑use nonce for `addr`.
3. Frontend builds the **linking message** binding `addr ↔ P`, the user signs it, frontend calls `link_wallet`.
4. Backend recovers the signer via `k256::ecdsa::VerifyingKey::recover_from_prehash` and atomically writes both directions of the `addr ↔ P` map — rejecting if the wallet is already bound to a different principal, or recovery doesn't match.
5. For each wallet, the user fills the attestation form and clicks Sign. The frontend computes a **deterministic canonical serialisation** of the form data (sorted line‑oriented, hex‑encoded string values) and SHA‑256s it. That commit hex goes into the **attestation message** along with `(wallet, principal, revision, ISO timestamp, server nonce)`.
6. Wallet signs via `personal_sign`. Frontend submits the signature, the payload, and the commit.
7. Backend re‑computes the commit from the payload, compares — rejects on mismatch. Re‑builds the attestation message, recovers the signer, compares to the claimed wallet — rejects on mismatch. Consumes the nonce, writes revision N.

Smart‑contract wallets (Coinbase Smart Wallet, Safe, Argent, ERC‑4337) are **not** supported because their signatures recover to the owner EOA, not the smart account. The UI explicitly warns; the connector list is EOA‑only.

### Admin
Dual‑factor:
1. Caller's II principal must equal the configured `admin_principal`.
2. ECDSA signature over the admin message must recover to the configured `admin_eth_address`.

`set_admin_eth_address` and `set_admin_principal` are gated by `ic_cdk::api::is_controller(&caller)`, so only canister controllers can rotate either value. With no human controller, the admin can be changed only by a controller that holders voted in. Live admin config is readable via `get_admin_info` (public).

**What the admin can see:** `admin_overview` only — each holder's principal and Telegram handle, and per wallet three verdicts the canister computes itself: whether the signature still verifies (re-derived from the stored record at call time), whether it covers the holder's current profile, and which linked wallets were never signed. Legal names, dates of birth, nationalities, emails and declared amounts never leave the canister through any admin endpoint.

**On-chain verification:** `admin_verify_onchain` has the canister read every attested wallet's multiBTC balance itself, through HTTPS outcalls agreed by consensus, at two points per chain: the last block before the first malicious Multichain transaction (2023‑07‑06 16:21:23 UTC — Ethereum 17,635,953, BSC 29,730,477, Polygon 44,757,671) and a recent block. It also reports whether the balance the claimant's browser recorded at signing matches the current one. Each read is a single-node HTTPS outcall: cheaper than a 13-node replicated one, at the cost of trusting that node's answer, so every reading records which provider answered and that it was not replicated. Readings are stored separately from the signed records and never alter them; a failed read is stored as an error, never as zero. **Canto cannot currently be verified**: every known public Canto endpoint is unreachable or serves an expired TLS certificate.

### No export

The backend has **no export or delete** of holder data. Each holder can download their own records from the Verify page ("Download my evidence"), through reads scoped to their own Internet Identity. The only other way records leave the canister is `governed_read_all`, which answers only a principal that holders voted to grant access, only for the number of days the proposal named, and logs every read on the proposal for all holders to see. `verify/verify-attestation.mjs` checks either file independently.

### Governance

Proposals live in the backend canister itself (`create_proposal`, `vote`, `finalize_proposal`, `list_proposals`), visible to registered holders on the Governance page.

- **Who votes:** holders who had signed a wallet attestation before 2026‑10‑01 16:00 UTC. Holders who sign later vote once their first signed wallet is 14 days old and the canister's own on-chain reading shows at least 0.02 multiBTC across their wallets, so a vote cannot be swung by last-minute or empty sign-ups. One vote each, changeable until the proposal resolves. Ballots are secret: everyone sees totals, nobody (including the admin) sees who voted which way.
- **How it resolves:** as soon as every eligible holder has voted; otherwise 7 days after creation. The side with more votes cast wins; there is no minimum turnout. A tie goes to the side whose voters hold more multiBTC by the canister's own on-chain readings. A tie there too, or no votes at all, fails, and nothing changes.
- **What a proposal can do:** record a decision; grant a principal read access to all holder records for a set number of days (1–365); or add a controller to the backend. Only the admin can propose adding a controller (`admin_propose_add_controller`, dual-factor). If holders pass it, the canister adds the controller itself, which requires the canister to be one of its own controllers. Governance can only add controllers, never remove one.

Since 2026‑10‑01 the canister is its only controller, so a holder vote is the only way anyone gains the power to change it (see below).

### Verify the deployed code

Anyone can check that the backend running on the Internet Computer is exactly the code in this repository, with no trust in the operators. The build is reproducible: the Rust toolchain, dfx version and build paths are pinned in `Dockerfile.build`, so every machine produces byte-identical output.

**You need:** `git` and Docker (on Windows, use WSL). Checked on x86-64 Linux, locally and in CI. About five minutes.

**1. Build it yourself.**

```bash
git clone https://github.com/wilaq/MultiBTC.git
cd MultiBTC
git checkout v2026.10.01    # the deployed release, from the table below
./scripts/build-backend.sh  # last line: artifacts/backend.wasm  sha256: <hash>
```

**2. Read the hash the network reports for the live canister.** Either:

- with [dfx](https://internetcomputer.org/docs/building-apps/getting-started/install) installed, asking the network directly:
  ```bash
  dfx canister info 7d7lc-byaaa-aaaah-qusjq-cai --network ic   # "Module hash: 0x<hash>"
  ```
- or, without installing anything, on the [ICP dashboard](https://dashboard.internetcomputer.org/canister/7d7lc-byaaa-aaaah-qusjq-cai) under "Module hash". The dashboard can lag behind an upgrade by some hours; `dfx` is authoritative.

**3. Compare.** If the two hashes are identical, the live canister runs exactly this source, and nothing else.

| Release | Deployed | Backend module SHA-256 |
|---|---|---|
| `v2026.10.01` | 2026-10-01 (current) | `dca57fe08eef6ad077f3c27c210c549fde7bcc24fa6960205c43f8e489df2c5a` |

The build reads only `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `dfx.json`, `canister_ids.json` and `src/backend/` (see `.dockerignore`), so any later commit that leaves those untouched, like one that only edits this README, builds the same hash. CI also runs this build on every push: open the latest run under the repository's **Actions** tab, then the `reproducible-build` job, which prints the hash.

**Further checks**, all with `dfx` and all read straight from the network:

```bash
# Every public method the canister has. There is no export or wipe method.
dfx canister metadata 7d7lc-byaaa-aaaah-qusjq-cai candid:service --network ic

# Who can change the code ("Controllers:").
dfx canister info 7d7lc-byaaa-aaaah-qusjq-cai --network ic
```

### Who controls the backend

**No person.** Since 2026‑10‑01 the backend's only controller is the canister itself, which `dfx canister info` above confirms. The operator removed both of their own controller keys. Every install, upgrade and controller change is permanently recorded in the Internet Computer's canister history.

What that means:

- **Nobody can change the code or copy the data on their own.** Upgrading a canister or downloading a snapshot of its memory takes a controller, and the canister's own code can do only one thing as its controller: *add* a controller, once holders have voted for it on a proposal the admin made (see *Governance*).
- **The vote is the safeguard, so watch it.** Proposals are visible to every holder on the Governance page. There is no minimum turnout: a proposal that nobody opposes within 7 days passes with a single yes vote.
- **A controller added by vote has full power.** It can upgrade the code, which changes the module hash above, or download a snapshot of the canister's memory, which leaves no public trace. The vote is the point at which holders decide to trust it.
- **If the admin's keys are lost,** nobody can propose adding a controller, so the backend can never be upgraded again. It keeps running, and holders keep access to their own records and their votes on decisions and data-access grants.
- **The website is still operated.** The frontend canister (`7wy2p-…`) keeps a controller so the site can be fixed and improved. It holds no data, but it is the page holders type into, so that much trust in the operator remains.

### Caps
- `MAX_EDITS = 20` revisions per holder profile and per wallet attestation.
- `MAX_WALLETS_PER_PRINCIPAL = 5`.
- 10 supporting tx hashes max per wallet.
- 15‑minute TTL on every nonce, single‑use.

---

## Disclaimer

This portal is operated by a coordinated group of multiBTC holders. **It is not affiliated with KPMG, the Multichain Foundation, or any court.** A formal engagement letter / retainer from the appointed Singapore solicitor follows off‑platform once that solicitor is retained. The data collected here is used solely for that legal coordination.
