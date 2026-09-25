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
};

export const POST_CORRECTION_ACTIONS = {
  reopenPost: {
    label: 'Reopen Post',
    consequence:
      'Returns this completed Post to Active so the community can keep helping. Closed contact requests and adoption applications stay closed, removed content is not restored, and the owner is notified.',
  },
};
