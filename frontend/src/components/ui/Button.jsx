/**
 * Shared Button — single source of truth for all interactive buttons.
 * Variants: primary | secondary | ghost | destructive
 * Sizes: sm | md | lg
 * Never add a one-off button style elsewhere — extend this instead.
 */
import { forwardRef } from 'react';

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 select-none';

const VARIANTS = {
  primary:     'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary:   'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 active:bg-gray-100 shadow-card',
  ghost:       'bg-transparent text-gray-600 hover:bg-gray-100 active:bg-gray-200',
  destructive: 'bg-white text-red-600 border border-red-200 hover:bg-red-50 hover:border-red-300 active:bg-red-100',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs rounded-sm',
  md: 'px-4 py-2   text-sm rounded-sm',
  lg: 'px-5 py-2.5 text-sm rounded-sm',
};

const Button = forwardRef(function Button(
  { variant = 'primary', size = 'md', className = '', children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export default Button;
