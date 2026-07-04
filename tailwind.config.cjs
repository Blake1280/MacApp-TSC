/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Jost', '-apple-system', 'sans-serif'],
        serif: ['"Cormorant Garamond"', '"Playfair Display"', 'Georgia', 'serif'],
        script: ['"Dancing Script"', 'cursive'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: 'hsl(var(--muted))',
        'muted-foreground': 'hsl(var(--muted-foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Brand palette — mirrors website's rose / blush / cream / ink scale
        // for direct use (e.g. bg-rose-600). Names match the source CSS.
        rose: {
          900: '#6E2F3A',
          700: '#8E4856',
          600: '#A95C6B',
          500: '#BF7382',
          400: '#D08F9C',
          // Pale washes — hex mirrors of the --rose-50/100/200/300 HSL vars
          // in styles.css, so pages can use bg-rose-50 / border-rose-200
          // instead of inline style={{ … 'hsl(var(--rose-200))' }} hacks.
          300: '#F2BFC7',
          200: '#E8CAD0',
          100: '#F5E0E4',
          50: '#FCF5F7',
        },
        blush: {
          500: '#E08A95',
          400: '#EBA0A9',
          300: '#F2BFC7',
          200: '#F8D7DC',
          100: '#FCEBEE',
        },
        cream: {
          DEFAULT: '#FBF4EF',
          2: '#F4E9DF',
        },
        sand: {
          100: '#F1E7DC',
          200: '#E5D6C5',
          300: '#C8B6A2',
        },
        taupe: {
          500: '#8C7B6B',
          700: '#5A4F44',
        },
        ink: {
          900: '#1F1A17',
          700: '#3C342E',
          500: '#6B5F55',
          300: '#A89A8E',
        },
        success: {
          DEFAULT: '#6E8E5E',
          deep: '#44603C',
        },
        warning: {
          DEFAULT: '#D4923B',
          deep: '#7E5525',
        },
        error: '#B5403F',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
      },
      boxShadow: {
        card: '0 8px 30px rgba(140, 123, 107, 0.10)',
        'card-hover': '0 12px 30px rgba(110, 47, 58, 0.12), 0 4px 10px rgba(110, 47, 58, 0.06)',
      },
    },
  },
  plugins: [],
};
