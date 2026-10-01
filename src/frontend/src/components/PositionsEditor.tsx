import type { PositionDetail, PositionTypeVariant } from '../lib/backend';
import { CHAIN_KEYS, type SupportedChainId } from '../lib/wagmi';
import { Field } from './Field';
import { AmountInput } from './AmountInput';

const CHAIN_OPTS: { value: string; label: string }[] = [
  { value: CHAIN_KEYS[1], label: 'Ethereum' },
  { value: CHAIN_KEYS[56], label: 'BSC' },
  { value: CHAIN_KEYS[137], label: 'Polygon' },
  { value: CHAIN_KEYS[7700], label: 'Canto' },
];

type Kind = 'RawToken' | 'Lp' | 'Vault' | 'Other';

function variantToKind(v: PositionTypeVariant): Kind {
  if ('RawToken' in v) return 'RawToken';
  if ('Lp' in v) return 'Lp';
  if ('Vault' in v) return 'Vault';
  return 'Other';
}

function makeVariant(kind: Kind): PositionTypeVariant {
  if (kind === 'RawToken') return { RawToken: null };
  if (kind === 'Lp') return { Lp: { protocol: '', pool: '' } };
  if (kind === 'Vault') return { Vault: { protocol: '', name: '' } };
  return { Other: '' };
}

export function PositionsEditor({
  positions,
  setPositions,
  detected,
}: {
  positions: PositionDetail[];
  setPositions: (p: PositionDetail[]) => void;
  detected: Record<SupportedChainId, bigint>;
}) {
  function add() {
    setPositions([
      ...positions,
      { chain: CHAIN_KEYS[1], kind: { RawToken: null }, declared_multibtc: 0n },
    ]);
  }
  function update(i: number, p: PositionDetail) {
    setPositions(positions.map((x, idx) => (idx === i ? p : x)));
  }
  function remove(i: number) {
    setPositions(positions.filter((_, idx) => idx !== i));
  }

  function prefillFromDetected() {
    const next: PositionDetail[] = [];
    (Object.entries(CHAIN_KEYS) as [string, string][]).forEach(([cidStr, key]) => {
      const cid = Number(cidStr) as SupportedChainId;
      if (detected[cid] > 0n) {
        next.push({ chain: key, kind: { RawToken: null }, declared_multibtc: detected[cid] });
      }
    });
    setPositions(next.length > 0 ? next : positions);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink-800">Positions (at least 1 required)</h4>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary !px-3 !py-1.5" onClick={prefillFromDetected}>
            Prefill from detected
          </button>
          <button type="button" className="btn-primary !px-3 !py-1.5" onClick={add}>
            + Add position
          </button>
        </div>
      </div>
      {positions.length === 0 && (
        <div className="text-xs text-ink-500">No positions yet. Add at least one.</div>
      )}
      {positions.map((p, i) => {
        const kind = variantToKind(p.kind);
        return (
          <div key={i} className="rounded-md border border-ink-200 p-3 space-y-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="Chain" required>
                <select
                  className="field-input"
                  value={p.chain}
                  onChange={(e) => update(i, { ...p, chain: e.target.value })}
                >
                  {CHAIN_OPTS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Position type" required>
                <select
                  className="field-input"
                  value={kind}
                  onChange={(e) => update(i, { ...p, kind: makeVariant(e.target.value as Kind) })}
                >
                  <option value="RawToken">Raw multiBTC token</option>
                  <option value="Lp">LP position</option>
                  <option value="Vault">Vault position</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Declared multiBTC" required>
                <AmountInput
                  value={p.declared_multibtc}
                  placeholder="0.00000000"
                  onValue={(v) => update(i, { ...p, declared_multibtc: v })}
                />
              </Field>
            </div>
            {'Lp' in p.kind && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="LP protocol" required>
                  <input
                    className="field-input"
                    placeholder="e.g. Thena"
                    value={p.kind.Lp.protocol}
                    onChange={(e) => {
                      if (!('Lp' in p.kind)) return;
                      update(i, {
                        ...p,
                        kind: { Lp: { ...p.kind.Lp, protocol: e.target.value } },
                      });
                    }}
                  />
                </Field>
                <Field label="LP pool" required>
                  <input
                    className="field-input"
                    placeholder="e.g. BTCB/multiBTC"
                    value={p.kind.Lp.pool}
                    onChange={(e) => {
                      if (!('Lp' in p.kind)) return;
                      update(i, {
                        ...p,
                        kind: { Lp: { ...p.kind.Lp, pool: e.target.value } },
                      });
                    }}
                  />
                </Field>
              </div>
            )}
            {'Vault' in p.kind && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Field label="Vault protocol" required>
                  <input
                    className="field-input"
                    placeholder="e.g. Beefy"
                    value={p.kind.Vault.protocol}
                    onChange={(e) => {
                      if (!('Vault' in p.kind)) return;
                      update(i, {
                        ...p,
                        kind: { Vault: { ...p.kind.Vault, protocol: e.target.value } },
                      });
                    }}
                  />
                </Field>
                <Field label="Vault name" required>
                  <input
                    className="field-input"
                    placeholder="e.g. mooThenaBTCB-multiBTC"
                    value={p.kind.Vault.name}
                    onChange={(e) => {
                      if (!('Vault' in p.kind)) return;
                      update(i, {
                        ...p,
                        kind: { Vault: { ...p.kind.Vault, name: e.target.value } },
                      });
                    }}
                  />
                </Field>
              </div>
            )}
            {'Other' in p.kind && (
              <Field
                label="Describe where the multiBTC is"
                required
                help="e.g. lending market collateral, OTC desk custody, hardware wallet not auto-detected"
              >
                <input
                  className="field-input"
                  placeholder="e.g. Aave collateral; Fireblocks custody"
                  value={p.kind.Other}
                  onChange={(e) => update(i, { ...p, kind: { Other: e.target.value } })}
                />
              </Field>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs text-red-600 hover:underline"
                onClick={() => remove(i)}
              >
                Remove
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
