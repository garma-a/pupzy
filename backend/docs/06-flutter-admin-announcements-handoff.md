# App handoff: admin announcements

Status: ready-for-human
Type: task
For: Matthew (Flutter app)

A super admin can now send an **Announcement** from the admin: a message to every eligible user, or to the users whose home City is one chosen City. It arrives as an in-app notification, and as a push for users who have notifications on. Nothing here is breaking.

## What is new

| Thing                   | Value                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| Notification `type`     | `ADMIN_ANNOUNCEMENT` (new value of the `NotificationType` enum)                                                 |
| Not to be confused with | `SYSTEM_ANNOUNCEMENT`, the retired saved-search alert. It stays as old rows only and is not reused.             |
| Related Post            | none. `relatedPostId` is `null`.                                                                                |
| Text                    | A title (up to 80 characters) and a message (up to 500 characters), written by the admin in English and Arabic. |

## GraphQL

No new operations and no new fields. `myNotifications` returns the announcement like any other notification:

```graphql
{
  myNotifications(first: 20) {
    edges {
      node {
        id
        type # "ADMIN_ANNOUNCEMENT"
        title # already in the user's language
        body # already in the user's language, up to 500 characters
        relatedPostId # null
        isRead
        createdAt
      }
    }
  }
}
```

`title` and `body` are rendered by the server from the user's synchronized language (`ar` gives the Arabic text, anything else gives English), the same as every other notification. Show them as they are. Do not pick a language in the app.

The only schema change is the new `ADMIN_ANNOUNCEMENT` value in the output enum `NotificationType`. The compatibility script reports it as additive (see below).

## Push

The push `notification` (title and body) is localized by the server the same way. The `data` payload has only two keys, both strings:

```json
{ "notificationId": "<uuid>", "type": "ADMIN_ANNOUNCEMENT" }
```

There is no `relatedPostId`, `relatedCommentId` or any other routing key. Push is sent only to users with notifications turned on, and the server rechecks that just before sending. The in-app notification is always created, whatever the push setting.

`push_service.dart` already handles a payload without `relatedPostId`: a tap marks the notification read and opens the notifications sheet. That is acceptable for announcements. If you want the tap to land on the full text, find the notification by `notificationId` in the sheet and open it as described below.

## What the app should do

1. **Icon.** Add `ADMIN_ANNOUNCEMENT` to `_iconForType` in `lib/screens/notifications_panel.dart` and return `Icons.campaign_outlined`, the same icon `SYSTEM_ANNOUNCEMENT` already uses:

   ```dart
   case 'SYSTEM_ANNOUNCEMENT':
   case 'ADMIN_ANNOUNCEMENT':
     return Icons.campaign_outlined;
   ```

2. **Tap opens the full text, with no Post navigation.** The list clamps the message to two lines and an announcement can be 500 characters long. In `_openNotification`, when `n.type == 'ADMIN_ANNOUNCEMENT'`, mark it read as today and open a dialog or bottom sheet with the full `title` and `body` (selectable text is a nice touch). Do not call `openNotificationTarget`: there is no Post. Keep the existing early return for other types without a `relatedPostId`.

3. **Layout.** The text is user-written. Let it wrap, and use `TextDirection` from the active language (the server already chose Arabic or English). The body may contain line breaks.

## Old app builds

Nothing crashes. `AppNotification.type` is a plain `String`, and `_iconForType` has a `default:` branch that returns `Icons.notifications_none`. An old build shows the announcement with the generic bell icon and the text clamped to two lines, and a tap only marks it read (no Post to open). A push still shows its full title and body in the system tray. Users get the full experience after they update.

## Compatibility check

```bash
cd backend
node scripts/graphql-schema-compat.mjs <commit before this change> HEAD
```

Result: compatible. The only difference is the additive enum value `NotificationType.ADMIN_ANNOUNCEMENT`. An old client that selects `type` as a `String` keeps working. A client with a generated, closed enum would need to add the value; the Flutter app does not use one.
