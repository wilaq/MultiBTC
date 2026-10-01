import { useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Principal } from '@dfinity/principal';
import { anonymousBackendActor, backendActor } from '../lib/auth';
import { buildAdminMessage } from '../lib/message';
import {
  unwrap,
  type AdminInfo,
  type BackendService,
  type ChainVerdict,
  type ChainObservation,
  type HolderOverview,
} from '../lib/backend';
import { formatMultibtc, shortAddress } from '../lib/format';
import { ConnectWalletButton } from '../components/ConnectWalletDialog';
import { AuthGate } from '../components/AuthGate';
import { PrincipalChip } from '../components/PrincipalChip';
import type { ActorSubclass } from '@dfinity/agent';

export function Admin() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink-900">Admin</h1>
        <p className="text-sm text-ink-600">
          Sign in with Internet Identity, then sign with the admin EVM wallet. Both must match
          the values configured by a canister controller.
        </p>
      </header>
      <AdminConfigPanel />
      <AuthGate>{({ principal }) => <AdminControls callerPrincipal={principal} />}</AuthGate>
    </div>
  );
}

function AdminConfigPanel() {
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [amController, setAmController] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ethInput, setEthInput] = useState('');
  const [principalInput, setPrincipalInput] = useState('');

  async function load() {
    try {
      setError(null);
      const anon = await anonymousBackendActor();
      const i = await anon.get_admin_info();
      setInfo(i);
      setEthInput(i.eth_address);
      setPrincipalInput(i.principal[0]?.toText() ?? '');
      try {
        const actor = await backendActor();
        const cc = await actor.am_i_controller();
        setAmController(cc);
      } catch {
        setAmController(false);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function saveEth() {
    setBusy(true);
    setError(null);
    try {
      const actor = await backendActor();
      unwrap(await actor.set_admin_eth_address(ethInput.trim()));
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePrincipal() {
    setBusy(true);
    setError(null);
    try {
      const actor = await backendActor();
      const arg: [] | [Principal] =
        principalInput.trim() === '' ? [] : [Principal.fromText(principalInput.trim())];
      unwrap(await actor.set_admin_principal(arg));
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink-900">Admin configuration</div>
        {amController !== null && (
          <span
            className={`text-xs ${amController ? 'text-emerald-700' : 'text-ink-500'}`}
          >
            {amController ? 'You are a canister controller.' : 'Read-only (not a controller).'}
          </span>
        )}
      </div>
      <div className="card-body space-y-4">
        {info && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
            <div>
              <div className="text-xs text-ink-500">Configured admin EVM wallet</div>
              <code className="font-mono break-all">{info.eth_address}</code>
            </div>
            <div>
              <div className="text-xs text-ink-500">Linked Internet Identity principal</div>
              <code className="font-mono break-all">
                {info.principal[0]?.toText() ?? '(none — admin auth disabled)'}
              </code>
            </div>
            <div>
              <div className="text-xs text-ink-500">Edit cap per principal</div>
              <span>{info.max_edits} edits</span>
            </div>
            <div>
              <div className="text-xs text-ink-500">Wallets cap per principal</div>
              <span>{info.max_wallets_per_principal.toString()} wallets</span>
            </div>
          </div>
        )}

        {amController && (
          <div className="rounded-md border border-ink-200 p-3 space-y-3 bg-ink-50">
            <p className="text-xs text-ink-600">
              As a canister controller you can change either value. The admin can call admin
              endpoints only when both match (signature recovers to the EVM wallet AND caller
              principal equals the linked principal).
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Admin EVM wallet (0x…)</span>
                <div className="flex gap-2">
                  <input
                    className="field-input flex-1 font-mono"
                    value={ethInput}
                    onChange={(e) => setEthInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={saveEth}
                    disabled={busy}
                  >
                    Save
                  </button>
                </div>
              </label>
              <label className="block">
                <span className="field-label">
                  Admin II principal (paste — leave empty to clear)
                </span>
                <div className="flex gap-2">
                  <input
                    className="field-input flex-1 font-mono"
                    placeholder="aaaaa-…"
                    value={principalInput}
                    onChange={(e) => setPrincipalInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={savePrincipal}
                    disabled={busy}
                  >
                    Save
                  </button>
                </div>
              </label>
            </div>
          </div>
        )}
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}

function AdminControls({ callerPrincipal }: { callerPrincipal: Principal }) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [overview, setOverview] = useState<HolderOverview[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const anon = await anonymousBackendActor();
        setInfo(await anon.get_admin_info());
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();
  }, []);

  const principalMatches = info?.principal[0]?.toText() === callerPrincipal.toText();
  const walletMatches =
    isConnected && info && address && address.toLowerCase() === info.eth_address.toLowerCase();

  async function loadOverview() {
    setError(null);
    setBusy(true);
    try {
      if (!walletMatches) throw new Error('Connect the configured admin EVM wallet first.');
      if (!principalMatches) throw new Error('Signed in with the wrong II principal for admin.');
      const actor = await backendActor();
      const auth = await produceAuth(actor);
      setOverview(unwrap(await actor.admin_overview(auth)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  /** The canister reads every attested wallet's balance itself, then returns the overview. */
  async function verifyOnchain() {
    setError(null);
    setBusy(true);
    try {
      if (!walletMatches) throw new Error('Connect the configured admin EVM wallet first.');
      if (!principalMatches) throw new Error('Signed in with the wrong II principal for admin.');
      const actor = await backendActor();
      const auth = await produceAuth(actor);
      setOverview(unwrap(await actor.admin_verify_onchain(auth)));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function produceAuth(actor: ActorSubclass<BackendService>) {
    const nonce = unwrap(await actor.get_admin_nonce());
    const signed_at_iso = new Date().toISOString();
    const message = buildAdminMessage(signed_at_iso, nonce);
    const signature = await signMessageAsync({ message });
    return { signature, nonce, signed_at_iso };
  }

  const wallets = overview?.flatMap((h) => h.wallets) ?? [];
  const invalid = wallets.filter((w) => !w.signature_valid).length;
  const stale = wallets.filter((w) => !w.profile_current).length;

  return (
    <div className="space-y-6">
      <div className="card">
        <div className="card-body space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
            <div className="space-y-1">
              <PrincipalChip principal={callerPrincipal} />
              {info && (
                <div className={`ml-1 ${principalMatches ? 'text-emerald-700' : 'text-red-600'}`}>
                  {principalMatches ? '✓ matches admin' : '✗ does not match admin'}
                </div>
              )}
            </div>
            <div>
              <span className="text-ink-500">Connected EVM wallet: </span>
              <code className="font-mono">{address ? shortAddress(address) : '(none)'}</code>
              {info && address && (
                <span className={`ml-2 ${walletMatches ? 'text-emerald-700' : 'text-red-600'}`}>
                  {walletMatches ? '✓ matches admin' : '✗ does not match admin'}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ConnectWalletButton />
            <button
              type="button"
              className="btn-primary"
              onClick={loadOverview}
              disabled={!walletMatches || !principalMatches || busy}
            >
              {busy ? 'Working…' : 'Load overview'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={verifyOnchain}
              disabled={!walletMatches || !principalMatches || busy}
              title="The canister reads every wallet's multiBTC balance itself, at the pre-incident block and now. Takes about a minute."
            >
              {busy ? 'Working…' : 'Verify balances on-chain'}
            </button>
          </div>
          <p className="text-xs text-ink-500">
            This is everything the admin can see: Telegram handles, and verdicts the canister
            computes itself. Names, dates of birth, emails and declared amounts never leave the
            canister, and there is no export.
          </p>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </div>
      </div>

      {overview && (
        <div className="card">
          <div className="card-header text-sm text-ink-700">
            {overview.length} holder{overview.length === 1 ? '' : 's'} · {wallets.length} attested
            wallet{wallets.length === 1 ? '' : 's'} ·{' '}
            <span className={invalid ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
              {invalid ? `${invalid} signature${invalid === 1 ? '' : 's'} failing` : 'all signatures valid'}
            </span>
            {stale > 0 && <span className="text-amber-700"> · {stale} need re-signing</span>}
          </div>
          <ul className="divide-y divide-ink-200">
            {overview.map((h) => (
              <li key={h.principal.toText()} className="space-y-2 px-4 py-3 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold text-ink-900">
                    {h.telegram_handle[0] ?? <span className="font-normal text-ink-400">no Telegram</span>}
                  </span>
                  <code className="font-mono text-xs text-ink-500">{h.principal.toText().slice(0, 11)}…</code>
                </div>
                {h.wallets.map((w) => (
                  <div key={w.wallet_address} className="text-xs">
                    <code className="font-mono">{shortAddress(w.wallet_address)}</code>{' '}
                    {w.signature_valid ? (
                      <span className="text-emerald-700">✓ signature valid</span>
                    ) : (
                      <span className="text-red-600">✗ {w.signature_error[0] ?? 'signature invalid'}</span>
                    )}
                    {!w.profile_current && (
                      <span className="text-amber-700"> · profile edited since signing</span>
                    )}
                    <span className="text-ink-400"> · rev {w.revision}</span>
                    {w.onchain.length > 0 && <OnchainTable rows={w.onchain} />}
                  </div>
                ))}
                {h.unattested_wallets.map((a) => (
                  <div key={a} className="text-xs text-ink-500">
                    <code className="font-mono">{shortAddress(a)}</code> linked, not attested
                  </div>
                ))}
                {h.wallets.length === 0 && h.unattested_wallets.length === 0 && (
                  <div className="text-xs text-ink-400">no wallets yet</div>
                )}
              </li>
            ))}
            {overview.length === 0 && <li className="px-4 py-6 text-center text-ink-500">No holders yet.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Balances the canister read itself. Public chain data, not the claimant's figures. */
function OnchainTable({ rows }: { rows: ChainVerdict[] }) {
  const cell = (o: [] | [ChainObservation]) => {
    const obs = o[0];
    if (!obs) return <span className="text-ink-400">—</span>;
    if (obs.balance[0] === undefined)
      return <span className="text-amber-700" title={obs.error[0] ?? ''}>unavailable</span>;
    return (
      <span title={`block ${obs.block[0]?.toString()} via ${obs.provider[0] ?? '?'}`}>
        {formatMultibtc(obs.balance[0], 8)}
      </span>
    );
  };
  return (
    <div className="overflow-x-auto">
      <table className="mt-1 mb-2 text-xs">
      <thead className="text-ink-500">
        <tr>
          <th className="pr-3 text-left font-normal">chain</th>
          <th className="pr-3 text-right font-normal">pre-incident</th>
          <th className="pr-3 text-right font-normal">now</th>
          <th className="text-left font-normal">at signing</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.chain}>
            <td className="pr-3">{r.chain}</td>
            <td className="pr-3 text-right font-mono">{cell(r.pre_incident)}</td>
            <td className="pr-3 text-right font-mono">{cell(r.current)}</td>
            <td>
              {r.detected_matches_current[0] === undefined ? (
                <span className="text-ink-400">—</span>
              ) : r.detected_matches_current[0] ? (
                <span className="text-emerald-700">✓ matches now</span>
              ) : (
                <span className="text-red-600" title="Either the claimant's browser reported a different balance, or tokens moved after signing.">
                  ✗ differs from now
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
      </table>
    </div>
  );
}
