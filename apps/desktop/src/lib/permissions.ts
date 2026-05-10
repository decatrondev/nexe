// Permission bit flags — must match backend (services/guilds)
export const Permissions = {
  ADMINISTRATOR:     1 << 0,
  MANAGE_GUILD:      1 << 1,
  MANAGE_CHANNELS:   1 << 2,
  MANAGE_ROLES:      1 << 3,
  KICK_MEMBERS:      1 << 8,
  BAN_MEMBERS:       1 << 9,
  TIMEOUT_MEMBERS:   1 << 10,
  VIEW_CHANNEL:      1 << 15,
  SEND_MESSAGES:     1 << 16,
  MANAGE_MESSAGES:   1 << 18,
} as const;

export function hasPermission(userPerms: number, perm: number): boolean {
  // Administrator bypasses all checks
  if (userPerms & Permissions.ADMINISTRATOR) return true;
  return (userPerms & perm) === perm;
}

/**
 * Compute effective permissions for a user based on their roles.
 * Combines all role permissions with bitwise OR.
 */
export function computePermissions(
  roleIds: string[],
  roles: { id: string; permissions: number; isDefault?: boolean }[],
): number {
  let perms = 0;
  for (const role of roles) {
    if (roleIds.includes(role.id) || role.isDefault) {
      perms |= role.permissions;
    }
  }
  return perms;
}
