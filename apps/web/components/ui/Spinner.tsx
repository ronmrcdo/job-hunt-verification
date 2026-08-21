// Inline loading spinner. Uses currentColor so it inherits the surrounding
// text colour, and a fast 0.6s spin (a quicker spinner reads as "loading
// faster"). The `spin` keyframe lives in globals.css. `size` is the rendered
// px box (default 14 for buttons); the 16-unit viewBox scales to fit.
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={["animate-[spin_0.6s_linear_infinite]", className].filter(Boolean).join(" ")}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
