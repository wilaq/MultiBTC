import { useEffect, useRef, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import type { Principal } from '@dfinity/principal';
import { BalanceTable } from './BalanceTable';
import { PositionsEditor } from './PositionsEditor';
import { PostIncidentAcquisitionsEditor } from './PostIncidentAcquisitionsEditor';
import { BridgeAttemptsEditor } from './BridgeAttemptsEditor';
import { Field } from './Field';
import { backendActor } from '../lib/auth';
import { buildAttestationMessage } from '../lib/message';
import {
  commitAttest,
  commitHolder,
  holderToCommit,
  type AttestPayloadForCommit,
  type PositionDetail as CommitPosition,
} from '../lib/dataCommitment';
import {
  unwrap,
  type AttestPayload,
  type HolderProfile,
  type WalletAttestation,
  type PositionDetail,
  type PostIncidentAcquisition,
  type BridgeAttempt,
} from '../lib/backend';
import { CHAIN_LABELS, type SupportedChainId } from '../lib/wagmi';
import { formatMultibtc, parseMultibtc, shortAddress } from '../lib/format';

interface Props {
  walletAddress: string;
  principal: Principal;
  /** The holder profile in force. Its identity and hash go into the signed bytes. */
  holder: HolderProfile;
  initial: WalletAttestation | null;
  onSaved: (w: WalletAttestation) => void;
}



function posToCommit(p: PositionDetail): CommitPosition {
  return {
    chain: p.chain,
    declaredMultibtc: p.declared_multibtc,
    kind:
      'RawToken' in p.kind
        ? { kind: 'RawToken' }
        : 'Lp' in p.kind
          ? { kind: 'Lp', protocol: p.kind.Lp.protocol, pool: p.kind.Lp.pool }
          : 'Vault' in p.kind
            ? { kind: 'Vault', protocol: p.kind.Vault.protocol, name: p.kind.Vault.name }
            : { kind: 'Other', text: p.kind.Other },
  };
}

export function WalletAttestationForm({ walletAddress, principal, holder, initial, onSaved }: Props) {
  const { address: connected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [detected, setDetected] = useState<Record<SupportedChainId, bigint>>({
    1: 0n,
    56: 0n,
    137: 0n,
    7700: 0n,
  });
  const [failedChains, setFailedChains] = useState<SupportedChainId[]>([]);
  const [positions, setPositions] = useState<PositionDetail[]>(initial?.positions ?? []);
  const initialApproxClaim = initial?.approximate_total_claim[0];
  const [approxTotal, setApproxTotal] = useState<string>(
    initialApproxClaim != null
      ? formatMultibtc(initialApproxClaim, 8).replace(/\.?0+$/, '')
      : '',
  );
  const [heldPre, setHeldPre] = useState(initial?.held_pre_incident ?? false);
  const [acquiredPost, setAcquiredPost] = useState(initial?.acquired_post_incident ?? false);
  const [acquisitions, setAcquisitions] = useState<PostIncidentAcquisition[]>(
    initial?.post_incident_acquisitions ?? [],
  );
  const [bridgeAttempted, setBridgeAttempted] = useState(
    initial?.attempted_bridge_redemption ?? false,
  );
  const [bridgeAttempts, setBridgeAttempts] = useState<BridgeAttempt[]>(
    initial?.bridge_attempts ?? [],
  );
  const [podFiledHere, setPodFiledHere] = useState(initial?.pod_filed_for_this_wallet ?? false);
  const [podRefHere, setPodRefHere] = useState<string>(
    initial?.pod_reference_for_this_wallet[0] ?? '',
  );
  const [supportTxHashes, setSupportTxHashes] = useState<string[]>(
    initial?.support_tx_hashes ?? [],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const errorPanelRef = useRef<HTMLDivElement | null>(null);

  const walletConnected =
    !!connected && connected.toLowerCase() === walletAddress.toLowerCase();

  const revision = initial ? initial.revision + 1 : 0;

  // Reset acquisitions if user unchecks acquired_post_incident.
  useEffect(() => {
    if (!acquiredPost) setAcquisitions([]);
  }, [acquiredPost]);
  useEffect(() => {
    if (!bridgeAttempted) setBridgeAttempts([]);
  }, [bridgeAttempted]);

  function validate(): string[] {
    const e: string[] = [];
    if (!walletConnected) {
      e.push(
        `Connected wallet doesn't match — connect ${walletAddress} in your wallet extension before signing.`,
      );
    }
    if (positions.length === 0) {
      e.push('Add at least one position describing where this wallet holds (or held) multiBTC.');
    }
    positions.forEach((p, i) => {
      if ('Lp' in p.kind) {
        if (p.kind.Lp.protocol.trim() === '' || p.kind.Lp.pool.trim() === '') {
          e.push(`Position ${i + 1}: LP positions require both protocol and pool.`);
        }
      } else if ('Vault' in p.kind) {
        if (p.kind.Vault.protocol.trim() === '' || p.kind.Vault.name.trim() === '') {
          e.push(`Position ${i + 1}: vault positions require both protocol and vault name.`);
        }
      } else if ('Other' in p.kind) {
        if (p.kind.Other.trim() === '') {
          e.push(
            `Position ${i + 1}: "Other" positions require a description of where the multiBTC is.`,
          );
        }
      }
    });
    if (acquiredPost && acquisitions.length === 0) {
      e.push('Post-incident acquisitions: add at least one acquisition (date, chain, amount).');
    }
    acquisitions.forEach((a, i) => {
      if (a.acquisition_date_iso.trim() === '')
        e.push(`Post-incident acquisition ${i + 1}: pick an acquisition date.`);
      if (a.amount_multibtc === 0n)
        e.push(`Post-incident acquisition ${i + 1}: enter the amount of multiBTC acquired.`);
    });
    if (bridgeAttempted && bridgeAttempts.length === 0) {
      e.push('Bridge attempts: add at least one tx hash.');
    }
    bridgeAttempts.forEach((b, i) => {
      if (b.tx_hash.trim() === '') e.push(`Bridge attempt ${i + 1}: enter the tx hash.`);
    });
    return e;
  }

  async function sign() {
    setError(null);
    const errs = validate();
    if (errs.length > 0) {
      setValidationErrors(errs);
      setTimeout(() => errorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      return;
    }
    setValidationErrors([]);
    setBusy(true);
    try {
      let approxTotalBI: bigint | null = null;
      if (approxTotal.trim() !== '') {
        const parsedTotal = parseMultibtc(approxTotal);
        if (!parsedTotal.ok) throw new Error(`Approximate total claim: ${parsedTotal.error}`);
        approxTotalBI = parsedTotal.value;
      }

      const commitPayload: AttestPayloadForCommit = {
        walletAddress: walletAddress.toLowerCase(),
        detectedEth: detected[1],
        detectedBsc: detected[56],
        detectedPolygon: detected[137],
        detectedCanto: detected[7700],
        positions: positions.map(posToCommit),
        approximateTotalClaim: approxTotalBI,
        heldPreIncident: heldPre,
        acquiredPostIncident: acquiredPost,
        postIncidentAcquisitions: acquisitions.map((a) => ({
          acquisitionDateIso: a.acquisition_date_iso,
          chain: a.chain,
          amountMultibtc: a.amount_multibtc,
          pricePaidUsd: a.price_paid_usd[0] ?? null,
          notes: a.notes[0] ?? null,
        })),
        attemptedBridgeRedemption: bridgeAttempted,
        bridgeAttempts: bridgeAttempts.map((b) => ({
          chain: b.chain,
          txHash: b.tx_hash,
          description: b.description[0] ?? null,
        })),
        podFiledForThisWallet: podFiledHere,
        podReferenceForThisWallet: podRefHere.trim() === '' ? null : podRefHere.trim(),
        supportTxHashes: supportTxHashes.map((h) => h.trim()).filter((h) => h !== ''),
      };
      const holderRevision = Number(holder.revision);
      const holderCommit = await commitHolder(holderToCommit(holder));
      const commit = await commitAttest(
        commitPayload,
        principal.toText(),
        revision,
        holderRevision,
        holderCommit,
      );
      const signed_at_iso = new Date().toISOString();
      const actor = await backendActor();
      const nonce = unwrap(await actor.get_attest_nonce(walletAddress.toLowerCase()));
      const message = buildAttestationMessage(
        walletAddress.toLowerCase(),
        principal.toText(),
        revision,
        holder.legal_name,
        holder.date_of_birth_iso,
        holderRevision,
        holderCommit,
        commit,
        signed_at_iso,
        nonce,
      );
      const signature = await signMessageAsync({ message });

      const payload: AttestPayload = {
        wallet_address: walletAddress.toLowerCase(),
        detected_eth: detected[1],
        detected_bsc: detected[56],
        detected_polygon: detected[137],
        detected_canto: detected[7700],
        positions,
        approximate_total_claim: approxTotalBI == null ? [] : [approxTotalBI],
        held_pre_incident: heldPre,
        acquired_post_incident: acquiredPost,
        post_incident_acquisitions: acquisitions,
        attempted_bridge_redemption: bridgeAttempted,
        bridge_attempts: bridgeAttempts,
        pod_filed_for_this_wallet: podFiledHere,
        pod_reference_for_this_wallet:
          podRefHere.trim() === '' ? [] : [podRefHere.trim()],
        support_tx_hashes: supportTxHashes.map((h) => h.trim()).filter((h) => h !== ''),
        signature,
        nonce,
        signed_at_iso,
        data_commitment_sha256: commit,
      };

      const res = initial
        ? await actor.update_wallet_attestation(payload)
        : await actor.submit_wallet_attestation(payload);
      onSaved(unwrap(res));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const detectedSum =
    detected[1] + detected[56] + detected[137] + detected[7700];

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-ink-900">
            Wallet attestation for {shortAddress(walletAddress)}
          </div>
          <div className="text-xs text-ink-500">
            {initial ? `Saving as revision ${revision}` : 'New attestation (revision 0)'}
          </div>
        </div>
      </div>
      <div className="card-body space-y-6">
        {validationErrors.length > 0 && (
          <div
            ref={errorPanelRef}
            className="rounded-md border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-1"
          >
            <div className="font-semibold">Please fix the following before signing:</div>
            <ul className="list-disc pl-5">
              {validationErrors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        {!walletConnected && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Connect this exact wallet ({shortAddress(walletAddress)}) to sign. Currently connected:{' '}
            {connected ? shortAddress(connected) : 'none'}.
          </div>
        )}

        <BalanceTable
          address={walletAddress}
          onBalances={setDetected}
          onFailures={setFailedChains}
        />

        <section className="space-y-2">
          <PositionsEditor
            positions={positions}
            setPositions={setPositions}
            detected={detected}
          />
        </section>

        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-ink-800">Claim total</h4>
          <Field
            label="Approximate total multiBTC claim (optional override)"
            help="Defaults to the sum of detected balances above if left empty. Enter a different value only if your actual holdings differ (e.g. LP/vault positions you declared as positions)."
          >
            <input
              className="field-input max-w-xs"
              inputMode="decimal"
              placeholder={formatMultibtc(detectedSum, 8).replace(/\.?0+$/, '') || '0'}
              value={approxTotal}
              onChange={(e) => setApproxTotal(e.target.value)}
            />
          </Field>
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-semibold text-ink-800">
                Supporting tx hashes{' '}
                <span className="text-xs font-normal text-ink-500">
                  ({supportTxHashes.length} / 10, optional)
                </span>
              </h5>
              <button
                type="button"
                className="btn-primary !px-3 !py-1.5"
                disabled={supportTxHashes.length >= 10}
                onClick={() => setSupportTxHashes([...supportTxHashes, ''])}
              >
                + Add tx hash
              </button>
            </div>
            <p className="text-xs text-ink-500">
              Paste tx hashes from any chain that support your claim total — e.g. the tx that
              deposited multiBTC into an LP, transferred it to a vault, moved it to custody, or
              acquired it from a DEX. Up to 10.
            </p>
            {supportTxHashes.map((hash, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className="field-input font-mono flex-1"
                  placeholder="0x… (tx hash from any chain)"
                  value={hash}
                  onChange={(e) => {
                    const next = [...supportTxHashes];
                    next[i] = e.target.value;
                    setSupportTxHashes(next);
                  }}
                />
                <button
                  type="button"
                  className="text-xs text-red-600 hover:underline"
                  onClick={() =>
                    setSupportTxHashes(supportTxHashes.filter((_, idx) => idx !== i))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-ink-800">Timing</h4>
          <Check
            label="I held multiBTC at this wallet before July 7, 2023 (pre-incident holder)"
            checked={heldPre}
            onChange={setHeldPre}
          />
          <Check
            label="I acquired multiBTC at this wallet after July 7, 2023 (post-incident)"
            checked={acquiredPost}
            onChange={setAcquiredPost}
          />
          {acquiredPost && (
            <PostIncidentAcquisitionsEditor items={acquisitions} setItems={setAcquisitions} />
          )}
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-ink-800">Bridge redemption history</h4>
          <Check
            label="I attempted to redeem multiBTC via the Multichain bridge / HTLC"
            checked={bridgeAttempted}
            onChange={setBridgeAttempted}
          />
          {bridgeAttempted && (
            <BridgeAttemptsEditor items={bridgeAttempts} setItems={setBridgeAttempts} />
          )}
        </section>

        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-ink-800">PoD per-wallet</h4>
          <Check
            label="I have filed a Proof of Debt specifically referencing this wallet"
            checked={podFiledHere}
            onChange={setPodFiledHere}
          />
          {podFiledHere && (
            <label className="block max-w-md">
              <span className="field-label">PoD reference (optional)</span>
              <input
                className="field-input"
                value={podRefHere}
                onChange={(e) => setPodRefHere(e.target.value)}
              />
            </label>
          )}
        </section>

        {failedChains.length > 0 && (
          <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <strong>
              Could not read your balance on{' '}
              {failedChains.map((c) => CHAIN_LABELS[c]).join(', ')}.
            </strong>{' '}
            Signing now records <strong>0</strong> for{' '}
            {failedChains.length === 1 ? 'that chain' : 'those chains'}, which cannot be told apart
            from genuinely holding none. Use Refresh above and wait for a balance before signing —
            or declare the amount in Positions if you know it.
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-3">
          <button type="button" className="btn-accent" onClick={sign} disabled={busy}>
            {busy
              ? 'Signing & submitting…'
              : initial
                ? `Sign & save revision ${revision}`
                : 'Sign & submit attestation'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink-800">
      <input
        type="checkbox"
        className="mt-0.5 rounded border-ink-400 text-ink-900 focus:ring-ink-700"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
