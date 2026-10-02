/** RUTF shield-and-leaf mark (landing and login pages), drawn after the landing-page mock-up. */
export function RutfMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 3 6 9v14c0 11 7.6 19.3 18 22 10.4-2.7 18-11 18-22V9L24 3Z" fill="#123b73" />
      <path d="M24 7.4 10 12.1V23c0 8.8 5.8 15.6 14 18 8.2-2.4 14-9.2 14-18V12.1L24 7.4Z" fill="#fff" />
      <path d="M24 35V22" stroke="#2e9b62" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M24 26c-6.5 0-9.5-4-9.5-9 5.5 0 9.5 3 9.5 9Z" fill="#2e9b62" />
      <path d="M24 26c6.5 0 9.5-4 9.5-9-5.5 0-9.5 3-9.5 9Z" fill="#3fb874" />
      <circle cx="24" cy="15" r="3.2" fill="#2e9b62" />
    </svg>
  );
}
