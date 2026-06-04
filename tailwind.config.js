/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./App.tsx'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      fontFamily: {
        body: ['ClashGrotesk'],
        bodyRegular: ['ClashGroteskRegular'],
        display: ['ClashDisplay'],
      },
      fontSize: {
        'landing-heading': ['24px', { lineHeight: '28px' }],
        'landing-body': ['16px', { lineHeight: '20px' }],
        'landing-cta': ['18px', { lineHeight: '22px' }],
      },
    },
  },
  plugins: [],
};
