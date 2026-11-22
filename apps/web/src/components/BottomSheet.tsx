import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * iOS-style bottom sheet on phones; centered dialog on wide screens.
 * Accessible: role=dialog, aria-modal, Escape closes, focus moves in and is restored, simple focus trap.
 * Swipe the grabber down to dismiss.
 */
export function BottomSheet({
  open, onClose, title, children, footer, size = 'md',
}: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [dragY, setDragY] = useState(0);
  const startY = useRef<number | null>(null);
  // parents pass inline closures; keep the latest in a ref so a parent re-render (e.g. the inbox poll) does not re-run the
  // effect below — that used to restore focus and then steal it back to the first control while the user was typing
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () =>
      el ? Array.from(el.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((x) => !x.hasAttribute('disabled')) : [];
    setTimeout(() => (focusables()[0] ?? el)?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className={`sheet sheet--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
      >
        <div
          className="sheet__grabber"
          onTouchStart={(e) => (startY.current = e.touches[0].clientY)}
          onTouchMove={(e) => {
            if (startY.current === null) return;
            setDragY(Math.max(0, e.touches[0].clientY - startY.current));
          }}
          onTouchEnd={() => {
            if (dragY > 120) onClose();
            setDragY(0);
            startY.current = null;
          }}
          aria-hidden
        >
          <span />
        </div>
        <header className="sheet__head">
          <h2 id={titleId} className="sheet__title">
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Kapat">
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet__body">{children}</div>
        {footer ? <footer className="sheet__foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
