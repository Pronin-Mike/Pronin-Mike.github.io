/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // тёплый бежевый фон
        cream: {
          50: '#fdfbf8',
          100: '#faf7f2',
          200: '#f4ede3',
          300: '#e9ddcc',
          400: '#dbc9b2'
        },
        // терракота — основной акцент
        terra: {
          50: '#fdf2ec',
          100: '#f9dfd2',
          200: '#f2c3ad',
          300: '#e6a181',
          400: '#d4795a',
          500: '#c4623f',
          600: '#a94f31',
          700: '#8a3f27'
        },
        // олива — «можно готовить»
        olive: {
          50: '#f3f6ec',
          100: '#e5edd9',
          200: '#cbdbb5',
          300: '#a9c489',
          400: '#87a865',
          500: '#6b8f4e',
          600: '#557340',
          700: '#435b33'
        },
        // мёд — предупреждения
        honey: {
          50: '#fdf6e6',
          100: '#f9e9c4',
          200: '#f4d894',
          300: '#edc465',
          400: '#d9a53a',
          500: '#b5801f',
          700: '#7c5a11',
          800: '#5f440c'
        },
        berry: {
          50: '#fbebef',
          200: '#f3c3cd',
          500: '#c2445f',
          700: '#8e2f44'
        },
        ink: {
          DEFAULT: '#3b322c',
          soft: '#6a5d54',
          muted: '#9a8c81'
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ],
        display: ['Georgia', 'Iowan Old Style', 'Times New Roman', 'serif']
      },
      boxShadow: {
        soft: '0 1px 2px rgba(80, 60, 45, 0.05), 0 12px 26px -20px rgba(80, 60, 45, 0.40)',
        lift: '0 6px 18px -6px rgba(80, 60, 45, 0.22)',
        sheet: '0 -18px 60px -24px rgba(60, 44, 32, 0.45)'
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
