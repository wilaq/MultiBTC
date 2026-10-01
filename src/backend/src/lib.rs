mod commitment;
mod governance;
mod message;
mod nonce;
mod onchain;
mod types;
mod verify;

use candid::Principal;
use ic_cdk::api::{caller, is_controller, time};
use ic_cdk_macros::{init, post_upgrade, pre_upgrade, query, update};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{DefaultMemoryImpl, StableBTreeMap};
use std::cell::RefCell;

use crate::types::*;

type Mem = VirtualMemory<DefaultMemoryImpl>;

// Memory ids for stable structures. Append-only — never reuse a freed id.
const MEM_WALLET_TO_PRINCIPAL: MemoryId = MemoryId::new(0);
const MEM_PRINCIPAL_WALLETS: MemoryId = MemoryId::new(1);
const MEM_HOLDER_LATEST: MemoryId = MemoryId::new(2);
const MEM_HOLDER_REVISIONS: MemoryId = MemoryId::new(3);
const MEM_WALLET_LATEST: MemoryId = MemoryId::new(4);
const MEM_WALLET_REVISIONS: MemoryId = MemoryId::new(5);
// 6, 7 and 8 held the old `EthAddress -> NonceEntry` maps. Nonces are now keyed
// by (purpose, caller principal), which changes the stable node layout, and
// `StableBTreeMap::load` does NOT assert the stored bounds against the new ones
// -- it silently keeps the old page size and the canister then traps reading its
// own nodes (verified on a local upgrade from the deployed build). So those
// regions are retired rather than reinterpreted, and all three nonce kinds share
// one virgin region. Never reuse 6, 7 or 8.
const MEM_NONCES: MemoryId = MemoryId::new(11);
// Canister-observed on-chain balances. Kept out of the signed records.
const MEM_ONCHAIN: MemoryId = MemoryId::new(12);
// Holder governance: proposals with their (secret) ballots and outcomes.
const MEM_PROPOSALS: MemoryId = MemoryId::new(13);

// Nonce purposes, the first byte of every NonceKey.
const NONCE_LINK: u8 = 0;
const NONCE_ATTEST: u8 = 1;
const NONCE_ADMIN: u8 = 2;
const MEM_ADMIN_ETH: MemoryId = MemoryId::new(9);
const MEM_ADMIN_PRINCIPAL: MemoryId = MemoryId::new(10);

// Singleton key for the admin-config single-row maps.
const ADMIN_KEY: u8 = 0;

thread_local! {
    // 1 page (64 KiB) buckets, not the 8 MiB default: 11 memory regions would
    // otherwise reserve 88 MiB of empty stable memory on first write, which is
    // pure idle-cycle burn. Only takes effect on a *fresh* install -- an existing
    // canister keeps whatever bucket size its stored header records.
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init_with_bucket_size(DefaultMemoryImpl::default(), 1));

    static WALLET_TO_PRINCIPAL: RefCell<StableBTreeMap<EthAddress, PrincipalVal, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_WALLET_TO_PRINCIPAL))));

    static PRINCIPAL_WALLETS: RefCell<StableBTreeMap<PrincipalAddrKey, (), Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_PRINCIPAL_WALLETS))));

    static HOLDER_LATEST: RefCell<StableBTreeMap<PrincipalVal, u32, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_HOLDER_LATEST))));

    static HOLDER_REVISIONS: RefCell<StableBTreeMap<PrincipalRevKey, HolderProfile, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_HOLDER_REVISIONS))));

    static WALLET_LATEST: RefCell<StableBTreeMap<EthAddress, u32, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_WALLET_LATEST))));

    static WALLET_REVISIONS: RefCell<StableBTreeMap<AddrRevKey, WalletAttestation, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_WALLET_REVISIONS))));

    static NONCES: RefCell<StableBTreeMap<NonceKey, NonceEntry, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_NONCES))));

    static ADMIN_ETH: RefCell<StableBTreeMap<u8, EthAddress, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_ADMIN_ETH))));

    static ADMIN_PRINCIPAL: RefCell<StableBTreeMap<u8, PrincipalVal, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_ADMIN_PRINCIPAL))));

    static ONCHAIN: RefCell<StableBTreeMap<EthAddress, OnchainRecord, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_ONCHAIN))));

    static PROPOSALS: RefCell<StableBTreeMap<u64, Proposal, Mem>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MEM_PROPOSALS))));

    // Start time of an on-chain verification run in progress. Heap only; a run
    // interrupted by a trap is treated as finished once it is stale.
    static VERIFY_RUNNING: RefCell<Option<u64>> = const { RefCell::new(None) };

    // Rotating start point for the expired-nonce sweep. Heap only -- it resets on
    // upgrade, which costs nothing but a single restarted sweep pass.
    static SWEEP_CURSOR: RefCell<Option<NonceKey>> = const { RefCell::new(None) };
}

// `k256` and friends pull in `getrandom` but we never actually invoke its
// randomness path (ECDSA recovery is deterministic). Register a no-op shim so
// the linker resolves the symbol on wasm32.
getrandom::register_custom_getrandom!(always_fail_getrandom);
fn always_fail_getrandom(_buf: &mut [u8]) -> Result<(), getrandom::Error> {
    Err(getrandom::Error::UNSUPPORTED)
}

// ============================================================================
// Lifecycle
// ============================================================================

#[init]
fn init() {}

#[pre_upgrade]
fn pre_upgrade() {}

#[post_upgrade]
fn post_upgrade() {}

// ============================================================================
// Helpers
// ============================================================================

fn caller_or_err() -> Result<Principal, String> {
    let c = caller();
    if c == Principal::anonymous() {
        return Err("authentication required: please sign in with Internet Identity".into());
    }
    Ok(c)
}

fn parse_addr(s: &str) -> Result<EthAddress, String> {
    EthAddress::from_hex(s)
}

fn default_admin_eth() -> EthAddress {
    let mut a = [0u8; 20];
    hex::decode_to_slice(DEFAULT_ADMIN_ETH_ADDRESS_HEX, &mut a).expect("admin addr");
    EthAddress(a)
}

fn current_admin_eth() -> EthAddress {
    ADMIN_ETH
        .with(|m| m.borrow().get(&ADMIN_KEY))
        .unwrap_or_else(default_admin_eth)
}

fn current_admin_principal() -> Option<Principal> {
    ADMIN_PRINCIPAL.with(|m| m.borrow().get(&ADMIN_KEY).map(|p| p.0))
}

fn require_controller() -> Result<(), String> {
    if !is_controller(&caller()) {
        return Err("only a canister controller may call this".into());
    }
    Ok(())
}

fn now_ns() -> u64 {
    time()
}

fn nonce_expired(entry: &NonceEntry, ttl_ns: u64) -> bool {
    now_ns().saturating_sub(entry.issued_at_ns) > ttl_ns
}

/// How many entries one sweep pass looks at. A bounded linear scan from a
/// rotating cursor -- reclaims faster than a single caller can insert, since each
/// caller holds at most one row per map. Swap for a time-ordered index only if
/// the nonce maps ever get big enough for a full pass to matter.
const SWEEP_BATCH: usize = 20;

fn sweep_expired(map: &RefCell<StableBTreeMap<NonceKey, NonceEntry, Mem>>, ttl_ns: u64) {
    let start = SWEEP_CURSOR.with(|c| c.borrow().clone());
    let batch: Vec<(NonceKey, NonceEntry)> = {
        let m = map.borrow();
        match start {
            Some(k) => m.range(k..).take(SWEEP_BATCH).collect(),
            None => m.iter().take(SWEEP_BATCH).collect(),
        }
    };
    // Short batch means we hit the end of the map: wrap the cursor.
    let next = if batch.len() < SWEEP_BATCH { None } else { batch.last().map(|(k, _)| k.clone()) };
    SWEEP_CURSOR.with(|c| *c.borrow_mut() = next);

    let mut m = map.borrow_mut();
    for (k, v) in batch {
        if nonce_expired(&v, ttl_ns) {
            m.remove(&k);
        }
    }
}

/// Issue a fresh nonce for `caller`, overwriting any previous one. Keyed by the
/// caller, so one principal can never invalidate another's in-flight nonce, and
/// can never hold more than one row per map.
async fn issue_nonce(
    purpose: u8,
    caller: Principal,
    addr: EthAddress,
    ttl_ns: u64,
) -> Result<String, String> {
    let nonce = nonce::fresh_uuid_v4().await?;
    let entry = NonceEntry { nonce: nonce.clone(), addr, issued_at_ns: now_ns() };
    NONCES.with(|m| {
        sweep_expired(m, ttl_ns);
        m.borrow_mut().insert(NonceKey(purpose, caller), entry);
    });
    Ok(nonce)
}

