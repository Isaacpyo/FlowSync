import clsx from 'clsx';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={clsx('shrink-0', className)}>
      <defs>
        <linearGradient id="fs-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#fs-logo)" />
      <path
        d="M8 11.5c3-3 6 3 9 0s6 3 7 1M8 17c3-3 6 3 9 0s6 3 7 1M8 22.5c3-3 6 3 9 0s6 3 7 1"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={clsx('inline-flex items-center gap-2 font-semibold tracking-tight', className)}
    >
      <LogoMark className="size-7" />
      <span>FlowSync</span>
    </span>
  );
}
