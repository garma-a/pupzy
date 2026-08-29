import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { pupzyTheme, PUPZY_COLORS } from './theme.js';
import { ADMIN_RESOURCE_TABLES } from './index.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const themeCssPath = path.join(currentDir, 'public', 'pupzy-theme.css');

describe('Task 12: Finish Responsive Pupzy States & Browser Polish', () => {
  const cssContent = fs.readFileSync(themeCssPath, 'utf-8');

  describe('Design Language & Theme Tokens Coherence', () => {
    it('defines the approved Pupzy color palette tokens', () => {
      assert.equal(PUPZY_COLORS.primary100, '#C4622D');
      assert.equal(PUPZY_COLORS.bg, '#FAF6F1');
      assert.equal(PUPZY_COLORS.text, '#2D1506');
      assert.equal(PUPZY_COLORS.error, '#D94040');
      assert.equal(PUPZY_COLORS.success, '#2D8B6F');
      assert.equal(PUPZY_COLORS.accent, '#8B6355');
      assert.equal(PUPZY_COLORS.border, '#E8DED5');
      assert.equal(PUPZY_COLORS.container, '#FFFFFF');
    });

    it('declares theme shadows for login, cards, drawer, and modals', () => {
      assert.ok(pupzyTheme.shadows.login);
      assert.ok(pupzyTheme.shadows.card);
      assert.ok(pupzyTheme.shadows.drawer);
      assert.match(cssContent, /--pupzy-shadow-modal/);
      assert.match(cssContent, /--pupzy-shadow-login/);
    });

    it('styles login page container, card, headings, and error message', () => {
      assert.match(cssContent, /section\[data-css\*="Login"\]/);
      assert.match(cssContent, /var\(--pupzy-shadow-login\)/);
      assert.match(cssContent, /var\(--pupzy-error-light\)/);
      assert.match(cssContent, /var\(--pupzy-error-dark\)/);
    });

    it('styles navigation sidebar, drawer, and active items', () => {
      assert.match(cssContent, /section\[data-css\*="Sidebar"\]/);
      assert.match(cssContent, /var\(--pupzy-surface-warm\)/);
      assert.match(cssContent, /var\(--pupzy-primary\)/);
    });

    it('styles modals and confirmation dialogs with 16px radius and elevation', () => {
      assert.match(cssContent, /\.adminjs_Modal/);
      assert.match(cssContent, /var\(--pupzy-radius-modal\)/);
      assert.match(cssContent, /var\(--pupzy-shadow-modal\)/);
    });

    it('styles notices (toasts) for success, error, warning, and info states', () => {
      assert.match(cssContent, /\.adminjs_Notice/);
      assert.match(cssContent, /var\(--pupzy-radius-notice\)/);
      assert.match(cssContent, /\[type="success"\]/);
      assert.match(cssContent, /\[type="error"\]/);
      assert.match(cssContent, /\[type="warning"\]/);
      assert.match(cssContent, /\[type="info"\]/);
    });
  });

  describe('Typography, Accessibility & High Contrast', () => {
    it('imports Cairo, DM Sans, and Playfair Display fonts', () => {
      assert.match(cssContent, /family=Cairo/);
      assert.match(cssContent, /family=DM\+Sans/);
      assert.match(cssContent, /family=Playfair\+Display/);
    });

    it('configures Playfair Display for headings and DM Sans / Cairo for body', () => {
      assert.match(cssContent, /--pupzy-font-heading:\s*'Playfair Display'/);
      assert.match(cssContent, /--pupzy-font-body:\s*'DM Sans'/);
      assert.match(cssContent, /--pupzy-font-arabic:\s*'Cairo'/);
      assert.match(cssContent, /--pupzy-font-mono/);
    });

    it('provides Arabic RTL typography rules with proper line-height', () => {
      assert.match(cssContent, /\[dir="rtl"\]/);
      assert.match(cssContent, /\[data-property-name\*="arabic"\]/);
      assert.match(cssContent, /direction:\s*rtl/);
      assert.match(cssContent, /line-height:\s*1\.6/);
    });

    it('enforces visible high-contrast focus indicators for keyboard navigation', () => {
      assert.match(cssContent, /\*:focus-visible/);
      assert.match(cssContent, /outline:\s*2px solid var\(--pupzy-primary\)/);
      assert.match(cssContent, /outline-offset:\s*2px/);
    });

    it('includes reduced-motion accessibility rules', () => {
      assert.match(cssContent, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
      assert.match(cssContent, /animation-duration:\s*0\.01ms/);
      assert.match(cssContent, /transition-duration:\s*0\.01ms/);
    });

    it('configures touch-friendly target sizing for mobile and tablet devices', () => {
      assert.match(cssContent, /@media\s*\(pointer:\s*coarse\)/);
      assert.match(cssContent, /min-height:\s*38px/);
    });
  });

  describe('System States & Visual Feedback', () => {
    it('configures brand primary styling on loaders and spinners', () => {
      assert.match(cssContent, /\.adminjs_Loader/);
      assert.match(cssContent, /border-top-color:\s*var\(--pupzy-primary\)/);
    });

    it('configures validation error states for form inputs and textareas', () => {
      assert.match(cssContent, /aria-invalid="true"/);
      assert.match(cssContent, /border-color:\s*var\(--pupzy-error\)/);
    });

    it('configures pill buttons for primary and danger actions', () => {
      assert.match(cssContent, /button\[variant="primary"\]/);
      assert.match(cssContent, /var\(--pupzy-radius-pill\)/);
      assert.match(cssContent, /button\[variant="danger"\]/);
    });

    it('configures badges for active, warning, danger, and neutral states', () => {
      assert.match(cssContent, /\[variant="success"\]/);
      assert.match(cssContent, /\[variant="warning"\]/);
      assert.match(cssContent, /\[variant="danger"\]/);
      assert.match(cssContent, /\[variant="default"\]/);
    });
  });

  describe('Responsive Breakpoints & Content Usability', () => {
    it('defines multi-tier grid breakpoints for dashboard metric cards', () => {
      assert.match(cssContent, /\.pupzy-metric-grid/);
      assert.match(cssContent, /@media\s*\(min-width:\s*576px\)/);
      assert.match(cssContent, /@media\s*\(min-width:\s*900px\)/);
      assert.match(cssContent, /@media\s*\(min-width:\s*1400px\)/);
    });

    it('prevents main content blowout near desktop breakpoint when persistent sidebar is active', () => {
      assert.match(cssContent, /section\[data-css\*="Main"\]/);
      assert.match(cssContent, /min-width:\s*0\s*!important/);
      assert.match(cssContent, /max-width:\s*100%\s*!important/);
    });

    it('configures table wrappers with explicit horizontal scrolling and min-width', () => {
      assert.match(cssContent, /overflow-x:\s*auto\s*!important/);
      assert.match(cssContent, /-webkit-overflow-scrolling:\s*touch\s*!important/);
      assert.match(cssContent, /min-width:\s*600px/);
    });
  });

  describe('Anti-Collapse & Character Squeezing Guarantees across all 20 tables', () => {
    it('ensures ADMIN_RESOURCE_TABLES contains all 20 curated tables', () => {
      assert.equal(ADMIN_RESOURCE_TABLES.length, 20);
    });

    it('enforces no-wrap on all structural table data types (IDs, timestamps, statuses, enums, counts, actions)', () => {
      assert.match(cssContent, /td\[data-property-name\*="id"\]/);
      assert.match(cssContent, /td\[data-property-name\*="_id"\]/);
      assert.match(cssContent, /td\[data-property-name\*="created"\]/);
      assert.match(cssContent, /td\[data-property-name\*="updated"\]/);
      assert.match(cssContent, /td\[data-property-name\*="_at"\]/);
      assert.match(cssContent, /td\[data-property-name\*="status"\]/);
      assert.match(cssContent, /td\[data-property-name\*="type"\]/);
      assert.match(cssContent, /td\[data-property-name\*="is_"\]/);
      assert.match(cssContent, /td\[data-property-name\*="has_"\]/);
      assert.match(cssContent, /td\[data-property-name\*="count"\]/);
      assert.match(cssContent, /td\[data-property-name\*="score"\]/);
      assert.match(cssContent, /td\[data-property-name\*="price"\]/);
      assert.match(cssContent, /td\[data-property-name="species"\]/);
      assert.match(cssContent, /td\[data-property-name="gender"\]/);
      assert.match(cssContent, /td\.adminjs_TableActionCell/);
      assert.match(cssContent, /td:last-child/);
      assert.match(cssContent, /\.pupzy-nowrap/);
    });

    it('enforces text truncation for list titles, bodies, and addresses without breaking show view wrapping', () => {
      assert.match(cssContent, /td\[data-property-name="title"\]/);
      assert.match(cssContent, /td\[data-property-name="body"\]/);
      assert.match(cssContent, /td\[data-property-name="address_english"\]/);
      assert.match(cssContent, /td\[data-property-name="address_arabic"\]/);
      assert.match(cssContent, /text-overflow:\s*ellipsis/);
      assert.match(cssContent, /\[data-css\*="property-show"\]/);
      assert.match(cssContent, /word-break:\s*break-word/);
      assert.match(cssContent, /overflow-wrap:\s*anywhere/);
    });
  });
});