fn consume_nonce(
    purpose: u8,
    caller: Principal,
    addr: &EthAddress,
    nonce: &str,
    ttl_ns: u64,
) -> Result<(), String> {
    let key = NonceKey(purpose, caller);
    let mut map = NONCES.with(|m| m.borrow().get(&key)).map(|e| (key.clone(), e));
    let (key, entry) = map.take().ok_or("no outstanding nonce; request one first")?;
    if entry.nonce != nonce {
        return Err("nonce mismatch".into());
    }
    if entry.addr != *addr {
        return Err("nonce was issued for a different wallet address".into());
    }
    if nonce_expired(&entry, ttl_ns) {
        return Err("nonce expired".into());
    }
    NONCES.with(|m| m.borrow_mut().remove(&key));
    Ok(())
}

// --- Prefix range bounds (B1) ------------------------------------------------
// All three composite keys encode their prefix first, so one principal's (or one
// address's) rows are contiguous and these bounds select exactly them.

fn wallets_of(p: Principal) -> std::ops::RangeInclusive<PrincipalAddrKey> {
    PrincipalAddrKey(p, EthAddress([0x00; 20]))..=PrincipalAddrKey(p, EthAddress([0xff; 20]))
}

fn holder_revs_of(p: Principal) -> std::ops::RangeInclusive<PrincipalRevKey> {
    PrincipalRevKey(p, 0)..=PrincipalRevKey(p, u32::MAX)
}

fn wallet_revs_of(a: EthAddress) -> std::ops::RangeInclusive<AddrRevKey> {
    AddrRevKey(a, 0)..=AddrRevKey(a, u32::MAX)
}

// ============================================================================
// --- Identity binding ---
// ============================================================================

#[update]
async fn get_link_nonce(eth_address: String) -> Result<String, String> {
    let caller = caller_or_err()?;
    let addr = parse_addr(&eth_address)?;
    issue_nonce(NONCE_LINK, caller, addr, NONCE_TTL_NS).await
}

#[update]
fn link_wallet(payload: LinkPayload) -> Result<(), String> {
    let caller = caller_or_err()?;
    let addr = parse_addr(&payload.wallet_address)?;
    let addr_lower = addr.to_lower_hex();

    // Verify wallet not already bound to a different principal.
    if let Some(existing) = WALLET_TO_PRINCIPAL.with(|m| m.borrow().get(&addr)) {
        if existing.0 != caller {
            return Err("wallet already linked to a different Internet Identity".into());
        } else {
            return Ok(()); // already linked to caller — idempotent.
        }
    }

    // Enforce the per-principal wallet cap.
    let existing_count: u64 =
        PRINCIPAL_WALLETS.with(|m| m.borrow().range(wallets_of(caller)).count() as u64);
    if existing_count >= MAX_WALLETS_PER_PRINCIPAL {
        return Err(format!(
            "wallet cap reached: at most {MAX_WALLETS_PER_PRINCIPAL} wallets per Internet \
             Identity"
        ));
    }

    // Consume nonce.
    consume_nonce(NONCE_LINK, caller, &addr, &payload.nonce, NONCE_TTL_NS)?;

    // Rebuild canonical link message; recover address from signature.
    let msg = message::build_link_message(
        &addr_lower,
        &caller.to_text(),
        &payload.signed_at_iso,
        &payload.nonce,
    );
    let recovered = verify::recover_eth_address(&msg, &payload.signature)?;
    if recovered != addr.0 {
        return Err(format!(
            "signature recovered to 0x{recovered_hex} but the linked wallet is 0x{claimed_hex}. \
             If you're using a smart-contract wallet (Coinbase Smart Wallet, Safe, Argent, any \
             ERC-4337 account, etc.) the signature recovers to the owner EOA, not the smart \
             account — please reconnect using the EOA wallet that holds your multiBTC, or use \
             MetaMask / Rabby / Trust / Brave / Frame on the same address that holds multiBTC.",
            recovered_hex = hex::encode(recovered),
            claimed_hex = hex::encode(addr.0)
        ));
    }

    // Write both directions atomically.
    WALLET_TO_PRINCIPAL.with(|m| m.borrow_mut().insert(addr, PrincipalVal(caller)));
    PRINCIPAL_WALLETS.with(|m| m.borrow_mut().insert(PrincipalAddrKey(caller, addr), ()));
    Ok(())
}

/// Replaces the old `get_principal_for_wallet`, which returned the bound
/// principal to anonymous callers -- a public wallet-address -> Internet-Identity
/// deanonymization oracle. The link step only ever needed "is this taken?".
#[query]
fn get_wallet_link_status(eth_address: String) -> WalletLinkStatus {
    let addr = match EthAddress::from_hex(&eth_address) {
        Ok(a) => a,
        Err(_) => return WalletLinkStatus::Unlinked,
    };
    match WALLET_TO_PRINCIPAL.with(|m| m.borrow().get(&addr)) {
        None => WalletLinkStatus::Unlinked,
        Some(bound) if bound.0 == caller() => WalletLinkStatus::LinkedToCaller,
        Some(_) => WalletLinkStatus::LinkedToOther,
    }
}

#[query]
fn get_wallets_for_principal() -> Vec<String> {
    let caller = match caller_or_err() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    PRINCIPAL_WALLETS
        .with(|m| m.borrow().range(wallets_of(caller)).map(|(k, _)| k.1.to_lower_hex()).collect())
}

// ============================================================================
// --- Holder layer ---
// ============================================================================

fn validate_holder(p: &HolderPayload) -> Result<(), String> {
    if p.legal_name.trim().is_empty() {
        return Err("legal_name is required".into());
    }
    if p.date_of_birth_iso.len() != 10 {
        return Err("date_of_birth_iso must be YYYY-MM-DD".into());
    }
    if p.nationality.trim().is_empty() {
        return Err("nationality is required".into());
    }
    if p.country_of_residence.trim().is_empty() {
        return Err("country_of_residence is required".into());
    }
    if !p.email.contains('@') || !p.email.contains('.') {
        return Err("email format invalid".into());
    }
    if !(p.consent_group_representation
        && p.consent_data_use_for_legal
        && p.ack_engagement_letter_to_follow
        && p.ack_fee_structure
        && p.ack_group_strategy_coordinated
        && p.ack_site_not_affiliated
        && p.truthfully_attested)
    {
        return Err("all acknowledgments and the truthfulness attestation are required".into());
    }
    Ok(())
}

fn payload_to_holder(payload: HolderPayload, principal: Principal, revision: u32) -> HolderProfile {
    HolderProfile {
        revision,
        principal,
        legal_name: payload.legal_name,
        date_of_birth_iso: payload.date_of_birth_iso,
        nationality: payload.nationality,
        country_of_residence: payload.country_of_residence,
        email: payload.email,
        telegram_handle: payload.telegram_handle,
        preferred_comm_channel: payload.preferred_comm_channel,
        has_filed_pod: payload.has_filed_pod,
        pod_filed_date_iso: payload.pod_filed_date_iso,
        pod_reference: payload.pod_reference,
        needs_help_filing_pod: payload.needs_help_filing_pod,
        consent_group_representation: payload.consent_group_representation,
        consent_data_use_for_legal: payload.consent_data_use_for_legal,
        ack_engagement_letter_to_follow: payload.ack_engagement_letter_to_follow,
        ack_fee_structure: payload.ack_fee_structure,
        ack_group_strategy_coordinated: payload.ack_group_strategy_coordinated,
        ack_site_not_affiliated: payload.ack_site_not_affiliated,
        truthfully_attested: payload.truthfully_attested,
        fee_preference: payload.fee_preference,
        preferred_payment_method: payload.preferred_payment_method,
        naming_preference: payload.naming_preference,
        other_multichain_claims: payload.other_multichain_claims,
        additional_documentation_notes: payload.additional_documentation_notes,
        submitted_at_ns: now_ns(),
    }
}

#[update]
fn submit_holder(payload: HolderPayload) -> Result<HolderProfile, String> {
    let caller = caller_or_err()?;
    validate_holder(&payload)?;
    if HOLDER_LATEST.with(|m| m.borrow().contains_key(&PrincipalVal(caller))) {
        return Err("holder profile already exists; use update_holder".into());
    }
    let h = payload_to_holder(payload, caller, 0);
    HOLDER_REVISIONS.with(|m| m.borrow_mut().insert(PrincipalRevKey(caller, 0), h.clone()));
    HOLDER_LATEST.with(|m| m.borrow_mut().insert(PrincipalVal(caller), 0));
    Ok(h)
}

