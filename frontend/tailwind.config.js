/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Additive keys only — do NOT touch the default `sans` key, it would
        // silently re-theme the whole app. `font-display`/`font-landing` are
        // opt-in utilities used only by the new landing page + Job Analyzer/
        // Bulk Apply redesign (see CLAUDE.md-adjacent redesign scope notes).
        display: ['"Playfair Display"', 'ui-serif', 'serif'],
        landing: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
