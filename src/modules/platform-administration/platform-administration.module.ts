import { QueryBusinessData } from './application/query-business-data.js';
import { BUSINESS_QUERY_READER } from './application/ports/business-query-reader.js';
import { PrismaBusinessQueryReader } from './infrastructure/prisma-business-query.reader.js';
import { BusinessQueryController } from './presentation/http/business-query.controller.js';
import { Module } from '@nestjs/common';
import { GetDashboardSummary } from './application/get-dashboard-summary.js';
import { DASHBOARD_READER } from './application/ports/dashboard-reader.js';
import { PrismaDashboardReader } from './infrastructure/prisma-dashboard.reader.js';
import { DashboardController } from './presentation/http/dashboard.controller.js';
import { ManageSystemConfig } from './application/manage-system-config.js';
import { CONTACT_EMAIL_VALIDATOR } from './application/ports/contact-email-validator.js';
import { ContactEmailValidatorAdapter } from './infrastructure/contact-email-validator.adapter.js';
import { SYSTEM_CONFIG_REPOSITORY } from './application/ports/system-config-repository.js';
import { PrismaSystemConfigRepository } from './infrastructure/prisma-system-config.repository.js';
import {
  PublicSiteConfigController,
  SystemConfigController,
} from './presentation/http/system-config.controller.js';
import { ListOperationLogs } from './application/list-operation-logs.js';
import { OPERATION_LOG_READER } from './application/ports/operation-log-reader.js';
import { PrismaOperationLogReader } from './infrastructure/prisma-operation-log.reader.js';
import { OperationLogsController } from './presentation/http/operation-logs.controller.js';
import { DatabaseModule } from '../../shared/persistence/database.module.js';
import { CUSTOM_FIELD_REPOSITORY } from './application/ports/custom-field-repository.js';
import { ManageCustomFields } from './application/manage-custom-fields.js';
import { PrismaCustomFieldRepository } from './infrastructure/prisma-custom-field.repository.js';
import { ROLE_AUTHORIZATION_REPOSITORY } from './application/ports/role-authorization-repository.js';
import { ManageRoleAuthorization } from './application/manage-role-authorization.js';
import { PrismaRoleAuthorizationRepository } from './infrastructure/prisma-role-authorization.repository.js';
import { MANAGED_ROLE_REPOSITORY } from './application/ports/managed-role-repository.js';
import { PrismaManagedRoleRepository } from './infrastructure/prisma-managed-role.repository.js';
import { MANAGED_DICTIONARY_REPOSITORY } from './application/ports/managed-dictionary-repository.js';
import { ManageDictionaries } from './application/manage-dictionaries.js';
import { PrismaManagedDictionaryRepository } from './infrastructure/prisma-managed-dictionary.repository.js';
import { ManageRoles } from './application/manage-roles.js';
import { RoleAuthorizationController } from './presentation/http/role-authorization.controller.js';
import { ManagedRolesController } from './presentation/http/managed-roles.controller.js';
import { ManagedDictionariesController } from './presentation/http/managed-dictionaries.controller.js';
import {
  CustomFieldGroupsController,
  CustomFieldsController,
} from './presentation/http/custom-fields.controller.js';

@Module({
  imports: [DatabaseModule],
  controllers: [
    BusinessQueryController,
    DashboardController,
    PublicSiteConfigController,
    SystemConfigController,
    OperationLogsController,
    CustomFieldsController,
    CustomFieldGroupsController,
    RoleAuthorizationController,
    ManagedRolesController,
    ManagedDictionariesController,
  ],
  providers: [
    QueryBusinessData,
    { provide: BUSINESS_QUERY_READER, useClass: PrismaBusinessQueryReader },
    GetDashboardSummary,
    PrismaDashboardReader,
    { provide: DASHBOARD_READER, useExisting: PrismaDashboardReader },
    ManageSystemConfig,
    ContactEmailValidatorAdapter,
    {
      provide: CONTACT_EMAIL_VALIDATOR,
      useExisting: ContactEmailValidatorAdapter,
    },
    PrismaSystemConfigRepository,
    {
      provide: SYSTEM_CONFIG_REPOSITORY,
      useExisting: PrismaSystemConfigRepository,
    },
    ListOperationLogs,
    PrismaOperationLogReader,
    { provide: OPERATION_LOG_READER, useExisting: PrismaOperationLogReader },
    ManageCustomFields,
    ManageRoleAuthorization,
    ManageRoles,
    ManageDictionaries,
    PrismaCustomFieldRepository,
    PrismaRoleAuthorizationRepository,
    PrismaManagedRoleRepository,
    PrismaManagedDictionaryRepository,
    {
      provide: CUSTOM_FIELD_REPOSITORY,
      useExisting: PrismaCustomFieldRepository,
    },
    {
      provide: ROLE_AUTHORIZATION_REPOSITORY,
      useExisting: PrismaRoleAuthorizationRepository,
    },
    {
      provide: MANAGED_ROLE_REPOSITORY,
      useExisting: PrismaManagedRoleRepository,
    },
    {
      provide: MANAGED_DICTIONARY_REPOSITORY,
      useExisting: PrismaManagedDictionaryRepository,
    },
  ],
  exports: [QueryBusinessData, BUSINESS_QUERY_READER, CUSTOM_FIELD_REPOSITORY],
})
export class PlatformAdministrationModule {}
