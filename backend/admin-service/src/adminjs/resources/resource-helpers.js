import { toAvailableValues } from '../enums.js';

export const noDeleteActions = {
  delete: { isAccessible: false },
  bulkDelete: { isAccessible: false },
};

export const readOnlyActions = {
  new: { isAccessible: false },
  edit: { isAccessible: false },
  delete: { isAccessible: false },
  bulkDelete: { isAccessible: false },
};

export function enumProperty(values, extra = {}) {
  return { availableValues: toAvailableValues(values), ...extra };
}

export function stripRecordParams(response, propertyNames) {
  const strip = (record) => {
    if (!record?.params) return;
    for (const propertyName of propertyNames) delete record.params[propertyName];
    for (const populatedRecord of Object.values(record.populated ?? {})) {
      strip(populatedRecord);
    }
  };
  strip(response.record);
  for (const record of response.records ?? []) strip(record);
  return response;
}

export const stripPopulatedPasswordHashes = (response) => stripRecordParams(response, ['password_hash']);

export function attachShortUuid(properties, fieldNames, components, locations = ['list', 'show']) {
  if (!components?.ShortUuid) return;
  for (const field of fieldNames) {
    const existing = properties[field] || {};
    const existingComponents = existing.components || {};
    const newComponents = { ...existingComponents };
    if (locations.includes('list')) newComponents.list = components.ShortUuid;
    if (locations.includes('show')) newComponents.show = components.ShortUuid;
    properties[field] = {
      ...existing,
      components: newComponents,
    };
  }
}

/**
 * Declares the read-only "Status" column of a report resource (see
 * `reportStatusProperties`). Not sortable or filterable: it has no column.
 */
export function reportStatusProperty(components) {
  return {
    isSortable: false,
    isDisabled: true,
    isVisible: { list: true, show: true, edit: false, filter: false },
    ...(components?.StatusBadge ? { components: { list: components.StatusBadge, show: components.StatusBadge } } : {}),
  };
}

/**
 * Gives foreign-key columns the `ReferenceLink` component: the referenced
 * record's readable name, linked to its page. `ShortUuid` stays for a record's
 * own `id`.
 */
export function attachReferenceLink(properties, fieldNames, components, locations = ['list', 'show']) {
  if (!components?.ReferenceLink) return;
  for (const field of fieldNames) {
    const existing = properties[field] || {};
    const newComponents = { ...(existing.components || {}) };
    if (locations.includes('list')) newComponents.list = components.ReferenceLink;
    if (locations.includes('show')) newComponents.show = components.ReferenceLink;
    properties[field] = { ...existing, components: newComponents };
  }
}

export function buildReadOnlyResource(db, table, navigation, properties = {}, extra = {}) {
  const { actions = {}, ...otherOptions } = extra;

  return {
    resource: db.table(table),
    options: {
      navigation,
      properties,
      actions: { ...readOnlyActions, ...actions },
      ...otherOptions,
    },
  };
}

const MUTATING_ACTIONS = ['new', 'edit', 'delete', 'bulkDelete'];

export function attachCacheInvalidation(resourceDef, cache) {
  if (!cache) return resourceDef;
  const options = { ...(resourceDef.options ?? {}) };
  const actions = { ...(options.actions ?? {}) };

  const invalidatorHook = async (response) => {
    if (response?.notice?.type === 'success') {
      cache.invalidate();
    }
    return response;
  };

  for (const actionName of MUTATING_ACTIONS) {
    const existingAction = actions[actionName];
    if (existingAction && existingAction.isAccessible === false) {
      continue;
    }

    if (!existingAction) {
      actions[actionName] = { after: invalidatorHook };
    } else {
      const existingAfter = existingAction.after;
      let after;
      if (!existingAfter) {
        after = invalidatorHook;
      } else if (Array.isArray(existingAfter)) {
        after = [...existingAfter, invalidatorHook];
      } else {
        after = [existingAfter, invalidatorHook];
      }
      actions[actionName] = { ...existingAction, after };
    }
  }

  return {
    ...resourceDef,
    options: {
      ...options,
      actions,
    },
  };
}

/**
 * Columns of a referenced record that a list or show response may carry.
 * AdminJS populates a whole row, which for a User includes `phone_number` and
 * `last_known_location`; a reference only ever needs a name, an email and a
 * picture. Anything not listed is removed. Other tables only lose
 * `password_hash`.
 */
const POPULATED_ALLOW_LISTS = Object.freeze({
  users: [
    'id',
    'email',
    'full_name',
    'full_name_arabic',
    'profile_picture_url',
    'is_verified',
    'is_banned',
    'home_city_id',
  ],
  admin_users: ['id', 'email', 'full_name', 'role', 'is_active'],
});

function sanitizeRecordPopulated(record, referenceByPath) {
  for (const [path, populatedRecord] of Object.entries(record?.populated ?? {})) {
    if (!populatedRecord?.params) continue;
    const resourceId = populatedRecord.resourceId ?? referenceByPath.get(path);
    const allowed = POPULATED_ALLOW_LISTS[resourceId];
    if (allowed) {
      for (const column of Object.keys(populatedRecord.params)) {
        if (!allowed.includes(column)) delete populatedRecord.params[column];
      }
    } else {
      delete populatedRecord.params.password_hash;
    }
    sanitizeRecordPopulated(populatedRecord, new Map());
  }
}

/** `after` hook: strips private columns from every `record.populated.*` entry. */
export function sanitizePopulatedRecords(response, _request, context) {
  const referenceByPath = new Map();
  for (const property of context?.resource?.properties?.() ?? []) {
    const reference = property.reference?.();
    if (reference) referenceByPath.set(property.name(), reference);
  }
  for (const record of response?.records ?? (response?.record ? [response.record] : [])) {
    sanitizeRecordPopulated(record, referenceByPath);
  }
  return response;
}

const POPULATING_ACTIONS = ['list', 'show', 'search', 'edit', 'new'];

/** Applies `sanitizePopulatedRecords` last to every action that returns populated records. */
export function attachPopulatedSanitizer(resourceDef) {
  const options = { ...(resourceDef.options ?? {}) };
  const actions = { ...(options.actions ?? {}) };
  for (const actionName of POPULATING_ACTIONS) {
    const existing = actions[actionName];
    if (existing?.isAccessible === false) continue;
    const after = existing?.after ? [existing.after].flat() : [];
    actions[actionName] = { ...existing, after: [...after, sanitizePopulatedRecords] };
  }
  return { ...resourceDef, options: { ...options, actions } };
}
