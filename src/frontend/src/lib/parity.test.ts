import { describe, it, expect } from 'vitest';
import { buildAdminMessage, buildAttestationMessage, buildLinkMessage } from './message';
import { Principal } from '@dfinity/principal';
import {
  serialiseAttest,
  serialiseHolder,
  holderToCommit,
  sha256Hex,
  commitAttest,
  commitHolder,
  type AttestPayloadForCommit,
  type HolderForCommit,
  type PositionDetail,
} from './dataCommitment';

const ADMIN_ADDR = '0xd381e358d6b4e176559d3d76109985ed83259aec';
const NIL_PRINCIPAL = 'aaaaa-aa';
const NONCE = '11111111-1111-4111-8111-111111111111';
const ISO = '2026-05-13T18:00:00Z';
// Must match HC in src/backend/src/commitment.rs tests.
const HC = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

/** Must match holder() in src/backend/src/commitment.rs tests. */
function holderFixture(): HolderForCommit {
  return {
    revision: 3,
    principalText: NIL_PRINCIPAL,
    legalName: 'Alice Smith',
    dateOfBirthIso: '1980-01-01',
    nationality: 'SG',
    countryOfResidence: 'SG',
    email: 'alice@example.com',
    telegramHandle: null,
    preferredCommChannel: { kind: 'Email' },
    hasFiledPod: true,
    podFiledDateIso: '2025-06-01',
    podReference: 'PoD-1',
    needsHelpFilingPod: false,
    consentGroupRepresentation: true,
    consentDataUseForLegal: true,
    ackEngagementLetterToFollow: true,
    ackFeeStructure: true,
    ackGroupStrategyCoordinated: true,
    ackSiteNotAffiliated: true,
    truthfullyAttested: true,
    feePreference: 'ProportionalToClaim',
    preferredPaymentMethod: null,
    namingPreference: 'AnonymousViaRepresentative',
    otherMultichainClaims: null,
    additionalDocumentationNotes: null,
    submittedAtNs: 1_700_000_000_000_000_000n,
  };
}

describe('canonical message parity (mirrors src/backend/src/message.rs)', () => {
  it('link message matches golden', () => {
    const m = buildLinkMessage(ADMIN_ADDR, NIL_PRINCIPAL, ISO, NONCE);
    expect(m).toBe(
      'multiBTC Holders Group — Identity Binding\n' +
        '\n' +
        'I bind this Ethereum wallet to my Internet Identity principal so that\n' +
        'only I can view and edit my verification record.\n' +
        '\n' +
        `Wallet:    ${ADMIN_ADDR}\n` +
        `Principal: ${NIL_PRINCIPAL}\n` +
        `Timestamp: ${ISO}\n` +
        `Nonce:     ${NONCE}`,
    );
  });

  it('attestation message matches Rust golden byte-for-byte', () => {
    const commit = '0'.repeat(64);
    const m = buildAttestationMessage(
      ADMIN_ADDR,
      NIL_PRINCIPAL,
      0,
      'Alice Smith',
      '1980-01-01',
      3,
      HC,
      commit,
      ISO,
      NONCE,
    );
    // Must stay identical to ATTESTATION_GOLDEN in src/backend/src/message.rs.
    const expected =
      'multiBTC Holders Group — Verification & Authorization\n' +
      '\n' +
      'I, the controller of this wallet, declare:\n' +
      '\n' +
      '1. I hold or have held multiBTC tokens at this address.\n' +
      '2. I support the coordinated pursuit of asset-specific recovery\n' +
      '   for multiBTC holders in the Multichain Foundation Ltd. liquidation.\n' +
      '3. I authorize the appointed legal representative of the multiBTC\n' +
      '   Holders Group to act on my behalf in proceedings related to the\n' +
      '   Multichain liquidation (Singapore HC/CWU 134/2025;\n' +
      '   U.S. Bankruptcy Court SDNY 25-12340-DSJ).\n' +
      '4. I understand this is a group coordination effort with shared costs\n' +
      '   (either upfront cost-share or litigation funding, per my preference).\n' +
      '5. I attest under penalty of perjury that the information I have\n' +
      '   provided alongside this signature is true, accurate, and complete\n' +
      '   to the best of my knowledge.\n' +
      '\n' +
      `Wallet:           ${ADMIN_ADDR}\n` +
      `Linked principal: ${NIL_PRINCIPAL}\n` +
      `Revision:         0\n` +
      `Holder:           Alice Smith\n` +
      `Date of birth:    1980-01-01\n` +
      `Holder profile:   revision 3, 0x${HC}\n` +
      `Data commitment:  0x${commit}\n` +
      `Timestamp:        ${ISO}\n` +
      `Nonce:            ${NONCE}`;
    expect(m).toBe(expected);
  });

  it('admin message matches golden', () => {
    const m = buildAdminMessage(ISO, 'abc');
    expect(m).toBe(
      'multiBTC Holders Group — Admin Access\n' +
        '\n' +
        'I am authenticating as the admin operator.\n' +
        `Timestamp: ${ISO}\n` +
        `Nonce:     abc`,
    );
  });
});

function emptyPayload(): AttestPayloadForCommit {
  return {
    walletAddress: ADMIN_ADDR,
    detectedEth: 0n,
    detectedBsc: 0n,
    detectedPolygon: 0n,
    detectedCanto: 0n,
    positions: [],
    approximateTotalClaim: null,
    heldPreIncident: false,
    acquiredPostIncident: false,
    postIncidentAcquisitions: [],
    attemptedBridgeRedemption: false,
    bridgeAttempts: [],
    podFiledForThisWallet: false,
    podReferenceForThisWallet: null,
    supportTxHashes: [],
  };
}

