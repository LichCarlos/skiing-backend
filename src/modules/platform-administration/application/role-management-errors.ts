export class ManagedRoleNotFoundError extends Error {
  constructor() {
    super('Role not found');
    this.name = 'ManagedRoleNotFoundError';
  }
}

export class ProtectedManagedRoleError extends Error {
  constructor() {
    super('The system administrator role is protected');
    this.name = 'ProtectedManagedRoleError';
  }
}

export class RegistrationRoleRequiredError extends Error {
  constructor() {
    super('The registered-user role must remain active');
    this.name = 'RegistrationRoleRequiredError';
  }
}

export class ManagedRoleActorUnavailableError extends Error {
  constructor() {
    super('The role management actor is unavailable');
    this.name = 'ManagedRoleActorUnavailableError';
  }
}

export class ManagedRoleScopeAuthorizationError extends Error {
  constructor() {
    super('Only system_admin may configure the default role data scope');
    this.name = 'ManagedRoleScopeAuthorizationError';
  }
}
