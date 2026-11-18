// A small original icon set: 24x24 stroke drawings keyed by name.

const O9 = 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z';

const PATHS = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  ticket: ['M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z', 'M14 6v2m0 3v2m0 3v2'],
  book: ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01M8 17h.01'],
  box: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5', 'M12 12v9'],
  'map-pin': ['M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z', 'M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  database: [
    'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3z',
    'M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6',
    'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  ],
  refresh: ['M20 11a8 8 0 0 0-14.3-4.3L4 8.5', 'M4 4v4.5h4.5', 'M4 13a8 8 0 0 0 14.3 4.3l1.7-1.8', 'M20 20v-4.5h-4.5'],
  building: ['M5 21V4h10v17', 'M15 9h4v12', 'M3 21h18', 'M8.5 8h3M8.5 12h3M8.5 16h3'],
  'file-text': ['M6 3h8l4 4v14H6z', 'M14 3v4h4', 'M9 12h6M9 16h6'],
  shield: ['M12 3l7 3v5c0 4.6-2.9 8.3-7 10-4.1-1.7-7-5.4-7-10V6z'],
  alert: ['M12 4l9 16H3z', 'M12 10v4.5', 'M12 17.5h.01'],
  bug: [
    'M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0z',
    'M9 5.5L7.5 3.5M15 5.5l1.5-2',
    'M8 12H4M20 12h-4M8 16l-3 2M16 16l3 2M8 8.5L5 7M16 8.5L19 7',
  ],
  clipboard: ['M8 5H6v16h12V5h-2', 'M9 3h6v4H9z', 'M9 12h6M9 16h4'],
  graduation: ['M2 9l10-5 10 5-10 5z', 'M6 11.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.5', 'M22 9v5'],
  clock: [O9, 'M12 7v5l3.5 2'],
  scale: ['M12 4v16', 'M7 20h10', 'M5 7h14', 'M5 7l-3 7a3 3 0 0 0 6 0z', 'M19 7l-3 7a3 3 0 0 0 6 0z'],
  target: [O9, 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z'],
  'check-square': ['M4 4h16v16H4z', 'M8 12.5l3 3 5-6.5'],
  folder: ['M3 6h6l2 2.5h10V19H3z'],
  chart: ['M4 20V4', 'M4 20h16', 'M8 16v-4M12 16V8M16 16v-6'],
  settings: [
    'M4 7h9M17 7h3M4 17h3M11 17h9',
    'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
    'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  ],
  users: [
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6',
    'M16 4.5a3.5 3.5 0 0 1 0 6.5',
    'M18 14.5c2.1.9 3.5 3 3.5 5.5',
  ],
  user: ['M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M4.5 21c0-3.9 3.4-7 7.5-7s7.5 3.1 7.5 7'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M16 16l4.5 4.5'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  x: ['M6 6l12 12M18 6L6 18'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  'chevron-down': ['M6 9l6 6 6-6'],
  'chevron-up': ['M6 15l6-6 6 6'],
  'chevron-left': ['M15 6l-6 6 6 6'],
  'chevron-right': ['M9 6l6 6-6 6'],
  'chevrons-left': ['M11 6l-6 6 6 6M18 6l-6 6 6 6'],
  'chevrons-right': ['M6 6l6 6-6 6M13 6l6 6-6 6'],
  'arrow-up': ['M12 19V5M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14M6 13l6 6 6-6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v6H4V6h6'],
  download: ['M12 4v11', 'M7 11l5 5 5-5', 'M4 20h16'],
  upload: ['M12 16V5', 'M7 9l5-5 5 5', 'M4 20h16'],
  filter: ['M3 5h18l-7 8.5V20l-4-2v-4.5z'],
  sun: [
    'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    'M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8',
  ],
  moon: ['M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z'],
  menu: ['M4 6h16M4 12h16M4 18h16'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v5M14 11v5'],
  link: [
    'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1',
    'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  ],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  info: [O9, 'M12 11v5.5', 'M12 7.5h.01'],
  calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4M16 3v4'],
  message: ['M4 5h16v11H10l-4 4v-4H4z'],
  history: ['M4 12a8 8 0 1 0 2.6-5.9L4 8.5', 'M4 4v4.5h4.5', 'M12 8v4.5l3 1.5'],
  eye: ['M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z', 'M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  star: ['M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'],
  logout: ['M10 4H5v16h5', 'M15 8l4 4-4 4', 'M19 12H9'],
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Accessible name. Omit for decorative icons (the default), which are hidden from assistive technology. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 18, label, className }: IconProps) {
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'more' ? 2.6 : 1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {(PATHS[name] ?? PATHS.info).map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
