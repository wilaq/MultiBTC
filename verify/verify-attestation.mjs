#!/usr/bin/env node
/**
 * Standalone verifier for multiBTC Holders Group wallet attestations.
 *
 * Deliberately independent: it does NOT import anything from src/backend or
 * src/frontend, and it never contacts the canister. It reimplements the
 * canonical serialisation from verify/SPEC.md and re-derives every value from
 * the exported record alone. Agreement between this implementation, the Rust
 * canister and the TypeScript frontend is what makes a record verifiable; if it
 * only ran the project's own code it would prove nothing.
 *
 * Usage:
 *   node verify-attestation.mjs <evidence-bundle.json> [--show <index>]
 *
 * Exit code 0 = every record verified, 1 = at least one failure.
 */
import { readFileSync } from 'node:fs';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';

const enc = new TextEncoder();
const toHex = (b) => Buffer.from(b).toString('hex');
const fromHex = (h) => Uint8Array.from(Buffer.from(h, 'hex'));
const hexUtf8 = (s) => toHex(enc.encode(s ?? ''));

// ---------------------------------------------------------------------------
// Candid -> plain JS. An agent-js dump writes `opt T` as [] / [value],
// `principal` as {"__principal__": "..."}, and nat/nat64 as a BigInt (exported
// as a decimal string). Accept all of those shapes verbatim so the input can be
// a faithful dump of exactly what the canister returned.
// ---------------------------------------------------------------------------
function opt(v) {
  if (Array.isArray(v)) return v.length ? v[0] : null;
  return v === undefined ? null : v;
}
function principalText(v) {
  if (v && typeof v === 'object' && '__principal__' in v) return v.__principal__;
  if (typeof v === 'string') return v;
  throw new Error(`unrecognised principal encoding: ${JSON.stringify(v)}`);
}
/** nat / nat64 / nat128 -> exact decimal string (never through a JS number). */
function nat(v) {
  const x = opt(v);
  if (x === null || x === '') return '';
  if (typeof x === 'bigint') return x.toString();
  if (typeof x === 'number') {
    if (!Number.isSafeInteger(x)) throw new Error(`unsafe integer in export: ${x}`);
    return String(x);
  }
  if (typeof x === 'string') {
    if (!/^\d+$/.test(x)) throw new Error(`not a decimal integer: ${x}`);
    return x;
  }
  throw new Error(`unrecognised nat encoding: ${JSON.stringify(x)}`);
}
/** float64 -> fixed 6 decimals, matching Rust's `{:.6}`. */
function f64(v) {
  const x = opt(v);
  return x === null ? '' : Number(x).toFixed(6);
}
function optHex(v) {
  const x = opt(v);
  return x === null ? '' : hexUtf8(x);
}

function positionKind(kind) {
  const [tag] = Object.keys(kind);
  const val = kind[tag];
  switch (tag) {
    case 'RawToken':
      return 'RawToken';
    case 'Lp':
      return `Lp:${hexUtf8(val.protocol)}:${hexUtf8(val.pool)}`;
    case 'Vault':
      return `Vault:${hexUtf8(val.protocol)}:${hexUtf8(val.name)}`;
    case 'Other':
      return `Other:${hexUtf8(val)}`;
    default:
      throw new Error(`unknown position kind: ${tag}`);
  }
}

function commChannelStr(c) {
  const [tag] = Object.keys(c);
  if (tag === 'Email' || tag === 'Telegram') return tag;
  if (tag === 'Other') return `Other:${hexUtf8(c.Other)}`;
  throw new Error(`unknown comm channel: ${tag}`);
}
const variantTag = (v, fallback) => (v && typeof v === 'object' ? Object.keys(v)[0] : v) ?? fallback;

