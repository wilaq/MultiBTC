import { useEffect, useMemo } from 'react';
import { useReadContracts } from 'wagmi';
import { erc20BalanceAbi, MULTIBTC } from '../lib/contracts';
import { CHAIN_LABELS, type SupportedChainId } from '../lib/wagmi';
import { formatMultibtc } from '../lib/format';

interface Props {
  address: string;
  onBalances?: (b: Record<SupportedChainId, bigint>) => void;
  /** Chains whose balanceOf call failed. Their balance is reported as 0. */
  onFailures?: (chains: SupportedChainId[]) => void;
}

const CHAINS: SupportedChainId[] = [1, 56, 137, 7700];

export function BalanceTable({ address, onBalances, onFailures }: Props) {
  const contracts = useMemo(
    () =>
      CHAINS.map((cid) => ({
        chainId: cid,
        address: MULTIBTC[cid],
        abi: erc20BalanceAbi,
        functionName: 'balanceOf' as const,
        args: [address as `0x${string}`],
      })),
    [address],
  );

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts,
    allowFailure: true,
    query: { enabled: !!address },
  });

  const balances = useMemo(() => {
    const out: Record<SupportedChainId, bigint> = { 1: 0n, 56: 0n, 137: 0n, 7700: 0n };
    if (!data) return out;
    data.forEach((r, i) => {
      const cid = CHAINS[i];
      if (r.status === 'success' && typeof r.result === 'bigint') {
        out[cid] = r.result;
      }
    });
    return out;
  }, [data]);

  // A failed read is indistinguishable from a zero balance once it reaches the
  // payload, so the chains that failed have to travel upward too.
  const failed = useMemo(
    () => CHAINS.filter((cid, i) => data?.[i]?.status === 'failure'),
    [data],
  );
  const failedSig = failed.join(',');
  useEffect(() => {
    onFailures?.(failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedSig]);

  // Surface balances upward when they change.
  const sig = JSON.stringify({
    1: balances[1].toString(),
    56: balances[56].toString(),
    137: balances[137].toString(),
    7700: balances[7700].toString(),
  });
  useMemo(() => {
    onBalances?.(balances);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="text-sm font-semibold text-ink-900">Detected multiBTC balances</div>
        <button
          type="button"
          className="text-xs text-ink-600 hover:underline"
          onClick={() => refetch()}
        >
          Refresh
        </button>
      </div>
      <div className="card-body overflow-x-auto p-0">
        <table className="min-w-full text-sm">
          <thead className="bg-ink-50 text-ink-700">
            <tr>
              <th className="px-4 py-2 text-left">Chain</th>
              <th className="px-4 py-2 text-left">Contract</th>
              <th className="px-4 py-2 text-right">multiBTC balance</th>
            </tr>
          </thead>
          <tbody>
            {CHAINS.map((cid) => {
              const status = data?.[CHAINS.indexOf(cid)]?.status;
              return (
                <tr key={cid} className="border-t border-ink-200">
                  <td className="px-4 py-2">{CHAIN_LABELS[cid]}</td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-600">
                    {MULTIBTC[cid].slice(0, 10)}…{MULTIBTC[cid].slice(-6)}
                  </td>
                  <td className="px-4 py-2 text-right font-mono">
                    {isLoading
                      ? '…'
                      : status === 'failure'
                        ? <span className="text-red-600">RPC error</span>
                        : formatMultibtc(balances[cid])}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {error && (
          <div className="px-4 py-2 text-xs text-red-600 border-t border-ink-200">
            {error.message}
          </div>
        )}
        <p className="px-4 py-3 text-xs text-ink-500 border-t border-ink-200">
          Reading from many public RPCs in parallel per chain. If your multiBTC is in an LP or
          vault position, it may not appear here — declare it manually in the positions section
          below.
        </p>
      </div>
    </div>
  );
}
