import bcrypt from 'bcryptjs';
import { ValidationError } from 'adminjs';
import { ENUMS } from '../enums.js';
import { isSuperAdmin } from '../rbac.js';
import { enumProperty, stripRecordParams } from './resource-helpers.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function prepareAdminCredentials(request, context = {}) {
  if (request.method !== 'post') return request;
  const errors = {};

  if (request.payload?.email !== undefined) {
    const email = String(request.payload.email).trim().toLowerCase();
    if (email.length > 255 || !EMAIL_PATTERN.test(email)) {
      errors.email = { message: 'Enter a valid email address.' };
    } else {
      request.payload.email = email;
    }
  }

  const password = String(request.payload?.password_hash ?? '');
  if (password) {
    if (password.length < 12) {
      errors.password_hash = { message: 'Password must be at least 12 characters.' };
    } else if (Buffer.byteLength(password, 'utf8') > 72) {
      errors.password_hash = { message: 'Password must be at most 72 UTF-8 bytes.' };
    }
  } else if (context.action?.name === 'new') {
    errors.password_hash = { message: 'Password is required.' };
  }

  if (Object.keys(errors).length) throw new ValidationError(errors);

  if (password) {
    request.payload.password_hash = await bcrypt.hash(password, 12);
  } else {
    delete request.payload.password_hash;
  }
  return request;
}

const superAdminOnly = { isAccessible: isSuperAdmin };
const stripPasswordHash = (response) => stripRecordParams(response, ['password_hash']);

export function buildAdminUsersResource(db) {
  return {
    resource: db.table('admin_users'),
    options: {
      navigation: { name: 'Admin Management', icon: 'Lock' },
      properties: {
        id: { isTitle: true, isDisabled: true },
        role: enumProperty(ENUMS.adminRole),
        password_hash: {
          label: 'New Password',
          type: 'password',
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
          before: prepareAdminCredentials,
          after: stripPasswordHash,
        },
        edit: {
          isAccessible: isSuperAdmin,
          before: prepareAdminCredentials,
          after: stripPasswordHash,
        },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  };
}
