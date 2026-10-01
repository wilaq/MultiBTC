import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { Principal } from '@dfinity/principal';
import { AuthGate } from '../components/AuthGate';
import { ConnectWalletButton } from '../components/ConnectWalletDialog';
import { anonymousBackendActor, backendActor, BACKEND_CANISTER_ID } from '../lib/auth';
import { buildAdminMessage } from '../lib/message';
import { formatMultibtc, formatTsNs } from '../lib/format';
import { unwrap, type ProposalKind, type ProposalView, type VoteChoice } from '../lib/backend';

export function Governance() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-ink-900">Governance</h1>
        <p className="text-sm text-ink-600">
          Holders decide together. A proposal resolves as soon as every eligible holder has voted,
          otherwise after 7 days, when the larger share of votes cast wins. A tie goes to the side
          whose voters hold more multiBTC, as verified on-chain by the canister. Ballots are
          secret; only totals are shown.
        </p>
      </header>
      <AuthGate>{({ principal }) => <GovernanceContent me={principal} />}</AuthGate>
    </div>
  );
}

const short = (p: Principal) => `${p.toText().slice(0, 11)}…`;

function GovernanceContent({ me }: { me: Principal }) {
  const [proposals, setProposals] = useState<ProposalView[] | null>(null);
  const [eligible, setEligible] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const actor = await backendActor();
      const [list, elig, info] = await Promise.all([
        actor.list_proposals(),
        actor.am_i_eligible_voter(),
        (await anonymousBackendActor()).get_admin_info(),
      ]);
      setProposals(unwrap(list));
      setEligible(elig);
      setIsAdmin(info.principal[0]?.toText() === me.toText());
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const myActiveGrant = proposals?.some(
    (p) =>
      'GrantDataAccess' in p.kind &&
      p.kind.GrantDataAccess.grantee.toText() === me.toText() &&
      p.access_expires_at_ns[0] !== undefined &&
      Number(p.access_expires_at_ns[0] / 1_000_000n) > Date.now(),
  );

  return (
    <div className="space-y-6">
      {error && <div className="card"><div className="card-body text-sm text-red-600">{error}</div></div>}
      {myActiveGrant && <GrantedDownload />}
      {eligible || isAdmin ? (
        <NewProposal onCreated={reload} isAdmin={isAdmin} eligible={eligible} />
      ) : (
        proposals && (
          <div className="card">
            <div className="card-body text-sm text-ink-600">
              Holders who signed a wallet before 1 October 2026 can propose and vote. Holders who
              sign later can once their first signed wallet is 14 days old and the canister has
              verified at least 0.02 multiBTC across their wallets on-chain.
            </div>
          </div>
        )
      )}
      {proposals?.length === 0 && <div className="text-sm text-ink-500">No proposals yet.</div>}
      {proposals?.map((p) => (
        <ProposalCard key={p.id.toString()} p={p} me={me} eligible={eligible} onChange={reload} />
      ))}
    </div>
  );
}

function kindSummary(k: ProposalKind) {
  if ('GrantDataAccess' in k)
    return `Grant ${short(k.GrantDataAccess.grantee)} read access to all holder records for ${k.GrantDataAccess.duration_days} day(s)`;
  if ('AddController' in k)
    return `Add ${k.AddController.controller.toText()} as a controller of the backend canister`;
  return 'Group decision';
}

function ProposalCard({
  p,
  me,
  eligible,
  onChange,
}: {
  p: ProposalView;
  me: Principal;
  eligible: boolean;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcome = p.outcome[0];
  const open = !outcome && !p.awaiting_finalisation;
  const msLeft = Number(p.deadline_ns / 1_000_000n) - Date.now();
  const mine = p.my_vote[0];

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }
  const vote = (choice: VoteChoice) =>
    act(async () => unwrap(await (await backendActor()).vote(p.id, choice)));
  const finalize = () =>
    act(async () => unwrap(await (await backendActor()).finalize_proposal(p.id)));

  return (
    <div className="card">
      <div className="card-header flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-ink-900">
          #{p.id.toString()} · {p.title}
        </div>
        <span
          className={`text-xs font-medium ${
            outcome ? (outcome.passed ? 'text-emerald-700' : 'text-red-600') : 'text-ink-600'
          }`}
        >
          {outcome
            ? outcome.passed
              ? 'Passed'
              : 'Rejected'
            : p.awaiting_finalisation
              ? 'Voting closed'
              : `Open · ${Math.max(0, Math.ceil(msLeft / 3_600_000))} h left`}
        </span>
      </div>
      <div className="card-body space-y-3 text-sm">
        <div className={'AddController' in p.kind ? 'font-medium text-amber-800' : 'text-ink-700'}>
          {kindSummary(p.kind)}
        </div>
        {p.description && <p className="whitespace-pre-wrap text-ink-700">{p.description}</p>}
        <div className="text-xs text-ink-500">
          Proposed by {short(p.proposer)}
          {p.proposer.toText() === me.toText() && ' (you)'} · {formatTsNs(p.created_at_ns)}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-emerald-700">Yes {p.yes}</span>
          <span className="text-red-600">No {p.no}</span>
          <span className="text-ink-500">of {p.eligible_now} eligible</span>
          {mine && <span className="text-ink-600">You voted {'Yes' in mine ? 'yes' : 'no'}</span>}
        </div>

        {open && eligible && (
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => vote({ Yes: null })}>
              Vote yes
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => vote({ No: null })}>
              Vote no
            </button>
          </div>
        )}
        {p.awaiting_finalisation && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={finalize}>
            Finalise result
          </button>
        )}

        {outcome && (
          <div className="rounded border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-700 space-y-1">
            <div>
              {outcome.reason} · {outcome.yes} yes / {outcome.no} no of {outcome.eligible} eligible ·
              resolved {formatTsNs(outcome.resolved_at_ns)}
            </div>
            {outcome.tiebreak_yes_balance[0] !== undefined && (
              <div>
                Tiebreak — yes voters hold {formatMultibtc(outcome.tiebreak_yes_balance[0], 8)}, no
                voters {formatMultibtc(outcome.tiebreak_no_balance[0] ?? 0n, 8)} multiBTC (verified
                on-chain).
              </div>
            )}
            {'AddController' in p.kind && outcome.passed && (
              <div>
                {outcome.executed_at_ns[0] !== undefined ? (
                  <span className="text-emerald-700">Controller added {formatTsNs(outcome.executed_at_ns[0])}.</span>
                ) : (
                  <span className="text-red-600">
                    Not yet carried out{outcome.execution_error[0] ? `: ${outcome.execution_error[0]}` : ''}.{' '}
                    <button type="button" className="underline" disabled={busy} onClick={finalize}>
                      Retry
                    </button>
                  </span>
                )}
              </div>
            )}
            {p.access_expires_at_ns[0] !== undefined && (
              <div>
                Access {Number(p.access_expires_at_ns[0] / 1_000_000n) > Date.now() ? 'open until' : 'expired'}{' '}
                {formatTsNs(p.access_expires_at_ns[0])} · read {p.reads_at_ns.length} time(s)
                {p.reads_at_ns.length > 0 && `, last ${formatTsNs(p.reads_at_ns[p.reads_at_ns.length - 1])}`}
              </div>
            )}
          </div>
        )}
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    </div>
  );
}

