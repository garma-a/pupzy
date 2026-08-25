import { toAvailableValues } from "../enums.js";

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
    for (const propertyName of propertyNames)
      delete record.params[propertyName];
    for (const populatedRecord of Object.values(record.populated ?? {})) {
      strip(populatedRecord);
    }
  };
  strip(response.record);
  for (const record of response.records ?? []) strip(record);
  return response;
}

export function buildReadOnlyResource(
  db,
  table,
  navigation,
  properties = {},
  extra = {},
) {
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

const MUTATING_ACTIONS = ["new", "edit", "delete", "bulkDelete"];

export function attachCacheInvalidation(resourceDef, cache) {
  if (!cache) return resourceDef;
  const options = { ...(resourceDef.options ?? {}) };
  const actions = { ...(options.actions ?? {}) };

  const invalidatorHook = async (response) => {
    if (response?.notice?.type === "success") {
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

