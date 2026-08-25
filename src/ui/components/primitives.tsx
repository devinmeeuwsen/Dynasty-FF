import type { ReactNode } from 'react';
import type { Position } from '../../engine/types';
import { POSITION_CLASS } from '../format';

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={`panel ${className}`}>{children}</Tag>;
}

export function PanelHeader({
  title,
  subtitle,
  right,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
      <div className="min-w-0">
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink-100">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 max-w-prose text-[0.8125rem] leading-relaxed text-ink-400">
            {subtitle}
          </p>
        ) : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </header>
  );
}

export function PositionChip({ position }: { position: Position }) {
  return (
    <span
      className={`num inline-flex h-5 min-w-[2.125rem] items-center justify-center rounded-md px-1.5 text-[0.6875rem] font-semibold ring-1 ring-inset ${POSITION_CLASS[position]}`}
    >
      {position}
    </span>
  );
}

export function Stat({
  label,
  children,
  hint,
  tone = 'neutral',
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'now' | 'later' | 'blend';
}) {
  const toneClass = {
    neutral: 'text-ink-100',
    now: 'text-now-400',
    later: 'text-later-400',
    blend: 'text-blend-400',
  }[tone];
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
        {label}
      </div>
      <div className={`num mt-1 text-2xl font-semibold tracking-tight ${toneClass}`}>
        {children}
      </div>
      {hint ? <div className="mt-1 text-[0.75rem] leading-snug text-ink-400">{hint}</div> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  type = 'button',
  className = '',
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  title?: string;
}) {
  const base =
    'focus-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-40';
  const sizes = { sm: 'h-8 px-3 text-[0.8125rem]', md: 'h-10 px-4 text-sm' }[size];
  const variants = {
    primary:
      'bg-blend-500 text-white shadow-lg shadow-blend-600/25 hover:bg-blend-400 active:translate-y-px',
    ghost:
      'border border-white/10 bg-white/[0.03] text-ink-200 hover:bg-white/[0.07] hover:text-ink-100',
    subtle: 'text-ink-300 hover:bg-white/[0.05] hover:text-ink-100',
    danger: 'border border-bad-500/30 bg-bad-500/10 text-bad-500 hover:bg-bad-500/20',
  }[variant];
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${sizes} ${variants} ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-400">
        {label}
      </span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-400">{hint}</p> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  onEnter,
  autoFocus,
  type = 'text',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onEnter?: () => void;
  autoFocus?: boolean;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
      className="focus-ring h-10 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 text-sm text-ink-100 placeholder:text-ink-500"
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const next = Number(e.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="num focus-ring h-10 w-full rounded-lg border border-white/10 bg-ink-950/60 px-3 text-sm text-ink-100"
    />
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="focus-ring h-10 w-full appearance-none rounded-lg border border-white/10 bg-ink-950/60 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 5l3 3 3-3%22 stroke=%22%236a6a85%22 stroke-width=%221.5%22 fill=%22none%22 stroke-linecap=%22round%22/></svg>')] bg-[length:12px] bg-[right_0.75rem_center] bg-no-repeat px-3 pr-9 text-sm text-ink-100"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} className="bg-ink-900">
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-lg border border-white/10 bg-ink-950/50 p-0.5"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`focus-ring rounded-[0.4375rem] font-medium transition ${
              size === 'sm' ? 'h-7 px-2.5 text-[0.75rem]' : 'h-8 px-3 text-[0.8125rem]'
            } ${
              active
                ? 'bg-white/[0.1] text-ink-100 shadow-sm'
                : 'text-ink-400 hover:text-ink-200'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'good' | 'bad';
  title?: ReactNode;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-blend-500/25 bg-blend-500/[0.07] text-ink-200',
    warn: 'border-now-500/30 bg-now-500/[0.08] text-ink-200',
    good: 'border-good-500/30 bg-good-500/[0.08] text-ink-200',
    bad: 'border-bad-500/35 bg-bad-500/[0.09] text-ink-200',
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 text-[0.8125rem] leading-relaxed ${tones}`}>
      {title ? <div className="mb-1 font-semibold text-ink-100">{title}</div> : null}
      {children}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-md bg-white/[0.04] ${className}`} />;
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-ink-200">{title}</h3>
      {children ? (
        <p className="max-w-md text-[0.8125rem] leading-relaxed text-ink-400">{children}</p>
      ) : null}
      {action}
    </div>
  );
}

/** A horizontal bar used inside table cells to make magnitude scannable. */
export function Bar({
  fraction,
  color,
  className = '',
}: {
  fraction: number;
  color: string;
  className?: string;
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${width}%`, background: color }}
      />
    </div>
  );
}
