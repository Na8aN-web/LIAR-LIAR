'use client';

import { useEffect } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  className = '',
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
  wide?: boolean;
  className?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}
