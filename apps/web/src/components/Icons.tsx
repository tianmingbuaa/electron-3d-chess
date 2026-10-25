import type { CSSProperties } from 'react';

export type IconName =
  | 'undo'
  | 'restart'
  | 'flag'
  | 'volume'
  | 'mute'
  | 'flip'
  | 'panel'
  | 'close'
  | 'chevron'
  | 'cpu'
  | 'spark'
  | 'check'
  | 'arrow'
  | 'shield'
  | 'menu'
  | 'keyboard'
  | 'info';

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

const paths: Record<IconName, React.ReactNode> = {
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9.5A5.5 5.5 0 0 1 19 14.5v0a5.5 5.5 0 0 1-5.5 5.5H10" />
    </>
  ),
  restart: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.4-5.9L3 9" />
      <path d="M3 3.5V9h5.5" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 5c3.2-2 6.4 1.6 9.6 0 1.5-.8 3-.9 4.4-.4v8.8c-1.4-.5-2.9-.4-4.4.4-3.2 1.6-6.4-2-9.6 0" />
    </>
  ),
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15 9a4 4 0 0 1 0 6" />
      <path d="M17.6 6.6a8 8 0 0 1 0 10.8" />
    </>
  ),
  mute: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 10 4 4" />
      <path d="m20 10-4 4" />
    </>
  ),
  flip: (
    <>
      <path d="M4 7h13" />
      <path d="m14 4 3 3-3 3" />
      <path d="M20 17H7" />
      <path d="m10 14-3 3 3 3" />
    </>
  ),
  panel: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M14 4v16" />
      <path d="M7 9h4M7 13h4M7 17h3" />
    </>
  ),
  close: (
    <>
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </>
  ),
  chevron: <path d="m7 10 5 5 5-5" />,
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      <path d="M10 10h4v4h-4z" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <path d="m5.6 5.6 2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.2" />
    </>
  ),
  check: <path d="m5 12 4.5 4.5L19 7" />,
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.7-3.8" />
    </>
  ),
  menu: (
    <>
      <path d="M4 8h16M4 16h16" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M7 10h.01M11 10h.01M15 10h.01M18 10h.01M7 14h.01M18 14h.01M10 14h5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
};

export function Icon({ name, size = 18, className, strokeWidth = 1.6, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
