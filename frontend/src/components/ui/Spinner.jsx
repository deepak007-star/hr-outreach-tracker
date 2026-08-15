/**
 * Shared loading spinner — promoted from the markup App.jsx's auth-loading
 * screen already used (`w-8 h-8 border-2 border-brand-500 border-t-transparent
 * rounded-full animate-spin`), duplicated nowhere else until now. Use this
 * instead of a literal '…'/'Loading...' text for any in-progress button or
 * inline loading state.
 *
 * Sizes: sm (16px, inline in a button) | md (32px, default) | lg (48px, full-page)
 */
const SIZES = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-2',
  lg: 'w-12 h-12 border-[3px]',
};

// `color` sets the border color (default brand orange); pass 'white' for use
// on a solid dark/colored button background (e.g. Button's primary variant).
// Kept as a literal class-name map (not a template-string interpolation) so
// Tailwind's JIT can actually see and generate these classes at build time.
const COLORS = {
  brand: 'border-brand-500',
  white: 'border-white',
};

export default function Spinner({ size = 'md', color = 'brand', className = '' }) {
  return (
    <div
      className={`${SIZES[size] ?? SIZES.md} ${COLORS[color] ?? COLORS.brand} border-t-transparent rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
