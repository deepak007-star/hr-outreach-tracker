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
        // ── Secondary accent: teal — promotes the pre-existing (previously
        // inconsistent) #0d9488 focus-ring color into an intentional secondary
        // token. Reserved for links, secondary actions, and "connected"/
        // "auto-synced"/informational states — brand orange stays primary.
        signal: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
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
        // Modal entrance/exit — consumed by ui/Modal.jsx
        'modal-in': {
          '0%':   { opacity: '0', transform: 'scale(0.96) translateY(4px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)'     },
        },
        'modal-out': {
          '0%':   { opacity: '1', transform: 'scale(1) translateY(0)'     },
          '100%': { opacity: '0', transform: 'scale(0.97) translateY(2px)' },
        },
        'backdrop-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        // Retriggerable tab-switch fade — pair with key={activeTab} on the
        // content wrapper, unlike fade-slide-in which only ever plays once
        // (applied unconditionally to <main> on initial mount).
        'tab-fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'   },
        },
      },
      animation: {
        'signal-ping':   'signal-ping 1.8s cubic-bezier(0,0,.2,1) infinite',
        'fade-slide-in': 'fade-slide-in 150ms ease-out backwards',
        'skeleton-wave': 'skeleton-wave 1.6s linear infinite',
        'modal-in':      'modal-in 180ms ease-out backwards',
        'modal-out':     'modal-out 120ms ease-in forwards',
        'backdrop-in':   'backdrop-in 150ms ease-out backwards',
        'tab-fade-in':   'tab-fade-in 180ms ease-out backwards',
      },
    },
  },
  plugins: [],
};
