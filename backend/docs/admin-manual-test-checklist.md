# Admin manual test checklist

A short script for checking the admin moderation fixes by hand against a local, seeded database. Nothing here touches production.

## Start

```bash
cd backend/admin-service
npm run local:admin -- --reset
```

Open http://localhost:4000/admin. Log in with the local-only moderator account (`moderator@pupzy.local`) or the local super admin (`superadmin@pupzy.local`). Their local test passwords are in `scripts/local/seed.mjs`. `--reset` restores the seed data, so run it again between test rounds.

## 1. Reports show their status

- [ ] Moderation → Post Reports: the list has a **Status** column, and open reports read "Open".
- [ ] Open a report. Status is at the top, and every field has a label.

## 2. Reports link to everything

- [ ] On a Post Report, click the **Post**: it opens the Post. Go back and click **Reported by**: it opens the reporter, with their photo.
- [ ] On a Comment Report, click the **Comment**, then its **Author**.
- [ ] Moderation Actions: click a **Target**. It opens the post, comment or user, not the audit row.

## 3. Close a report with no action

- [ ] On an open Post Report, use **Review With No Action**. The success message stays visible, and Status reads "Closed: no action … by <you>".

## 4. Act from the report page

- [ ] On an open Comment Report, use **Hide Comment** and give a reason. You come back to the report, and Status reads "Closed: action taken".
- [ ] On an open Post Report, use **Remove Post**. Its report and the reports on its comments close.
- [ ] On an Account Report, use **Ban User**.

## 5. Approve and Flag

- [ ] Open the flagged rescue post (an injured kitten near Nasr City) and **Approve** it. It becomes clean, and its open reports read "Closed: no action".
- [ ] **Flag** a clean post with open reports. The reports stay "Open".
- [ ] **Restore** a removed post, then a removed comment. Their reports don't change.

## 6. Rescue comment images

- [ ] Open a rescue Comment that has images. The thumbnails load, and clicking one opens it full size (arrow keys move between images, Esc closes).
- [ ] An Arabic comment reads right to left.
- [ ] The Comment Report page shows the reported comment's text, images and other reports at the top.
- [ ] The post review screen: "Review this report" opens in the same tab and brings you back with the report shown as closed.

## 7. Users and profile photos

- [ ] The Users list starts with a photo column. Users without a photo show their initials.
- [ ] Open Omar Hassan: a large photo opens full size. Use **Remove Profile Photo** with a reason, and his initials appear.
- [ ] Edit a user's name and save. You land on that user's page, and the photo URL is not editable.
- [ ] Unban the banned seller with **Unban User**. It works and shows a success message.

## 8. Announcements (super admin only)

Log in as the local super admin (`superadmin@pupzy.local`). The Announcements entry is in the left menu. Log in as the moderator (`moderator@pupzy.local`) in a private window: the entry is missing, and opening `/admin/resources/announcements/actions/new` shows no form.

- [ ] Announcements → **New announcement**. Click **Preview** with nothing typed: each of the four fields shows a message, and nothing is sent.
- [ ] Type an English title and message, and an Arabic title and message. The counters read `n / 80` and `n / 500`, and the Arabic fields type right to left. Typing in a field clears its message.
- [ ] Put Arabic text in an English field: the message says it must be written in English. Do the reverse for an Arabic field.
- [ ] **Preview** shows two notification cards: English on the left, Arabic (right to left) on the right.
- [ ] **Continue** shows the exact number of users ("N users will receive this announcement") and a **Send to N users** button. The number is the count of users who are not banned and have no deletion request.
- [ ] Go back, choose **Users in one City**, pick a City, and Preview again: the number is smaller and the preview names the City. Choose a City with no one in it: **Send** is refused with "There are no eligible users for this audience."
- [ ] Press **Send**. You land on the announcement's page with a success message, status **Pending**, and a note that the backend starts within about a minute. The page refreshes itself.
- [ ] Moderation Actions has one **ANNOUNCEMENT SENT** row for it, and its target opens the announcement.
- [ ] The Announcements list shows the sender, time, audience (All users or the City), both texts, status, recipients, in-app and push counts.
- [ ] If the backend is running against this database, the status moves to **Sending**, then **Sent**, and the in-app count reaches the recipient count. In the app, a user whose language is Arabic sees the Arabic text and everyone else sees English.
- [ ] There is no way to edit or delete an announcement after it is sent.