// ---------------------------------------------------------------------------
// Holder canonical serialisation (SPEC.md §2b).
//
// The per-wallet signature commits to this, so the identity behind a claim is
// covered by the signature rather than being mutable form state.
// ---------------------------------------------------------------------------
export function serialiseHolder(hp) {
  const L = [];
  L.push(`ack_engagement_letter_to_follow=${!!hp.ack_engagement_letter_to_follow}`);
  L.push(`ack_fee_structure=${!!hp.ack_fee_structure}`);
  L.push(`ack_group_strategy_coordinated=${!!hp.ack_group_strategy_coordinated}`);
  L.push(`ack_site_not_affiliated=${!!hp.ack_site_not_affiliated}`);
  L.push(`additional_documentation_notes=${optHex(hp.additional_documentation_notes)}`);
  L.push(`consent_data_use_for_legal=${!!hp.consent_data_use_for_legal}`);
  L.push(`consent_group_representation=${!!hp.consent_group_representation}`);
  L.push(`country_of_residence=${hexUtf8(hp.country_of_residence)}`);
  L.push(`date_of_birth_iso=${hexUtf8(hp.date_of_birth_iso)}`);
  L.push(`email=${hexUtf8(hp.email)}`);
  L.push(`fee_preference=${variantTag(hp.fee_preference, 'Undecided')}`);
  L.push(`has_filed_pod=${!!hp.has_filed_pod}`);
  L.push(`legal_name=${hexUtf8(hp.legal_name)}`);
  L.push(`naming_preference=${variantTag(hp.naming_preference, 'AnonymousViaRepresentative')}`);
  L.push(`nationality=${hexUtf8(hp.nationality)}`);
  L.push(`needs_help_filing_pod=${!!hp.needs_help_filing_pod}`);
  L.push(`other_multichain_claims=${optHex(hp.other_multichain_claims)}`);
  L.push(`pod_filed_date_iso=${optHex(hp.pod_filed_date_iso)}`);
  L.push(`pod_reference=${optHex(hp.pod_reference)}`);
  L.push(`preferred_comm_channel=${commChannelStr(opt(hp.preferred_comm_channel))}`);
  L.push(`preferred_payment_method=${optHex(hp.preferred_payment_method)}`);
  L.push(`principal=${principalText(hp.principal)}`);
  L.push(`revision=${Number(hp.revision)}`);
  L.push(`submitted_at_ns=${nat(hp.submitted_at_ns)}`);
  L.push(`telegram_handle=${optHex(hp.telegram_handle)}`);
  L.push(`truthfully_attested=${!!hp.truthfully_attested}`);
  return L.join('\n');
}

export const commitHolder = (hp) => toHex(sha256(enc.encode(serialiseHolder(hp))));

// ---------------------------------------------------------------------------
// Canonical serialisation (SPEC.md §2). Fixed lexicographic line order, values
// hex-encoded so that a newline or '=' inside user text cannot forge a line.
// ---------------------------------------------------------------------------
export function serialiseAttest(r, holderRevision, holderCommitment) {
  const L = [];
  L.push(`acquired_post_incident=${!!r.acquired_post_incident}`);
  L.push(`approximate_total_claim=${nat(r.approximate_total_claim)}`);
  L.push(`attempted_bridge_redemption=${!!r.attempted_bridge_redemption}`);
  const bridge = r.bridge_attempts ?? [];
  L.push(`bridge_attempts=${bridge.length}`);
  bridge.forEach((a, i) => {
    L.push(`bridge_attempts.${i}.chain=${hexUtf8(a.chain)}`);
    L.push(`bridge_attempts.${i}.description=${optHex(a.description)}`);
    L.push(`bridge_attempts.${i}.tx_hash=${hexUtf8(a.tx_hash)}`);
  });
  L.push(`detected_bsc=${nat(r.detected_bsc)}`);
  L.push(`detected_canto=${nat(r.detected_canto)}`);
  L.push(`detected_eth=${nat(r.detected_eth)}`);
  L.push(`detected_polygon=${nat(r.detected_polygon)}`);
  L.push(`held_pre_incident=${!!r.held_pre_incident}`);
  L.push(`holder_commitment=${holderCommitment}`);
  L.push(`holder_revision=${holderRevision}`);
  L.push(`linked_principal=${principalText(r.linked_principal)}`);
  L.push(`pod_filed_for_this_wallet=${!!r.pod_filed_for_this_wallet}`);
  L.push(`pod_reference_for_this_wallet=${optHex(r.pod_reference_for_this_wallet)}`);
  const positions = r.positions ?? [];
  L.push(`positions=${positions.length}`);
  positions.forEach((p, i) => {
    L.push(`positions.${i}.chain=${hexUtf8(p.chain)}`);
    L.push(`positions.${i}.declared_multibtc=${nat(p.declared_multibtc)}`);
    L.push(`positions.${i}.kind=${positionKind(p.kind)}`);
  });
  const acq = r.post_incident_acquisitions ?? [];
  L.push(`post_incident_acquisitions=${acq.length}`);
  acq.forEach((a, i) => {
    const k = `post_incident_acquisitions.${i}`;
    L.push(`${k}.acquisition_date_iso=${hexUtf8(a.acquisition_date_iso)}`);
    L.push(`${k}.amount_multibtc=${nat(a.amount_multibtc)}`);
    L.push(`${k}.chain=${hexUtf8(a.chain)}`);
    L.push(`${k}.notes=${optHex(a.notes)}`);
    L.push(`${k}.price_paid_usd=${f64(a.price_paid_usd)}`);
  });
  L.push(`revision=${Number(r.revision)}`);
  const tx = r.support_tx_hashes ?? [];
  L.push(`support_tx_hashes=${tx.length}`);
  tx.forEach((h, i) => L.push(`support_tx_hashes.${i}=${hexUtf8(h)}`));
  L.push(`wallet_address=${String(r.wallet_address).toLowerCase()}`);
  return L.join('\n');
}

