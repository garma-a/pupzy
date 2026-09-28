# Post activity notifications: Flutter integration

The backend selects recipients from authenticated engagement. The app does not send recipient IDs, maintain follower lists, or register a subscription when rendering a feed.

## Automatic following

An account follows a Post while it owns it or has a current save, current Post Boost (`toggleUpvote`), an existing Comment/Reply, a contact request, or an adoption application. Existing data qualifies immediately; no backfill or client migration is required. Merely viewing a feed or Post does not qualify. Removing the last qualifying relationship stops following; removing a save alone does not stop it if another relationship remains. Deleted/removed Comments do not establish following. Boosting a Comment alone does not establish following.

Followers receive new Comments and Replies, plus the existing completion/reopening notifications. A person's own action never notifies them. Multiple qualifying relationships produce one notification per event. Direct recipients (Post owner, parent Comment author) are deduplicated against followers. Saves and Boosts still notify their existing direct recipients; they are not broadcast to every follower. Editing Post text/photos is not a notification event.

Audience membership is captured when activity commits. Muting, Blocks, removed content, and account availability are checked again during delivery. Blocks against the actor, Post creator, or parent Comment author prevent disclosure of inaccessible discussion. Historical inbox entries remain historical entries.

## Query and mute API

Use the existing authenticated GraphQL endpoint with `Authorization: Bearer <Firebase ID token>`. Both operations derive the account from the token and accept no `userId`/recipient override.

```graphql
query PostNotificationState($postId: ID!) {
  myPostNotificationPreferences(postId: $postId) {
    postId
    isFollowing
    isMuted
    notificationsEnabled
  }
}

mutation MutePost($postId: ID!, $muted: Boolean!) {
  setPostNotificationsMuted(postId: $postId, muted: $muted) {
    postId
    isFollowing
    isMuted
    notificationsEnabled
  }
}
```

Example variables: `{"postId":"<post UUID>","muted":true}`. Use `false` to unmute. The mutation is an idempotent setter, so retries are safe. Refresh this state after saving, unsaving, Boosting, or deleting a Comment. Show “Mute post notifications” when unmuted and “Unmute post notifications” when muted.

- `isFollowing`: the account currently has a qualifying relationship, independently of mute.
- `isMuted`: explicit preference; later engagement never resets it. Muting is allowed before following.
- `notificationsEnabled`: `isFollowing && !isMuted`. It does not represent OS permission, device registration, or the account-wide push setting.

An inaccessible, removed, or nonexistent Post returns the normal not-found error; malformed UUIDs are rejected. There is no API to inspect another account's preferences.

Mute stops future activity inbox entries and pushes for this Post and permanently cancels pending activity. Unmuting does not replay canceled or skipped events. Existing inbox entries are retained. Sends already handed to FCM cannot be recalled. Contact/adoption decisions and administrator account/moderation messages remain transactional notifications and are not muted by this control.

One deliberate exception preserves ADR 0008: reopening corrections to previously delivered completion messages remain in the inbox even when muted, so an earlier outcome is corrected. Their pushes are muted.

## Receiving updates

Use the existing device registration and inbox APIs:

```graphql
mutation RegisterPush($input: RegisterDeviceInput!) {
  registerDevice(input: $input) {
    id
    platform
  }
}

query NotificationInbox($first: Int, $after: String) {
  myNotifications(first: $first, after: $after) {
    unreadCount
    edges {
      cursor
      node {
        id
        type
        title
        body
        isRead
        relatedPostId
        relatedCommentId
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

query NotificationBadge {
  myUnreadNotificationCount
}

mutation ReadNotification($notificationId: ID!) {
  markNotificationRead(notificationId: $notificationId) {
    id
    isRead
  }
}

mutation ReadAllNotifications {
  markAllNotificationsRead
}

mutation UnregisterPush($token: String!) {
  unregisterDevice(token: $token)
}
```

Registration variables: `{"input":{"token":"<FCM token>","platform":"ANDROID"}}` (or `IOS`). Register after login and token refresh; unregister before logout. An account-wide disabled push preference keeps inbox updates but suppresses device pushes.

On foreground FCM receipt, refresh the inbox and badge. Refresh on login, app resume, and opening the notification panel as well: push delivery is a wake-up hint, not the source of truth. Fetch the first page again for new entries; `after` paginates older history. This feature uses FCM plus GraphQL queries, not a GraphQL WebSocket subscription.

Existing `NEW_COMMENT` and `NEW_REPLY` types now also cover followed Posts. Route using `data.relatedPostId` and `data.relatedCommentId`; do not infer ownership from the notification type. Render backend `title`/`body`, which use the synchronized English/Arabic preference. Handle unavailable/deleted targets gracefully. Deduplicate client events by `notificationId`.

Android messages use high priority, default sound, and the app's `pupzy_activity` Activity channel. iOS alerts request default sound and APNs priority 10. Platform/user settings still control presentation. Notifications of the same type and Post share collapse/tag metadata; the inbox retains individual entries.

## Deployment and validation

This implementation includes the backend changes from `origin/feature/solid-notifications`, including its immediate-delivery, private-user-field, SRID, account-deletion flag, local-storage override, and testing changes. `User.email` and `User.notificationsEnabled` are nullable for other people's profiles; obtain your own settings through `me`.

Run the normal `npm run db:migrate` step before deploying the new backend. Migration `0060` fixes coordinate SRID and may briefly lock/rewrite `posts` on an affected database; schedule accordingly. Migration `0061` adds per-account/Post preferences with cascading deletion. No production migration was run while implementing this feature.

Discussion writes and owner completion changes request delivery immediately after commit. Workers continue draining full batches; the minute-based cron remains recovery/retry support. Administrator completion changes are picked up by the existing scheduled worker.

Backend checks:

```sh
npm run build
npm test -- --runInBand src/notifications/post-activity.integration.spec.ts
npm test -- --runInBand src/comments/discussion-notifications.integration.spec.ts
npm test -- --runInBand src/notifications/push.provider.spec.ts src/notifications/immediate-delivery.spec.ts
```

Integration tests use disposable PostGIS databases. For a device check, sign in as A and save/Boost a Post, create a Comment as B, verify A's inbox and push, then mute as A and repeat. Verify that unmute only restores future activity. Repeat with the app backgrounded/closed and with a Block. Real-device FCM/APNs delivery requires configured provider credentials and OS permission and is not established by database tests.

The handoff's proposed marketplace engagement restrictions, Lost & Found image restrictions, and signup age policy are separate product changes. They are not silently applied here: the current domain contract explicitly allows those discussion behaviors, and the handoff specifies no signup age threshold.

## Verification record

The production `npm run build` passed. All 72 unit suites passed (922 tests). The affected PostGIS integration suites passed (113 tests across activity preferences, discussion recovery, SRID, Block isolation, language, device delivery, workflow delivery, and completion/reopening). Four admin helper tests and lint checks on changed TypeScript files also passed.

Whole-repository `tsc --noEmit` reports existing test-fixture typing errors, including outdated service constructor calls and schema-less database mocks; it is not a passing check. The production build uses `tsconfig.build.json`, which excludes those test files. Live device/provider testing and production deployment have not been performed.
