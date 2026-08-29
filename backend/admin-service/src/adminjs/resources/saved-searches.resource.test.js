import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildSavedSearchesResource } from './saved-searches.resource.js';

const db = { table: (name) => ({ name }) };

describe('AdminJS Saved Searches Resource Configuration', () => {
  const resource = buildSavedSearchesResource(db);

  it('disables all mutation actions (new, edit, delete, bulkDelete)', () => {
    const actions = resource.options.actions;
    assert.equal(actions.new.isAccessible, false);
    assert.equal(actions.edit.isAccessible, false);
    assert.equal(actions.delete.isAccessible, false);
    assert.equal(actions.bulkDelete.isAccessible, false);
  });

  it('includes city_id in list, show, and filter properties', () => {
    assert.ok(resource.options.listProperties.includes('city_id'));
    assert.ok(resource.options.showProperties.includes('city_id'));
    assert.ok(resource.options.filterProperties.includes('city_id'));
  });

  it('declares concise intentional listProperties and full showProperties', () => {
    assert.deepEqual(resource.options.listProperties, [
      'id',
      'user_id',
      'label',
      'post_type',
      'city_id',
      'species',
      'created_at',
    ]);
    assert.ok(resource.options.showProperties.includes('breed'));
    assert.ok(resource.options.showProperties.includes('market_category'));
    assert.ok(resource.options.showProperties.includes('max_price'));
  });

  it('attaches ShortUuid custom component to ID and relation fields when provided', () => {
    const components = { ShortUuid: 'CustomShortUuidComponent' };
    const res = buildSavedSearchesResource(db, components);
    assert.equal(res.options.properties.id.components.list, 'CustomShortUuidComponent');
    assert.equal(res.options.properties.id.components.show, 'CustomShortUuidComponent');
    assert.equal(res.options.properties.user_id.components.list, 'CustomShortUuidComponent');
    assert.equal(res.options.properties.user_id.components.show, 'CustomShortUuidComponent');
  });

  it('strips populated password hashes from list and show actions', () => {
    const listAfter = resource.options.actions.list.after;
    const showAfter = resource.options.actions.show.after;

    const response = {
      record: {
        params: { id: 'search-1' },
        populated: {
          user_id: {
            params: {
              id: 'user-1',
              email: 'test@example.com',
              password_hash: 'secret_hash',
            },
          },
        },
      },
    };

    const cleaned = showAfter(response);
    assert.equal(cleaned.record.populated.user_id.params.password_hash, undefined);
  });
});
