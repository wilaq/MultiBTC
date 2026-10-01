import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useConnectors, type Connector } from 'wagmi';
import { shortAddress } from '../lib/format';

export function ConnectWalletButton() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink-700">{shortAddress(address)}</span>
        <button type="button" className="btn-secondary" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <>
      <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
        Connect wallet
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ onClose }: { onClose: () => void }) {
  const connectors = useConnectors();
  const { connect, isPending } = useConnect();
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-header flex items-center justify-between">
          <div className="text-sm font-semibold text-ink-900">Choose a wallet</div>
          <button
            type="button"
            className="rounded p-1 text-ink-500 hover:bg-ink-100"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="card-body space-y-2">
          {connectors.map((c) => (
            <ConnectorRow
              key={c.uid}
              connector={c}
              onPick={async () => {
                setError(null);
                try {
                  await connect({ connector: c });
                  onClose();
                } catch (e: any) {
                  setError(e?.message ?? String(e));
                }
              }}
              busy={isPending}
            />
          ))}
          {error && <div className="text-sm text-red-600">{error}</div>}
          <p className="text-xs text-ink-500 pt-2">
            Don't see your wallet? Use WalletConnect to scan a QR code from any mobile wallet
            (Trust, Rainbow, Ledger Live, Argent, mobile MetaMask/Coinbase, etc.).
          </p>
        </div>
      </div>
    </div>
  );
}

function ConnectorRow({
  connector,
  onPick,
  busy,
}: {
  connector: Connector;
  onPick: () => void;
  busy: boolean;
}) {
  const icon = (connector as any).icon as string | undefined;
  const initial = (connector.name || '?').charAt(0).toUpperCase();
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={busy}
      className="flex w-full items-center justify-between rounded-md border border-ink-200 px-3 py-2.5 text-left hover:bg-ink-50 disabled:opacity-40"
    >
      <span className="flex items-center gap-3">
        <span className="relative inline-flex h-7 w-7 items-center justify-center rounded bg-ink-700 text-xs font-semibold text-white overflow-hidden">
          {initial}
          {icon && (
            <img
              src={icon}
              alt=""
              className="absolute inset-0 h-full w-full object-cover rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
        </span>
        <span className="font-medium text-ink-900">{connector.name}</span>
      </span>
      <span className="text-xs text-ink-500">Connect →</span>
    </button>
  );
}
