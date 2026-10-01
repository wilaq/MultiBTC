import type { BridgeAttempt } from '../lib/backend';
import { CHAIN_KEYS } from '../lib/wagmi';
import { Field } from './Field';

const CHAIN_OPTS: { value: string; label: string }[] = [
  { value: CHAIN_KEYS[1], label: 'Ethereum' },
  { value: CHAIN_KEYS[56], label: 'BSC' },
  { value: CHAIN_KEYS[137], label: 'Polygon' },
  { value: CHAIN_KEYS[7700], label: 'Canto' },
  { value: 'bitcoin', label: 'Bitcoin (HTLC)' },
];

export function BridgeAttemptsEditor({
  items,
  setItems,
}: {
  items: BridgeAttempt[];
  setItems: (v: BridgeAttempt[]) => void;
}) {
  function add() {
    setItems([...items, { chain: CHAIN_KEYS[1], tx_hash: '', description: [] }]);
  }
  function update(i: number, v: BridgeAttempt) {
    setItems(items.map((x, idx) => (idx === i ? v : x)));
  }
  function remove(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink-800">Bridge attempts</h4>
        <button type="button" className="btn-primary !px-3 !py-1.5" onClick={add}>
          + Add attempt
        </button>
      </div>
      <p className="text-xs text-ink-500">
        Tx hashes of any bridge redemption attempts on Multichain router or HTLC interactions.
        Strengthens evidence that you tried to redeem your multiBTC.
      </p>
      {items.map((a, i) => (
        <div key={i} className="rounded-md border border-ink-200 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Chain" required>
              <select
                className="field-input"
                value={a.chain}
                onChange={(e) => update(i, { ...a, chain: e.target.value })}
              >
                {CHAIN_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tx hash" required>
              <input
                className="field-input font-mono"
                placeholder="0x…"
                value={a.tx_hash}
                onChange={(e) => update(i, { ...a, tx_hash: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Description (optional)">
            <input
              className="field-input"
              placeholder="e.g. router redemption failed, Multichain support ticket #1234"
              value={a.description.length > 0 ? a.description[0] : ''}
              onChange={(e) =>
                update(i, { ...a, description: e.target.value === '' ? [] : [e.target.value] })
              }
            />
          </Field>
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
      ))}
    </div>
  );
}
