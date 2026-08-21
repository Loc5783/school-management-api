const paths = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  attendance: <><path d="M8 3v3M16 3v3M4 9h16" /><rect x="4" y="5" width="16" height="16" rx="2" /><path d="m8 15 2 2 5-5" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" /><circle cx="12" cy="14" r="3.5" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="12" r="2" /><path d="M13 10h4M13 14h4M6 17h12" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <path d="M12 3 20 6v5c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-3Z" />,
  students: <><circle cx="12" cy="8" r="3.5" /><path d="M5 21a7 7 0 0 1 14 0M4 4v5M20 4v5" /></>,
  classes: <><path d="M3 20h18M5 20V9l7-5 7 5v11M9 20v-5h6v5" /></>,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.4 2.4-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56v.1h-3.4v-.1A1.7 1.7 0 0 0 10 18.94a1.7 1.7 0 0 0-1.88.34l-.06.06-2.4-2.4.06-.06A1.7 1.7 0 0 0 6.06 15 1.7 1.7 0 0 0 4.5 14H4.4v-3.4h.1A1.7 1.7 0 0 0 6.06 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.4-2.4.06.06A1.7 1.7 0 0 0 10 5.06a1.7 1.7 0 0 0 1.04-1.56v-.1h3.4v.1A1.7 1.7 0 0 0 15.48 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.4 2.4-.06.06A1.7 1.7 0 0 0 19.42 9 1.7 1.7 0 0 0 21 10.56h.1V14H21a1.7 1.7 0 0 0-1.6 1Z" /></>,
  bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  arrowLeft: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
  logout: <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M17 11a3 3 0 1 0 0-6M17 14a5 5 0 0 1 4 4.8" /></>,
  money: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M7 15h.01M17 9h.01M12 9v6M10 11.2c.4-.8 1.1-1.2 2-1.2 1.1 0 2 .6 2 1.5 0 2.2-4 1-4 3.2 0 .9.9 1.5 2 1.5.9 0 1.6-.4 2-1.1" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
};

export default function Icon({ name, size = 20, stroke = 1.8, className = '' }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name] || paths.grid}
    </svg>
  );
}
