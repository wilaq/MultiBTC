// Byte-for-byte mirror of src/backend/src/message.rs.
// Any change here MUST be made in the Rust file too — see parity tests.

export function buildLinkMessage(
  addressLowerHex: string,
  principalText: string,
  signedAtIso: string,
  nonce: string,
): string {
  return (
    'multiBTC Holders Group — Identity Binding\n' +
    '\n' +
    'I bind this Ethereum wallet to my Internet Identity principal so that\n' +
    'only I can view and edit my verification record.\n' +
    '\n' +
    `Wallet:    ${addressLowerHex}\n` +
    `Principal: ${principalText}\n` +
    `Timestamp: ${signedAtIso}\n` +
    `Nonce:     ${nonce}`
  );
}

export function buildAttestationMessage(
  addressLowerHex: string,
  principalText: string,
  revision: number,
  legalName: string,
  dateOfBirthIso: string,
  holderRevision: number,
  holderCommitmentHex: string,
  dataCommitmentSha256Hex: string,
  signedAtIso: string,
  nonce: string,
): string {
  return (
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
    `Wallet:           ${addressLowerHex}\n` +
    `Linked principal: ${principalText}\n` +
    `Revision:         ${revision}\n` +
    `Holder:           ${legalName}\n` +
    `Date of birth:    ${dateOfBirthIso}\n` +
    `Holder profile:   revision ${holderRevision}, 0x${holderCommitmentHex}\n` +
    `Data commitment:  0x${dataCommitmentSha256Hex}\n` +
    `Timestamp:        ${signedAtIso}\n` +
    `Nonce:            ${nonce}`
  );
}

export function buildAdminMessage(signedAtIso: string, nonce: string): string {
  return (
    'multiBTC Holders Group — Admin Access\n' +
    '\n' +
    'I am authenticating as the admin operator.\n' +
    `Timestamp: ${signedAtIso}\n` +
    `Nonce:     ${nonce}`
  );
}
