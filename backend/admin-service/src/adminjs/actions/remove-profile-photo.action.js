import { actionResponse, readModerationReason, runModerationAction } from './helpers.js';
import { isAnyAdmin } from '../rbac.js';

function hasProfilePhoto(record) {
  if (!record) return false;
  const value = typeof record.get === 'function' ? record.get('profile_picture_url') : undefined;
  const url = value !== undefined ? value : record.params?.profile_picture_url;
  return typeof url === 'string' && url.trim() !== '';
}

/**
 * Removes a User's profile photo with the same effects as the app's own
 * removal (`UsersRepository.clearProfilePhoto`) in one transaction under the
 * user's row lock: the picture URL and owned storage key are cleared, the
 * change marker is set (so the sign-in provider's picture is never applied
 * again, see `linkFirebaseUserId`), and an owned stored object is queued for
 * deletion. A provider-supplied picture has no owned key, so nothing is
 * queued for it. Nothing is added beyond what the app does (no notification).
 */
export function buildRemoveProfilePhotoAction(pool, component, cache) {
  return {
    actionType: 'record',
    icon: 'Image',
    isAccessible: isAnyAdmin,
    isVisible: (context) => hasProfilePhoto(context?.record),
    component,
    handler: async (request, _response, context) => {
      const { record, currentAdmin } = context;
      if (request.method !== 'post') return { record: record.toJSON(currentAdmin) };

      const reasonResult = readModerationReason(request.payload?.reason);
      if (reasonResult.error || !reasonResult.reason) {
        return actionResponse(
          record,
          currentAdmin,
          { ok: false, error: reasonResult.error ?? 'A reason is required.' },
          '',
        );
      }

      const result = await runModerationAction(pool, {
        table: 'users',
        id: record.id(),
        adminUserId: currentAdmin.id,
        actionType: 'USER_PROFILE_PHOTO_REMOVED',
        targetType: 'USER',
        reason: reasonResult.reason,
        onSuccess: () => cache?.invalidate(),
        validate: (row) =>
          !row.profile_picture_url && !row.profile_photo_storage_key ? 'This user has no profile photo.' : null,
        mutate: async (client, row) => {
          if (row.profile_photo_storage_key) {
            await client.query(
              `INSERT INTO media_deletion_work (storage_key, cdn_url, status, attempts)
               VALUES ($1, '', 'PENDING', 0)`,
              [row.profile_photo_storage_key],
            );
          }
          await client.query(
            `UPDATE users
             SET profile_picture_url = NULL, profile_photo_storage_key = NULL,
                 profile_photo_changed_at = now(), updated_at = now()
             WHERE id = $1`,
            [row.id],
          );
          return { removedOwnedPhoto: Boolean(row.profile_photo_storage_key) };
        },
      });
      return actionResponse(record, currentAdmin, result, 'Profile photo removed.');
    },
  };
}
