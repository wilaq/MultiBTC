import { useState } from 'react';
import type { Principal } from '@dfinity/principal';

export function PrincipalChip({
  principal,
  label = 'Your II principal',
}: {
  principal: Principal;
  label?: string;
}) {
  const text = principal.toText();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — user can select the text manually
    }
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-ink-300 bg-white px-3 py-1.5 text-xs">
      <span className="text-ink-500">{label}:</span>
      <code className="font-mono text-ink-900 break-all select-all">{text}</code>
      <button
        type="button"
        onClick={copy}
        className="rounded border border-ink-300 px-2 py-0.5 text-ink-700 hover:bg-ink-50"
        aria-label="Copy principal"
      >
        {copied ? '✓ Copied' : 'Copy'}
      </button>
    </div>
  );
}
