export function isSuperAdmin(context) {
  return context.currentAdmin?.role === 'SUPER_ADMIN';
}

export function isAnyAdmin(context) {
  return context.currentAdmin?.role === 'ADMIN' || context.currentAdmin?.role === 'SUPER_ADMIN';
}
