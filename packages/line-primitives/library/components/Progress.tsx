// @line-level atom
'use client';
import { Progress as RadixProgress } from 'radix-ui';
import { useId } from 'react';

export type ProgressProps = {
  label: string;
  /** null or undefined: indeterminate. */
  value?: number | null;
  max?: number;
  /** Shows "n%" next to the label. */
  showValue?: boolean;
  size?: 'sm' | 'md';
  tone?: 'brand' | 'success' | 'error';
};

const TONES = { brand: 'bg-slate-900', success: 'bg-green-600', error: 'bg-red-600' };

/** How far a task has got (Radix Progress: role="progressbar"; no aria-valuenow while indeterminate). */
export function Progress({ label, value = null, max = 100, showValue = false, size = 'md', tone = 'brand' }: ProgressProps) {
  const id = useId();
  const known = typeof value === 'number';
  const percent = known ? Math.round((Math.min(Math.max(value, 0), max) / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5" data-size={size}>
      <div className="flex justify-between text-sm">
        <span id={`${id}-label`} data-part="label" className="font-medium text-slate-900">{label}</span>
        <ValueText show={showValue && known} percent={percent} />
      </div>
      <RadixProgress.Root aria-labelledby={`${id}-label`} value={value} max={max} className={`relative w-full overflow-hidden rounded-full bg-slate-200 ${size === 'sm' ? 'h-1.5' : 'h-2.5'}`}>
        <RadixProgress.Indicator
          data-part="indicator"
          className={`h-full transition-transform data-[state=indeterminate]:w-1/3 data-[state=indeterminate]:animate-pulse ${TONES[tone]}`}
          style={known ? { transform: `translateX(-${100 - percent}%)` } : undefined}
        />
      </RadixProgress.Root>
    </div>
  );
}

function ValueText({ show, percent }: { show: boolean; percent: number }) {
  if (!show) return null;
  return <span aria-hidden="true" data-part="valueText" className="tabular-nums text-slate-600">{percent}%</span>;
}
