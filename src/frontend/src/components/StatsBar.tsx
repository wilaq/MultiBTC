import { useEffect, useState } from 'react';
import { anonymousBackendActor } from '../lib/auth';
import { formatMultibtc } from '../lib/format';
import type { PublicStats } from '../lib/backend';

export function StatsBar() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const actor = await anonymousBackendActor();
        const s = await actor.get_public_stats();
        if (!cancelled) setStats(s);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <div className="text-sm text-red-600">Failed to load stats: {error}</div>;
  }
  if (!stats) {
    return <div className="text-sm text-ink-500">Loading aggregate stats…</div>;
  }

  const total =
    stats.total_declared_claim > 0n
      ? stats.total_declared_claim
      : stats.total_detected_eth +
        stats.total_detected_bsc +
        stats.total_detected_polygon +
        stats.total_detected_canto;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Verified holders" value={stats.total_holders.toString()} />
      <Stat label="Linked wallets" value={stats.total_wallets.toString()} />
      <Stat label="Total declared multiBTC" value={formatMultibtc(total)} />
      <Stat label="Pre-incident holders" value={stats.pre_incident_wallets.toString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-ink-900 break-all">{value}</div>
    </div>
  );
}
