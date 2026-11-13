/**
 * Confirmation copy for the type-specific Post Resolution actions and the
 * administrator reopening correction.
 *
 * Kept in a plain module (no JSX) so `moderation-action-messages.test.js` can
 * import the maps and prove that every action in `POST_RESOLUTION_ACTIONS`
 * (`actions/moderate-post.actions.js`) has matching confirmation copy, and
 * that no confirmation copy points at an action that no longer exists.
 */
export const POST_RESOLUTION_ACTIONS = {
  markRescued: {
    label: 'Mark rescued',
    consequence:
      'Records this rescue as resolved, closes its pending contact requests and adoption applications, and notifies the owner. The Post stays readable and is not removed.',
  },
  markAnimalDeceased: {
    label: 'Mark animal deceased',
    consequence:
      'Records this rescue as closed because the animal died, closes its pending contact requests and adoption applications, and notifies the owner. The Post stays readable, is never described as rescued, and is not removed.',
  },
  markReunited: {
    label: 'Mark reunited',
    consequence:
      'Records this case as reunited, closes its pending contact requests and adoption applications, and notifies the owner. The Post stays readable and is not removed.',
  },
  markResolved: {
    label: 'Mark resolved',
    consequence:
      'Records this case as resolved, closes its pending contact requests and adoption applications, and notifies the owner. The Post stays readable and is not removed.',
  },
  markAdopted: {
    label: 'Mark adopted',
    consequence:
      'Records this listing as adopted, closes its pending adoption applications and contact requests, and notifies the owner. The Post stays readable and is not removed.',
  },
  markSold: {
    label: 'Mark sold',
    consequence:
      'Records this listing as sold, closes its pending contact requests and adoption applications, and notifies the owner. The Post stays readable and is not removed.',
  },
};

export const ACTION_CONSEQUENCES = {
  removePost:
    'Removes the Post from discovery and notifies the owner with this reason. Media and discussion are retained, and an administrator can restore the Post later.',
  removeProfilePhoto:
    "Clears this user's profile photo and queues the stored image for deletion. The user keeps their account and can upload a new photo; the sign-in provider's picture is not applied again.",
  hideComment:
    "Hides this Comment from everyone but staff, takes it out of the Post's comment count and closes its open Comment Reports as action taken. An administrator can restore it later.",
  hideCommentImages:
    "Hides only this Comment's images from users (the text stays) and closes its open Comment Reports as action taken. An administrator can restore it later.",
  removeComment:
    'Permanently removes this Comment, queues its images for deletion and closes its open Comment Reports. This cannot be undone.',
};

/** Button and heading text for actions that use the shared form. */
export const ACTION_LABELS = {
  banUser: 'Ban User',
  flagPost: 'Flag Post',
  removePost: 'Remove Post',
  removeProfilePhoto: 'Remove Profile Photo',
  removeComment: 'Remove Comment',
  hideComment: 'Hide Comment',
  hideCommentImages: 'Hide Comment Images',
  reviewWithNoAction: 'Review with No Action',
};

/**
 * Actions that only ask the moderator to confirm. They use the shared form so
 * the confirmation is submitted as a POST (AdminJS sends a guard-only action
 * as a GET, which the handlers correctly ignore). The reason is optional.
 */
export const CONFIRM_ONLY_ACTIONS = {
  approvePost: {
    label: 'Approve Post',
    consequence:
      'Marks this Post as clean, removes it from the review queue and closes its open Post Reports as reviewed with no action.',
  },
  restorePost: {
    label: 'Restore Post',
    consequence:
      'Returns this removed Post to Active so it appears in discovery again. Reports already closed stay closed.',
  },
  unbanUser: {
    label: 'Unban User',
    consequence: 'Lifts this ban and clears the ban reason. Posts removed earlier are not restored.',
  },
  restoreComment: {
    label: 'Restore Comment',
    consequence: 'Marks this Comment clean and makes it visible again, and closes its open Comment Reports.',
  },
};

export const POST_CORRECTION_ACTIONS = {
  reopenPost: {
    label: 'Reopen Post',
    consequence:
      'Returns this completed Post to Active so the community can keep helping. Closed contact requests and adoption applications stay closed, removed content is not restored, and the owner is notified.',
  },
};
