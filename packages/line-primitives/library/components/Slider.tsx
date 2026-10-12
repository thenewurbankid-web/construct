// @line-level atom
'use client';
import { Slider as RadixSlider } from 'radix-ui';
import { useId, useState } from 'react';

export type SliderProps = {
  label: string;
  value?: number;
  defaultValue?: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  /** The user let go or finished a key press. */
  onValueCommit?: (value: number) => void;
  disabled?: boolean;
  /** Shows the value; keys and drags are ignored (aria-readonly). */
  readOnly?: boolean;
  /** Shown under it (role="alert"); sets aria-invalid. */
  error?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
};

/** Pick a number in a range by dragging or with the arrow keys (Radix Slider). */
export function Slider({ label, value, defaultValue, min = 0, max = 100, step = 1, onValueChange, onValueCommit, disabled, readOnly = false, error, orientation = 'horizontal', className = '' }: SliderProps) {
  const id = useId();
  const [own, setOwn] = useState(defaultValue ?? min);
  const current = value ?? own;
  return (
    <div className={`flex flex-col gap-2 ${className}`} data-orientation={orientation}>
      <div className="flex items-center justify-between text-sm">
        <span id={`${id}-label`} data-part="label" className="font-medium text-slate-900">{label}</span>
        <output data-part="output" aria-hidden="true" className="tabular-nums text-slate-600">{current}</output>
      </div>
      <RadixSlider.Root
        value={[current]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        orientation={orientation}
        onValueChange={([v]) => { if (readOnly) return; setOwn(v); onValueChange?.(v); }}
        onValueCommit={([v]) => { if (!readOnly) onValueCommit?.(v); }}
        className="relative flex touch-none select-none items-center data-[orientation=horizontal]:h-5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-40 data-[orientation=vertical]:w-5 data-[orientation=vertical]:flex-col data-[disabled]:opacity-50"
      >
        <RadixSlider.Track data-part="track" className="relative grow overflow-hidden rounded-full bg-slate-200 data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5">
          <RadixSlider.Range data-part="range" className="absolute bg-slate-900 data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full" />
        </RadixSlider.Track>
        <RadixSlider.Thumb aria-labelledby={`${id}-label`} aria-readonly={readOnly || undefined} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} data-part="thumb" className="block h-5 w-5 rounded-full border-2 border-slate-900 bg-white hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900" />
      </RadixSlider.Root>
      <SliderError id={`${id}-error`} text={error} />
    </div>
  );
}

function SliderError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} role="alert" className="text-sm text-red-700">{text}</p>;
}
