import React, { useState } from 'react';
import { ApiClient, useNotice } from 'adminjs';
import { Box, Button, CheckBox, FormGroup, H3, Label, TextArea } from '@adminjs/design-system';

const api = new ApiClient();

export default function ModerationAction({ action, resource, record }) {
  const addNotice = useNotice();
  const [reason, setReason] = useState('');
  const [alsoRemovePosts, setAlsoRemovePosts] = useState(false);
  const [loading, setLoading] = useState(false);
  const isBan = action.name === 'banUser';
  const label = { banUser: 'Ban User', flagPost: 'Flag Post', removePost: 'Remove Post' }[action.name] ?? action.label;

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
      <H3 mb="lg">{label}</H3>
      <FormGroup>
        <Label htmlFor="moderation-reason">Reason</Label>
        <TextArea
          id="moderation-reason"
          value={reason}
          maxLength={500}
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
      <Button variant="danger" disabled={loading || !reason.trim()} onClick={() => void submit()}>
        {loading ? 'Applying…' : label}
      </Button>
    </Box>
  );
}
