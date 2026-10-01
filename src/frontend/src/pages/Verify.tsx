import { useCallback, useEffect, useState } from 'react';
import { AuthGate } from '../components/AuthGate';
import { HolderForm } from '../components/HolderForm';
import { WalletsPanel } from '../components/WalletsPanel';
import { PrincipalChip } from '../components/PrincipalChip';
import { backendActor, BACKEND_CANISTER_ID } from '../lib/auth';
import { unwrap, type HolderProfile, type WalletAttestation } from '../lib/backend';
import type { Principal } from '@dfinity/principal';

export function Verify() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink-900">Verify your wallet &amp; authorize</h1>
        <p className="text-sm text-ink-600">
          Sign in with Internet Identity, save your holder profile, then link and sign for each
          wallet you control.
        </p>
      </header>
      <AuthGate>
        {({ principal, logout }) => (
          <VerifyContent principal={principal} onLogout={logout} />
        )}
      </AuthGate>
    </div>
  );
}

function VerifyContent({
  principal,
  onLogout,
}: {
  principal: Principal;
  onLogout: () => Promise<void>;
}) {
  const [holder, setHolder] = useState<HolderProfile | null>(null);
  const [wallets, setWallets] = useState<WalletAttestation[]>([]);
  const [linkedAddrs, setLinkedAddrs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const actor = await backendActor();
      const [h, ws, addrs] = await Promise.all([
        actor.get_my_holder(),
        actor.get_my_wallets(),
        actor.get_wallets_for_principal(),
      ]);
      setHolder(h[0] ?? null);
      setWallets(ws);
      setLinkedAddrs(addrs);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (loading) return <div className="text-sm text-ink-500">Loading your record…</div>;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-body flex items-center justify-between flex-wrap gap-3">
          <PrincipalChip principal={principal} label="Signed in as" />
          <div className="flex flex-wrap gap-2">
            {holder && <DownloadMyEvidence />}
            <button type="button" className="btn-secondary" onClick={onLogout}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {error && <div className="card"><div className="card-body text-sm text-red-600">{error}</div></div>}

      <HolderForm initial={holder} onSaved={(h) => setHolder(h)} />

      {holder ? (
        <WalletsPanel
          principal={principal}
          holder={holder}
          wallets={wallets}
          linkedAddresses={linkedAddrs}
          reload={reload}
        />
      ) : (
        <div className="card">
          <div className="card-body text-sm text-ink-600">
            Save your holder profile first — then you can link wallets and submit per-wallet
            attestations.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A holder's own records, in exactly the shape verify/verify-attestation.mjs
 * reads, so anyone they hand it to can check every signature independently.
 *
 * This is the only way records leave the canister: each person exports their
 * own, through caller-scoped reads. There is no operator-side export.
 */
function DownloadMyEvidence() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const actor = await backendActor();
      const [profile, holderRevisions, wallets] = await Promise.all([
        actor.get_my_holder(),
        actor.get_holder_revisions(),
        actor.get_my_wallets(),
      ]);
      if (!profile[0]) throw new Error('Save your holder profile first.');
      const walletRevisions = await Promise.all(
        wallets.map(async (w) => [
          w.wallet_address,
          unwrap(await actor.get_wallet_revisions(w.wallet_address)),
        ]),
      );
      const bundles = [
        {
          profile: profile[0],
          wallets,
          holder_revisions: holderRevisions,
          wallet_revisions: walletRevisions,
        },
      ];
      // u128 amounts do not fit a JSON number, so bigints travel as decimal strings.
      const body = JSON.stringify(bundles, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
      const body_sha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const doc = {
        manifest: {
          spec: 'verify/SPEC.md',
          canister_id: BACKEND_CANISTER_ID,
          exported_at_client_iso: new Date().toISOString(),
          body_sha256,
          note: 'Exported by the holder. exported_at is the browser clock and not authoritative; submitted_at_ns on each record is Internet Computer consensus time.',
        },
        bundles: JSON.parse(body),
      };
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-multibtc-evidence-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn-secondary" onClick={download} disabled={busy}>
        {busy ? 'Preparing…' : 'Download my evidence'}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </>
  );
}
