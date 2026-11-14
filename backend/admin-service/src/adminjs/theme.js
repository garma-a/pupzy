/**
 * Pupzy moderation desk: original brand palette, clearer hierarchy, bilingual typography.
 * Presentation only; status meanings and moderation behavior stay unchanged.
 */

export const PUPZY_COLORS = Object.freeze({
  // Brand primary orange shades
  primary100: '#C4622D',
  primary80: '#D4784A',
  primary60: '#E09571',
  primary40: '#ECB398',
  primary20: '#F7D1C0',

  // Accent & Dark-brown text
  accent: '#8B6355',
  text: '#2D1506',
  grey100: '#2D1506',
  grey80: '#8B6355',
  grey60: '#8B6355',
  grey40: '#B8A499',
  grey20: '#FAF6F1',

  // Common
  white: '#FFFFFF',
  black: '#1A0C03',

  // Alerts & statuses
  errorDark: '#9D0616',
  error: '#D94040',
  errorLight: '#F9E5E7',

  successDark: '#246F59',
  success: '#2D8B6F',
  successLight: '#E7F3EF',

  warningDark: '#A14F17',
  warning: '#C4622D',
  warningLight: '#F6EDE8',

  infoDark: '#A84E1F',
  info: '#C4622D',
  infoLight: '#F7D1C0',

  // Backgrounds & structural elements
  bg: '#FAF6F1',
  filterBg: '#FAF6F1',
  container: '#FFFFFF',
  sidebar: '#FFFFFF',

  // Borders, separators, and highlights
  inputBorder: '#E8DED5',
  separator: '#E8DED5',
  border: '#E8DED5',
  highlight: '#F5EDE3',
  love: '#C4622D',
});

export const pupzyTheme = Object.freeze({
  colors: PUPZY_COLORS,
  font: "'Onest', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontSizes: {
    xs: '12px',
    sm: '13px',
    default: '14px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    h4: '16px',
    h3: '20px',
    h2: '28px',
    h1: '28px',
  },
  borders: {
    input: '1px solid #E8DED5',
    filterInput: '1px solid #E8DED5',
    bg: '1px solid #E8DED5',
    default: '1px solid #E8DED5',
  },
  shadows: {
    login: '0 24px 80px rgba(45, 21, 6, 0.12)',
    cardHover: '0 6px 20px rgba(45, 21, 6, 0.06)',
    drawer: '-8px 0 40px rgba(45, 21, 6, 0.12)',
    card: '0 2px 4px rgba(45, 21, 6, 0.02)',
    inputFocus: '0 0 0 3px rgba(196, 98, 45, 0.14)',
    buttonFocus: '0 0 0 3px rgba(196, 98, 45, 0.2)',
  },
});
