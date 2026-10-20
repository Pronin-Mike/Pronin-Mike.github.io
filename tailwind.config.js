/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Sage & Graphite. Старые имена сохранены как совместимые алиасы,
        // чтобы дизайн менялся без переписывания работающих экранов целиком.
        cream: {
          50: '#ffffff',
          100: '#f7f8f6',
          200: '#eef1ed',
          300: '#e1e6e1',
          400: '#cbd3cc'
        },
        // основной шалфейный акцент
        terra: {
          50: '#f1f6f1',
          100: '#dde9de',
          200: '#c2d7c5',
          300: '#9fbea5',
          400: '#75977e',
          500: '#53745d',
          600: '#45634f',
          700: '#385140'
        },
        olive: {
          50: '#e8f2ea',
          100: '#d6e9da',
          200: '#b8d8c0',
          300: '#91c09f',
          400: '#62a277',
          500: '#34704d',
          600: '#2d6042',
          700: '#285239'
        },
        honey: {
          50: '#fff2db',
          100: '#ffe6b8',
          200: '#f7d18a',
          300: '#e8b557',
          400: '#c98b20',
          500: '#aa7212',
          700: '#98630c',
          800: '#744b08'
        },
        berry: {
          50: '#fce9e9',
          200: '#f1bcbc',
          500: '#ae4242',
          700: '#873333'
        },
        ink: {
          DEFAULT: '#252b28',
          soft: '#4f5a54',
          muted: '#68736c'
        }
      },
      fontFamily: {
        sans: [
          'Manrope Variable',
          'Manrope',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        display: ['Manrope Variable', 'Manrope', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        soft: '0 1px 2px rgba(37, 43, 40, 0.05), 0 12px 26px -20px rgba(37, 43, 40, 0.28)',
        lift: '0 8px 22px -10px rgba(37, 43, 40, 0.24)',
        sheet: '0 -18px 60px -24px rgba(37, 43, 40, 0.38)'
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' }
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' }
        },
        'sheet-in': {
          from: { opacity: '0.6', transform: 'translateY(18px)' },
          to: { opacity: '1', transform: 'none' }
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' }
        }
      },
      animation: {
        'fade-in': 'fade-in 180ms ease both',
        'rise-in': 'rise-in 220ms ease both',
        'sheet-in': 'sheet-in 240ms cubic-bezier(0.2, 0.7, 0.3, 1) both',
        'toast-in': 'toast-in 200ms ease both'
      }
    }
  },
  plugins: []
};