#[update]
fn update_holder(payload: HolderPayload) -> Result<HolderProfile, String> {
    let caller = caller_or_err()?;
    validate_holder(&payload)?;
    let prev = HOLDER_LATEST
        .with(|m| m.borrow().get(&PrincipalVal(caller)))
        .ok_or("no holder profile yet; call submit_holder")?;
    if prev >= MAX_EDITS {
        return Err(format!(
            "edit cap reached: you have already saved {MAX_EDITS} revisions for your holder \
             profile"
        ));
    }
    let next = prev + 1;
    let h = payload_to_holder(payload, caller, next);
    HOLDER_REVISIONS.with(|m| m.borrow_mut().insert(PrincipalRevKey(caller, next), h.clone()));
    HOLDER_LATEST.with(|m| m.borrow_mut().insert(PrincipalVal(caller), next));
    Ok(h)
}

#[query]
fn get_my_holder() -> Option<HolderProfile> {
    let caller = caller_or_err().ok()?;
    let latest = HOLDER_LATEST.with(|m| m.borrow().get(&PrincipalVal(caller)))?;
    HOLDER_REVISIONS.with(|m| m.borrow().get(&PrincipalRevKey(caller, latest)))
}

#[query]
fn get_holder_revisions() -> Vec<HolderProfile> {
    let caller = match caller_or_err() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    HOLDER_REVISIONS
        .with(|m| m.borrow().range(holder_revs_of(caller)).map(|(_, v)| v).collect())
}

// ============================================================================
// --- Wallet attestation layer ---
// ============================================================================

#[update]
async fn get_attest_nonce(eth_address: String) -> Result<String, String> {
    let caller = caller_or_err()?;
    let addr = parse_addr(&eth_address)?;
    issue_nonce(NONCE_ATTEST, caller, addr, NONCE_TTL_NS).await
}

fn ensure_acknowledged(holder: &HolderProfile) -> Result<(), String> {
    if !(holder.consent_group_representation
        && holder.consent_data_use_for_legal
        && holder.ack_engagement_letter_to_follow
        && holder.ack_fee_structure
        && holder.ack_group_strategy_coordinated
        && holder.ack_site_not_affiliated
        && holder.truthfully_attested)
    {
        return Err("holder profile must have all acknowledgments true".into());
    }
    Ok(())
}

fn validate_attest(payload: &AttestPayload) -> Result<(), String> {
    if payload.acquired_post_incident && payload.post_incident_acquisitions.is_empty() {
        return Err(
            "acquired_post_incident is true but post_incident_acquisitions is empty".into(),
        );
    }
    if payload.attempted_bridge_redemption && payload.bridge_attempts.is_empty() {
        return Err("attempted_bridge_redemption is true but bridge_attempts is empty".into());
    }
    if payload.positions.is_empty() {
        return Err("at least one position is required".into());
    }
    if payload.support_tx_hashes.len() > 10 {
        return Err(format!(
            "at most 10 supporting tx hashes per wallet (got {})",
            payload.support_tx_hashes.len()
        ));
    }
    for (i, h) in payload.support_tx_hashes.iter().enumerate() {
        if h.trim().is_empty() {
            return Err(format!("supporting tx hash {i} is empty"));
        }
    }
    for (i, p) in payload.positions.iter().enumerate() {
        match &p.kind {
            PositionType::RawToken => {}
            PositionType::Lp { protocol, pool } => {
                if protocol.trim().is_empty() || pool.trim().is_empty() {
                    return Err(format!(
                        "position {i}: LP positions require both protocol and pool to be filled"
                    ));
                }
            }
            PositionType::Vault { protocol, name } => {
                if protocol.trim().is_empty() || name.trim().is_empty() {
                    return Err(format!(
                        "position {i}: vault positions require both protocol and vault name"
                    ));
                }
            }
            PositionType::Other(text) => {
                if text.trim().is_empty() {
                    return Err(format!(
                        "position {i}: 'Other' positions require a non-empty description (where \
                         the multiBTC is — lending, vault, custodian, etc.)"
                    ));
                }
            }
        }
    }
    Ok(())
}

fn build_attestation(
    payload: AttestPayload,
    principal: Principal,
    revision: u32,
    holder_revision: u32,
    signed_message: String,
) -> WalletAttestation {
    WalletAttestation {
        revision,
        holder_revision,
        wallet_address: payload.wallet_address.to_lowercase(),
        linked_principal: principal,
        detected_eth: payload.detected_eth,
        detected_bsc: payload.detected_bsc,
        detected_polygon: payload.detected_polygon,
        detected_canto: payload.detected_canto,
        positions: payload.positions,
        approximate_total_claim: payload.approximate_total_claim,
        held_pre_incident: payload.held_pre_incident,
        acquired_post_incident: payload.acquired_post_incident,
        post_incident_acquisitions: payload.post_incident_acquisitions,
        attempted_bridge_redemption: payload.attempted_bridge_redemption,
        bridge_attempts: payload.bridge_attempts,
        pod_filed_for_this_wallet: payload.pod_filed_for_this_wallet,
        pod_reference_for_this_wallet: payload.pod_reference_for_this_wallet,
        support_tx_hashes: payload.support_tx_hashes,
        signed_message,
        signature: payload.signature,
        nonce: payload.nonce,
        signed_at_iso: payload.signed_at_iso,
        data_commitment_sha256: payload.data_commitment_sha256,
        submitted_at_ns: now_ns(),
    }
}

fn submit_or_update(
    payload: AttestPayload,
    require_existing: bool,
) -> Result<WalletAttestation, String> {
    let caller = caller_or_err()?;
    let addr = parse_addr(&payload.wallet_address)?;
    let addr_lower = addr.to_lower_hex();

    // Principal must be linked to this wallet.
    let bound = WALLET_TO_PRINCIPAL
        .with(|m| m.borrow().get(&addr))
        .ok_or("wallet not linked: call link_wallet first")?;
    if bound.0 != caller {
        return Err("wallet linked to a different principal".into());
    }

    // Holder profile must exist with all acks.
    let holder_rev = HOLDER_LATEST
        .with(|m| m.borrow().get(&PrincipalVal(caller)))
        .ok_or("save your holder profile first")?;
    let holder = HOLDER_REVISIONS
        .with(|m| m.borrow().get(&PrincipalRevKey(caller, holder_rev)))
        .ok_or("holder profile missing")?;
    ensure_acknowledged(&holder)?;

    validate_attest(&payload)?;

    // Revision selection.
    let prev = WALLET_LATEST.with(|m| m.borrow().get(&addr));
    let revision = match (prev, require_existing) {
        (None, true) => return Err("no prior attestation; use submit_wallet_attestation".into()),
        (Some(_), false) => return Err("attestation exists; use update_wallet_attestation".into()),
        (None, false) => 0u32,
        (Some(r), true) => {
            if r >= MAX_EDITS {
                return Err(format!(
                    "edit cap reached: {MAX_EDITS} revisions already saved for this wallet"
                ));
            }
            r + 1
        }
    };

    // Bind the holder profile that is in force right now. `holder` was already
    // fetched above for the acknowledgment check.
    let holder_commit = commitment::commit_holder(&holder);

    // Recompute data_commitment_sha256 and compare to payload.
    let expected_commit =
        commitment::commit_attest(&payload, &caller, revision, holder_rev, &holder_commit);
    if expected_commit != payload.data_commitment_sha256.trim_start_matches("0x") {
        return Err("data commitment mismatch (payload was tampered with after signing)".into());
    }

    // Consume nonce.
    consume_nonce(NONCE_ATTEST, caller, &addr, &payload.nonce, NONCE_TTL_NS)?;

    // Rebuild canonical attestation message and recover signer.
    let msg = message::build_attestation_message(
        &addr_lower,
        &caller.to_text(),
        revision,
        &holder.legal_name,
        &holder.date_of_birth_iso,
        holder_rev,
        &holder_commit,
        &expected_commit,
        &payload.signed_at_iso,
        &payload.nonce,
    );
    let recovered = verify::recover_eth_address(&msg, &payload.signature)?;
    if recovered != addr.0 {
        return Err(format!(
            "signature recovered to 0x{recovered_hex} but the wallet under attestation is \
             0x{claimed_hex}.\n\nDiagnostic — backend reconstructed message ({msg_len} bytes), \
             caller principal {caller_text}:\n---8<---\n{msg}\n---8<---\n\nIf your wallet \
             showed exactly that text and is an EOA, please report this. If you're using a \
             smart-contract wallet (Coinbase Smart Wallet, Safe, Argent, ERC-4337) the \
             signature recovers to the owner EOA — connect the EOA directly instead.",
            recovered_hex = hex::encode(recovered),
            claimed_hex = hex::encode(addr.0),
            msg_len = msg.len(),
            caller_text = caller.to_text(),
            msg = msg,
        ));
    }

    let stored = build_attestation(payload, caller, revision, holder_rev, msg);
    WALLET_REVISIONS.with(|m| {
        m.borrow_mut().insert(AddrRevKey(addr, revision), stored.clone())
    });
    WALLET_LATEST.with(|m| m.borrow_mut().insert(addr, revision));
    Ok(stored)
}

