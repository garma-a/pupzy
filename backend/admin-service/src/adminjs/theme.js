/**
 * Approved Pupzy visual identity theme tokens for AdminJS.
 *
 * Grounded in the historical Flutter-era design system:
 * - Warm cream background (#FAF6F1)
 * - Pupzy orange primary (#C4622D)
 * - Dark-brown text (#2D1506)
 * - Red critical / danger states (#D94040)
 * - Green success states (#2D8B6F)
 * - Warm secondary accents (#8B6355) and muted tones (#B8A499)
 * - Rounded cards and containers (16px border-radius)
 * - DM Sans and Cairo body typography with Playfair Display headings
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
  font: "'DM Sans', 'Cairo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  borders: {
    input: '1px solid #E8DED5',
    filterInput: '1px solid #E8DED5',
    bg: '1px solid #E8DED5',
    default: '1px solid #E8DED5',
  },
  shadows: {
    login: '0 8px 30px rgba(45, 21, 6, 0.08)',
    cardHover: '0 4px 16px rgba(45, 21, 6, 0.08)',
    drawer: '-2px 0 12px rgba(45, 21, 6, 0.08)',
    card: '0 2px 8px rgba(45, 21, 6, 0.04)',
    inputFocus: '0 0 0 2px rgba(196, 98, 45, 0.25)',
    buttonFocus: '0 0 0 2px rgba(196, 98, 45, 0.3)',
  },
});
