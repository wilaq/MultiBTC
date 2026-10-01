use crate::types::*;
use candid::Principal;
use sha2::{Digest, Sha256};

fn h(s: &str) -> String {
    hex::encode(s.as_bytes())
}
fn oh(s: &Option<String>) -> String {
    s.as_ref().map(|x| hex::encode(x.as_bytes())).unwrap_or_default()
}
fn ou(v: &Option<u128>) -> String {
    v.map(|x| x.to_string()).unwrap_or_default()
}
fn of(v: &Option<f64>) -> String {
    // Fixed 6 decimal places so Rust + TS render identically.
    v.map(|x| format!("{:.6}", x)).unwrap_or_default()
}
fn position_type_str(k: &PositionType) -> String {
    match k {
        PositionType::RawToken => "RawToken".to_string(),
        PositionType::Lp { protocol, pool } => {
            format!("Lp:{}:{}", hex::encode(protocol.as_bytes()), hex::encode(pool.as_bytes()))
        }
        PositionType::Vault { protocol, name } => format!(
            "Vault:{}:{}",
            hex::encode(protocol.as_bytes()),
            hex::encode(name.as_bytes())
        ),
        PositionType::Other(s) => format!("Other:{}", hex::encode(s.as_bytes())),
    }
}

fn comm_channel_str(c: &CommChannel) -> String {
    match c {
        CommChannel::Email => "Email".to_string(),
        CommChannel::Telegram => "Telegram".to_string(),
        CommChannel::Other(s) => format!("Other:{}", hex::encode(s.as_bytes())),
    }
}
fn fee_pref_str(f: &FeePreference) -> &'static str {
    match f {
        FeePreference::UpfrontCostShare => "UpfrontCostShare",
        FeePreference::LitigationFunding => "LitigationFunding",
        FeePreference::ProportionalToClaim => "ProportionalToClaim",
        FeePreference::Undecided => "Undecided",
    }
}
fn naming_pref_str(n: &NamingPreference) -> &'static str {
    match n {
        NamingPreference::WillingToBeNamed => "WillingToBeNamed",
        NamingPreference::AnonymousViaRepresentative => "AnonymousViaRepresentative",
    }
}

/// Canonical form of a stored holder profile, same conventions as
/// `serialise_attest`: `key=value` lines, fixed lexicographic order, text
/// hex-encoded as UTF-8 bytes.
///
/// This exists so the per-wallet signature can commit to *who* is claiming, not
/// just what they hold. Without it the identity layer is mutable with nothing
/// but an Internet Identity session, and a signature could end up sitting beside
/// a name it never covered.
pub fn serialise_holder(hp: &HolderProfile) -> String {
    let mut l: Vec<String> = Vec::with_capacity(32);
    l.push(format!("ack_engagement_letter_to_follow={}", hp.ack_engagement_letter_to_follow));
    l.push(format!("ack_fee_structure={}", hp.ack_fee_structure));
    l.push(format!("ack_group_strategy_coordinated={}", hp.ack_group_strategy_coordinated));
    l.push(format!("ack_site_not_affiliated={}", hp.ack_site_not_affiliated));
    l.push(format!("additional_documentation_notes={}", oh(&hp.additional_documentation_notes)));
    l.push(format!("consent_data_use_for_legal={}", hp.consent_data_use_for_legal));
    l.push(format!("consent_group_representation={}", hp.consent_group_representation));
    l.push(format!("country_of_residence={}", h(&hp.country_of_residence)));
    l.push(format!("date_of_birth_iso={}", h(&hp.date_of_birth_iso)));
    l.push(format!("email={}", h(&hp.email)));
    l.push(format!("fee_preference={}", fee_pref_str(&hp.fee_preference)));
    l.push(format!("has_filed_pod={}", hp.has_filed_pod));
    l.push(format!("legal_name={}", h(&hp.legal_name)));
    l.push(format!("naming_preference={}", naming_pref_str(&hp.naming_preference)));
    l.push(format!("nationality={}", h(&hp.nationality)));
    l.push(format!("needs_help_filing_pod={}", hp.needs_help_filing_pod));
    l.push(format!("other_multichain_claims={}", oh(&hp.other_multichain_claims)));
    l.push(format!("pod_filed_date_iso={}", oh(&hp.pod_filed_date_iso)));
    l.push(format!("pod_reference={}", oh(&hp.pod_reference)));
    l.push(format!("preferred_comm_channel={}", comm_channel_str(&hp.preferred_comm_channel)));
    l.push(format!("preferred_payment_method={}", oh(&hp.preferred_payment_method)));
    l.push(format!("principal={}", hp.principal.to_text()));
    l.push(format!("revision={}", hp.revision));
    l.push(format!("submitted_at_ns={}", hp.submitted_at_ns));
    l.push(format!("telegram_handle={}", oh(&hp.telegram_handle)));
    l.push(format!("truthfully_attested={}", hp.truthfully_attested));
    l.join("\n")
}