type Draft = 'Decision' | 'GrantDataAccess' | 'AddController';

function NewProposal({
  onCreated,
  isAdmin,
  eligible,
}: {
  onCreated: () => Promise<void>;
  isAdmin: boolean;
  eligible: boolean;
}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [kind, setKind] = useState<Draft>(eligible ? 'Decision' : 'AddController');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [principalText, setPrincipalText] = useState('');
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const actor = await backendActor();
      if (kind === 'AddController') {
        if (!address) throw new Error('Connect the admin EVM wallet to sign.');
        const nonce = unwrap(await actor.get_admin_nonce());
        const signed_at_iso = new Date().toISOString();
        const signature = await signMessageAsync({ message: buildAdminMessage(signed_at_iso, nonce) });
        unwrap(
          await actor.admin_propose_add_controller(
            { signature, nonce, signed_at_iso },
            title,
            description,
            Principal.fromText(principalText.trim()),
          ),
        );
      } else {
        const k: ProposalKind =
          kind === 'Decision'
            ? { Decision: null }
            : {
                GrantDataAccess: {
                  grantee: Principal.fromText(principalText.trim()),
                  duration_days: Number(days),
                },
              };
        unwrap(await actor.create_proposal({ title, description, kind: k }));
      }
      setTitle('');
      setDescription('');
      setPrincipalText('');
      await onCreated();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-header text-sm font-semibold text-ink-900">New proposal</div>
      <div className="card-body space-y-3">
        <select className="field-input max-w-sm" value={kind} onChange={(e) => setKind(e.target.value as Draft)}>
          {eligible && <option value="Decision">Group decision</option>}
          {eligible && <option value="GrantDataAccess">Grant read access to all records</option>}
          {/* Shown to the admin only; the backend also refuses anyone else. */}
          {isAdmin && <option value="AddController">Add a controller (admin)</option>}
        </select>
        <input className="field-input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          className="field-input"
          rows={3}
          placeholder="What is being decided, and why"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {kind !== 'Decision' && (
          <input
            className="field-input font-mono"
            placeholder={kind === 'AddController' ? 'Principal to add as controller' : 'Principal to receive access'}
            value={principalText}
            onChange={(e) => setPrincipalText(e.target.value)}
          />
        )}
        {kind === 'GrantDataAccess' && (
          <label className="block max-w-xs text-sm">
            <span className="field-label">Access lasts (days, 1–365)</span>
            <input className="field-input" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
        )}
        {kind === 'AddController' && (
          <div className="space-y-2 text-xs text-amber-800">
            <p>
              A controller can upgrade the canister and read everything it holds. If holders pass
              this, the canister adds the principal itself; nothing can remove a controller this
              way. Signing requires the admin EVM wallet.
            </p>
            <ConnectWalletButton />
          </div>
        )}
        <button type="button" className="btn-primary" disabled={busy || !title.trim()} onClick={submit}>
          {busy ? 'Submitting…' : 'Submit proposal'}
        </button>
        {error && <div className="text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}

/** For a principal holding an active grant: the records, in the verifier's format. */
function GrantedDownload() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const bundles = unwrap(await (await backendActor()).governed_read_all());
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
          note: 'Read under a data-access grant passed by holder vote; the read is logged on the proposal.',
        },
        bundles: JSON.parse(body),
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `multibtc-records-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card border-emerald-200">
      <div className="card-body space-y-2 text-sm">
        <div className="font-semibold text-ink-900">You hold an active data-access grant</div>
        <p className="text-ink-700">
          Holders voted to let you read all records for a limited time. Each download is logged on
          the proposal, visible to every holder.
        </p>
        <button type="button" className="btn-primary" disabled={busy} onClick={download}>
          {busy ? 'Preparing…' : 'Download records'}
        </button>
        {error && <div className="text-red-600">{error}</div>}
      </div>
    </div>
  );
}
