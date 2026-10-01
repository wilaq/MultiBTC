# Wallet attestation — verification specification

This document defines, byte for byte, how a multiBTC Holders Group wallet
attestation is constructed, so that any third party can verify a record without
trusting the canister, this repository, or the party producing the export.

`verify-attestation.mjs` in this directory is one implementation of it. The
canister (`src/backend/src/commitment.rs`, `message.rs`, `verify.rs`) and the
browser (`src/frontend/src/lib/dataCommitment.ts`, `message.ts`) are two others.
All three are independent and must agree; `selftest.mjs` checks this
implementation against the canister's own published test vectors.

---

## 1. What a verified record does and does not establish

**Establishes.** At the recorded timestamp, a party in possession of the private
key for Ethereum address `W` produced an ECDSA signature over a message that
names `W`, names Internet Identity principal `P`, names a revision number,
**names the holder's legal name and date of birth in plain text, and commits
(SHA-256) to every other field of that holder profile revision**, and commits
(SHA-256) to every field of the wallet declaration. The declaration therefore
cannot be altered after signing without invalidating the signature, and cannot
be transplanted to a different address, identity, profile, or revision.

**Does not establish.**

1. **Key control is not legal ownership.** Anyone holding the private key can
   sign — a custodian, a joint owner, a party who obtained the key improperly.
2. **Balances are self-declared.** `detected_eth`, `detected_bsc`,
   `detected_polygon` and `detected_canto` are read by the declarant's own
   browser and submitted as assertions. The canister performs no on-chain
   verification of them. They are bound by the signature (so they are
   tamper-evident, and are attested under penalty of perjury per clause 5 of the
   message body) but they are not independently proven.
3. **The principal is not a person, and the identity is self-declared.**
   `linked_principal` is an Internet Identity principal; the legal name, date of
   birth and nationality are asserted by the claimant, not verified against any
   document. They *are* covered by the signature (§2b), so the claimant
   demonstrably signed under that name and cannot later swap it without
   invalidating the record — but no third party has checked that the name is
   theirs.
4. **This is not an executed mandate.** Clause 3 of the message body expresses an
   intention to authorise representation. Whether an electronic signature can
   *create* such an authority is a question of the governing law — note in
   particular that the First Schedule to Singapore's Electronic Transactions Act
   2010 excludes powers of attorney from the Act's electronic signature
   provisions. The operative retainer is executed off-platform.

---

## 2b. Holder profile commitment

The holder profile is mutable — it can be revised up to 20 times with only an
Internet Identity session, and no wallet signature. So each wallet attestation
binds the exact profile revision that was in force when it was signed, and a
later edit leaves earlier attestations pointing at the older revision rather
than silently acquiring a new identity.

Same conventions as §2: `key=value` lines joined by `\n` with no trailing
newline, fixed lexicographic order, text as lowercase hex of its UTF-8 bytes,
absent optional values as the empty string.

| Line | Value encoding |
|---|---|
| `ack_engagement_letter_to_follow` | `true` / `false` |
| `ack_fee_structure` | `true` / `false` |
| `ack_group_strategy_coordinated` | `true` / `false` |
| `ack_site_not_affiliated` | `true` / `false` |
| `additional_documentation_notes` | hex(UTF-8), empty if absent |
| `consent_data_use_for_legal` | `true` / `false` |
| `consent_group_representation` | `true` / `false` |
| `country_of_residence` | hex(UTF-8) |
| `date_of_birth_iso` | hex(UTF-8) |
| `email` | hex(UTF-8) |
| `fee_preference` | `UpfrontCostShare` / `LitigationFunding` / `ProportionalToClaim` / `Undecided` |
| `has_filed_pod` | `true` / `false` |
| `legal_name` | hex(UTF-8) |
| `naming_preference` | `WillingToBeNamed` / `AnonymousViaRepresentative` |
| `nationality` | hex(UTF-8) |
| `needs_help_filing_pod` | `true` / `false` |
| `other_multichain_claims` | hex(UTF-8), empty if absent |
| `pod_filed_date_iso` | hex(UTF-8), empty if absent |
| `pod_reference` | hex(UTF-8), empty if absent |
| `preferred_comm_channel` | `Email` / `Telegram` / `Other:<hex(text)>` |
| `preferred_payment_method` | hex(UTF-8), empty if absent |
| `principal` | principal in textual form |
| `revision` | decimal integer |
| `submitted_at_ns` | decimal integer, Internet Computer consensus time |
| `telegram_handle` | hex(UTF-8), empty if absent |
| `truthfully_attested` | `true` / `false` |

