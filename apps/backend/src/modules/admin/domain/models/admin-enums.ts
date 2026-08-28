/**
 * BC05: Admin & Analytics — Audit Action Constants
 *
 * Centralised here so every consumer (SystemConfigService, AdminUsersController)
 * references the same literal string — no magic strings scattered across files.
 */
export const AUDIT_ACTIONS = {
  USER_SUSPEND:                 'user.suspend',
  USER_UNSUSPEND:               'user.unsuspend',
  USER_ROLE_ASSIGN:             'user.role_assign',
  SYSTEM_CONFIG_UPDATE:         'system_config.update',
  /** Emitted when an operation is blocked because it would remove the last active SuperAdmin. */
  LAST_SUPERADMIN_PROTECTED:    'user.last_superadmin_protected',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
