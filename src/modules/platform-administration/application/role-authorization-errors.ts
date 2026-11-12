export class RoleAuthorizationNotFoundError extends Error {
  constructor() {
    super('Role not found');
    this.name = 'RoleAuthorizationNotFoundError';
  }
}

export class ProtectedSystemRoleError extends Error {
  constructor() {
    super('The system administrator role is protected');
    this.name = 'ProtectedSystemRoleError';
  }
}

export class InvalidRoleAuthorizationReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRoleAuthorizationReferenceError';
  }
}

export class RoleAuthorizationActorUnavailableError extends Error {
  constructor() {
    super('The authorization actor is unavailable');
    this.name = 'RoleAuthorizationActorUnavailableError';
  }
}

export class RoleAuthorizationAdministratorRequiredError extends Error {
  constructor() {
    super('An active system_admin is required to replace role authorization');
    this.name = 'RoleAuthorizationAdministratorRequiredError';
  }
}
