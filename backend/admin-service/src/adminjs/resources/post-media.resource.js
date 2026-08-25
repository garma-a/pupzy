import { noDeleteActions } from "./resource-helpers.js";

export function buildPostMediaResource(db) {
  return {
    resource: db.table("post_media"),
    options: {
      navigation: { name: "Post Details", icon: "Image" },
      properties: {
        cloudflare_storage_key: { isDisabled: true },
        public_url: { isDisabled: true },
      },
      actions: { ...noDeleteActions, new: { isAccessible: false } },
    },
  };
}
