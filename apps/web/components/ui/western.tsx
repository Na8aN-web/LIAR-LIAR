// The Wild West design system: five building blocks, styled in globals.css.
//   <Paper>        aged parchment panel (sepia ink on cream)
//   <WoodBar>      dark planked bar (cream text)
//   <BrassBadge>   engraved brass plate for numbers (timer, purse, counts)
//   <StampButton>  ink-stamped button (also: className="btn")
//   <Rope />       twisted rope divider

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(' ');

export function Paper({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('paper', className)} {...rest}>
      {children}
    </div>
  );
}

export function WoodBar({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('wood', className)} {...rest}>
      {children}
    </div>
  );
}

export function BrassBadge({
  label,
  children,
  className,
  tone,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
  tone?: 'alert';
}) {
  return (
    <div className={cx('brass', tone === 'alert' && 'brass-alert', className)}>
      {label && <span className="brass-label">{label}</span>}
      <span className="brass-value">{children}</span>
    </div>
  );
}

export function StampButton({
  variant = 'default',
  size,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost'; size?: 'small' }) {
  return (
    <button
      className={cx('btn', variant === 'primary' && 'primary', variant === 'ghost' && 'ghost', size === 'small' && 'small', className)}
      {...rest}
    />
  );
}

export function Rope({ className }: { className?: string }) {
  return <hr className={cx('rope', className)} aria-hidden />;
}
