/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Bases — switched by the theme provider, never hard-coded per component.
        ink: {
          DEFAULT: '#12131A', // deep charcoal-navy dark base (not pure black)
          raised: '#191B24',
          card: '#1E2130',
          line: '#2A2E3D',
        },
        paper: {
          DEFAULT: '#F5F3EF', // warm off-white light base
          raised: '#FFFFFF',
          card: '#FFFFFF',
          line: '#E3DFD7',
        },
        // The vibe spectrum — the product's data-encoding scale.
        vibe: {
          teal: '#4ECDC4',
          amber: '#FFD166',
          red: '#FF5A5F',
        },
        mute: '#6B6F76',
      },
      fontFamily: {
        display: ['SpaceGrotesk', 'Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Display type carries the emotional weight: vibe scores + venue names.
        vibe: ['44px', { lineHeight: '44px', letterSpacing: '-1.6px', fontWeight: '700' }],
        venue: ['17px', { lineHeight: '21px', letterSpacing: '-0.3px', fontWeight: '600' }],
        meta: ['12px', { lineHeight: '15px', letterSpacing: '0.1px' }],
      },
      borderRadius: {
        row: '18px',
      },
    },
  },
  plugins: [],
};