#[update]
fn submit_wallet_attestation(payload: AttestPayload) -> Result<WalletAttestation, String> {
    submit_or_update(payload, false)
}

#[update]
fn update_wallet_attestation(payload: AttestPayload) -> Result<WalletAttestation, String> {
    submit_or_update(payload, true)
}

#[query]
fn get_my_wallets() -> Vec<WalletAttestation> {
    let caller = match caller_or_err() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let addrs: Vec<EthAddress> =
        PRINCIPAL_WALLETS.with(|m| m.borrow().range(wallets_of(caller)).map(|(k, _)| k.1).collect());
    let mut out = Vec::with_capacity(addrs.len());
    for a in addrs {
        if let Some(rev) = WALLET_LATEST.with(|m| m.borrow().get(&a)) {
            if let Some(att) = WALLET_REVISIONS.with(|m| m.borrow().get(&AddrRevKey(a, rev))) {
                out.push(att);
            }
        }
    }
    out
}

/// Only the principal this wallet is linked to may read its history. This used to
/// be unauthenticated: since multiBTC holder addresses are public on-chain, anyone
/// could walk the token holder list and dump every claimant's record.
#[query]
fn get_wallet_revisions(eth_address: String) -> Result<Vec<WalletAttestation>, String> {
    let caller = caller_or_err()?;
    let addr = parse_addr(&eth_address)?;
    let bound = WALLET_TO_PRINCIPAL
        .with(|m| m.borrow().get(&addr))
        .ok_or("wallet not linked")?;
    if bound.0 != caller {
        return Err("this wallet is linked to a different Internet Identity".into());
    }
    Ok(WALLET_REVISIONS.with(|m| m.borrow().range(wallet_revs_of(addr)).map(|(_, v)| v).collect()))
}

// ============================================================================
// --- Public ---
// ============================================================================

/// Walks the two `*_LATEST` maps (one row per holder / per wallet) instead of
/// every revision ever written. Still O(n) per call on a page that
/// every visitor loads -- cache it in a StableCell invalidated by the four write
/// paths if the registry ever gets big.
/// Public, because no person controls this canister: anyone must be able to
/// see when it needs topping up. At zero cycles a canister's memory is wiped.
#[query]
fn cycles_balance() -> u128 {
    ic_cdk::api::canister_balance128()
}

#[query]
fn get_public_stats() -> PublicStats {
    let mut s = PublicStats::default();
    let latest_holders: Vec<HolderProfile> = HOLDER_LATEST.with(|m| {
        let m = m.borrow();
        s.total_holders = m.len();
        m.iter()
            .filter_map(|(p, rev)| {
                HOLDER_REVISIONS.with(|hr| hr.borrow().get(&PrincipalRevKey(p.0, rev)))
            })
            .collect()
    });
    for h in latest_holders {
        if h.has_filed_pod {
            s.pod_filed_holders += 1;
        }
    }
    let latest_wallets: Vec<WalletAttestation> = WALLET_LATEST.with(|m| {
        let m = m.borrow();
        s.total_wallets = m.len();
        m.iter()
            .filter_map(|(a, rev)| WALLET_REVISIONS.with(|wr| wr.borrow().get(&AddrRevKey(a, rev))))
            .collect()
    });
    {
        for v in &latest_wallets {
            s.total_detected_eth = s.total_detected_eth.saturating_add(v.detected_eth);
            s.total_detected_bsc = s.total_detected_bsc.saturating_add(v.detected_bsc);
            s.total_detected_polygon =
                s.total_detected_polygon.saturating_add(v.detected_polygon);
            s.total_detected_canto = s.total_detected_canto.saturating_add(v.detected_canto);
            let claim = v.approximate_total_claim.unwrap_or_else(|| {
                v.detected_eth
                    .saturating_add(v.detected_bsc)
                    .saturating_add(v.detected_polygon)
                    .saturating_add(v.detected_canto)
            });
            s.total_declared_claim = s.total_declared_claim.saturating_add(claim);
            if v.held_pre_incident {
                s.pre_incident_wallets += 1;
            }
            if v.acquired_post_incident {
                s.post_incident_wallets += 1;
            }
            if v.submitted_at_ns > s.last_submission_at_ns {
                s.last_submission_at_ns = v.submitted_at_ns;
            }
        }
    }
    s
}

// ============================================================================
// --- Admin ---
// ============================================================================

#[update]
async fn get_admin_nonce() -> Result<String, String> {
    // Only the bound admin principal may request the nonce — this also gates the
    // II side of the dual-factor admin auth.
    let caller = caller_or_err()?;
    if let Some(p) = current_admin_principal() {
        if p != caller {
            return Err(
                "admin principal mismatch: sign in with the II linked to the admin".into(),
            );
        }
    } else {
        return Err(
            "admin principal not configured yet — a canister controller must call \
             set_admin_principal first"
                .into(),
        );
    }
    issue_nonce(NONCE_ADMIN, caller, current_admin_eth(), ADMIN_NONCE_TTL_NS).await
}

fn verify_admin_auth(auth: &AdminAuth) -> Result<(), String> {
    let caller = caller_or_err()?;
    let bound_principal = current_admin_principal()
        .ok_or("admin principal not configured")?;
    if caller != bound_principal {
        return Err("admin principal mismatch".into());
    }
    let admin = current_admin_eth();
    // Consumes the nonce. This only actually sticks because every caller of this
    // helper is an #[update]; as #[query]s the removal was rolled back and the
    // same (nonce, signature) pair stayed replayable for the whole TTL.
    consume_nonce(NONCE_ADMIN, caller, &admin, &auth.nonce, ADMIN_NONCE_TTL_NS)?;
    let msg = message::build_admin_message(&auth.signed_at_iso, &auth.nonce);
    let recovered = verify::recover_eth_address(&msg, &auth.signature)?;
    if recovered != admin.0 {
        return Err(format!(
            "admin signature recovered to 0x{recovered_hex}, not the configured admin EVM \
             wallet 0x{admin_hex}. Smart-contract wallets are not supported here — sign with \
             the EOA configured as the admin.",
            recovered_hex = hex::encode(recovered),
            admin_hex = hex::encode(admin.0)
        ));
    }
    Ok(())
}

// --- Admin config (controller-only) ---

#[query]
fn get_admin_info() -> AdminInfo {
    AdminInfo {
        eth_address: current_admin_eth().to_lower_hex(),
        principal: current_admin_principal(),
        max_edits: MAX_EDITS,
        max_wallets_per_principal: MAX_WALLETS_PER_PRINCIPAL,
    }
}

#[query]
fn am_i_controller() -> bool {
    is_controller(&caller())
}

#[update]
fn set_admin_eth_address(eth_address: String) -> Result<(), String> {
    require_controller()?;
    let addr = EthAddress::from_hex(&eth_address)?;
    ADMIN_ETH.with(|m| m.borrow_mut().insert(ADMIN_KEY, addr));
    Ok(())
}

#[update]
fn set_admin_principal(principal: Option<Principal>) -> Result<(), String> {
    require_controller()?;
    match principal {
        Some(p) => {
            if p == Principal::anonymous() {
                return Err("admin principal cannot be anonymous".into());
            }
            ADMIN_PRINCIPAL.with(|m| m.borrow_mut().insert(ADMIN_KEY, PrincipalVal(p)));
        }
        None => {
            ADMIN_PRINCIPAL.with(|m| m.borrow_mut().remove(&ADMIN_KEY));
        }
    }
    Ok(())
}

// There is no admin bulk read, export or wipe of holder data. admin_export_csv,
// admin_list_holders, admin_list_holders_full and admin_reset_data were removed.
// The only bulk read is governed_read_all, open solely to a principal named in a
// GrantDataAccess proposal that holders passed, for a limited time, with every
// read logged. Build from source and compare the module hash to confirm. Each
// holder can also read their own records through the caller-scoped get_my_* and
// get_*_revisions endpoints.

