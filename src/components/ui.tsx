import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { X, Check, AlertTriangle, Info, Loader2, Search } from 'lucide-react';
import clsx from 'clsx';

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  padded = true,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  padded?: boolean;
  id?: string;
}) {
  return (
    <section id={id} data-card className={clsx('card', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-4 sm:p-5')}>{children}</div>
    </section>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">{eyebrow}</p>}
        <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ── Button ──────────────────────────────────────────────────────────────────
type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger' | 'outline';

export function Button({
  variant = 'default',
  size = 'md',
  loading,
  icon: Icon,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  const variantClass = {
    default: 'btn',
    primary: 'btn btn-primary',
    ghost: 'btn btn-ghost',
    danger: 'btn btn-danger',
    outline: 'btn bg-transparent',
  }[variant];

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={clsx(variantClass, size === 'sm' && '!px-2.5 !py-1.5 !text-xs', className)}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : Icon ? <Icon size={15} /> : null}
      {children}
    </button>
  );
}

// ── form controls ───────────────────────────────────────────────────────────
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && <span className="label">{label}</span>}
      {children}
      {error ? (
        <p className="mt-1 text-[11px] text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = (props: InputHTMLAttributes<HTMLInputElement>) => (
  <input {...props} className={clsx('input', props.className)} />
);

export const Textarea = (props: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea {...props} className={clsx('input min-h-[90px] resize-y', props.className)} />
);

export const Select = (props: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select {...props} className={clsx('input appearance-none pr-8', props.className)}>
    {props.children}
  </select>
);

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition',
          checked ? 'border-accent/60 bg-accent/80' : 'border-line bg-raised',
          disabled && 'opacity-50',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white transition-all',
            checked ? 'left-[22px]' : 'left-0.5',
          )}
          style={{ height: 18, width: 18 }}
        />
      </button>
    </div>
  );
}

export function TagInput({
  value,
  onChange,
  placeholder = 'Add a tag and press Enter',
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const tag = draft.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft('');
  };
  return (
    <div className="rounded-xl border border-line bg-raised/70 px-2 py-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <span key={tag} className="chip">
            {tag}
            <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit}
          placeholder={placeholder}
          className="min-w-[120px] flex-1 bg-transparent px-1 py-0.5 text-sm outline-none placeholder:text-muted/60"
        />
      </div>
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={clsx('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input pl-9"
      />
    </div>
  );
}

// ── feedback ────────────────────────────────────────────────────────────────
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'border-line bg-raised/70 text-muted',
    accent: 'border-accent/30 bg-accent/12 text-accent',
    ok: 'border-ok/30 bg-ok/12 text-ok',
    warn: 'border-warn/30 bg-warn/12 text-warn',
    danger: 'border-danger/30 bg-danger/12 text-danger',
    info: 'border-accent2/30 bg-accent2/12 text-accent2',
  };
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon = Info,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line/80 px-6 py-10 text-center">
      <Icon size={22} className="mb-3 text-muted" />
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={clsx('animate-spin text-accent', className)} size={18} />
);

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted">
      <Spinner /> {label}
    </div>
  );
}

export function Progress({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'ok' | 'warn' | 'danger' }) {
  const colors = { accent: 'bg-accent', ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger' };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/70" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ── modal ───────────────────────────────────────────────────────────────────
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={clsx(
          'animate-fadeIn flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-line bg-surface shadow-2xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line/70 px-4 py-3 sm:px-5">
          <div>
            <h2 className="text-sm font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close dialog" className="btn btn-ghost !p-1.5">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line/70 px-4 py-3 sm:px-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-muted">{message}</p>
    </Modal>
  );
}

// ── tabs ────────────────────────────────────────────────────────────────────
export function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-line/70 bg-surface/60 p-1" role="tablist">
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={clsx(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
            value === item.value ? 'bg-raised text-ink shadow-sm' : 'text-muted hover:text-ink',
          )}
        >
          {item.label}
          {item.badge !== undefined && <span className="chip !border-0 !bg-line/60 !px-1.5">{item.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ── markdown ────────────────────────────────────────────────────────────────
export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose-life">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const url = href && /^https?:\/\//i.test(href) ? href : null;
            if (!url) return <span>{children}</span>;
            return (
              <a href={url} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
        }}
      >
        {content || '_Nothing written yet._'}
      </ReactMarkdown>
    </div>
  );
}

// ── toasts ──────────────────────────────────────────────────────────────────
type Toast = { id: number; tone: 'ok' | 'error' | 'info'; message: string };
const ToastContext = createContext<{ push: (tone: Toast['tone'], message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, tone, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-20 left-1/2 z-[60] flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={clsx(
              'animate-fadeIn pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-lg backdrop-blur',
              toast.tone === 'ok' && 'border-ok/40 bg-ok/12 text-ok',
              toast.tone === 'error' && 'border-danger/40 bg-danger/12 text-danger',
              toast.tone === 'info' && 'border-line bg-surface/95 text-ink',
            )}
          >
            {toast.tone === 'ok' ? <Check size={14} /> : toast.tone === 'error' ? <AlertTriangle size={14} /> : <Info size={14} />}
            <span className="leading-relaxed">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return {
    success: (message: string) => ctx.push('ok', message),
    error: (message: string) => ctx.push('error', message),
    info: (message: string) => ctx.push('info', message),
  };
}

// ── misc ────────────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'accent' | 'ok' | 'warn' | 'danger';
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) {
  const color = { accent: 'text-accent', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }[tone ?? 'accent'];
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
        {Icon && <Icon size={15} className={color} />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-ink">{value}</div>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-xl border border-line/80 bg-raised/40 p-3 text-[11px] leading-relaxed text-muted">
      <Info size={14} className="mt-0.5 shrink-0 text-accent2" />
      <div>{children}</div>
    </div>
  );
}
