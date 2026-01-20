/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e3f9ed',
          100: '#c7f3db',
          200: '#8fe7b7',
          300: '#57db93',
          400: '#1fcf6f',
          500: '#075e55',
          600: '#064e47',
          700: '#053e39',
          800: '#042e2b',
          900: '#021f1d',
        }
      }
    },
  },
  plugins: [],
}
