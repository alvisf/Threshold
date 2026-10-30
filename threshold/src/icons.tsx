/** Line icons, 24 x 24, drawn with the text colour. No emoji anywhere in the app. */
const PATHS = {
  bucket: 'M5 7h14l-1.6 12.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5 7zm0 0c0-1.7 3.1-3 7-3s7 1.3 7 3M7.5 13h9',
  chart: 'M4 20V11m6 9V5m6 15v-6m4 6H2',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm7.4 3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  check: 'M9 3.5h6v3H9zM8 5H5.5v15.5h13V5H16M8.5 13.5l2.5 2.5 4.5-5',
  food: 'M12 7.5c-1.4-1.2-3.4-1.5-5-.6C4.9 8.2 4.3 11.3 5.4 14.6 6.5 17.9 8.6 21 10.6 21c.6 0 .9-.3 1.4-.3s.8.3 1.4.3c2 0 4.1-3.1 5.2-6.4 1.1-3.3.5-6.4-1.6-7.7-1.6-.9-3.6-.6-5 .6zm0 0c0-2.2 1-3.8 3.2-4.5',
  bolt: 'M13.5 2.5 5 13.5h6.5l-1 8 8.5-11h-6.5l1-8z',
  stop: 'M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
  head: 'M8 21v-4.3A7 7 0 1 1 18.6 10l1.6 3.4-1.7.6v2.3a1.7 1.7 0 0 1-1.7 1.7H15V21',
  close: 'M6 6l12 12M18 6 6 18',
  sleep: 'M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z',
  wake: 'M12 20.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM12 9v4l2.5 1.5M5 3.5 2.5 6M19 3.5 21.5 6',
  pressure: 'M4 17a8 8 0 1 1 16 0M12 17l4-5',
  meal: 'M5 3v4.5a2 2 0 0 0 4 0V3M7 3v18M17 21V3c-2 0-3.5 2.2-3.5 5.5 0 2.4 1.2 3.8 3.5 3.8',
  water: 'M12 3.5c3.3 4.2 5.8 7.4 5.8 10.3a5.8 5.8 0 0 1-11.6 0c0-2.9 2.5-6.1 5.8-10.3z',
  caffeine: 'M4.5 9.5h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5V9.5zM15.5 10.5h1.5a2.5 2.5 0 0 1 0 5h-1.5M8 3.5v3M12 3.5v3',
  wave: 'M2.5 12c2.4 0 2.4-4 4.8-4s2.4 8 4.7 8 2.4-8 4.7-8 2.4 4 4.8 4',
  cycle: 'M4.5 5.5h15v14h-15zM4.5 9.5h15M8.5 3v4M15.5 3v4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}
