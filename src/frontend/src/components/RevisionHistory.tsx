import { useEffect, useState } from 'react';
import { backendActor } from '../lib/auth';
import { unwrap, type WalletAttestation } from '../lib/backend';
import { formatMultibtc, formatTsNs } from '../lib/format';

export function RevisionHistory({ walletAddress }: { walletAddress: string }) {
  const [revs, setRevs] = useState<WalletAttestation[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const actor = await backendActor();
      try {
        const r = unwrap(await actor.get_wallet_revisions(walletAddress.toLowerCase()));
        if (!cancelled) setRevs(r);
      } catch {
        if (!cancelled) setRevs([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, walletAddress]);

  return (
    <div>
      <button
        type="button"
        className="text-xs text-ink-600 hover:underline"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide revision history' : 'Show revision history'}
      </button>
      {open && (
        <div className="mt-2 rounded-md border border-ink-200 bg-white p-3 space-y-2">
          {revs === null && <div className="text-xs text-ink-500">Loading…</div>}
          {revs && revs.length === 0 && <div className="text-xs text-ink-500">No revisions.</div>}
          {revs &&
            revs.map((r) => (
              <div key={r.revision} className="text-xs text-ink-700">
                <span className="font-semibold">rev {r.revision}</span> ·{' '}
                {formatTsNs(r.submitted_at_ns)} ·{' '}
                {formatMultibtc(
                  r.approximate_total_claim[0] ??
                    r.detected_eth + r.detected_bsc + r.detected_polygon + r.detected_canto,
                )}{' '}
                multiBTC declared · sig{' '}
                <code className="font-mono">{r.signature.slice(0, 14)}…</code>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
