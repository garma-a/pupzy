# Pupzy legal documents

- [terms-of-service.en.md](terms-of-service.en.md) — Terms of Service, English
- [terms-of-service.ar.md](terms-of-service.ar.md) — Terms of Service, Arabic (prevails if the two differ)

**These are drafts, not legal advice.** Have them reviewed by a qualified Egyptian
lawyer before publishing. No terms can protect you from every liability. Egyptian
law does not allow excluding liability for fraud, gross negligence or intentional
wrongdoing, or waiving mandatory consumer rights. What the Terms can do is
allocate responsibility to users, set clear rules, and show the app stores the
safeguards they require.

## 1. Fill in before publishing

Replace every `[square bracket]` placeholder in both files:

| Placeholder | What to put |
|---|---|
| Legal entity name, company type, commercial registration no., registered address | The company that operates Pupzy |
| Support email, safety email, support phone | Monitored contacts (the app stores require working contact details) |
| Privacy Policy URL | Required by both stores; a Privacy Policy must be written too |
| Account deletion web page URL | Google Play requires a web page where users can request deletion |
| EGP amount (section 15.2) | Liability cap; your lawyer should set it |
| Cairo (section 19.3) | Courts with jurisdiction |

## 2. Ask the lawyer to confirm

- The liability limits (15), indemnity (16) and disclaimers (14) are enforceable
  against consumers under Egyptian consumer protection law, and the cap amount.
- Whether the Arabic version should prevail (1.4) and whether both must be shown.
- Whether the Personal Data Protection Law (No. 151 of 2020) requires registration
  or a licence for Pupzy's processing, and what the Privacy Policy must say.
- The adoption "reimbursement of documented costs" wording (4.2), and the rules on
  breeding (4.4) against the law on keeping dogs and dangerous animals.
- Whether any licence is needed to run a marketplace for pet products or to
  process location data.

## 3. Publish

1. Host both versions at a public URL, for example `https://pupzy.net/terms`.
2. Set the backend environment variables:
   - `TERMS_VERSION=2026-09-27` (the version at the top of the document)
   - `TERMS_URL=<the hosted page>`
3. Every account is then asked to accept the new version in the app before
   creating posts, comments, replies, contact requests or adoption applications.
   For any later change, publish a new version with a new date and update
   `TERMS_VERSION`.

## 4. The Terms promise these — make sure they are true

| Promise in the Terms | Status |
|---|---|
| In-app reporting of posts, comments, replies and accounts; blocking users | Done |
| Account deletion in the app; 30-day retention before permanent deletion | Done |
| Acceptance of each new Terms version in the app | Done |
| Photo location metadata removed before publishing | Done |
| Marketplace has no comments or Raise | Done in the app. **The backend still accepts them through the API**, so enforce it there too |
| Lost & Found comments are text-only | Done in the app. **The backend still accepts photos on Lost & Found**, so enforce it there too |
| Users are 18 or older | **Not enforced.** Add an age confirmation at sign-up |
| Reports acted on within 24 hours | **An operational commitment.** Someone must review reports daily |
| Account deletion via a web page | **To do:** Google Play requires it |

## 5. Store submission checklist (beyond the Terms)

**Apple App Store**

- Privacy Policy URL in App Store Connect and inside the app.
- App Privacy ("nutrition label"): contact info, location, photos, identifiers,
  user content.
- Guideline 1.2 (user-generated content): content filtering, reporting, blocking,
  timely moderation, and contact details in the app.
- Guideline 5.1.1(v): in-app account deletion (done).
- Age rating questionnaire. Expect a mature rating because of user-generated
  content and meeting strangers; the Terms require 18+.
- Explain in the review notes that no live animals are sold. Adoption and mating
  posts connect owners only, and the Marketplace sells pet supplies.

**Google Play**

- Privacy Policy URL and the Data safety form.
- User-generated content policy: Terms that define objectionable content, in-app
  reporting and blocking, and active moderation.
- Account deletion: in the app (done) and via a web page (to do).
- Target audience and content: adults (18+).
- Permission declarations: location (rescue and lost posts, nearby feeds),
  notifications, photos.
