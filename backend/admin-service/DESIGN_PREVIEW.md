# Admin design preview

This branch is for review before production. The deployed photo fixes are already on `main`; this design has not been deployed.

## Open the preview

Requires Node.js 22 or newer, Docker running, and this complete repository (the sample photos live in `frontend/assets/images`).

From `backend/admin-service`:

```sh
npm ci
npm run preview:design
```

Open <http://localhost:4100/admin>.

- Email: `preview@pupzy.local`
- Password: `PupzyPreview2026!`

These are sample credentials for the local preview only. The script creates a fresh disposable PostgreSQL/PostGIS container and synthetic Posts, reports and users. It does not load production configuration. It listens only on the local loopback interface. Stop with Ctrl+C to remove its database. Starting again resets the sample data. Set `PUPZY_PREVIEW_PORT` if port 4100 is occupied.

## Review the experience

1. Sign in; try a wrong password first to see the error state.
2. Open a work queue and confirm its filter remains when returning from a Post.
3. Open an Adoption, Rescue, Lost, Mating or Product Post. Check photos, description, owner, lifecycle status, discussion and reports.
4. Open a photo. Use arrow keys, Tab and Escape; closing returns focus to its thumbnail.
5. Try Approve, Flag, Remove and a valid case outcome on sample Posts. The existing reason, confirmation and audit flows remain in place.
6. Try narrow and wide browser windows, keyboard navigation, and your operating system's reduced-motion setting.

## Design decisions

| Area               | Decision and purpose                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colors             | Preserve every original theme color token, including orange `#C4622D`, cream `#FAF6F1`, brown `#2D1506`, and the existing semantic red and green.                       |
| Type               | Self-host Onest for English and Cairo for Arabic, with system fallbacks and font swapping. Use one clear hierarchy throughout the login, lists, forms and review pages. |
| First screen       | Put work queues before totals. Emphasize one nonempty review queue; keep Refresh secondary.                                                                             |
| Case review        | Keep context beside original photos on wide screens, then stack them in reading order on narrow screens. Retain full-image viewing.                                     |
| Actions            | Retain the existing order and permissions. Give the approval action clear emphasis and removal a separate danger treatment, with spacing between wrapped controls.      |
| Loading and errors | Distinguish first-load failure from an empty queue. Retain the last successful overview on refresh failure and offer Retry.                                             |
| Motion             | Brief opacity/position entry and interaction feedback; no decorative idle animation. Respect reduced motion.                                                            |
| Loading cost       | Add no UI dependencies or API calls. Serve the new font subsets locally; retain existing AdminJS and map integrations.                                                  |

No database schema, moderation rules, API contracts or production credentials change in this design branch. The local preview is not a production deployment command.

## Validation

```sh
npm test
npm run test:browser
npm run format:check
```

The browser suite creates its own disposable databases. Run it in a separate checkout if the live preview watcher is running, because it recreates the generated `.adminjs` component bundle. Production configuration must never be used for the preview or browser suite.
