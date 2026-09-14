import { useId } from "react";

/**
 * What the Custom swatch shows until a colour of your own is picked: a
 * gradient square with a sparkle. Once one is picked, the sparkle sits on
 * that colour instead, so the swatch still reads as the custom one.
 */
export function CustomColorIcon({ color }: { color?: string | null }) {
  const id = useId();
  const tone = `${id}-tone`;
  const blue = `${id}-blue`;
  return (
    <svg viewBox="0 0 40 40" width="100%" height="100%" aria-hidden="true" style={{ display: "block", borderRadius: "inherit", pointerEvents: "none" }} data-testid="custom-color-icon">
      {color ? (
        <rect width="40" height="40" fill={color} />
      ) : (
        <>
          <defs>
            <linearGradient id={tone} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#ec4bb4" />
              <stop offset="0.55" stopColor="#c05ce6" />
              <stop offset="0.8" stopColor="#3fd8b6" />
              <stop offset="1" stopColor="#2fc6a4" />
            </linearGradient>
            <linearGradient id={blue} x1="0" y1="0" x2="1" y2="0.35">
              <stop offset="0.35" stopColor="#3b82f6" stopOpacity="0" />
              <stop offset="1" stopColor="#3a7bea" stopOpacity="0.95" />
            </linearGradient>
          </defs>
          <rect width="40" height="40" fill={`url(#${tone})`} />
          <rect y="16" width="40" height="24" fill={`url(#${blue})`} />
        </>
      )}
      <path d="M20 7.5C20.9 15.6 24.4 19.1 32.5 20C24.4 20.9 20.9 24.4 20 32.5C19.1 24.4 15.6 20.9 7.5 20C15.6 19.1 19.1 15.6 20 7.5Z" fill="#fff" stroke={color ? "rgba(0,0,0,0.25)" : "none"} strokeWidth="0.8" />
    </svg>
  );
}
