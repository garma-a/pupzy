import React, { useState } from 'react';
import { ApiClient, useNotice } from 'adminjs';
import { Box, Button, CheckBox, FormGroup, H3, Label, Text, TextArea } from '@adminjs/design-system';

import { ACTION_CONSEQUENCES, POST_CORRECTION_ACTIONS, POST_RESOLUTION_ACTIONS } from './moderation-action-messages.js';

const api = new ApiClient();

export default function ModerationAction({ action, resource, record }) {
  const addNotice = useNotice();
  const [reason, setReason] = useState('');
  const [alsoRemovePosts, setAlsoRemovePosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const isBan = action.name === 'banUser';
  const isReviewWithNoAction = action.name === 'reviewWithNoAction';
  const resolution = POST_RESOLUTION_ACTIONS[action.name];
  const correction = POST_CORRECTION_ACTIONS[action.name];
  const isResolution = Boolean(resolution);
  const label =
    correction?.label ??
    resolution?.label ??
    {
      banUser: 'Ban User',
      flagPost: 'Flag Post',
      removePost: 'Remove Post',
      reviewWithNoAction: 'Review with No Action',
    }[action.name] ??
    action.label;
  const consequence = correction?.consequence ?? resolution?.consequence ?? ACTION_CONSEQUENCES[action.name];
  const variant = correction || isResolution || isReviewWithNoAction ? 'primary' : 'danger';

  const submit = async () => {
    setLoading(true);
    try {
      const response = await api.recordAction({
        resourceId: resource.id,
        recordId: record.id,
        actionName: action.name,
        data: { reason, alsoRemovePosts },
      });
      if (response.data.notice) addNotice(response.data.notice);
      if (response.data.notice?.type === 'success') {
        window.location.assign(
          `/admin/resources/${encodeURIComponent(resource.id)}/records/${encodeURIComponent(record.id)}/show`,
        );
      }
    } catch {
      addNotice({ message: 'The moderation action failed.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box variant="white" p="xl">
      <H3 mb="sm">{label}</H3>
      {consequence ? (
        <Text id="moderation-action-consequence" mb="lg" color="grey60">
          {consequence}
        </Text>
      ) : null}
      <FormGroup>
        <Label htmlFor="moderation-reason">Reason</Label>
        <TextArea
          id="moderation-reason"
          value={reason}
          maxLength={500}
          aria-describedby={consequence ? 'moderation-action-consequence' : undefined}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Explain why this action is required"
        />
      </FormGroup>
      {isBan ? (
        <FormGroup>
          <CheckBox
            id="also-remove-posts"
            checked={alsoRemovePosts}
            onChange={(event) => setAlsoRemovePosts(event.target.checked)}
          />
          <Label inline htmlFor="also-remove-posts">
            Also remove this user's active posts
          </Label>
        </FormGroup>
      ) : null}
      <Button
        variant={variant}
        data-testid="moderation-action-submit"
        data-variant={variant}
        aria-busy={loading}
        disabled={loading || (!isReviewWithNoAction && !reason.trim())}
        onClick={() => void submit()}
      >
        {loading ? 'Applying…' : label}
      </Button>
      <Text role="status" aria-live="polite" ml="default">
        {loading ? 'Recording the action…' : ''}
      </Text>
    </Box>
  );
}
