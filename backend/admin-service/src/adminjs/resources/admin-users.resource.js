import bcrypt from "bcryptjs";
import { ENUMS } from "../enums.js";
import { isSuperAdmin } from "../rbac.js";
import { enumProperty, stripRecordParams } from "./resource-helpers.js";

export async function hashAdminPassword(request) {
  if (request.method !== "post") return request;
  const password = String(request.payload?.password_hash ?? "");
  if (password.trim()) {
    request.payload.password_hash = await bcrypt.hash(password, 12);
  } else {
    delete request.payload.password_hash;
  }
  return request;
}

const superAdminOnly = { isAccessible: isSuperAdmin };
const stripPasswordHash = (response) =>
  stripRecordParams(response, ["password_hash"]);

export function buildAdminUsersResource(db) {
  return {
    resource: db.table("admin_users"),
    options: {
      navigation: { name: "Admin Management", icon: "Lock" },
      properties: {
        id: { isTitle: true, isDisabled: true },
        role: enumProperty(ENUMS.adminRole),
        password_hash: {
          label: "New Password",
          type: "password",
          isVisible: { list: false, filter: false, show: false, edit: true },
        },
        last_login_at: { isDisabled: true },
        created_at: { isDisabled: true },
        updated_at: { isDisabled: true },
      },
      actions: {
        list: { isAccessible: isSuperAdmin, after: stripPasswordHash },
        search: { isAccessible: isSuperAdmin, after: stripPasswordHash },
        show: { isAccessible: isSuperAdmin, after: stripPasswordHash },
        new: {
          isAccessible: isSuperAdmin,
          before: hashAdminPassword,
          after: stripPasswordHash,
        },
        edit: {
          isAccessible: isSuperAdmin,
          before: hashAdminPassword,
          after: stripPasswordHash,
        },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
