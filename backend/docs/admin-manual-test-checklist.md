# Admin manual test guide

One pass over the whole admin: the moderation fixes (PR #47), announcements (PR #49) and the redesign (PR 3). It runs against a local, seeded database. Nothing here touches production.

## Start

Stop any local admin that is already running (Ctrl+C in its terminal). Then, from this branch:

```bash
cd backend/admin-service
npm install
npm run local:admin -- --reset
```

Open http://localhost:4000/admin and log in as the local super admin (`superadmin@pupzy.local`). The moderator account is `moderator@pupzy.local`. Their local test passwords are in `scripts/local/seed.mjs`. `--reset` restores the seed data; run it again before a second round.

Check at a laptop size (1440 or 1280 wide). Nothing should scroll sideways, even at 1024.

## 1. Sidebar and Inbox

- [ ] The sidebar reads, in order: Inbox, Reports, Content, People, Places, Announcements, Admin, and a collapsed Records group. Names are plain words, with no table names.
- [ ] The Inbox is the home screen. Its tiles show Open Post Reports, Open Comment Reports, Open Account Reports, Flagged posts and Pending review.
- [ ] Click a tile: the list below shows only that kind. Click it again to show everything.
- [ ] Each row has a kind badge, a picture or avatar, the title or excerpt, the reason, the reporter, "N reports" and an age. Several reports on one post are ONE row.
- [ ] Switch between Oldest first and Newest first.
- [ ] Filter by a tile, open a case with **Open case**, then press **Back to inbox**: the same filter and page come back.
- [ ] **Refresh now** updates the counts at once. Without it, counts can lag by up to 30 seconds, except after an action in the admin, which updates them straight away.

## 2. Case view (report pages)

- [ ] Open a Post Report. The left side has the photos (click one to enlarge), the title as a link to the post, badges, text, owner, city and date. The title is not repeated further down.
- [ ] The right side has the status, reason, details, reporter, the action buttons (primary first, destructive in red), "Other reports on this" and History.
- [ ] Narrow the window below about 1100 px: the right column moves under the left.
- [ ] **Technical details** at the bottom holds the raw IDs.
- [ ] A Comment Report shows the comment's text and images, with its heading as a link to the comment. An Account Report shows the avatar, the name as a link to the user, email, join date and ban state.

## 3. Report status and links

- [ ] Report lists have a Status badge: Open (orange), Closed: no action (grey), Closed: action taken (green). They look clearly different.
- [ ] On a report, click the post, the reporter, the comment and its author: each opens the right record.
- [ ] Moderation Actions (the audit log): each row reads as a sentence, and its target opens the post, comment or user.

## 4. Act on reports

- [ ] On an open Post Report, use **Review with no action**. The success message stays, and Status reads "Closed: no action" with your name.
- [ ] On an open Comment Report, use **Hide comment** with a reason. You come back to the report, now "Closed: action taken".
- [ ] On an open Post Report, use **Remove Post**. Its reports and the reports on its comments close.
- [ ] On an Account Report, use **Ban account**.
- [ ] Back in the Inbox, the cases you closed are gone and the tile counts went down.

## 5. Approve, Flag and Restore

- [ ] Open the flagged rescue post (an injured kitten near Nasr City) and **Approve** it. It becomes clean, and its open reports read "Closed: no action".
- [ ] **Flag Post** on a clean post with open reports. The reports stay Open.
- [ ] **Restore** a removed post, then a removed comment. Their reports don't change.
- [ ] On the post review screen, "Review this report" opens in the same tab and brings you back with the report shown as closed.

## 6. Comments and rescue images

- [ ] Open a rescue Comment with images. Thumbnails load; clicking one opens it full size (arrow keys move, Esc closes).
- [ ] An Arabic comment reads right to left.
- [ ] **Hide Comment Images** hides only the images.

## 7. Lists

- [ ] **Posts:** chips above the table (Active rescue, Lost pet, Found stray, Adoption, Products, Mating, Completed, Expired, Removed) show counts and filter the list. Titles are readable, with the full title on hover. Owner avatar, city, open reports and age are there.
- [ ] **Users:** photo or initials, name in both languages, email, Active or Banned, open reports, joined.
- [ ] **Comments:** excerpt, author, post, status, report count, images count, age.
- [ ] **Vet clinics:** the Arabic name takes at most two lines, a Status column reads Active or Closed, a missing phone shows "No phone", and the address is one column.
- [ ] Every list shows a loading skeleton while it loads and a clear empty state when a filter matches nothing.

## 8. Users and profile photos

- [ ] Open Omar Hassan: his photo opens full size. Use **Remove Profile Photo** with a reason; his initials appear.
- [ ] Edit a user's name and save. You land on that user's page, and the photo URL is not editable.
- [ ] Unban the banned seller with **Unban User**. It works and shows a success message.

## 9. Announcements (super admin only)

- [ ] As the moderator (in a private window), Announcements is missing from the menu, and `/admin/resources/announcements/actions/new` shows no form.
- [ ] As the super admin: Announcements → **New announcement**. **Preview** with nothing typed shows a message on each of the four fields.
- [ ] Type English and Arabic titles and messages. Counters read `n / 80` and `n / 500`, and the Arabic fields type right to left. Arabic in an English field (or the reverse) is refused.
- [ ] **Preview** shows an English card and an Arabic card. **Continue** shows "N users will receive this announcement" and **Send to N users**.
- [ ] Choose **Users in one City**: the number is smaller. A City with no users is refused.
- [ ] **Send**: the announcement page shows status Pending, and Moderation Actions has one "sent announcement" row.
- [ ] The Announcements list shows sender, time, audience, both texts, status and counts. There is no way to edit or delete one.
- [ ] Optional: with the backend running against this database, the status moves to Sending, then Sent.

## 10. Feel

- [ ] Hover a row: it highlights. Notices slide in. With "reduce motion" turned on in the OS, nothing animates.
- [ ] Tab through a page: every button and link shows a focus ring.

## Deploying after the test

Merge in order. After each merge, wait for the `pupzy` API deploy to finish before the next step, because it runs the migrations.

1. Merge #47 (migrations 0069–0070). Retarget #49 to `main`.
2. Merge #49 (migration 0071). Retarget PR 3 to `main`.
3. Merge PR 3 (no migration).
4. Once the API deploy for the last merge has finished, upload the admin by hand (it is not connected to GitHub). The staging folder must hold every shared file the admin `Dockerfile` copies. There are five after #49, including `src/notifications/admin-announcement.contract.ts`.