`holder_commitment` in §2 is `SHA-256` of these bytes, lowercase hex, no `0x`.

Note that the seven `consent_*` / `ack_*` / `truthfully_attested` booleans can
only ever be `true`: the canister rejects a profile where any of them is false,
so they record that the form was completed rather than carrying independent
evidentiary weight. The operative consent language is clauses 3–5 of the signed
message body in §3, which the wallet signs directly.

A reference vector is in `selftest.mjs` (`GOLDEN_HOLDER`) and in the canister's
`commitment.rs::golden_holder_serialisation`.

---

## 2. Canonical commitment preimage

A newline-joined (`\n`, no trailing newline) sequence of `key=value` lines in
**exactly** the order below. Text values are hex-encoded UTF-8 bytes, lowercase,
no `0x` prefix — so a newline or `=` inside user-supplied text cannot forge a
line. Absent optional values render as the empty string.

| Line | Value encoding |
|---|---|
| `acquired_post_incident` | `true` / `false` |
| `approximate_total_claim` | decimal integer, or empty if absent |
| `attempted_bridge_redemption` | `true` / `false` |
| `bridge_attempts` | element count |
| `bridge_attempts.<i>.chain` | hex(UTF-8) |
| `bridge_attempts.<i>.description` | hex(UTF-8), empty if absent |
| `bridge_attempts.<i>.tx_hash` | hex(UTF-8) |
| `detected_bsc` | decimal integer |
| `detected_canto` | decimal integer |
| `detected_eth` | decimal integer |
| `detected_polygon` | decimal integer |
| `held_pre_incident` | `true` / `false` |
| `holder_commitment` | 64 lowercase hex chars, no `0x` — see §2b |
| `holder_revision` | decimal integer, the profile revision this signature covers |
| `linked_principal` | principal in textual form, e.g. `aaaaa-aa` |
| `pod_filed_for_this_wallet` | `true` / `false` |
| `pod_reference_for_this_wallet` | hex(UTF-8), empty if absent |
| `positions` | element count |
| `positions.<i>.chain` | hex(UTF-8) |
| `positions.<i>.declared_multibtc` | decimal integer |
| `positions.<i>.kind` | see below |
| `post_incident_acquisitions` | element count |
| `post_incident_acquisitions.<i>.acquisition_date_iso` | hex(UTF-8) |
| `post_incident_acquisitions.<i>.amount_multibtc` | decimal integer |
| `post_incident_acquisitions.<i>.chain` | hex(UTF-8) |
| `post_incident_acquisitions.<i>.notes` | hex(UTF-8), empty if absent |
| `post_incident_acquisitions.<i>.price_paid_usd` | fixed 6 decimals (`1234.500000`), empty if absent |
| `revision` | decimal integer |
| `support_tx_hashes` | element count |
| `support_tx_hashes.<i>` | hex(UTF-8) |
| `wallet_address` | lowercase `0x`-prefixed 40 hex digits |

Repeated-field blocks (`bridge_attempts.*`, `positions.*`,
`post_incident_acquisitions.*`, `support_tx_hashes.*`) follow their count line
immediately, indices ascending from 0, subfields in the order shown.

`positions.<i>.kind` is one of:

```
RawToken
Lp:<hex(protocol)>:<hex(pool)>
Vault:<hex(protocol)>:<hex(name)>
Other:<hex(text)>
```

**Amounts are integers in token base units.** multiBTC has 8 decimals, so
`100000000` is 1 multiBTC. They must never be parsed through an IEEE-754 double.

The commitment is `SHA-256(preimage_bytes)`, lowercase hex, no `0x`.

### Reference vector

The preimage for an all-empty declaration by principal `aaaaa-aa` at revision 0
for wallet `0xd381e358d6b4e176559d3d76109985ed83259aec` is reproduced verbatim
in `selftest.mjs` (`GOLDEN_EMPTY`) and in the canister's
`commitment.rs::golden_empty_payload`.

---

## 3. Canonical signed message

The fixed body below, then six labelled lines. Field values are padded to a
fixed label column; the exact spacing is part of the signed bytes.

