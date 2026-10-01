// Byte-for-byte mirror of src/backend/src/commitment.rs.
// Any change here MUST be made in the Rust file too — see parity tests.
import type { HolderProfile } from './backend';

export type PositionType =
  | { kind: 'RawToken' }
  | { kind: 'Lp'; protocol: string; pool: string }
  | { kind: 'Vault'; protocol: string; name: string }
  | { kind: 'Other'; text: string };

export interface PositionDetail {
  chain: string;
  kind: PositionType;
  declaredMultibtc: bigint;
}

export interface BridgeAttempt {
  chain: string;
  txHash: string;
  description: string | null;
}

export interface PostIncidentAcquisition {
  acquisitionDateIso: string;
  chain: string;
  amountMultibtc: bigint;
  pricePaidUsd: number | null;
  notes: string | null;
}

export interface AttestPayloadForCommit {
  walletAddress: string;
  detectedEth: bigint;
  detectedBsc: bigint;
  detectedPolygon: bigint;
  detectedCanto: bigint;
  positions: PositionDetail[];
  approximateTotalClaim: bigint | null;
  heldPreIncident: boolean;
  acquiredPostIncident: boolean;
  postIncidentAcquisitions: PostIncidentAcquisition[];
  attemptedBridgeRedemption: boolean;
  bridgeAttempts: BridgeAttempt[];
  podFiledForThisWallet: boolean;
  podReferenceForThisWallet: string | null;
  supportTxHashes: string[];
}

function utf8Hex(s: string): string {
  const enc = new TextEncoder().encode(s);
  let out = '';
  for (const b of enc) out += b.toString(16).padStart(2, '0');
  return out;
}

function h(s: string): string {
  return utf8Hex(s);
}
function oh(s: string | null | undefined): string {
  return s == null ? '' : utf8Hex(s);
}
function ou(v: bigint | null | undefined): string {
  return v == null ? '' : v.toString();
}
function of(v: number | null | undefined): string {
  return v == null ? '' : v.toFixed(6);
}
function positionTypeStr(k: PositionType): string {
  switch (k.kind) {
    case 'RawToken':
      return 'RawToken';
    case 'Lp':
      return `Lp:${utf8Hex(k.protocol)}:${utf8Hex(k.pool)}`;
    case 'Vault':
      return `Vault:${utf8Hex(k.protocol)}:${utf8Hex(k.name)}`;
    case 'Other':
      return `Other:${utf8Hex(k.text)}`;
  }
}

/** Mirrors `HolderProfile` as returned by the canister (candid `opt` unwrapped). */
export interface HolderForCommit {
  revision: number;
  principalText: string;
  legalName: string;
  dateOfBirthIso: string;
  nationality: string;
  countryOfResidence: string;
  email: string;
  telegramHandle: string | null;
  preferredCommChannel: { kind: 'Email' } | { kind: 'Telegram' } | { kind: 'Other'; text: string };
  hasFiledPod: boolean;
  podFiledDateIso: string | null;
  podReference: string | null;
  needsHelpFilingPod: boolean;
  consentGroupRepresentation: boolean;
  consentDataUseForLegal: boolean;
  ackEngagementLetterToFollow: boolean;
  ackFeeStructure: boolean;
  ackGroupStrategyCoordinated: boolean;
  ackSiteNotAffiliated: boolean;
  truthfullyAttested: boolean;
  feePreference: 'UpfrontCostShare' | 'LitigationFunding' | 'ProportionalToClaim' | 'Undecided';
  preferredPaymentMethod: string | null;
  namingPreference: 'WillingToBeNamed' | 'AnonymousViaRepresentative';
  otherMultichainClaims: string | null;
  additionalDocumentationNotes: string | null;
  submittedAtNs: bigint;
}

function commChannelStr(c: HolderForCommit['preferredCommChannel']): string {
  switch (c.kind) {
    case 'Email':
      return 'Email';
    case 'Telegram':
      return 'Telegram';
    case 'Other':
      return `Other:${utf8Hex(c.text)}`;
  }
}

