// The Sandpiper mark: a small wading bird at the water's edge. An original drawing; the same
// shapes are in web/public/favicon.svg. Change both to re-brand.

export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" fill="var(--logo-bg, #17656f)" />
      <path
        d="M5.200 16.800C7.800 12.400 12.300 10.900 16.400 11.500c3.500.5 5.600 2.600 5.200 5.300-.5 3-3.500 4.500-7 4.500-3.800 0-7.200-1.500-9.400-4.500z"
        fill="#ffffff"
      />
      <circle cx="21.300" cy="10.500" r="3" fill="#ffffff" />
      <path d="M23.800 10.900l5.300 1.500" stroke="var(--logo-accent, #f0c078)" strokeWidth="1.600" strokeLinecap="round" fill="none" />
      <path d="M12.800 20.800v4M16.600 20.800v4" stroke="var(--logo-accent, #f0c078)" strokeWidth="1.500" strokeLinecap="round" fill="none" />
      <path
        d="M6 27c1.700-1.100 3.300-1.100 5 0s3.300 1.100 5 0 3.300-1.100 5 0 3.300 1.100 5 0"
        stroke="#ffffff" strokeOpacity="0.55" strokeWidth="1.300" strokeLinecap="round" fill="none"
      />
      <circle cx="22" cy="10" r="0.750" fill="var(--logo-bg, #17656f)" />
    </svg>
  );
}

/** Logo plus the application name, split so the first word carries the weight. */
export function Wordmark({ name, size = 28 }: { name: string; size?: number }) {
  const [first, ...rest] = name.split(' ');
  return (
    <span className="wordmark">
      <Logo size={size} />
      <span className="wordmark-text">
        <span className="wordmark-first">{first}</span>
        {rest.length > 0 && <span className="wordmark-rest"> {rest.join(' ')}</span>}
      </span>
    </span>
  );
}
