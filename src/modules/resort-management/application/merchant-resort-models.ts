import type { MerchantResortStatus } from '../domain/merchant-resort.js';

export interface MerchantResortInput {
  name?: unknown;
  province?: unknown;
  city?: unknown;
  district?: unknown;
  address?: unknown;
  longitude?: unknown;
  latitude?: unknown;
  coverAssetId?: unknown;
  galleryAssetIds?: unknown;
  fitTagValues?: unknown;
  price?: unknown;
  openStatus?: unknown;
  snowCondition?: unknown;
  openingHours?: unknown;
  trailSummary?: unknown;
  facilitySummary?: unknown;
  officialUrl?: unknown;
  description?: unknown;
  customFields?: unknown;
}

export interface MerchantResortAuditContext {
  traceId: string;
  clientIp: string | null;
  userAgent: string | null;
}

export interface MerchantResortValues {
  name: string;
  province?: string | null;
  city?: string | null;
  district?: string | null;
  address?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  coverAssetId: string | null;
  price: number;
  openStatus: string;
  snowCondition: string;
  openingHours?: string | null;
  trailSummary?: string | null;
  facilitySummary?: string | null;
  officialUrl?: string | null;
  description: string;
  customFields: Record<string, unknown>;
}

export interface MerchantResortRecord {
  resortId: number;
  merchantId: number | null;
  name: string;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  longitude: string | null;
  latitude: string | null;
  coverAssetId: string | null;
  coverStorageKey: string | null;
  gallery: { assetId: string; sortOrder: number; storageKey: string }[];
  fitTags: string[];
  rating: string | null;
  ratingCount: number;
  price: number;
  openStatus: string;
  snowCondition: string;
  snowConditionUpdatedAt: Date | null;
  openingHours: string | null;
  trailSummary: string | null;
  facilitySummary: string | null;
  officialUrl: string | null;
  description: string;
  customFields: unknown;
  status: MerchantResortStatus;
  updatedAt: Date;
}

export interface ResortRelations {
  coverAssetId?: string | null;
  galleryAssetIds?: string[];
  fitTagValues?: string[];
}

export interface MerchantResortAuditChange {
  actionKey: string;
  resortId: number;
  before?: Record<string, unknown>;
  after: Record<string, unknown>;
  changedFields?: string[];
}