/** Candid HolderProfile -> the shape the canonical serialiser expects. */
export function holderToCommit(h: HolderProfile): HolderForCommit {
  const comm = h.preferred_comm_channel;
  return {
    revision: Number(h.revision),
    principalText: h.principal.toText(),
    legalName: h.legal_name,
    dateOfBirthIso: h.date_of_birth_iso,
    nationality: h.nationality,
    countryOfResidence: h.country_of_residence,
    email: h.email,
    telegramHandle: h.telegram_handle[0] ?? null,
    preferredCommChannel:
      'Email' in comm ? { kind: 'Email' } : 'Telegram' in comm ? { kind: 'Telegram' } : { kind: 'Other', text: comm.Other },
    hasFiledPod: h.has_filed_pod,
    podFiledDateIso: h.pod_filed_date_iso[0] ?? null,
    podReference: h.pod_reference[0] ?? null,
    needsHelpFilingPod: h.needs_help_filing_pod,
    consentGroupRepresentation: h.consent_group_representation,
    consentDataUseForLegal: h.consent_data_use_for_legal,
    ackEngagementLetterToFollow: h.ack_engagement_letter_to_follow,
    ackFeeStructure: h.ack_fee_structure,
    ackGroupStrategyCoordinated: h.ack_group_strategy_coordinated,
    ackSiteNotAffiliated: h.ack_site_not_affiliated,
    truthfullyAttested: h.truthfully_attested,
    feePreference: (Object.keys(h.fee_preference)[0] ?? 'Undecided') as HolderForCommit['feePreference'],
    preferredPaymentMethod: h.preferred_payment_method[0] ?? null,
    namingPreference: (Object.keys(h.naming_preference)[0] ??
      'AnonymousViaRepresentative') as HolderForCommit['namingPreference'],
    otherMultichainClaims: h.other_multichain_claims[0] ?? null,
    additionalDocumentationNotes: h.additional_documentation_notes[0] ?? null,
    submittedAtNs: h.submitted_at_ns,
  };
}

/** Candid HolderProfile -> the shape the canonical serialiser expects. */
/** Mirror of `commitment.rs::serialise_holder`. */
export function serialiseHolder(hp: HolderForCommit): string {
  const l: string[] = [];
  l.push(`ack_engagement_letter_to_follow=${hp.ackEngagementLetterToFollow}`);
  l.push(`ack_fee_structure=${hp.ackFeeStructure}`);
  l.push(`ack_group_strategy_coordinated=${hp.ackGroupStrategyCoordinated}`);
  l.push(`ack_site_not_affiliated=${hp.ackSiteNotAffiliated}`);
  l.push(`additional_documentation_notes=${oh(hp.additionalDocumentationNotes)}`);
  l.push(`consent_data_use_for_legal=${hp.consentDataUseForLegal}`);
  l.push(`consent_group_representation=${hp.consentGroupRepresentation}`);
  l.push(`country_of_residence=${h(hp.countryOfResidence)}`);
  l.push(`date_of_birth_iso=${h(hp.dateOfBirthIso)}`);
  l.push(`email=${h(hp.email)}`);
  l.push(`fee_preference=${hp.feePreference}`);
  l.push(`has_filed_pod=${hp.hasFiledPod}`);
  l.push(`legal_name=${h(hp.legalName)}`);
  l.push(`naming_preference=${hp.namingPreference}`);
  l.push(`nationality=${h(hp.nationality)}`);
  l.push(`needs_help_filing_pod=${hp.needsHelpFilingPod}`);
  l.push(`other_multichain_claims=${oh(hp.otherMultichainClaims)}`);
  l.push(`pod_filed_date_iso=${oh(hp.podFiledDateIso)}`);
  l.push(`pod_reference=${oh(hp.podReference)}`);
  l.push(`preferred_comm_channel=${commChannelStr(hp.preferredCommChannel)}`);
  l.push(`preferred_payment_method=${oh(hp.preferredPaymentMethod)}`);
  l.push(`principal=${hp.principalText}`);
  l.push(`revision=${hp.revision}`);
  l.push(`submitted_at_ns=${hp.submittedAtNs}`);
  l.push(`telegram_handle=${oh(hp.telegramHandle)}`);
  l.push(`truthfully_attested=${hp.truthfullyAttested}`);
  return l.join('\n');
}