export const commitAttest = (r, hRev, hCommit) =>
  toHex(sha256(enc.encode(serialiseAttest(r, hRev, hCommit))));

// ---------------------------------------------------------------------------
// Canonical signed message (SPEC.md §3). The em dash is U+2014: the EIP-191
// length prefix counts UTF-8 BYTES, not characters.
// ---------------------------------------------------------------------------
const ATTESTATION_BODY =
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
  '\n';

export function buildAttestationMessage({
  wallet,
  principal,
  revision,
  legalName,
  dateOfBirthIso,
  holderRevision,
  holderCommitHex,
  commitHex,
  signedAtIso,
  nonce,
}) {
  return (
    ATTESTATION_BODY +
    `Wallet:           ${wallet}\n` +
    `Linked principal: ${principal}\n` +
    `Revision:         ${revision}\n` +
    `Holder:           ${legalName}\n` +
    `Date of birth:    ${dateOfBirthIso}\n` +
    `Holder profile:   revision ${holderRevision}, 0x${holderCommitHex}\n` +
    `Data commitment:  0x${commitHex}\n` +
    `Timestamp:        ${signedAtIso}\n` +
    `Nonce:            ${nonce}`
  );
}

// ---------------------------------------------------------------------------
// EIP-191 personal_sign recovery (SPEC.md §4).
// ---------------------------------------------------------------------------
export function recoverAddress(message, sigHex) {
  const raw = fromHex(String(sigHex).replace(/^0x/i, ''));
  if (raw.length !== 65) throw new Error(`signature must be 65 bytes, got ${raw.length}`);
  const v = raw[64];
  const rec = v >= 27 ? v - 27 : v;
  if (rec !== 0 && rec !== 1) throw new Error(`invalid recovery id (v=${v})`);

  let sig = secp256k1.Signature.fromBytes(raw.slice(0, 64), 'compact');
  // Reject malleated (high-S) signatures: they recover to the same address here
  // but are rejected by ethers.js/viem, so an expert could not reproduce them.
  if (sig.s > secp256k1.Point.Fn.ORDER / 2n) {
    throw new Error('non-canonical (high-S) signature');
  }
  sig = sig.addRecoveryBit(rec);

  const body = enc.encode(message);
  const prefixed = new Uint8Array([
    ...enc.encode(`\x19Ethereum Signed Message:\n${body.length}`),
    ...body,
  ]);
  const pub = sig.recoverPublicKey(keccak_256(prefixed)).toBytes(false); // 0x04 || X || Y
  return '0x' + toHex(keccak_256(pub.slice(1)).slice(-20));
}