/// Re-derive everything a stored attestation's signature covers and check it
/// still verifies. Same steps as `submit_or_update`, minus the state changes, so
/// a record that verified on write and fails here points at storage corruption
/// or a bad upgrade. Error strings must never include the rebuilt message: it
/// contains the holder's name and date of birth.
fn reverify_attestation(w: &WalletAttestation, holder: &HolderProfile) -> Result<(), String> {
    if holder.revision != w.holder_revision || holder.principal != w.linked_principal {
        return Err("holder profile does not match the revision this signature covers".into());
    }
    let addr = parse_addr(&w.wallet_address)?;
    let payload = AttestPayload {
        wallet_address: w.wallet_address.clone(),
        detected_eth: w.detected_eth,
        detected_bsc: w.detected_bsc,
        detected_polygon: w.detected_polygon,
        detected_canto: w.detected_canto,
        positions: w.positions.clone(),
        approximate_total_claim: w.approximate_total_claim,
        held_pre_incident: w.held_pre_incident,
        acquired_post_incident: w.acquired_post_incident,
        post_incident_acquisitions: w.post_incident_acquisitions.clone(),
        attempted_bridge_redemption: w.attempted_bridge_redemption,
        bridge_attempts: w.bridge_attempts.clone(),
        pod_filed_for_this_wallet: w.pod_filed_for_this_wallet,
        pod_reference_for_this_wallet: w.pod_reference_for_this_wallet.clone(),
        support_tx_hashes: w.support_tx_hashes.clone(),
        signature: w.signature.clone(),
        nonce: w.nonce.clone(),
        signed_at_iso: w.signed_at_iso.clone(),
        data_commitment_sha256: w.data_commitment_sha256.clone(),
    };
    let holder_commit = commitment::commit_holder(holder);
    let expected_commit = commitment::commit_attest(
        &payload,
        &w.linked_principal,
        w.revision,
        w.holder_revision,
        &holder_commit,
    );
    if expected_commit != w.data_commitment_sha256.trim_start_matches("0x") {
        return Err("stored data no longer matches its signed commitment".into());
    }
    let msg = message::build_attestation_message(
        &addr.to_lower_hex(),
        &w.linked_principal.to_text(),
        w.revision,
        &holder.legal_name,
        &holder.date_of_birth_iso,
        w.holder_revision,
        &holder_commit,
        &expected_commit,
        &w.signed_at_iso,
        &w.nonce,
    );
    if msg != w.signed_message {
        return Err("rebuilt message differs from the stored signed message".into());
    }
    let recovered = verify::recover_eth_address(&msg, &w.signature)?;
    if recovered != addr.0 {
        return Err(format!(
            "signature recovers to 0x{}, not to this wallet",
            hex::encode(recovered)
        ));
    }
    Ok(())
}

/// The admin's whole view of the registry: who to contact, and whether their
/// evidence still holds up. No legal name, date of birth, nationality, email or
/// declared amount leaves the canister through here. An update, not a query,
/// because `verify_admin_auth` consumes the admin nonce.
#[update]
fn admin_overview(auth: AdminAuth) -> Result<Vec<HolderOverview>, String> {
    verify_admin_auth(&auth)?;
    Ok(build_overview())
}

/// The balance a claimant's browser reported for `chain` when signing.
fn detected_on(w: &WalletAttestation, chain: &str) -> Option<u128> {
    match chain {
        "ethereum" => Some(w.detected_eth),
        "bsc" => Some(w.detected_bsc),
        "polygon" => Some(w.detected_polygon),
        "canto" => Some(w.detected_canto),
        _ => None,
    }
}

fn chain_verdicts(w: &WalletAttestation, addr: &EthAddress) -> Vec<ChainVerdict> {
    let Some(record) = ONCHAIN.with(|m| m.borrow().get(addr)) else {
        return vec![];
    };
    onchain::CHAINS
        .iter()
        .map(|c| {
            let find = |snap: Snapshot| {
                record.observations.iter().find(|o| o.chain == c.key && o.snapshot == snap).cloned()
            };
            let current = find(Snapshot::Current);
            let detected_matches_current = match (&current, detected_on(w, c.key)) {
                (Some(ChainObservation { balance: Some(b), .. }), Some(d)) => Some(*b == d),
                _ => None,
            };
            ChainVerdict {
                chain: c.key.to_string(),
                pre_incident: find(Snapshot::PreIncident),
                current,
                detected_matches_current,
            }
        })
        .collect()
}

fn build_overview() -> Vec<HolderOverview> {
    let holders: Vec<(Principal, u32)> =
        HOLDER_LATEST.with(|m| m.borrow().iter().map(|(p, rev)| (p.0, rev)).collect());

    let mut out = Vec::with_capacity(holders.len());
    for (p, latest) in holders {
        let Some(profile) =
            HOLDER_REVISIONS.with(|m| m.borrow().get(&PrincipalRevKey(p, latest)))
        else {
            continue;
        };
        let addrs: Vec<EthAddress> = PRINCIPAL_WALLETS
            .with(|m| m.borrow().range(wallets_of(p)).map(|(k, _)| k.1).collect());

        let mut wallets = Vec::new();
        let mut unattested_wallets = Vec::new();
        for a in addrs {
            let Some(rev) = WALLET_LATEST.with(|m| m.borrow().get(&a)) else {
                unattested_wallets.push(a.to_lower_hex());
                continue;
            };
            let Some(w) = WALLET_REVISIONS.with(|m| m.borrow().get(&AddrRevKey(a, rev))) else {
                unattested_wallets.push(a.to_lower_hex());
                continue;
            };
            let check = match HOLDER_REVISIONS
                .with(|m| m.borrow().get(&PrincipalRevKey(p, w.holder_revision)))
            {
                Some(signed_holder) => reverify_attestation(&w, &signed_holder),
                None => Err("the holder profile revision this signature covers is missing".into()),
            };
            wallets.push(WalletVerdict {
                wallet_address: w.wallet_address.clone(),
                revision: w.revision,
                holder_revision: w.holder_revision,
                signature_valid: check.is_ok(),
                signature_error: check.err(),
                profile_current: w.holder_revision == latest,
                onchain: chain_verdicts(&w, &a),
            });
        }

        out.push(HolderOverview {
            principal: p,
            telegram_handle: profile.telegram_handle,
            holder_revision: latest,
            wallets,
            unattested_wallets,
        });
    }
    out
}

/// How long a verification run may hold the lock before it is presumed dead.
const VERIFY_STALE_NS: u64 = 15 * 60 * 1_000_000_000;

fn observation(
    chain: &onchain::Chain,
    snapshot: Snapshot,
    block: Option<u64>,
    read: Result<(u128, String), String>,
) -> ChainObservation {
    let (balance, provider, error) = match read {
        Ok((b, p)) => (Some(b), Some(p), None),
        Err(e) => (None, None, Some(e)),
    };
    ChainObservation {
        chain: chain.key.to_string(),
        snapshot,
        block,
        balance,
        error,
        provider,
        observed_at_ns: now_ns(),
        replicated: Some(false),
    }
}

/// Have the canister read every attested wallet's multiBTC balance itself, at
/// the pre-incident block and at a current block, and store what it saw. Then
/// return the overview, now including those readings.
///
/// Admin-only: the canister pays for the outcalls, so a public trigger would be
/// a way to drain its cycles. Kept out of `submit_or_update` deliberately -- an
/// await there would open a re-entrancy window between consuming the nonce and
/// writing the record, and submitting would depend on outcalls succeeding.
///
/// Ceiling: wallets are read sequentially, ~2 s per outcall and 6
/// per wallet, so a run takes about a minute per five wallets. Switch to
/// spawned background batches once the registry outgrows a single call.
#[update]
async fn admin_verify_onchain(auth: AdminAuth) -> Result<Vec<HolderOverview>, String> {
    verify_admin_auth(&auth)?;
    let now = now_ns();
    let busy = VERIFY_RUNNING
        .with(|r| matches!(*r.borrow(), Some(t) if now.saturating_sub(t) < VERIFY_STALE_NS));
    if busy {
        return Err("an on-chain verification is already running".into());
    }
    VERIFY_RUNNING.with(|r| *r.borrow_mut() = Some(now));

    let wallets: Vec<EthAddress> = WALLET_LATEST.with(|m| m.borrow().iter().map(|(a, _)| a).collect());

    // One current block per chain for the whole run, so every wallet is read
    // at the same height.
    let mut current = Vec::with_capacity(onchain::CHAINS.len());
    for chain in onchain::CHAINS {
        current.push(if chain.providers.is_empty() {
            Err("no reachable provider for this chain".to_string())
        } else {
            onchain::current_block(chain).await
        });
    }

    for addr in wallets {
        let mut observations = Vec::new();
        for (chain, cur) in onchain::CHAINS.iter().zip(&current) {
            observations.push(match chain.pre_incident_block {
                None => observation(chain, Snapshot::PreIncident, None,
                    Err("no reachable provider for this chain".into())),
                Some(block) => {
                    let read = onchain::balance_at(chain, &addr, block).await;
                    observation(chain, Snapshot::PreIncident, Some(block), read)
                }
            });
            observations.push(match cur {
                Err(e) => observation(chain, Snapshot::Current, None, Err(e.clone())),
                Ok((block, _)) => {
                    let read = onchain::balance_at(chain, &addr, *block).await;
                    observation(chain, Snapshot::Current, Some(*block), read)
                }
            });
        }
        ONCHAIN.with(|m| m.borrow_mut().insert(addr, OnchainRecord { observations }));
    }

    VERIFY_RUNNING.with(|r| *r.borrow_mut() = None);
    Ok(build_overview())
}