export async function commitHolder(hp: HolderForCommit): Promise<string> {
  return sha256Hex(serialiseHolder(hp));
}

export function serialiseAttest(
  p: AttestPayloadForCommit,
  linkedPrincipalText: string,
  revision: number,
  holderRevision: number,
  holderCommitment: string,
): string {
  const lines: string[] = [];
  lines.push(`acquired_post_incident=${p.acquiredPostIncident}`);
  lines.push(`approximate_total_claim=${ou(p.approximateTotalClaim)}`);
  lines.push(`attempted_bridge_redemption=${p.attemptedBridgeRedemption}`);
  lines.push(`bridge_attempts=${p.bridgeAttempts.length}`);
  p.bridgeAttempts.forEach((a, i) => {
    lines.push(`bridge_attempts.${i}.chain=${h(a.chain)}`);
    lines.push(`bridge_attempts.${i}.description=${oh(a.description)}`);
    lines.push(`bridge_attempts.${i}.tx_hash=${h(a.txHash)}`);
  });
  lines.push(`detected_bsc=${p.detectedBsc}`);
  lines.push(`detected_canto=${p.detectedCanto}`);
  lines.push(`detected_eth=${p.detectedEth}`);
  lines.push(`detected_polygon=${p.detectedPolygon}`);
  lines.push(`held_pre_incident=${p.heldPreIncident}`);
  lines.push(`holder_commitment=${holderCommitment}`);
  lines.push(`holder_revision=${holderRevision}`);
  lines.push(`linked_principal=${linkedPrincipalText}`);
  lines.push(`pod_filed_for_this_wallet=${p.podFiledForThisWallet}`);
  lines.push(`pod_reference_for_this_wallet=${oh(p.podReferenceForThisWallet)}`);
  lines.push(`positions=${p.positions.length}`);
  p.positions.forEach((pos, i) => {
    lines.push(`positions.${i}.chain=${h(pos.chain)}`);
    lines.push(`positions.${i}.declared_multibtc=${pos.declaredMultibtc}`);
    lines.push(`positions.${i}.kind=${positionTypeStr(pos.kind)}`);
  });
  lines.push(`post_incident_acquisitions=${p.postIncidentAcquisitions.length}`);
  p.postIncidentAcquisitions.forEach((a, i) => {
    lines.push(`post_incident_acquisitions.${i}.acquisition_date_iso=${h(a.acquisitionDateIso)}`);
    lines.push(`post_incident_acquisitions.${i}.amount_multibtc=${a.amountMultibtc}`);
    lines.push(`post_incident_acquisitions.${i}.chain=${h(a.chain)}`);
    lines.push(`post_incident_acquisitions.${i}.notes=${oh(a.notes)}`);
    lines.push(`post_incident_acquisitions.${i}.price_paid_usd=${of(a.pricePaidUsd)}`);
  });
  lines.push(`revision=${revision}`);
  lines.push(`support_tx_hashes=${p.supportTxHashes.length}`);
  p.supportTxHashes.forEach((hash, i) => {
    lines.push(`support_tx_hashes.${i}=${h(hash)}`);
  });
  lines.push(`wallet_address=${p.walletAddress.toLowerCase()}`);
  return lines.join('\n');
}

export async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function commitAttest(
  p: AttestPayloadForCommit,
  linkedPrincipalText: string,
  revision: number,
  holderRevision: number,
  holderCommitment: string,
): Promise<string> {
  return sha256Hex(
    serialiseAttest(p, linkedPrincipalText, revision, holderRevision, holderCommitment),
  );
}
