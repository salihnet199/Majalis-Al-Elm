import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.resolve(__dirname, './index.html'),
    path.resolve(__dirname, './src/**/*.{js,ts,jsx,tsx}'),
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mocha: {
          950: '#1a120d',
          900: '#231812',
          800: '#2d1f18',
          700: '#36251d',
          600: '#422f25',
          500: '#543b2f',
          400: '#755443',
        },
        gold: {
          300: '#f5e6be',
          400: '#e5c158',
          500: '#d4af37',
          600: '#b89326',
          700: '#917119',
        },
        cream: {
          50: '#fdfbf7',
          100: '#f7f2ea',
          200: '#ebe2d3',
          300: '#c5b8a5',
          400: '#968978',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
        cairo: ['Cairo', 'system-ui', 'sans-serif'],
        ruqaa: ['"Aref Ruqaa"', 'serif'],
        amiri: ['Amiri', 'serif'],
        arabic: ['Amiri', 'serif'],
      },
    },
  },
  plugins: [],
};