// ---------------------------------------------------------------------------
// Per-record verification
// ---------------------------------------------------------------------------
export function verifyRecord(r, holderProfile) {
  const problems = [];
  const wallet = String(r.wallet_address).toLowerCase();
  const principal = principalText(r.linked_principal);
  const revision = Number(r.revision);
  const holderRevision = Number(r.holder_revision);

  if (!holderProfile) {
    return {
      wallet,
      principal,
      revision,
      holderRevision,
      problems: [
        `holder profile revision ${holderRevision} is not in this export, so the identity ` +
          `this signature covers cannot be checked`,
      ],
    };
  }
  if (Number(holderProfile.revision) !== holderRevision) {
    problems.push(
      `holder profile supplied is revision ${Number(holderProfile.revision)}, signature covers ${holderRevision}`,
    );
  }
  const holderCommit = commitHolder(holderProfile);

  // 1. Re-derive the commitment from the payload the canister stored.
  const preimage = serialiseAttest(r, holderRevision, holderCommit);
  const commit = toHex(sha256(enc.encode(preimage)));
  const storedCommit = String(r.data_commitment_sha256 ?? '').replace(/^0x/i, '').toLowerCase();
  if (commit !== storedCommit) {
    problems.push(
      `data commitment mismatch: recomputed ${commit}, record claims ${storedCommit || '(empty)'} ` +
        `-- the stored payload is not what was signed`,
    );
  }

  // 2. Rebuild the signed message from its components (never trust the stored copy).
  const message = buildAttestationMessage({
    wallet,
    principal,
    revision,
    legalName: holderProfile.legal_name,
    dateOfBirthIso: holderProfile.date_of_birth_iso,
    holderRevision,
    holderCommitHex: holderCommit,
    commitHex: commit,
    signedAtIso: r.signed_at_iso,
    nonce: r.nonce,
  });
  if (typeof r.signed_message === 'string' && r.signed_message !== message) {
    problems.push('stored signed_message differs from the message rebuilt from the record fields');
  }

  // 3. Recover the signer and compare to the claimed wallet.
  let recovered = null;
  try {
    recovered = recoverAddress(message, r.signature);
    if (recovered.toLowerCase() !== wallet) {
      problems.push(`signature recovers to ${recovered}, not ${wallet}`);
    }
  } catch (e) {
    problems.push(`signature: ${e.message}`);
  }

  return {
    wallet,
    principal,
    revision,
    holderRevision,
    legalName: holderProfile.legal_name,
    commit,
    holderCommit,
    recovered,
    message,
    preimage,
    problems,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
/**
 * Flatten an export into [attestation, holder profile it was signed against]
 * pairs. Each bundle carries the holder's full revision history, so the exact
 * revision a signature covers can be recovered even after later profile edits.
 */
function collectPairs(doc) {
  const bundles = Array.isArray(doc?.bundles) ? doc.bundles : Array.isArray(doc) ? doc : [doc];
  const out = [];
  for (const b of bundles) {
    if (!b || typeof b !== 'object') continue;
    const byRev = new Map();
    for (const h of [...(b.holder_revisions ?? []), b.profile].filter(Boolean)) {
      byRev.set(Number(h.revision), h);
    }
    const attestations = [
      ...(b.wallets ?? []),
      ...(b.wallet_revisions ?? []).flatMap((e) => (Array.isArray(e) ? e[1] ?? [] : [])),
    ];
    for (const a of attestations) {
      if (!a || !('wallet_address' in a)) continue;
      out.push([a, byRev.get(Number(a.holder_revision)) ?? null]);
    }
  }
  // The latest revision appears in both `wallets` and `wallet_revisions`.
  const seen = new Set();
  return out.filter(([a]) => {
    const k = `${String(a.wallet_address).toLowerCase()}#${a.revision}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: node verify-attestation.mjs <evidence-bundle.json> [--show <index>]');
    process.exit(2);
  }
  const doc = JSON.parse(readFileSync(file, 'utf8'));

  if (doc && doc.manifest) {
    const { canister_id, module_hash, exported_at_client_iso, body_sha256 } = doc.manifest;
    console.log('Manifest');
    console.log(`  canister              ${canister_id ?? '(absent)'}`);
    console.log(`  module hash           ${module_hash ?? '(absent)'}`);
    console.log(`  exported (client clk) ${exported_at_client_iso ?? '(absent)'}`);
    if (body_sha256) {
      const actual = toHex(sha256(enc.encode(JSON.stringify(doc.bundles))));
      const ok = actual === String(body_sha256).replace(/^0x/i, '');
      console.log(`  body sha256           ${actual} ${ok ? 'MATCHES manifest' : 'DOES NOT MATCH manifest'}`);
      if (!ok) process.exitCode = 1;
    }
    console.log('');
  }

  const records = collectPairs(doc);
  if (!records.length) {
    console.error('no wallet attestations found in that file');
    process.exit(2);
  }

  const showIdx = args.includes('--show') ? Number(args[args.indexOf('--show') + 1]) : null;
  let failed = 0;
  records.forEach(([rec, holder], i) => {
    const v = verifyRecord(rec, holder);
    const ok = v.problems.length === 0;
    if (!ok) failed++;
    const who = v.legalName ? `  ${v.legalName}` : '';
    console.log(
      `[${i}] ${ok ? 'PASS' : 'FAIL'}  ${v.wallet}  rev ${v.revision}  ` +
        `holder rev ${v.holderRevision}${who}  ${v.principal}`,
    );
    v.problems.forEach((p) => console.log(`       ! ${p}`));
    if (showIdx === i) {
      console.log('\n--- holder commitment preimage (sha256 of these exact bytes) ---');
      console.log(serialiseHolder(holder));
      console.log(`--- sha256 = ${v.holderCommit}`);
      console.log('\n--- commitment preimage (sha256 of these exact bytes) ---');
      console.log(v.preimage);
      console.log(`--- sha256 = ${v.commit}`);
      console.log('\n--- signed message (EIP-191 personal_sign of these exact bytes) ---');
      console.log(v.message);
      console.log(`--- utf-8 byte length = ${enc.encode(v.message).length}`);
      console.log(`--- recovered signer  = ${v.recovered}\n`);
    }
  });

  console.log(`\n${records.length - failed}/${records.length} attestations verified.`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
