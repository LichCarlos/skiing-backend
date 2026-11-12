import { ManageMerchantProfiles } from './application/manage-merchant-profiles.js';
import { MERCHANT_PROFILE_REPOSITORY } from './application/ports/merchant-profile-repository.js';
import { PrismaMerchantProfileRepository } from './infrastructure/prisma-merchant-profile.repository.js';
import { MerchantProfilesController } from './presentation/http/merchant-profiles.controller.js';
import { Module } from '@nestjs/common';
import { CheckLoginAttempt } from './application/check-login-attempt.js';
import { LOGIN_ATTEMPT_STORE } from './application/ports/login-attempt-store.js';
import {
  LoginBucketKeys,
  createLoginBucketKeysFromEnvironment,
} from './infrastructure/login-bucket-keys.js';
import { PrismaLoginAttemptStore } from './infrastructure/prisma-login-attempt.store.js';
import { LoginLimitRetentionWorker } from './infrastructure/login-limit-retention.worker.js';
import { AdminPasswordController } from './presentation/http/admin-password.controller.js';
import { ResetManagedPassword } from './application/reset-managed-password.js';
import { ADMIN_PASSWORD_RESET_REPOSITORY } from './application/ports/admin-password-reset-repository.js';
import { PrismaAdminPasswordResetRepository } from './infrastructure/prisma-admin-password-reset.repository.js';
import { AssetsModule } from '../assets/assets.module.js';
import { UpdateOwnProfile } from './application/update-own-profile.js';
import { USER_PROFILE_REPOSITORY } from './application/ports/user-profile-repository.js';
import { PrismaUserProfileRepository } from './infrastructure/prisma-user-profile.repository.js';
import { ListAuthorizationResources } from './application/list-authorization-resources.js';
import { AuthorizationResourcesController } from './presentation/http/authorization-resources.controller.js';
import { APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { PASSWORD_HASHER } from './application/ports/password-hasher.js';
import { AUTHORIZATION_PRINCIPAL_READER } from './application/ports/authorization-principal-reader.js';
import { USER_REGISTRATION_REPOSITORY } from './application/ports/user-registration-repository.js';
import { RegisterUser } from './application/register-user.js';
import { ResolveAuthorizationPrincipal } from './application/resolve-authorization-principal.js';
import { PrismaUserRegistrationRepository } from './infrastructure/prisma-user-registration.repository.js';
import { BcryptPasswordHasher } from './infrastructure/bcrypt-password-hasher.js';
import { PrismaAuthorizationPrincipalReader } from './infrastructure/prisma-authorization-principal-reader.js';
import { GetPermissionTree } from './application/get-permission-tree.js';
import { PERMISSION_TREE_READER } from './application/ports/permission-tree-reader.js';
import { PrismaPermissionTreeReader } from './infrastructure/prisma-permission-tree.reader.js';
import { AuthorizationGuard } from './presentation/http/authorization.guard.js';
import { PermissionTreeController } from './presentation/http/permission-tree.controller.js';
import { AuthController } from './presentation/http/auth.controller.js';
import { AUTHENTICATION_REPOSITORY } from './application/ports/authentication-repository.js';
import { AUTH_SESSION_REPOSITORY } from './application/ports/auth-session-repository.js';
import { AUTH_TOKEN_SERVICE } from './application/ports/auth-token-service.js';
import { PrismaAuthenticationRepository } from './infrastructure/prisma-authentication.repository.js';
import { createAuthTokenServiceFromEnvironment } from './infrastructure/hmac-auth-token.service.js';
import { LoginUser } from './application/login-user.js';
import { RefreshAuthSession } from './application/refresh-auth-session.js';
import { LogoutAuthSession } from './application/logout-auth-session.js';
import { GetCurrentUser } from './application/get-current-user.js';
import { AccessTokenGuard } from './presentation/http/access-token.guard.js';
import { WebCsrfGuard } from './presentation/http/web-csrf.guard.js';
import { MANAGED_USER_REPOSITORY } from './application/ports/managed-user-repository.js';
import { ManageUsers } from './application/manage-users.js';
import { PrismaManagedUserRepository } from './infrastructure/prisma-managed-user.repository.js';
import { ManagedUsersController } from './presentation/http/managed-users.controller.js';
import { SELF_PASSWORD_CHANGE_REPOSITORY } from './application/ports/self-password-change-repository.js';
import { ChangeOwnPassword } from './application/change-own-password.js';
import { PrismaSelfPasswordChangeRepository } from './infrastructure/prisma-self-password-change.repository.js';
import { AccountController } from './presentation/http/account.controller.js';
import { PermissionCatalogController } from './presentation/http/permission-catalog.controller.js';
import { ManagePermissionCatalog } from './application/manage-permission-catalog.js';
import { PERMISSION_CATALOG_REPOSITORY } from './application/ports/permission-catalog-repository.js';
import { PrismaPermissionCatalogRepository } from './infrastructure/prisma-permission-catalog.repository.js';

@Module({
  imports: [DatabaseModule, AssetsModule],
  controllers: [
    MerchantProfilesController,
    AdminPasswordController,
    AuthorizationResourcesController,
    PermissionTreeController,
    AuthController,
    ManagedUsersController,
    AccountController,
    PermissionCatalogController,
  ],
  providers: [
    ManageMerchantProfiles,
    {
      provide: MERCHANT_PROFILE_REPOSITORY,
      useClass: PrismaMerchantProfileRepository,
    },
    CheckLoginAttempt,
    {
      provide: LoginBucketKeys,
      useFactory: createLoginBucketKeysFromEnvironment,
    },
    PrismaLoginAttemptStore,
    { provide: LOGIN_ATTEMPT_STORE, useExisting: PrismaLoginAttemptStore },
    LoginLimitRetentionWorker,
    ResetManagedPassword,
    PrismaAdminPasswordResetRepository,
    {
      provide: ADMIN_PASSWORD_RESET_REPOSITORY,
      useExisting: PrismaAdminPasswordResetRepository,
    },
    UpdateOwnProfile,
    PrismaUserProfileRepository,
    {
      provide: USER_PROFILE_REPOSITORY,
      useExisting: PrismaUserProfileRepository,
    },
    ListAuthorizationResources,
    BcryptPasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: BcryptPasswordHasher },
    PrismaUserRegistrationRepository,
    {
      provide: USER_REGISTRATION_REPOSITORY,
      useExisting: PrismaUserRegistrationRepository,
    },
    RegisterUser,
    PrismaAuthorizationPrincipalReader,
    {
      provide: AUTHORIZATION_PRINCIPAL_READER,
      useExisting: PrismaAuthorizationPrincipalReader,
    },
    ResolveAuthorizationPrincipal,
    PrismaPermissionTreeReader,
    {
      provide: PERMISSION_TREE_READER,
      useExisting: PrismaPermissionTreeReader,
    },
    GetPermissionTree,
    PrismaAuthenticationRepository,
    {
      provide: AUTHENTICATION_REPOSITORY,
      useExisting: PrismaAuthenticationRepository,
    },
    {
      provide: AUTH_SESSION_REPOSITORY,
      useExisting: PrismaAuthenticationRepository,
    },
    {
      provide: AUTH_TOKEN_SERVICE,
      useFactory: createAuthTokenServiceFromEnvironment,
    },
    GetCurrentUser,
    LoginUser,
    RefreshAuthSession,
    LogoutAuthSession,
    PrismaManagedUserRepository,
    {
      provide: MANAGED_USER_REPOSITORY,
      useExisting: PrismaManagedUserRepository,
    },
    ManageUsers,
    PrismaSelfPasswordChangeRepository,
    {
      provide: SELF_PASSWORD_CHANGE_REPOSITORY,
      useExisting: PrismaSelfPasswordChangeRepository,
    },
    ChangeOwnPassword,
    ManagePermissionCatalog,
    PrismaPermissionCatalogRepository,
    {
      provide: PERMISSION_CATALOG_REPOSITORY,
      useExisting: PrismaPermissionCatalogRepository,
    },
    { provide: APP_GUARD, useClass: WebCsrfGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
  exports: [ResolveAuthorizationPrincipal, AUTH_SESSION_REPOSITORY],
})
export class IdentityAccessModule {}
