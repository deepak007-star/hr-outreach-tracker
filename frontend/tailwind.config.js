/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // ── Brand token: deep teal (The Signal identity) ────────────────────────
      colors: {
        brand: {
          50:  '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',  // primary CTA · active nav · focus rings
          700: '#0f766e',  // hover state
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
        card:  '0 1px 2px rgba(0,0,0,.05), 0 0 0 1px rgba(15,118,110,.08)',
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
        'fade-slide-in': 'fade-slide-in 150ms ease-out both',
        'skeleton-wave': 'skeleton-wave 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};
