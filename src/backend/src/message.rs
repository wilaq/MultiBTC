use candid::Principal;

pub fn build_link_message(
    address_lower_hex: &str,
    principal_text: &str,
    signed_at_iso: &str,
    nonce: &str,
) -> String {
    format!(
        "multiBTC Holders Group — Identity Binding\n\
\n\
I bind this Ethereum wallet to my Internet Identity principal so that\n\
only I can view and edit my verification record.\n\
\n\
Wallet:    {addr}\n\
Principal: {principal}\n\
Timestamp: {ts}\n\
Nonce:     {nonce}",
        addr = address_lower_hex,
        principal = principal_text,
        ts = signed_at_iso,
        nonce = nonce
    )
}

// NOTE: `concat!` is used here on purpose — Rust's `\<newline>` line-continuation
// escape silently strips ALL leading whitespace on the next line, which would
// drop the 3-space indents on continuation lines and produce a different byte
// sequence than the TypeScript mirror. With `concat!` every string literal is
// preserved verbatim.
const ATTESTATION_BODY: &str = concat!(
    "multiBTC Holders Group — Verification & Authorization\n",
    "\n",
    "I, the controller of this wallet, declare:\n",
    "\n",
    "1. I hold or have held multiBTC tokens at this address.\n",
    "2. I support the coordinated pursuit of asset-specific recovery\n",
    "   for multiBTC holders in the Multichain Foundation Ltd. liquidation.\n",
    "3. I authorize the appointed legal representative of the multiBTC\n",
    "   Holders Group to act on my behalf in proceedings related to the\n",
    "   Multichain liquidation (Singapore HC/CWU 134/2025;\n",
    "   U.S. Bankruptcy Court SDNY 25-12340-DSJ).\n",
    "4. I understand this is a group coordination effort with shared costs\n",
    "   (either upfront cost-share or litigation funding, per my preference).\n",
    "5. I attest under penalty of perjury that the information I have\n",
    "   provided alongside this signature is true, accurate, and complete\n",
    "   to the best of my knowledge.\n",
    "\n",
);

#[allow(clippy::too_many_arguments)]
pub fn build_attestation_message(
    address_lower_hex: &str,
    principal_text: &str,
    revision: u32,
    legal_name: &str,
    date_of_birth_iso: &str,
    holder_revision: u32,
    holder_commitment_hex: &str,
    data_commitment_sha256_hex: &str,
    signed_at_iso: &str,
    nonce: &str,
) -> String {
    let mut s = String::with_capacity(ATTESTATION_BODY.len() + 256);
    s.push_str(ATTESTATION_BODY);
    s.push_str("Wallet:           ");
    s.push_str(address_lower_hex);
    s.push('\n');
    s.push_str("Linked principal: ");
    s.push_str(principal_text);
    s.push('\n');
    s.push_str("Revision:         ");
    s.push_str(&revision.to_string());
    s.push('\n');
    // The holder's own name and DOB are in the text the wallet displays, so the
    // signature demonstrably covers who is claiming -- not just what they hold.
    // The profile hash pins every other field of that exact revision.
    s.push_str("Holder:           ");
    s.push_str(legal_name);
    s.push('\n');
    s.push_str("Date of birth:    ");
    s.push_str(date_of_birth_iso);
    s.push('\n');
    s.push_str("Holder profile:   revision ");
    s.push_str(&holder_revision.to_string());
    s.push_str(", 0x");
    s.push_str(holder_commitment_hex);
    s.push('\n');
    s.push_str("Data commitment:  0x");
    s.push_str(data_commitment_sha256_hex);
    s.push('\n');
    s.push_str("Timestamp:        ");
    s.push_str(signed_at_iso);
    s.push('\n');
    s.push_str("Nonce:            ");
    s.push_str(nonce);
    s
}

pub fn build_admin_message(signed_at_iso: &str, nonce: &str) -> String {
    format!(
        "multiBTC Holders Group — Admin Access\n\
\n\
I am authenticating as the admin operator.\n\
Timestamp: {ts}\n\
Nonce:     {nonce}",
        ts = signed_at_iso,
        nonce = nonce
    )
}

