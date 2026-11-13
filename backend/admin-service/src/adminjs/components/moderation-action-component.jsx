import React, { useState } from 'react';
import { ApiClient, ViewHelpers, useNotice } from 'adminjs';
import { useNavigate } from 'react-router';
import { Box, Button, CheckBox, FormGroup, H3, Label, Text, TextArea } from '@adminjs/design-system';

import {
  ACTION_CONSEQUENCES,
  ACTION_LABELS,
  CONFIRM_ONLY_ACTIONS,
  POST_CORRECTION_ACTIONS,
  POST_RESOLUTION_ACTIONS,
} from './moderation-action-messages.js';
import { adminRootPath, safeReturnPath } from './list-return.js';

const api = new ApiClient();
const helpers = new ViewHelpers();

export default function ModerationAction({ action, resource, record }) {
  const addNotice = useNotice();
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  const [alsoRemovePosts, setAlsoRemovePosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const isBan = action.name === 'banUser';
  const isReviewWithNoAction = action.name === 'reviewWithNoAction';
  const resolution = POST_RESOLUTION_ACTIONS[action.name];
  const correction = POST_CORRECTION_ACTIONS[action.name];
  const confirmOnly = CONFIRM_ONLY_ACTIONS[action.name];
  const isResolution = Boolean(resolution);
  const label =
    correction?.label ?? resolution?.label ?? confirmOnly?.label ?? ACTION_LABELS[action.name] ?? action.label;
  const consequence =
    correction?.consequence ?? resolution?.consequence ?? confirmOnly?.consequence ?? ACTION_CONSEQUENCES[action.name];
  const reasonOptional = isReviewWithNoAction || Boolean(confirmOnly);
  const variant = correction || isResolution || isReviewWithNoAction || confirmOnly ? 'primary' : 'danger';

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
        // Client-side navigation keeps the notice that addNotice just queued.
        const returnTo = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'), adminRootPath());
        navigate(
          returnTo ?? helpers.recordActionUrl({ resourceId: resource.id, recordId: record.id, actionName: 'show' }),
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
          placeholder={reasonOptional ? 'Optional note for the audit log' : 'Explain why this action is required'}
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
        disabled={loading || (!reasonOptional && !reason.trim())}
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
