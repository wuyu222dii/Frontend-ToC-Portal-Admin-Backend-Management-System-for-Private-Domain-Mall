import type { components } from '@qingxu/contracts';

export type CatalogKind = 'brand' | 'category';
export type MasterDataStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type MasterDataAction = 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE';

export type BrandView = components['schemas']['BrandView'];
export type CategoryView = components['schemas']['CategoryView'];
export type HighRiskPreview = components['schemas']['HighRiskPreviewResponse']['data'];

export interface MasterDataItem {
  id: string;
  kind: CatalogKind;
  name: string;
  description: string | null;
  assetFileId: string | null;
  assetUrl: string | null;
  sortOrder: number;
  status: MasterDataStatus;
  version: number;
}

export interface CatalogListQuery {
  page: number;
  pageSize: number;
  keyword: string;
  status: MasterDataStatus | '';
  signal?: AbortSignal | undefined;
}

export interface CatalogListResult {
  items: MasterDataItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface CatalogEditorInput {
  name: string;
  description: string | null;
  assetFileId: string | null;
  sortOrder: number;
}

export interface UploadedCatalogAsset {
  fileId: string;
  publicUrl: string | null;
}
