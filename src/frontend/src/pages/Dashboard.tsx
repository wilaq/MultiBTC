import { useEffect, useState } from 'react';
import { anonymousBackendActor } from '../lib/auth';
import { formatMultibtc, formatTsNs } from '../lib/format';
import type { PublicStats } from '../lib/backend';

export function Dashboard() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const actor = await anonymousBackendActor();
        const [s, c] = await Promise.all([actor.get_public_stats(), actor.cycles_balance()]);
        if (!cancelled) {
          setStats(s);
          setCycles(c);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink-900">Public dashboard</h1>
        <p className="text-sm text-ink-600">
          Aggregate, non-identifying statistics from the verified holder register.
        </p>
      </header>

      {error && <div className="text-sm text-red-600">Failed: {error}</div>}

      {stats && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Tile label="Verified holders" value={stats.total_holders.toString()} />
          <Tile label="Linked wallets" value={stats.total_wallets.toString()} />
          <Tile
            label="Total declared multiBTC"
            value={formatMultibtc(
              stats.total_declared_claim > 0n
                ? stats.total_declared_claim
                : stats.total_detected_eth +
                    stats.total_detected_bsc +
                    stats.total_detected_polygon +
                    stats.total_detected_canto,
            )}
          />
          <Tile label="Detected on Ethereum" value={formatMultibtc(stats.total_detected_eth)} />
          <Tile label="Detected on BSC" value={formatMultibtc(stats.total_detected_bsc)} />
          <Tile label="Detected on Polygon" value={formatMultibtc(stats.total_detected_polygon)} />
          <Tile label="Detected on Canto" value={formatMultibtc(stats.total_detected_canto)} />
          <Tile label="Pre-incident wallets" value={stats.pre_incident_wallets.toString()} />
          <Tile label="Post-incident wallets" value={stats.post_incident_wallets.toString()} />
          <Tile label="PoD filed (holders)" value={stats.pod_filed_holders.toString()} />
          <Tile
            label="Last submission"
            value={
              stats.last_submission_at_ns > 0n
                ? formatTsNs(stats.last_submission_at_ns)
                : '—'
            }
          />
          {cycles !== null && (
            <Tile
              label="Backend cycles (top up below 1T)"
              value={`${(Number(cycles) / 1e12).toFixed(2)}T`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-base font-semibold text-ink-900 break-all">{value}</div>
    </div>
  );
}
