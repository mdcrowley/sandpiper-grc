// Icons by name. Drawn by the open-source Tabler icon set; each icon is imported on its own so
// only the ones listed here reach the bundle. To add a name, import the icon and add a line.
import type { ComponentType } from 'react';
import {
  IconAlertCircle, IconAlertTriangle, IconArrowDown, IconArrowRight, IconArrowUp, IconBell, IconBook, IconBox, IconBug,
  IconBuilding, IconCalendar, IconChartBar, IconCheck, IconChevronDown, IconChevronLeft, IconChevronRight,
  IconChevronUp, IconChevronsLeft, IconChevronsRight, IconCircleCheck, IconClipboardText, IconClock,
  IconCornerDownLeft, IconDatabase, IconDots, IconDownload, IconExternalLink, IconEye, IconEyeOff, IconFileText,
  IconFilter, IconFlask, IconFolder, IconHelpCircle, IconHistory, IconHome, IconInfoCircle, IconKey,
  IconLayoutSidebarLeftCollapse, IconLayoutSidebarLeftExpand, IconLink, IconLock, IconLogout, IconMapPin,
  IconMenu2, IconMessage, IconMinus, IconMoon, IconPencil, IconPlus, IconRefresh, IconScale, IconSchool,
  IconSearch, IconServer, IconSettings, IconShield, IconSquareCheck, IconStar, IconSun, IconTarget, IconTicket,
  IconTrash, IconUpload, IconUser, IconUsers, IconX,
} from '@tabler/icons-react';

type Glyph = ComponentType<{ size?: number | string; stroke?: number | string; className?: string }>;

const ICONS = {
  home: IconHome,
  ticket: IconTicket,
  book: IconBook,
  server: IconServer,
  box: IconBox,
  'map-pin': IconMapPin,
  database: IconDatabase,
  refresh: IconRefresh,
  building: IconBuilding,
  'file-text': IconFileText,
  shield: IconShield,
  alert: IconAlertTriangle,
  bug: IconBug,
  clipboard: IconClipboardText,
  graduation: IconSchool,
  clock: IconClock,
  scale: IconScale,
  target: IconTarget,
  'check-square': IconSquareCheck,
  folder: IconFolder,
  chart: IconChartBar,
  settings: IconSettings,
  users: IconUsers,
  user: IconUser,
  search: IconSearch,
  plus: IconPlus,
  minus: IconMinus,
  x: IconX,
  check: IconCheck,
  'chevron-down': IconChevronDown,
  'chevron-up': IconChevronUp,
  'chevron-left': IconChevronLeft,
  'chevron-right': IconChevronRight,
  'chevrons-left': IconChevronsLeft,
  'chevrons-right': IconChevronsRight,
  'arrow-up': IconArrowUp,
  'arrow-down': IconArrowDown,
  external: IconExternalLink,
  download: IconDownload,
  upload: IconUpload,
  filter: IconFilter,
  sun: IconSun,
  moon: IconMoon,
  menu: IconMenu2,
  more: IconDots,
  edit: IconPencil,
  trash: IconTrash,
  link: IconLink,
  lock: IconLock,
  info: IconInfoCircle,
  calendar: IconCalendar,
  message: IconMessage,
  history: IconHistory,
  eye: IconEye,
  star: IconStar,
  logout: IconLogout,
  // Added with the Mantine rebuild
  help: IconHelpCircle,
  'eye-off': IconEyeOff,
  'arrow-right': IconArrowRight,
  'check-circle': IconCircleCheck,
  'alert-circle': IconAlertCircle,
  key: IconKey,
  flask: IconFlask,
  bell: IconBell,
  enter: IconCornerDownLeft,
  'sidebar-collapse': IconLayoutSidebarLeftCollapse,
  'sidebar-expand': IconLayoutSidebarLeftExpand,
} as const satisfies Record<string, Glyph>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconProps {
  name: IconName;
  size?: number;
  /** Accessible name. Omit for decorative icons (the default), which are hidden from assistive technology. */
  label?: string;
  className?: string;
}

export function Icon({ name, size = 18, label, className }: IconProps) {
  const Glyph: ComponentType<Record<string, unknown>> = ICONS[name] ?? ICONS.info;
  return (
    <Glyph
      className={className ? `icon ${className}` : 'icon'}
      size={size}
      stroke={1.75}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    />
  );
}