/// Transform for the outcalls in `onchain`. Must be exported for the IC to call
/// it; it is a pure function of its input and reveals nothing.
#[query]
fn transform_rpc(args: ic_cdk::api::management_canister::http_request::TransformArgs)
    -> ic_cdk::api::management_canister::http_request::HttpResponse {
    onchain::canonicalise(args)
}

// ============================================================================
// --- Governance ---
// ============================================================================
// Rule and rationale: governance.rs. Controllers are untouched by any of this
// except AddController, which can only add.

fn holder_wallets(p: Principal) -> Vec<EthAddress> {
    PRINCIPAL_WALLETS.with(|m| m.borrow().range(wallets_of(p)).map(|(k, _)| k.1).collect())
}

/// Eligible to vote: a holder with at least one wallet attestation (each passed
/// signature verification when written) who meets `governance::may_vote`.
fn is_eligible(p: Principal, now: u64) -> bool {
    if !HOLDER_LATEST.with(|m| m.borrow().contains_key(&PrincipalVal(p))) {
        return false;
    }
    let first_signed_at = holder_wallets(p)
        .iter()
        .filter_map(|a| WALLET_REVISIONS.with(|m| m.borrow().get(&AddrRevKey(*a, 0))))
        .map(|w| w.submitted_at_ns)
        .min();
    first_signed_at.is_some_and(|t| governance::may_vote(now, t, verified_current_balance(p)))
}

fn eligible_voters(now: u64) -> Vec<Principal> {
    let holders: Vec<Principal> =
        HOLDER_LATEST.with(|m| m.borrow().iter().map(|(p, _)| p.0).collect());
    holders.into_iter().filter(|p| is_eligible(*p, now)).collect()
}

/// The canister's own latest *current* readings across a holder's wallets.
/// Used only to break tied votes; wallets never verified count as zero.
fn verified_current_balance(p: Principal) -> u128 {
    holder_wallets(p)
        .iter()
        .filter_map(|a| ONCHAIN.with(|m| m.borrow().get(a)))
        .flat_map(|r| r.observations)
        .filter(|o| o.snapshot == Snapshot::Current)
        .filter_map(|o| o.balance)
        .fold(0u128, |acc, b| acc.saturating_add(b))
}

/// Resolve `p` if it is due. Returns whether it changed.
fn finalize_if_due(p: &mut Proposal, now: u64) -> bool {
    if p.outcome.is_some() {
        return false;
    }
    let eligible = eligible_voters(now);
    let voted = p.ballots.iter().filter(|b| eligible.contains(&b.voter)).count();
    let Some(resolved_at) =
        governance::resolution_time(now, p.deadline_ns, voted, eligible.len())
    else {
        return false;
    };
    let side = |c: VoteChoice| -> Vec<Principal> {
        p.ballots.iter().filter(|b| b.choice == c).map(|b| b.voter).collect()
    };
    let (yes_voters, no_voters) = (side(VoteChoice::Yes), side(VoteChoice::No));
    let (yes, no) = (yes_voters.len() as u32, no_voters.len() as u32);
    let tied = yes == no;
    let sum = |v: &[Principal]| {
        v.iter().map(|x| verified_current_balance(*x)).fold(0u128, |a, b| a.saturating_add(b))
    };
    let (yes_balance, no_balance) = if tied { (sum(&yes_voters), sum(&no_voters)) } else { (0, 0) };
    let (passed, reason) = governance::decide(yes, no, yes_balance, no_balance);
    p.outcome = Some(Outcome {
        passed,
        reason: reason.to_string(),
        resolved_at_ns: resolved_at,
        yes,
        no,
        eligible: eligible.len() as u32,
        tiebreak_yes_balance: tied.then_some(yes_balance),
        tiebreak_no_balance: tied.then_some(no_balance),
        executed_at_ns: None,
        execution_error: None,
        execution_started_at_ns: None,
    });
    true
}

fn proposal_view(p: &Proposal, caller: Principal, now: u64, eligible_now: u32) -> ProposalView {
    let count = |c: VoteChoice| p.ballots.iter().filter(|b| b.choice == c).count() as u32;
    let access_expires_at_ns = match (&p.kind, &p.outcome) {
        (ProposalKind::GrantDataAccess { duration_days, .. }, Some(o)) if o.passed => {
            Some(o.resolved_at_ns.saturating_add(*duration_days as u64 * governance::DAY_NS))
        }
        _ => None,
    };
    ProposalView {
        id: p.id,
        proposer: p.proposer,
        title: p.title.clone(),
        description: p.description.clone(),
        kind: p.kind.clone(),
        created_at_ns: p.created_at_ns,
        deadline_ns: p.deadline_ns,
        yes: count(VoteChoice::Yes),
        no: count(VoteChoice::No),
        eligible_now,
        awaiting_finalisation: p.outcome.is_none() && now >= p.deadline_ns,
        outcome: p.outcome.clone(),
        access_expires_at_ns,
        reads_at_ns: p.reads_at_ns.clone(),
        my_vote: p.ballots.iter().find(|b| b.voter == caller).map(|b| b.choice),
    }
}

fn is_grantee_anywhere(p: Principal) -> bool {
    PROPOSALS.with(|m| {
        m.borrow().iter().any(|(_, x)| {
            matches!(x.kind, ProposalKind::GrantDataAccess { grantee, .. } if grantee == p)
        })
    })
}

/// Holders, controllers and the admin see every proposal.
fn sees_all_proposals(caller: Principal) -> bool {
    HOLDER_LATEST.with(|m| m.borrow().contains_key(&PrincipalVal(caller)))
        || is_controller(&caller)
        || current_admin_principal() == Some(caller)
}

/// Proposals are for holders, not the public. A grantee sees only the
/// proposals that name them.
fn require_governance_viewer(caller: Principal) -> Result<(), String> {
    if sees_all_proposals(caller) || is_grantee_anywhere(caller) {
        Ok(())
    } else {
        Err("governance is visible to registered holders only".into())
    }
}

fn store_new_proposal(proposer: Principal, title: String, description: String, kind: ProposalKind)
    -> Result<u64, String> {
    let title = title.trim().to_string();
    if title.is_empty() || title.chars().count() > governance::MAX_TITLE_CHARS {
        return Err(format!("title must be 1-{} characters", governance::MAX_TITLE_CHARS));
    }
    if description.chars().count() > governance::MAX_DESCRIPTION_CHARS {
        return Err(format!("description is limited to {} characters", governance::MAX_DESCRIPTION_CHARS));
    }
    let now = now_ns();
    let open = PROPOSALS.with(|m| {
        m.borrow()
            .iter()
            .filter(|(_, p)| p.proposer == proposer && p.outcome.is_none() && now < p.deadline_ns)
            .count()
    });
    if open >= governance::MAX_OPEN_PER_PROPOSER {
        return Err(format!(
            "at most {} open proposals per holder", governance::MAX_OPEN_PER_PROPOSER
        ));
    }
    let id = PROPOSALS.with(|m| m.borrow().last_key_value().map(|(k, _)| k + 1).unwrap_or(1));
    PROPOSALS.with(|m| {
        m.borrow_mut().insert(id, Proposal {
            id,
            proposer,
            title,
            description,
            kind,
            created_at_ns: now,
            deadline_ns: now.saturating_add(governance::VOTING_PERIOD_NS),
            ballots: vec![],
            outcome: None,
            reads_at_ns: vec![],
        })
    });
    Ok(id)
}

const NOT_ELIGIBLE: &str = "only eligible holders may propose or vote: a signed wallet from \
    before 2026-10-01, or a first signed wallet at least 14 days old with at least 0.02 \
    multiBTC verified on-chain by the canister";

