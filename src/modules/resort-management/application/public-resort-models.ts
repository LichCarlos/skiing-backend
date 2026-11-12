import type { MerchantResortRecord } from './merchant-resort-models.js';

// Explicit public read projection: no merchant, lifecycle or owner credentials.
export interface PublicResortRecord extends Pick<
  MerchantResortRecord,
  | 'resortId'
  | 'name'
  | 'province'
  | 'city'
  | 'district'
  | 'address'
  | 'longitude'
  | 'latitude'
  | 'coverStorageKey'
  | 'rating'
  | 'ratingCount'
  | 'price'
  | 'openStatus'
  | 'snowCondition'
  | 'snowConditionUpdatedAt'
  | 'openingHours'
  | 'trailSummary'
  | 'facilitySummary'
  | 'officialUrl'
  | 'description'
  | 'customFields'
  | 'updatedAt'
> {
  fitTags: { value: string; label: string }[];
  galleryStorageKeys: string[];
  favoriteByMe: boolean;
  distanceMeters: number | null;
}
