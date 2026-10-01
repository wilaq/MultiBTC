import { useEffect, useState } from 'react';
import type { Principal } from '@dfinity/principal';
import { ConnectWalletButton } from './ConnectWalletDialog';
import { LinkWalletStep } from './LinkWalletStep';
import { WalletAttestationForm } from './WalletAttestationForm';
import { RevisionHistory } from './RevisionHistory';
import { formatMultibtc, shortAddress, formatTsNs } from '../lib/format';
import type { HolderProfile, WalletAttestation } from '../lib/backend';
import { anonymousBackendActor } from '../lib/auth';
import { useAccount } from 'wagmi';

interface Props {
  principal: Principal;
  holder: HolderProfile;
  wallets: WalletAttestation[];
  linkedAddresses: string[];
  reload: () => Promise<void>;
}

export function WalletsPanel({ principal, holder, wallets, linkedAddresses, reload }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [justSavedAddr, setJustSavedAddr] = useState<string | null>(null);
  const [maxWallets, setMaxWallets] = useState<number>(5);
  const { address: connected } = useAccount();

  useEffect(() => {
    void (async () => {
      try {
        const a = await anonymousBackendActor();
        const info = await a.get_admin_info();
        setMaxWallets(Number(info.max_wallets_per_principal));
      } catch {
        /* keep default */
      }
    })();
  }, []);

  const byAddress = new Map(wallets.map((w) => [w.wallet_address.toLowerCase(), w]));
  const pending = linkedAddresses.filter((a) => !byAddress.has(a.toLowerCase()));

  // Total wallets the principal has consumed of its cap (linked + attested).
  const totalLinked = new Set(
    [...wallets.map((w) => w.wallet_address.toLowerCase()), ...linkedAddresses.map((a) => a.toLowerCase())],
  ).size;
  const remaining = Math.max(0, maxWallets - totalLinked);
  const atCap = remaining === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Linked wallets</h2>
          <p className="text-xs text-ink-500">
            {totalLinked} of {maxWallets} wallets used.{' '}
            {atCap ? 'Cap reached.' : `${remaining} remaining.`}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={atCap}
          onClick={() => {
            setAddingNew(true);
            setEditing(null);
            setJustSavedAddr(null);
          }}
        >
          + Add wallet
        </button>
      </div>

      {wallets.length === 0 && pending.length === 0 && !addingNew && (
        <div className="card">
          <div className="card-body text-sm text-ink-600">
            No wallets linked yet. Click "Add wallet" to link your first one.
          </div>
        </div>
      )}

      {wallets.map((w) => (
        <div key={w.wallet_address} className="card">
          <div className="card-body space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {shortAddress(w.wallet_address)}{' '}
                  <span className="text-xs text-ink-500">rev {w.revision}</span>
                </div>
                <div className="text-xs text-ink-500">
                  Last signed {formatTsNs(w.submitted_at_ns)}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setAddingNew(false);
                    setEditing(editing === w.wallet_address ? null : w.wallet_address);
                  }}
                >
                  {editing === w.wallet_address ? 'Close editor' : 'Edit'}
                </button>
              </div>
            </div>
            <div className="text-sm text-ink-700">
              Declared total:{' '}
              <span className="font-mono">
                {formatMultibtc(
                  w.approximate_total_claim[0] ??
                    w.detected_eth + w.detected_bsc + w.detected_polygon + w.detected_canto,
                )}
              </span>{' '}
              multiBTC across {w.positions.length} position{w.positions.length === 1 ? '' : 's'}.
            </div>
            {Number(w.holder_revision) !== Number(holder.revision) && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>Needs re-signing.</strong> This signature covers holder profile revision{' '}
                {Number(w.holder_revision)}, but your profile is now at revision{' '}
                {Number(holder.revision)}. The signature still proves what you signed then — it just
                no longer covers your current details. Re-sign to bring it up to date.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => setEditing(w.wallet_address)}
                >
                  Re-sign now
                </button>
              </div>
            )}
            <RevisionHistory walletAddress={w.wallet_address} />
            {editing === w.wallet_address && (
              <div className="pt-3">
                <WalletAttestationForm
                  walletAddress={w.wallet_address}
                  principal={principal}
                  holder={holder}
                  initial={w}
                  onSaved={async () => {
                    setEditing(null);
                    setJustSavedAddr(w.wallet_address);
                    await reload();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      ))}

      {pending.map((addr) => (
        <div key={addr} className="card">
          <div className="card-body space-y-2">
            <div className="text-sm font-semibold text-ink-900">
              {shortAddress(addr)}{' '}
              <span className="text-xs text-amber-700">— linked, attestation pending</span>
            </div>
            <p className="text-sm text-ink-700">
              You linked this wallet but haven't signed an attestation yet. Connect this exact
              wallet to fill the form and sign.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ConnectWalletButton />
              {connected && connected.toLowerCase() === addr.toLowerCase() && (
                <span className="text-xs text-ink-600">Wallet matches — fill the form below.</span>
              )}
            </div>
            {connected && connected.toLowerCase() === addr.toLowerCase() && (
              <div className="pt-2">
                <WalletAttestationForm
                  walletAddress={addr}
                  principal={principal}
                  holder={holder}
                  initial={null}
                  onSaved={async () => {
                    setJustSavedAddr(addr);
                    await reload();
                  }}
                />
              </div>
            )}
          </div>
        </div>
      ))}

      {justSavedAddr && (
        <div className="card border-emerald-200 bg-emerald-50">
          <div className="card-body space-y-3">
            <div className="text-sm text-emerald-900">
              ✓ Attestation saved for {shortAddress(justSavedAddr)}.
            </div>
            <div className="text-sm text-ink-800">
              Do you have another wallet to verify?{' '}
              <span className="text-xs text-ink-500">
                ({totalLinked} of {maxWallets} used)
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-accent"
                disabled={atCap}
                onClick={() => {
                  setAddingNew(true);
                  setJustSavedAddr(null);
                }}
              >
                Yes — add another wallet
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setJustSavedAddr(null)}
              >
                No — I'm done
              </button>
            </div>
            {atCap && (
              <div className="text-xs text-amber-700">
                You've reached the {maxWallets}-wallet cap. To add more, contact the group's
                solicitor.
              </div>
            )}
          </div>
        </div>
      )}

      {addingNew && !atCap && (
        <div className="space-y-3">
          <LinkWalletStep
            principal={principal}
            onLinked={async () => {
              setAddingNew(false);
              setJustSavedAddr(null);
              await reload();
            }}
          />
        </div>
      )}
    </div>
  );
}