/// Any eligible holder may propose a decision or a time-limited data-access
/// grant. Adding a controller goes through `admin_propose_add_controller`.
#[update]
fn create_proposal(args: CreateProposal) -> Result<u64, String> {
    let caller = caller_or_err()?;
    if !is_eligible(caller, now_ns()) {
        return Err(NOT_ELIGIBLE.into());
    }
    match &args.kind {
        ProposalKind::Decision => {}
        ProposalKind::GrantDataAccess { grantee, duration_days } => {
            if *grantee == Principal::anonymous() {
                return Err("the grantee cannot be the anonymous principal".into());
            }
            if *duration_days == 0 || *duration_days > governance::MAX_ACCESS_DAYS {
                return Err(format!("access must last 1-{} days", governance::MAX_ACCESS_DAYS));
            }
        }
        ProposalKind::AddController { .. } => {
            return Err("only the admin can propose adding a controller".into());
        }
    }
    store_new_proposal(caller, args.title, args.description, args.kind)
}

/// Admin only, two-factor: propose that holders approve adding a controller.
#[update]
fn admin_propose_add_controller(
    auth: AdminAuth,
    title: String,
    description: String,
    controller: Principal,
) -> Result<u64, String> {
    verify_admin_auth(&auth)?;
    if controller == Principal::anonymous() {
        return Err("the anonymous principal cannot be a controller".into());
    }
    store_new_proposal(caller(), title, description, ProposalKind::AddController { controller })
}

/// Cast or change a vote. Resolves the proposal at once if every eligible
/// holder has now voted, and carries out its effect if it passed.
#[update]
async fn vote(proposal_id: u64, choice: VoteChoice) -> Result<ProposalView, String> {
    let caller = caller_or_err()?;
    let now = now_ns();
    if !is_eligible(caller, now) {
        return Err(NOT_ELIGIBLE.into());
    }
    let mut p = PROPOSALS
        .with(|m| m.borrow().get(&proposal_id))
        .ok_or("no such proposal")?;
    if finalize_if_due(&mut p, now) || p.outcome.is_some() {
        PROPOSALS.with(|m| m.borrow_mut().insert(proposal_id, p));
        return Err("voting on this proposal has closed".into());
    }
    match p.ballots.iter_mut().find(|b| b.voter == caller) {
        Some(b) => {
            b.choice = choice;
            b.cast_at_ns = now;
        }
        None => p.ballots.push(Ballot { voter: caller, choice, cast_at_ns: now }),
    }
    finalize_if_due(&mut p, now);
    PROPOSALS.with(|m| m.borrow_mut().insert(proposal_id, p));
    execute_if_passed(proposal_id).await;
    Ok(current_view(proposal_id, caller))
}

/// Resolve a proposal whose voting period has ended, and carry out its effect
/// if it passed. Anyone who can see governance may trigger it; the result does
/// not depend on who or when (the deadline is the resolution time).
#[update]
async fn finalize_proposal(proposal_id: u64) -> Result<ProposalView, String> {
    let caller = caller_or_err()?;
    require_governance_viewer(caller)?;
    let mut p = PROPOSALS
        .with(|m| m.borrow().get(&proposal_id))
        .ok_or("no such proposal")?;
    if finalize_if_due(&mut p, now_ns()) {
        PROPOSALS.with(|m| m.borrow_mut().insert(proposal_id, p));
    }
    execute_if_passed(proposal_id).await;
    Ok(current_view(proposal_id, caller))
}

fn current_view(proposal_id: u64, caller: Principal) -> ProposalView {
    let eligible = eligible_voters(now_ns()).len() as u32;
    let p = PROPOSALS.with(|m| m.borrow().get(&proposal_id)).expect("proposal exists");
    proposal_view(&p, caller, now_ns(), eligible)
}

#[query]
fn list_proposals() -> Result<Vec<ProposalView>, String> {
    let caller = caller_or_err()?;
    require_governance_viewer(caller)?;
    let sees_all = sees_all_proposals(caller);
    let now = now_ns();
    let eligible = eligible_voters(now).len() as u32;
    let mut out: Vec<ProposalView> = PROPOSALS.with(|m| {
        m.borrow()
            .iter()
            .filter(|(_, p)| {
                sees_all
                    || matches!(p.kind, ProposalKind::GrantDataAccess { grantee, .. } if grantee == caller)
            })
            .map(|(_, p)| proposal_view(&p, caller, now, eligible))
            .collect()
    });
    out.reverse();
    Ok(out)
}

#[query]
fn am_i_eligible_voter() -> bool {
    caller_or_err().is_ok_and(|c| is_eligible(c, now_ns()))
}

const EXECUTION_STALE_NS: u64 = 10 * 60 * 1_000_000_000;

/// Carry out a passed proposal's effect in code. Only AddController has one.
async fn execute_if_passed(proposal_id: u64) {
    let Some(mut p) = PROPOSALS.with(|m| m.borrow().get(&proposal_id)) else { return };
    let ProposalKind::AddController { controller } = p.kind else { return };
    let now = now_ns();
    let Some(o) = p.outcome.as_mut() else { return };
    if !o.passed || o.executed_at_ns.is_some() {
        return;
    }
    if matches!(o.execution_started_at_ns, Some(t) if now.saturating_sub(t) < EXECUTION_STALE_NS) {
        return;
    }
    o.execution_started_at_ns = Some(now);
    PROPOSALS.with(|m| m.borrow_mut().insert(proposal_id, p));

    let result = add_controller(controller).await;

    let Some(mut p) = PROPOSALS.with(|m| m.borrow().get(&proposal_id)) else { return };
    if let Some(o) = p.outcome.as_mut() {
        o.execution_started_at_ns = None;
        match result {
            Ok(()) => {
                o.executed_at_ns = Some(now_ns());
                o.execution_error = None;
            }
            Err(e) => o.execution_error = Some(e),
        }
    }
    PROPOSALS.with(|m| m.borrow_mut().insert(proposal_id, p));
}

/// Minimal management-canister shapes: only the fields used here. Candid record
/// subtyping lets these decode the full responses, which keep gaining fields.
#[derive(candid::CandidType, serde::Deserialize)]
struct ControllersOnly {
    controllers: Vec<Principal>,
}
#[derive(candid::CandidType, serde::Deserialize)]
struct StatusSettingsOnly {
    settings: ControllersOnly,
}
#[derive(candid::CandidType)]
struct SetControllers {
    canister_id: Principal,
    settings: SetControllersSettings,
}
#[derive(candid::CandidType)]
struct SetControllersSettings {
    controllers: Option<Vec<Principal>>,
}

/// Add `new` to this canister's controllers, keeping every existing one.
/// Requires the canister to be one of its own controllers.
async fn add_controller(new: Principal) -> Result<(), String> {
    let me = ic_cdk::api::id();
    let mgmt = Principal::management_canister();
    let (status,): (StatusSettingsOnly,) = ic_cdk::call(
        mgmt,
        "canister_status",
        (ic_cdk::api::management_canister::main::CanisterIdRecord { canister_id: me },),
    )
    .await
    .map_err(|(c, m)| {
        format!("could not read controllers ({c:?}: {m}); is the canister its own controller?")
    })?;
    let mut controllers = status.settings.controllers;
    if controllers.contains(&new) {
        return Ok(());
    }
    if controllers.len() >= 10 {
        return Err("the canister already has the maximum of 10 controllers".into());
    }
    controllers.push(new);
    ic_cdk::call::<_, ()>(
        mgmt,
        "update_settings",
        (SetControllers {
            canister_id: me,
            settings: SetControllersSettings { controllers: Some(controllers) },
        },),
    )
    .await
    .map_err(|(c, m)| {
        format!("could not update controllers ({c:?}: {m}); is the canister its own controller?")
    })
}

/// The only bulk read of holder data: for a principal named in a passed
/// GrantDataAccess proposal, while its window lasts. Every read is logged on
/// the proposal, visible to all holders. An update, so the log entry persists
/// and the response is certified.
#[update]
fn governed_read_all() -> Result<Vec<HolderBundle>, String> {
    let caller = caller_or_err()?;
    let now = now_ns();
    // A grant that has just passed takes effect without anyone finalising it.
    let due: Vec<u64> = PROPOSALS.with(|m| {
        m.borrow().iter().filter(|(_, p)| p.outcome.is_none()).map(|(k, _)| k).collect()
    });
    for id in due {
        if let Some(mut p) = PROPOSALS.with(|m| m.borrow().get(&id)) {
            if finalize_if_due(&mut p, now) {
                PROPOSALS.with(|m| m.borrow_mut().insert(id, p));
            }
        }
    }
    let grant = PROPOSALS.with(|m| {
        m.borrow().iter().find(|(_, p)| match (&p.kind, &p.outcome) {
            (ProposalKind::GrantDataAccess { grantee, duration_days }, Some(o)) => {
                *grantee == caller
                    && o.passed
                    && governance::grant_active(now, o.resolved_at_ns, *duration_days)
            }
            _ => false,
        })
    });
    let Some((id, mut p)) = grant else {
        return Err("no active data-access grant for this principal".into());
    };
    p.reads_at_ns.push(now);
    PROPOSALS.with(|m| m.borrow_mut().insert(id, p));
    Ok(all_holder_bundles())
}