#[allow(dead_code)]
pub fn principal_text(p: &Principal) -> String {
    p.to_text()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn link_message_golden() {
        let m = build_link_message(
            "0xd381e358d6b4e176559d3d76109985ed83259aec",
            "aaaaa-aa",
            "2026-05-13T18:00:00Z",
            "11111111-1111-4111-8111-111111111111",
        );
        let expected = "multiBTC Holders Group — Identity Binding\n\
\n\
I bind this Ethereum wallet to my Internet Identity principal so that\n\
only I can view and edit my verification record.\n\
\n\
Wallet:    0xd381e358d6b4e176559d3d76109985ed83259aec\n\
Principal: aaaaa-aa\n\
Timestamp: 2026-05-13T18:00:00Z\n\
Nonce:     11111111-1111-4111-8111-111111111111";
        assert_eq!(m, expected);
    }

    /// Byte-for-byte expected. Must stay in sync with
    /// src/frontend/src/lib/parity.test.ts → buildAttestationMessage.
    const ATTESTATION_GOLDEN: &str = concat!(
        "multiBTC Holders Group — Verification & Authorization\n",
        "\n",
        "I, the controller of this wallet, declare:\n",
        "\n",
        "1. I hold or have held multiBTC tokens at this address.\n",
        "2. I support the coordinated pursuit of asset-specific recovery\n",
        "   for multiBTC holders in the Multichain Foundation Ltd. liquidation.\n",
        "3. I authorize the appointed legal representative of the multiBTC\n",
        "   Holders Group to act on my behalf in proceedings related to the\n",
        "   Multichain liquidation (Singapore HC/CWU 134/2025;\n",
        "   U.S. Bankruptcy Court SDNY 25-12340-DSJ).\n",
        "4. I understand this is a group coordination effort with shared costs\n",
        "   (either upfront cost-share or litigation funding, per my preference).\n",
        "5. I attest under penalty of perjury that the information I have\n",
        "   provided alongside this signature is true, accurate, and complete\n",
        "   to the best of my knowledge.\n",
        "\n",
        "Wallet:           0xd381e358d6b4e176559d3d76109985ed83259aec\n",
        "Linked principal: aaaaa-aa\n",
        "Revision:         0\n",
        "Holder:           Alice Smith\n",
        "Date of birth:    1980-01-01\n",
        "Holder profile:   revision 3, 0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff\n",
        "Data commitment:  0x0000000000000000000000000000000000000000000000000000000000000000\n",
        "Timestamp:        2026-05-13T18:00:00Z\n",
        "Nonce:            11111111-1111-4111-8111-111111111111",
    );

    #[test]
    fn attestation_message_golden() {
        let m = build_attestation_message(
            "0xd381e358d6b4e176559d3d76109985ed83259aec",
            "aaaaa-aa",
            0,
            "Alice Smith",
            "1980-01-01",
            3,
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            "0000000000000000000000000000000000000000000000000000000000000000",
            "2026-05-13T18:00:00Z",
            "11111111-1111-4111-8111-111111111111",
        );
        assert_eq!(m, ATTESTATION_GOLDEN);
    }

    /// The signer must be shown the name they are attesting under, so a changed
    /// identity has to change the bytes the wallet signs.
    #[test]
    fn identity_is_inside_the_signed_bytes() {
        let m = build_attestation_message(
            "0xd381e358d6b4e176559d3d76109985ed83259aec",
            "aaaaa-aa",
            0,
            "Bob Jones",
            "1990-02-02",
            3,
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
            "0000000000000000000000000000000000000000000000000000000000000000",
            "2026-05-13T18:00:00Z",
            "11111111-1111-4111-8111-111111111111",
        );
        assert!(m.contains("Holder:           Bob Jones"));
        assert!(m.contains("Date of birth:    1990-02-02"));
        assert_ne!(m, ATTESTATION_GOLDEN);
    }

    #[test]
    fn admin_message_golden() {
        let m = build_admin_message("2026-05-13T18:00:00Z", "abc");
        let expected = "multiBTC Holders Group — Admin Access\n\
\n\
I am authenticating as the admin operator.\n\
Timestamp: 2026-05-13T18:00:00Z\n\
Nonce:     abc";
        assert_eq!(m, expected);
    }
}
