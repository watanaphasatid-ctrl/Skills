import type { ButtonHTMLAttributes, ComponentChildren, TargetedEvent } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { CommandResult } from '../core/controlSystem';
import { toast } from './toast';

/** ISA-5.1 style instrument bubble: function letters over loop number. */
export function Bubble({ tag, size = 'md' }: { tag: string; size?: 'sm' | 'md' | 'lg' }) {
  const [fn = '', loop = ''] = tag.split(/[\s-]/);
  return (
    <span class={`bubble bubble-${size}`} aria-hidden="true">
      <span class="bubble-fn">{fn}</span>
      <span class="bubble-loop">{loop}</span>
    </span>
  );
}

export function Card({ title, aside, children, class: cls = '' }: { title?: string; aside?: ComponentChildren; children: ComponentChildren; class?: string }) {
  return (
    <section class={`card ${cls}`}>
      {(title || aside) && (
        <header class="card-head">
          {title && <h2>{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

export function Readout({ tag, label, value, unit, tone = 'normal' }: { tag: string; label: string; value: string; unit: string; tone?: 'normal' | 'setpoint' | 'alarm' }) {
  return (
    <div class={`readout readout-${tone}`}>
      <Bubble tag={tag} />
      <div class="readout-body">
        <span class="readout-label">{label}</span>
        <span class="readout-value">
          <span class="num">{value}</span>
          <span class="unit">{unit}</span>
        </span>
      </div>
    </div>
  );
}

export function StatusPill({ tone, children }: { tone: 'ok' | 'idle' | 'alarm' | 'warn'; children: ComponentChildren }) {
  return <span class={`pill pill-${tone}`}>{children}</span>;
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string; disabled?: boolean }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === value}
          class={o.value === value ? 'seg on' : 'seg'}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

interface NumberSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** Upper limit of the slider only; the number box accepts up to `max`. */
  sliderMax?: number;
  step: number;
  unit?: string;
  digits?: number;
  disabled?: boolean;
  hint?: string;
  onCommit: (v: number) => CommandResult | void;
}

/** Slider + number box that stay in sync; invalid typing never reaches the controller. */
export function NumberSlider({ id, label, value, min, max, sliderMax, step, unit, digits = 1, disabled, hint, onCommit }: NumberSliderProps) {
  const [text, setText] = useState(value.toFixed(digits));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value.toFixed(digits));
  }, [value, digits]);

  const commit = (raw: number) => {
    const v = Math.min(max, Math.max(min, raw));
    const r = onCommit(v);
    if (r && !r.ok) toast(r.reason ?? 'Command rejected', 'error');
  };

  const onText = (e: TargetedEvent<HTMLInputElement>) => {
    editing.current = true;
    setText(e.currentTarget.value);
  };
  const finish = () => {
    editing.current = false;
    const n = Number(text);
    // Out-of-range typing is REJECTED, not clamped: a typo such as 650 for 65 must not become 100.
    if (text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) commit(n);
    else toast(`${label}: enter a number between ${min} and ${max}`, 'error');
    setText(value.toFixed(digits));
  };

  return (
    <div class={`field ${disabled ? 'is-disabled' : ''}`}>
      <div class="field-row">
        <label for={`${id}-num`}>{label}</label>
        <span class="field-input">
          <input
            id={`${id}-num`}
            type="text"
            inputMode="decimal"
            value={text}
            disabled={disabled}
            onInput={onText}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                editing.current = false;
                setText(value.toFixed(digits));
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
          />
          {unit && <span class="unit">{unit}</span>}
        </span>
      </div>
      <input
        id={id}
        class="range"
        type="range"
        min={min}
        max={sliderMax ?? max}
        step={step}
        value={Math.min(value, sliderMax ?? max)}
        disabled={disabled}
        aria-label={label}
        onInput={(e) => commit(Number(e.currentTarget.value))}
      />
      {hint && <p class="hint">{hint}</p>}
    </div>
  );
}

export function Button({ children, tone = 'default', ...rest }: { tone?: 'default' | 'primary' | 'danger' | 'quiet' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} class={`btn btn-${tone} ${rest.class ?? ''}`}>
      {children}
    </button>
  );
}
