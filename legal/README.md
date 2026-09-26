# Pupzy legal & support website

A small static website with every public page the app stores require, in
English and Arabic:

| Page | URL on your domain | Source files |
|---|---|---|
| Home (links to all pages) | `/` | generated |
| Terms of Service | `/terms/` | `terms-of-service.en.md`, `terms-of-service.ar.md` |
| Privacy Policy | `/privacy/` | `privacy-policy.en.md`, `privacy-policy.ar.md` |
| Delete your account | `/delete-account/` | `delete-account.en.md`, `delete-account.ar.md` |
| Support | `/support/` | `support.en.md`, `support.ar.md` |
| Child safety standards | `/child-safety/` | `child-safety.en.md`, `child-safety.ar.md` |

Each page has an English / العربية switch. The Arabic version is right to left,
and the Arabic text prevails if the two differ. Add `?lang=ar` or `?lang=en` to a
URL to open it in that language. For example, the app can link to
`https://pupzy.net/terms/?lang=ar`.

**These are drafts, not legal advice.** Have them reviewed by a qualified Egyptian
lawyer before publishing. No terms can protect you from every liability.
Egyptian law does not allow excluding liability for fraud, gross negligence or
intentional wrongdoing, or waiving mandatory consumer rights.

## 1. Fill in your details

Open [`site.config.json`](site.config.json) and fill every empty value: company
name (English and Arabic), company type, commercial registration number,
address, support, safety and phone contacts, hosting provider, liability cap,
and your domain in `site_base_url`. Every page reads from this one file.

## 2. Build

```bash
python legal/build_site.py
```

This writes the finished website to `legal/site/`. The build lists any value
still missing, and the pages highlight it in yellow, so an unfinished page is
easy to spot. Only Python is needed; there is nothing to install.

To change any text, edit the `.md` files and build again.

## 3. Upload

Upload the **contents** of `legal/site/` to the root of your domain (for example
`https://pupzy.net/`) with any static host: cPanel or FTP, Netlify, Vercel,
GitHub Pages or Cloudflare Pages. Every page is a folder with an `index.html`, so
the URLs are `/terms/`, `/privacy/`, and so on. Check that every page opens
without signing in.

## 4. Connect the links

| Where | Field | URL |
|---|---|---|
| Backend `.env` | `TERMS_URL` | `https://<your domain>/terms/` |
| Backend `.env` | `TERMS_VERSION` | `2026-09-27` (the version at the top of the Terms) |
| App Store Connect | Privacy Policy URL | `https://<your domain>/privacy/` |
| App Store Connect | Support URL | `https://<your domain>/support/` |
| App Store Connect | License Agreement (EULA) | paste the Terms text, or link it in the description |
| Google Play Console | Privacy policy (App content) | `https://<your domain>/privacy/` |
| Google Play Console | Delete account URL (Data safety) | `https://<your domain>/delete-account/` |
| Google Play Console | Child safety standards (Social apps) | `https://<your domain>/child-safety/` |

In the app:

- make "Terms of Service" and "Privacy Policy" on the sign-in screen tappable
  links;
- add a Privacy Policy link next to the Terms link in the Terms sheets and in
  Profile → Terms & Privacy;
- add a "Contact support" item that opens `/support/`.

For every later change to the Terms, publish a new version with a new date and
update `TERMS_VERSION`. Every account is then asked to accept it in the app.

## 5. Ask the lawyer to confirm

- The liability limits, indemnity and disclaimers are enforceable against
  consumers under Egyptian consumer protection law, and the cap amount.
- Whether the Arabic version should prevail.
- What the Personal Data Protection Law (No. 151 of 2020) requires of Pupzy,
  such as registration, a licence, or a data protection officer, and whether the
  Privacy Policy meets it.
- The adoption "reimbursement of documented costs" wording, and the breeding
  rules against the law on keeping dogs and dangerous animals.
- Whether any licence is needed to run a marketplace for pet products.

## 6. The pages promise these — make sure they are true

| Promise | Status |
|---|---|
| In-app reporting of posts, comments, replies and accounts; blocking users | Done |
| Account deletion in the app; 30-day retention before permanent deletion | Done |
| Acceptance of each new Terms version in the app | Done |
| Photo location metadata removed before publishing | Done |
| No advertising or analytics trackers | Done (none in the app today; update the Privacy Policy if you add any) |
| Marketplace has no comments or Raise | Done in the app. **The backend still accepts them through the API**, so enforce it there too |
| Lost & Found comments are text-only | Done in the app. **The backend still accepts photos on Lost & Found**, so enforce it there too |
| Users are 18 or older | **Not enforced.** Add an age confirmation at sign-up |
| Reports acted on within 24 hours | **An operational commitment.** Someone must review reports daily |
| Deletion requests by email completed within 30 days | **An operational commitment** |

## 7. Store checklist beyond these pages

**Apple:** App Privacy details (contact info, location, photos, identifiers, user
content); guideline 1.2 for user-generated content (filtering, reporting,
blocking, timely moderation, contact details in the app); in-app account
deletion (done); an honest age rating (expect a mature rating); a review note
explaining that no live animals are sold.

**Google Play:** Data safety form; user-generated content policy; account
deletion in the app (done) and on the web (`/delete-account/`); target audience
adults (18+); permission declarations for location, notifications and photos.
