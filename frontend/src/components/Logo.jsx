// Brand mark — a paper plane (outreach/send) on an emerald badge, matching
// the palette used across the landing page and Job Analyzer/Bulk Apply.
export default function Logo({ size = 32, rounded = 'rounded-xl' }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 100 100"
      className={`${rounded} shrink-0`}
      role="img" aria-label="HR Outreach Tracker"
    >
      <defs>
        <linearGradient id="hrot-logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="22" fill="url(#hrot-logo-bg)" />
      <polygon points="91.7,8.3 62.5,91.7 45.8,54.2 8.3,37.5" fill="#ffffff" />
      <polygon points="91.7,8.3 62.5,91.7 45.8,54.2" fill="#000000" opacity="0.12" />
    </svg>
  );
}