```
multiBTC Holders Group — Verification & Authorization

I, the controller of this wallet, declare:

1. I hold or have held multiBTC tokens at this address.
2. I support the coordinated pursuit of asset-specific recovery
   for multiBTC holders in the Multichain Foundation Ltd. liquidation.
3. I authorize the appointed legal representative of the multiBTC
   Holders Group to act on my behalf in proceedings related to the
   Multichain liquidation (Singapore HC/CWU 134/2025;
   U.S. Bankruptcy Court SDNY 25-12340-DSJ).
4. I understand this is a group coordination effort with shared costs
   (either upfront cost-share or litigation funding, per my preference).
5. I attest under penalty of perjury that the information I have
   provided alongside this signature is true, accurate, and complete
   to the best of my knowledge.

Wallet:           <lowercase 0x address>
Linked principal: <principal text>
Revision:         <decimal>
Holder:           <legal name, verbatim>
Date of birth:    <YYYY-MM-DD>
Holder profile:   revision <decimal>, 0x<64 hex chars from §2b>
Data commitment:  0x<64 hex chars from §2>
Timestamp:        <ISO-8601 UTC, as supplied by the signer's browser>
Nonce:            <UUID v4 issued by the canister>
```

The dash in the first line is U+2014 EM DASH (3 bytes in UTF-8). There is no
trailing newline after the nonce.

`Timestamp` is the **signer's client clock** and is not authoritative.
`submitted_at_ns` on the stored record is Internet Computer consensus time and
is. The nonce is issued by the canister and is single-use with a 15-minute TTL,
which is what bounds how stale a signature can be relative to consensus time.

---

## 4. Signature verification

EIP-191 `personal_sign`:

1. `prefixed = "\x19Ethereum Signed Message:\n" || len(message_utf8) || message_utf8`
   where `len` is the **byte** length in ASCII decimal. The body contains an em
   dash, so byte length and character length differ — using the character count
   produces a different digest and verification fails.
2. `digest = keccak256(prefixed)`
3. Split the 65-byte signature as `r (32) || s (32) || v (1)`. Recovery id is
   `v - 27` when `v >= 27`, else `v`; it must be 0 or 1.
4. **Reject `s > n/2`** (non-canonical, "high-S"). Such a signature recovers to
   the same address but is rejected by ethers.js and viem, so an expert
   re-running the verification with standard tooling could not reproduce it. The
   canister rejects high-S on ingest.
5. Recover the public key, take `keccak256(pubkey[1..65])[12..32]` as the
   address, and compare case-insensitively to `wallet_address`.

A verifier must **rebuild** the message from §3 rather than trusting the
`signed_message` string stored on the record, must **recompute** the commitment
from §2 rather than trusting `data_commitment_sha256`, and must **recompute**
the holder commitment from §2b against the profile revision named by the
record's `holder_revision` — not against the holder's current profile. An export
carries the holder's full revision history precisely so the right one can be
selected. Both stored
copies are conveniences; the derived values are authoritative. `verifyRecord`
reports a mismatch between stored and derived as a failure.

---

## 5. Procedure

**Where an export comes from.** Each holder exports their *own* records from the
Verify page ("Download my evidence"), via reads scoped to their own Internet
Identity. The canister has no operator-side bulk read or export: the admin sees
only Telegram handles and verdicts the canister computes. So a file passed to
this verifier was produced by the holder it describes.

```bash
cd verify
npm install                                  # @noble/curves, @noble/hashes only
node selftest.mjs                            # confirm this implementation matches the canister's vectors
node verify-attestation.mjs bundle.json      # verify every record in an export
node verify-attestation.mjs bundle.json --show 0
```

`--show <i>` prints the exact commitment preimage, its SHA-256, the exact signed
message and its UTF-8 byte length, so the result can be reproduced by hand with
any unrelated tool (for example by pasting the message, signature and address
into a third-party signature checker).

Establish independently what code produced the export:

```bash
dfx canister info backend --network ic       # module hash, from the IC itself
```

and compare that hash to the one built from the git commit the export claims.
The export manifest records the canister id, the client-clock export time, and
the SHA-256 of the export body; `verify-attestation.mjs` re-checks the body
hash on load.

---

## 6. Notes for a certifying witness

For US Federal Rule of Evidence 902(13)/(14) purposes, the certifying person
should be able to state: what the system does and does not establish (§1), that
the export's SHA-256 matches the manifest, that `node selftest.mjs` passes
against the canister's published vectors, that `verify-attestation.mjs` reports
every record as PASS — which includes confirming that the identity each
signature was made under is the identity presented with the claim —
and that the module hash obtained from the Internet Computer matches the code
commit relied upon. Rule 902(13)/(14) also require advance written notice to
opposing parties and a certification meeting Rule 902(11)/(12).

Nothing in this document is legal advice, and the characterisation questions in
§1.4 are for counsel in the relevant jurisdiction.
