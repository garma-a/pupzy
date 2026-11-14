import React from 'react';
import { Text } from '@adminjs/design-system';

import { userDisplayName } from '../reference-title.js';
import { Avatar } from './avatar-component.jsx';
import { useMediaLightbox } from './media-lightbox.jsx';
import ShowField from './show-field.jsx';

const hasUrl = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * A user's profile photo: a small avatar in lists and a large one on the user
 * page that opens the full image in the shared lightbox. Without a photo (or
 * when it fails to load) it shows initials.
 */
export default function ProfilePhoto({ property, record, where }) {
  const { openMedia, dialog } = useMediaLightbox();
  const params = record?.params ?? {};
  const name = userDisplayName(params, record?.id);
  const url = hasUrl(params.profile_picture_url) ? params.profile_picture_url : null;

  if (where !== 'show') return <Avatar name={name} src={url} size={32} />;

  const avatar = <Avatar name={name} src={url} size={96} />;
  return (
    <ShowField property={property}>
      {url ? (
        <button
          type="button"
          data-testid="pupzy-profile-photo-open"
          aria-label={`Open ${name}'s profile photo`}
          onClick={(event) => openMedia([{ url }], 0, event.currentTarget)}
          style={{ border: 0, padding: 0, background: 'none', cursor: 'zoom-in', borderRadius: '50%' }}
        >
          {avatar}
        </button>
      ) : (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }} data-testid="pupzy-profile-photo-none">
          {avatar}
          <Text color="grey60">No profile photo</Text>
        </span>
      )}
      {dialog}
    </ShowField>
  );
}
