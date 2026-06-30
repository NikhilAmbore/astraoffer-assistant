/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './overlay.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: '#0A2540',
          cyan: '#00D4FF',
        },
      },
    },
  },
  plugins: [],
}