pub fn commit_holder(profile: &HolderProfile) -> String {
    let mut hasher = Sha256::new();
    hasher.update(serialise_holder(profile).as_bytes());
    hex::encode(hasher.finalize())
}

/// Deterministic, line-oriented serialisation of every consequential field in
/// the attestation payload. Format:
///
///   `field_name=value`
///
/// Lines emitted in fixed lexicographic order; strings hex-encoded as UTF-8
/// bytes to avoid newline / `=` ambiguity. Vec fields are emitted as
/// `<name>=<count>` followed by `<name>.<i>.<subfield>=...` lines (subfields
/// sorted lexicographically).
///
/// The frontend implements this same function so both sides can independently
/// recompute the sha256 commitment.
pub fn serialise_attest(
    payload: &AttestPayload,
    linked_principal: &Principal,
    revision: u32,
    holder_revision: u32,
    holder_commitment: &str,
) -> String {
    let mut lines: Vec<String> = Vec::with_capacity(64);

    lines.push(format!("acquired_post_incident={}", payload.acquired_post_incident));
    lines.push(format!("approximate_total_claim={}", ou(&payload.approximate_total_claim)));
    lines.push(format!("attempted_bridge_redemption={}", payload.attempted_bridge_redemption));
    lines.push(format!("bridge_attempts={}", payload.bridge_attempts.len()));
    for (i, a) in payload.bridge_attempts.iter().enumerate() {
        lines.push(format!("bridge_attempts.{i}.chain={}", h(&a.chain)));
        lines.push(format!("bridge_attempts.{i}.description={}", oh(&a.description)));
        lines.push(format!("bridge_attempts.{i}.tx_hash={}", h(&a.tx_hash)));
    }
    lines.push(format!("detected_bsc={}", payload.detected_bsc));
    lines.push(format!("detected_canto={}", payload.detected_canto));
    lines.push(format!("detected_eth={}", payload.detected_eth));
    lines.push(format!("detected_polygon={}", payload.detected_polygon));
    lines.push(format!("held_pre_incident={}", payload.held_pre_incident));
    lines.push(format!("holder_commitment={holder_commitment}"));
    lines.push(format!("holder_revision={holder_revision}"));
    lines.push(format!("linked_principal={}", linked_principal.to_text()));
    lines.push(format!("pod_filed_for_this_wallet={}", payload.pod_filed_for_this_wallet));
    lines.push(format!(
        "pod_reference_for_this_wallet={}",
        oh(&payload.pod_reference_for_this_wallet)
    ));
    lines.push(format!("positions={}", payload.positions.len()));
    for (i, p) in payload.positions.iter().enumerate() {
        lines.push(format!("positions.{i}.chain={}", h(&p.chain)));
        lines.push(format!("positions.{i}.declared_multibtc={}", p.declared_multibtc));
        lines.push(format!("positions.{i}.kind={}", position_type_str(&p.kind)));
    }
    lines.push(format!(
        "post_incident_acquisitions={}",
        payload.post_incident_acquisitions.len()
    ));
    for (i, a) in payload.post_incident_acquisitions.iter().enumerate() {
        lines.push(format!(
            "post_incident_acquisitions.{i}.acquisition_date_iso={}",
            h(&a.acquisition_date_iso)
        ));
        lines.push(format!(
            "post_incident_acquisitions.{i}.amount_multibtc={}",
            a.amount_multibtc
        ));
        lines.push(format!("post_incident_acquisitions.{i}.chain={}", h(&a.chain)));
        lines.push(format!("post_incident_acquisitions.{i}.notes={}", oh(&a.notes)));
        lines.push(format!(
            "post_incident_acquisitions.{i}.price_paid_usd={}",
            of(&a.price_paid_usd)
        ));
    }
    lines.push(format!("revision={}", revision));
    lines.push(format!("support_tx_hashes={}", payload.support_tx_hashes.len()));
    for (i, h) in payload.support_tx_hashes.iter().enumerate() {
        lines.push(format!("support_tx_hashes.{i}={}", hex::encode(h.as_bytes())));
    }
    lines.push(format!("wallet_address={}", payload.wallet_address.to_lowercase()));

    lines.join("\n")
}

