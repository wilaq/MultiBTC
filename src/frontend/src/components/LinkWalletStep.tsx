import { useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import type { Principal } from '@dfinity/principal';
import { backendActor } from '../lib/auth';
import { buildLinkMessage } from '../lib/message';
import { unwrap } from '../lib/backend';
import { ConnectWalletButton } from './ConnectWalletDialog';

export function LinkWalletStep({
  principal,
  onLinked,
}: {
  principal: Principal;
  onLinked: (address: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function link() {
    if (!address) return;
    setError(null);
    setBusy(true);
    try {
      const actor = await backendActor();
      // Conflict check first. The backend only tells us whether it is taken —
      // never by whom — so this cannot be used to map addresses to identities.
      const status = await actor.get_wallet_link_status(address.toLowerCase());
      if ('LinkedToOther' in status) {
        throw new Error(
          'This wallet is already bound to a different Internet Identity. Sign in with that identity, or use a different wallet.',
        );
      }
      const nonceRes = await actor.get_link_nonce(address.toLowerCase());
      const nonce = unwrap(nonceRes);
      const signed_at_iso = new Date().toISOString();
      const message = buildLinkMessage(
        address.toLowerCase(),
        principal.toText(),
        signed_at_iso,
        nonce,
      );
      const signature = await signMessageAsync({ message });
      unwrap(
        await actor.link_wallet({
          wallet_address: address.toLowerCase(),
          signature,
          nonce,
          signed_at_iso,
        }),
      );
      onLinked(address.toLowerCase());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="text-sm font-semibold text-ink-900">Link wallet</div>
      </div>
      <div className="card-body space-y-3">
        <p className="text-sm text-ink-700">
          Connect the EVM wallet you want to verify. You'll sign a short binding message that
          ties this wallet to your Internet Identity principal.
        </p>
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <strong>Use an EOA wallet</strong> (MetaMask, Rabby, Trust, Brave, Frame, Coinbase
          Wallet extension, etc.) — the wallet that actually holds your multiBTC. Smart-contract
          wallets (Coinbase Smart Wallet, Safe, Argent, ERC-4337) are not yet supported because
          their signatures recover to the owner EOA, not the smart account itself.
        </div>
        <div className="flex flex-wrap gap-3">
          <ConnectWalletButton />
          {isConnected && (
            <button type="button" className="btn-accent" onClick={link} disabled={busy}>
              {busy ? 'Linking…' : 'Sign & link'}
            </button>
          )}
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <details className="text-xs text-ink-500">
          <summary className="cursor-pointer">What gets signed?</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-ink-50 p-3 font-mono text-[11px] text-ink-700">
{`multiBTC Holders Group — Identity Binding

I bind this Ethereum wallet to my Internet Identity principal so that
only I can view and edit my verification record.

Wallet:    ${address ?? '0x…'}
Principal: ${principal.toText()}
Timestamp: <now>
Nonce:     <server-generated UUID>`}
          </pre>
        </details>
      </div>
    </div>
  );
}