fn all_holder_bundles() -> Vec<HolderBundle> {
    let holders: Vec<(Principal, u32)> =
        HOLDER_LATEST.with(|m| m.borrow().iter().map(|(p, r)| (p.0, r)).collect());
    let mut out = Vec::with_capacity(holders.len());
    for (p, latest) in holders {
        let Some(profile) = HOLDER_REVISIONS.with(|m| m.borrow().get(&PrincipalRevKey(p, latest)))
        else {
            continue;
        };
        let holder_revisions =
            HOLDER_REVISIONS.with(|m| m.borrow().range(holder_revs_of(p)).map(|(_, v)| v).collect());
        let mut wallets = Vec::new();
        let mut wallet_revisions = Vec::new();
        for a in holder_wallets(p) {
            if let Some(rev) = WALLET_LATEST.with(|m| m.borrow().get(&a)) {
                if let Some(w) = WALLET_REVISIONS.with(|m| m.borrow().get(&AddrRevKey(a, rev))) {
                    wallets.push(w);
                }
            }
            let revs =
                WALLET_REVISIONS.with(|m| m.borrow().range(wallet_revs_of(a)).map(|(_, v)| v).collect());
            wallet_revisions.push((a.to_lower_hex(), revs));
        }
        out.push(HolderBundle { profile, wallets, holder_revisions, wallet_revisions });
    }
    out
}

// Export the candid interface.
candid::export_service!();
#[ic_cdk_macros::query(name = "__get_candid_interface_tmp_hack")]
fn export_candid() -> String {
    __export_service()
}





#[cfg(test)]
mod reverify_tests {
    use super::*;
    use k256::ecdsa::SigningKey;
    use sha3::{Digest, Keccak256};

    fn principal() -> Principal {
        Principal::from_text("aaaaa-aa").unwrap()
    }

    fn holder(rev: u32) -> HolderProfile {
        HolderProfile {
            revision: rev,
            principal: principal(),
            legal_name: "Alice Smith".into(),
            date_of_birth_iso: "1980-01-01".into(),
            nationality: "SG".into(),
            country_of_residence: "SG".into(),
            email: "alice@example.com".into(),
            telegram_handle: Some("@alice".into()),
            preferred_comm_channel: CommChannel::Telegram,
            has_filed_pod: true,
            pod_filed_date_iso: None,
            pod_reference: None,
            needs_help_filing_pod: false,
            consent_group_representation: true,
            consent_data_use_for_legal: true,
            ack_engagement_letter_to_follow: true,
            ack_fee_structure: true,
            ack_group_strategy_coordinated: true,
            ack_site_not_affiliated: true,
            truthfully_attested: true,
            fee_preference: FeePreference::ProportionalToClaim,
            preferred_payment_method: None,
            naming_preference: NamingPreference::AnonymousViaRepresentative,
            other_multichain_claims: None,
            additional_documentation_notes: None,
            submitted_at_ns: 1_700_000_000_000_000_000,
        }
    }

    /// Builds and signs an attestation exactly as the frontend + write path do,
    /// with a real secp256k1 key.
    fn signed_attestation(h: &HolderProfile) -> WalletAttestation {
        let sk = SigningKey::from_bytes(&[7u8; 32].into()).unwrap();
        let pk = sk.verifying_key().to_encoded_point(false);
        let addr = format!("0x{}", hex::encode(&Keccak256::digest(&pk.as_bytes()[1..])[12..]));

        let mut w = WalletAttestation {
            revision: 0,
            holder_revision: h.revision,
            wallet_address: addr.clone(),
            linked_principal: principal(),
            detected_eth: 494_200_548,
            detected_bsc: 0,
            detected_polygon: 0,
            detected_canto: 0,
            positions: vec![PositionDetail {
                chain: "ethereum".into(),
                kind: PositionType::RawToken,
                declared_multibtc: 494_200_548,
            }],
            approximate_total_claim: None,
            held_pre_incident: true,
            acquired_post_incident: false,
            post_incident_acquisitions: vec![],
            attempted_bridge_redemption: false,
            bridge_attempts: vec![],
            pod_filed_for_this_wallet: false,
            pod_reference_for_this_wallet: None,
            support_tx_hashes: vec![],
            signed_message: String::new(),
            signature: String::new(),
            nonce: "3f2504e0-4f89-41d3-9a0c-0305e82c3301".into(),
            signed_at_iso: "2026-09-15T12:00:00Z".into(),
            data_commitment_sha256: String::new(),
            submitted_at_ns: 0,
        };

        let holder_commit = commitment::commit_holder(h);
        let payload = AttestPayload {
            wallet_address: w.wallet_address.clone(),
            detected_eth: w.detected_eth,
            detected_bsc: 0,
            detected_polygon: 0,
            detected_canto: 0,
            positions: w.positions.clone(),
            approximate_total_claim: None,
            held_pre_incident: true,
            acquired_post_incident: false,
            post_incident_acquisitions: vec![],
            attempted_bridge_redemption: false,
            bridge_attempts: vec![],
            pod_filed_for_this_wallet: false,
            pod_reference_for_this_wallet: None,
            support_tx_hashes: vec![],
            signature: String::new(),
            nonce: w.nonce.clone(),
            signed_at_iso: w.signed_at_iso.clone(),
            data_commitment_sha256: String::new(),
        };
        let commit = commitment::commit_attest(&payload, &principal(), 0, h.revision, &holder_commit);
        let msg = message::build_attestation_message(
            &addr, "aaaaa-aa", 0, &h.legal_name, &h.date_of_birth_iso,
            h.revision, &holder_commit, &commit, &w.signed_at_iso, &w.nonce,
        );
        let prefixed = format!("\x19Ethereum Signed Message:\n{}{}", msg.len(), msg);
        let digest = Keccak256::digest(prefixed.as_bytes());
        let (sig, recid) = sk.sign_prehash_recoverable(&digest).unwrap();

        w.signature = format!("0x{}{:02x}", hex::encode(sig.to_bytes()), 27 + recid.to_byte());
        w.signed_message = msg;
        w.data_commitment_sha256 = commit;
        w
    }

    #[test]
    fn a_genuine_record_reverifies() {
        let h = holder(2);
        let w = signed_attestation(&h);
        assert_eq!(reverify_attestation(&w, &h), Ok(()));
    }

    #[test]
    fn a_changed_amount_is_caught() {
        let h = holder(2);
        let mut w = signed_attestation(&h);
        w.detected_eth += 1;
        assert!(reverify_attestation(&w, &h).unwrap_err().contains("commitment"));
    }

    #[test]
    fn a_changed_identity_is_caught() {
        let h = holder(2);
        let w = signed_attestation(&h);
        let mut renamed = h.clone();
        renamed.legal_name = "Bob Jones".into();
        assert!(reverify_attestation(&w, &renamed).is_err());
    }

    #[test]
    fn the_wrong_profile_revision_is_refused() {
        let w = signed_attestation(&holder(2));
        assert!(reverify_attestation(&w, &holder(3)).is_err());
    }

    /// A genuine signature by the same key, lifted from a different attestation,
    /// must not validate this one.
    #[test]
    fn a_signature_from_another_attestation_is_caught() {
        let h = holder(2);
        let mut w = signed_attestation(&h);
        w.signature = signed_attestation(&holder(5)).signature;
        let err = reverify_attestation(&w, &h).unwrap_err();
        assert!(err.contains("not to this wallet"), "unexpected: {err}");
    }

    /// Nothing personal may escape through an error string.
    #[test]
    fn errors_never_contain_personal_data() {
        let h = holder(2);
        for mutate in [
            |w: &mut WalletAttestation| w.detected_eth += 1,
            |w: &mut WalletAttestation| w.signed_message.push('x'),
            |w: &mut WalletAttestation| w.signature = "0x00".into(),
        ] {
            let mut w = signed_attestation(&h);
            mutate(&mut w);
            let err = reverify_attestation(&w, &h).unwrap_err();
            assert!(!err.contains("Alice") && !err.contains("1980"), "leaked: {err}");
        }
    }
}



