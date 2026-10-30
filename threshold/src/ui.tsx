import { ReactNode, useEffect, useState } from 'react';
import { Sheet } from 'framework7-react';

export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    const onVis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [ms]);
  return now;
}

export function Chip({ on, onClick, children, label, className = '' }: {
  on?: boolean; onClick: () => void; children: ReactNode; label?: string; className?: string;
}) {
  return (
    <button type="button" className={`chip ${on ? 'on' : ''} ${className}`} aria-pressed={!!on} aria-label={label} onClick={onClick}>
      {children}
    </button>
  );
}

export function Choice<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: readonly { id: T; label: string }[]; value: T | null; onChange: (v: T) => void;
}) {
  return (
    <fieldset className="field">
      <legend>{label}</legend>
      <div className="chips">
        {options.map((o) => <Chip key={String(o.id)} on={value === o.id} onClick={() => onChange(o.id)}>{o.label}</Chip>)}
      </div>
    </fieldset>
  );
}

export function Switch({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <div className="row switch-row">
      <span><span>{label}</span>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <i aria-hidden="true" />
      </button>
    </div>
  );
}

export function Modal({ title, onClose, children, aside }: { title: string; onClose: () => void; children: ReactNode; aside?: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => {
      cancelAnimationFrame(id);
      document.querySelectorAll('.sheet-backdrop').forEach((b) => b.classList.remove('backdrop-in'));
      document.documentElement.classList.remove('with-modal-sheet');
    };
  }, []);
  return (
    <Sheet opened={open} className="modal" backdrop closeByBackdropClick closeOnEscape swipeToClose onSheetClosed={onClose} aria-label={title}>
      <div className="modal-handle" aria-hidden="true" />
      <div className="modal-body">
        <div className="modal-head">
          <h2>{title}</h2>
          {aside}
          <button type="button" className="link" onClick={() => setOpen(false)}>Close</button>
        </div>
        {children}
      </div>
    </Sheet>
  );
}

export function Card({ title, tone, children }: { title?: string; tone?: 'alert' | 'amber' | 'sage'; children: ReactNode }) {
  return (
    <section className={`card ${tone ?? ''}`}>
      {title && <div className="card-head"><h3>{title}</h3></div>}
      {children}
    </section>
  );
}