describe('data commitment parity (mirrors src/backend/src/commitment.rs)', () => {
  it('empty payload serialises byte-for-byte identical to Rust golden', () => {
    const s = serialiseAttest(emptyPayload(), NIL_PRINCIPAL, 0, 3, HC);
    expect(s).toBe(
      `acquired_post_incident=false
approximate_total_claim=
attempted_bridge_redemption=false
bridge_attempts=0
detected_bsc=0
detected_canto=0
detected_eth=0
detected_polygon=0
held_pre_incident=false
holder_commitment=${HC}
holder_revision=3
linked_principal=${NIL_PRINCIPAL}
pod_filed_for_this_wallet=false
pod_reference_for_this_wallet=
positions=0
post_incident_acquisitions=0
revision=0
support_tx_hashes=0
wallet_address=${ADMIN_ADDR}`,
    );
  });

  it('positions + post-incident match the Rust spot-checks', () => {
    const p: AttestPayloadForCommit = {
      ...emptyPayload(),
      detectedEth: 100_000_000n,
      heldPreIncident: true,
      acquiredPostIncident: true,
      positions: [
        {
          chain: 'ethereum',
          kind: { kind: 'RawToken' },
          declaredMultibtc: 100_000_000n,
        },
        {
          chain: 'bsc',
          kind: { kind: 'Lp', protocol: 'Thena', pool: 'BTCB/multiBTC' },
          declaredMultibtc: 250_000_000n,
        },
      ] satisfies PositionDetail[],
      postIncidentAcquisitions: [
        {
          acquisitionDateIso: '2024-01-15',
          chain: 'bsc',
          amountMultibtc: 50_000_000n,
          pricePaidUsd: 1234.5,
          notes: 'test',
        },
      ],
    };
    const s = serialiseAttest(p, NIL_PRINCIPAL, 2, 3, HC);
    expect(s).toContain('positions=2');
    expect(s).toContain('positions.0.chain=657468657265756d');
    expect(s).toContain('positions.0.kind=RawToken');
    expect(s).toContain('positions.1.kind=Lp:5468656e61:425443422f6d756c7469425443');
    expect(s).toContain('post_incident_acquisitions=1');
    expect(s).toContain('post_incident_acquisitions.0.price_paid_usd=1234.500000');
    expect(s).toContain('revision=2');
  });

  it('sha256Hex of empty payload matches what commitAttest computes', async () => {
    const s = serialiseAttest(emptyPayload(), NIL_PRINCIPAL, 0, 3, HC);
    const expected = await sha256Hex(s);
    const got = await commitAttest(emptyPayload(), NIL_PRINCIPAL, 0, 3, HC);
    expect(got).toBe(expected);
    expect(got).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('holder commitment parity (mirrors commitment.rs::serialise_holder)', () => {
  it('holder profile serialises byte-for-byte identical to Rust golden', () => {
    // Must stay identical to golden_holder_serialisation in commitment.rs.
    expect(serialiseHolder(holderFixture())).toBe(
      `ack_engagement_letter_to_follow=true
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
principal=${NIL_PRINCIPAL}
revision=3
submitted_at_ns=1700000000000000000
telegram_handle=
truthfully_attested=true`,
    );
  });

  // The adapter converts the canister's candid shape (opt as [] / [x], variants
  // as single-key objects, Principal objects, bigint nat) into the mirror's
  // input. A bug here would not fail typecheck but WOULD make every submission
  // bounce with "data commitment mismatch", so it is checked against the same
  // Rust golden rather than a hand-built object.
  it('the candid adapter feeds the serialiser exactly what Rust hashes', () => {
    const candidProfile = {
      revision: 3,
      principal: Principal.fromText(NIL_PRINCIPAL),
      legal_name: 'Alice Smith',
      date_of_birth_iso: '1980-01-01',
      nationality: 'SG',
      country_of_residence: 'SG',
      email: 'alice@example.com',
      telegram_handle: [] as [],
      preferred_comm_channel: { Email: null },
      has_filed_pod: true,
      pod_filed_date_iso: ['2025-06-01'] as [string],
      pod_reference: ['PoD-1'] as [string],
      needs_help_filing_pod: false,
      consent_group_representation: true,
      consent_data_use_for_legal: true,
      ack_engagement_letter_to_follow: true,
      ack_fee_structure: true,
      ack_group_strategy_coordinated: true,
      ack_site_not_affiliated: true,
      truthfully_attested: true,
      fee_preference: { ProportionalToClaim: null },
      preferred_payment_method: [] as [],
      naming_preference: { AnonymousViaRepresentative: null },
      other_multichain_claims: [] as [],
      additional_documentation_notes: [] as [],
      submitted_at_ns: 1_700_000_000_000_000_000n,
    };
    expect(serialiseHolder(holderToCommit(candidProfile))).toBe(
      serialiseHolder(holderFixture()),
    );
  });

  it('changing identity changes the holder commitment', async () => {
    const base = await commitHolder(holderFixture());
    const renamed = await commitHolder({ ...holderFixture(), legalName: 'Bob Jones' });
    const refee = await commitHolder({ ...holderFixture(), feePreference: 'LitigationFunding' });
    expect(renamed).not.toBe(base);
    expect(refee).not.toBe(base);
  });

  it('the attestation commitment moves when the bound holder revision does', async () => {
    const hc = await commitHolder(holderFixture());
    const a = await commitAttest(emptyPayload(), NIL_PRINCIPAL, 0, 3, hc);
    const b = await commitAttest(emptyPayload(), NIL_PRINCIPAL, 0, 4, hc);
    expect(a).not.toBe(b);
  });
});