pub fn commit_attest(
    payload: &AttestPayload,
    linked_principal: &Principal,
    revision: u32,
    holder_revision: u32,
    holder_commitment: &str,
) -> String {
    let s = serialise_attest(payload, linked_principal, revision, holder_revision, holder_commitment);
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p() -> Principal {
        Principal::from_text("aaaaa-aa").unwrap()
    }

    // Stand-in holder commitment for the attestation goldens.
    const HC: &str = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

    fn holder() -> HolderProfile {
        HolderProfile {
            revision: 3,
            principal: p(),
            legal_name: "Alice Smith".into(),
            date_of_birth_iso: "1980-01-01".into(),
            nationality: "SG".into(),
            country_of_residence: "SG".into(),
            email: "alice@example.com".into(),
            telegram_handle: None,
            preferred_comm_channel: CommChannel::Email,
            has_filed_pod: true,
            pod_filed_date_iso: Some("2025-06-01".into()),
            pod_reference: Some("PoD-1".into()),
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

    /// The identity layer is only evidence if the per-wallet signature covers
    /// it, so this serialisation is as load-bearing as the attestation one.
    #[test]
    fn golden_holder_serialisation() {
        let expected = "\
ack_engagement_letter_to_follow=true
ack_fee_structure=true
ack_group_strategy_coordinated=true
ack_site_not_affiliated=true
additional_documentation_notes=
consent_data_use_for_legal=true
consent_group_representation=true
country_of_residence=5347
date_of_birth_iso=313938302d30312d3031
email=616c696365406578616d706c652e636f6d
fee_preference=ProportionalToClaim
has_filed_pod=true
legal_name=416c69636520536d697468
naming_preference=AnonymousViaRepresentative
nationality=5347
needs_help_filing_pod=false
other_multichain_claims=
pod_filed_date_iso=323032352d30362d3031
pod_reference=506f442d31
preferred_comm_channel=Email
preferred_payment_method=
principal=aaaaa-aa
revision=3
submitted_at_ns=1700000000000000000
telegram_handle=
truthfully_attested=true";
        assert_eq!(serialise_holder(&holder()), expected);
    }

    /// Editing any profile field must move the holder commitment, which is what
    /// makes a stale attestation detectable rather than silent.
    #[test]
    fn holder_commitment_changes_when_identity_changes() {
        let a = commit_holder(&holder());
        let mut renamed = holder();
        renamed.legal_name = "Bob Jones".into();
        assert_ne!(a, commit_holder(&renamed), "renaming must change the commitment");
        let mut refee = holder();
        refee.fee_preference = FeePreference::LitigationFunding;
        assert_ne!(a, commit_holder(&refee), "fee preference must change the commitment");
    }

    /// The attestation commitment must move when the bound holder revision does,
    /// even if every wallet-level field is identical.
    #[test]
    fn attest_commitment_binds_the_holder() {
        let hc = commit_holder(&holder());
        let base = commit_attest(&empty_payload(), &p(), 0, 3, &hc);
        assert_ne!(base, commit_attest(&empty_payload(), &p(), 0, 4, &hc));
        let mut renamed = holder();
        renamed.legal_name = "Bob Jones".into();
        assert_ne!(base, commit_attest(&empty_payload(), &p(), 0, 3, &commit_holder(&renamed)));
    }

    fn empty_payload() -> AttestPayload {
        AttestPayload {
            wallet_address: "0x14791697260e4c9a71f18484c9f997b308e59325".to_string(),
            detected_eth: 0,
            detected_bsc: 0,
            detected_polygon: 0,
            detected_canto: 0,
            positions: vec![],
            approximate_total_claim: None,
            held_pre_incident: false,
            acquired_post_incident: false,
            post_incident_acquisitions: vec![],
            attempted_bridge_redemption: false,
            bridge_attempts: vec![],
            pod_filed_for_this_wallet: false,
            pod_reference_for_this_wallet: None,
            support_tx_hashes: vec![],
            signature: String::new(),
            nonce: String::new(),
            signed_at_iso: String::new(),
            data_commitment_sha256: String::new(),
        }
    }

    #[test]
    fn golden_empty_payload() {
        let s = serialise_attest(&empty_payload(), &p(), 0, 3, HC);
        // Stable golden — if this changes, the frontend mirror must change too.
        let expected = "\
acquired_post_incident=false
approximate_total_claim=
attempted_bridge_redemption=false
bridge_attempts=0
detected_bsc=0
detected_canto=0
detected_eth=0
detected_polygon=0
held_pre_incident=false
holder_commitment=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff
holder_revision=3
linked_principal=aaaaa-aa
pod_filed_for_this_wallet=false
pod_reference_for_this_wallet=
positions=0
post_incident_acquisitions=0
revision=0
support_tx_hashes=0
wallet_address=0x14791697260e4c9a71f18484c9f997b308e59325";
        assert_eq!(s, expected);
    }

    #[test]
    fn golden_with_positions_and_post_incident() {
        let mut p1 = empty_payload();
        p1.detected_eth = 100_000_000; // 1 multiBTC raw
        p1.held_pre_incident = true;
        p1.acquired_post_incident = true;
        p1.positions = vec![
            PositionDetail {
                chain: "ethereum".to_string(),
                kind: PositionType::RawToken,
                declared_multibtc: 100_000_000,
            },
            PositionDetail {
                chain: "bsc".to_string(),
                kind: PositionType::Lp {
                    protocol: "Thena".to_string(),
                    pool: "BTCB/multiBTC".to_string(),
                },
                declared_multibtc: 250_000_000,
            },
        ];
        p1.post_incident_acquisitions = vec![PostIncidentAcquisition {
            acquisition_date_iso: "2024-01-15".to_string(),
            chain: "bsc".to_string(),
            amount_multibtc: 50_000_000,
            price_paid_usd: Some(1234.5),
            notes: Some("test".to_string()),
        }];
        let s = serialise_attest(&p1, &p(), 2, 3, HC);
        // Spot-check key lines:
        assert!(s.contains("positions=2"));
        assert!(s.contains("positions.0.chain=657468657265756d")); // hex("ethereum")
        assert!(s.contains("positions.0.kind=RawToken"));
        assert!(s.contains("positions.1.kind=Lp:5468656e61:425443422f6d756c7469425443")); // hex("Thena"):hex("BTCB/multiBTC")
        assert!(s.contains("post_incident_acquisitions=1"));
        assert!(s.contains("post_incident_acquisitions.0.price_paid_usd=1234.500000"));
        assert!(s.contains("revision=2"));
        // Determinism: serialise twice, identical output.
        assert_eq!(serialise_attest(&p1, &p(), 2, 3, HC), s);
    }

    #[test]
    fn commitment_is_stable_sha256() {
        let s = serialise_attest(&empty_payload(), &p(), 0, 3, HC);
        let c = commit_attest(&empty_payload(), &p(), 0, 3, HC);
        let mut hasher = Sha256::new();
        hasher.update(s.as_bytes());
        assert_eq!(c, hex::encode(hasher.finalize()));
    }
}
