/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // ── Brand token: saffron-amber (Indian market — restrained warm tone) ─────
      colors: {
        brand: {
          50:  '#fff8f1',
          100: '#feecdc',
          200: '#fcd9bd',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#c2410c',  // primary CTA · active nav · focus rings (burnt orange)
          700: '#9a3412',  // hover state
          800: '#7c2d12',
          900: '#6c2410',
          950: '#431407',
        },
      },
      // ── Radius scale: sm=6px / md=10px / lg=16px ────────────────────────────
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '16px',
      },
      // ── Shadow: two elevations only ─────────────────────────────────────────
      boxShadow: {
        card:  '0 1px 2px rgba(0,0,0,.05), 0 0 0 1px rgba(194,65,12,.07)',
        modal: '0 8px 32px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.06)',
      },
      // ── Typography ──────────────────────────────────────────────────────────
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', 'ui-serif', 'serif'],
      },
      // ── Motion ──────────────────────────────────────────────────────────────
      keyframes: {
        // Signature Signal motif — radiating rings
        'signal-ping': {
          '0%':        { transform: 'scale(1)',   opacity: '0.5' },
          '75%, 100%': { transform: 'scale(2.2)', opacity: '0'   },
        },
        'fade-slide-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'   },
        },
        'skeleton-wave': {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
      },
      animation: {
        'signal-ping':   'signal-ping 1.8s cubic-bezier(0,0,.2,1) infinite',
        'fade-slide-in': 'fade-slide-in 150ms ease-out backwards',
        'skeleton-wave': 'skeleton-wave 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
