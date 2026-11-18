export function VideoIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="10"
        y="12"
        width="44"
        height="40"
        rx="8"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M10 23h44M10 41h44M22 12v11m20-11v11M22 41v11m20-11v11"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path d="m28 27 9 5-9 5V27Z" fill="currentColor" />
    </svg>
  );
}
