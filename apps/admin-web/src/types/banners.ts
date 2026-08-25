import type { components } from '@qingxu/contracts';

export type BannerItem = components['schemas']['BannerView'];
export type BannerStatus = BannerItem['status'];
export type BannerTargetType = BannerItem['target_type'];
export type BannerStatusAction = components['schemas']['BannerStatusAction']['action'];

export type BannerEditorTarget =
  | { targetType: 'NONE' }
  | { targetType: 'PRODUCT' | 'CATEGORY'; targetId: string }
  | { targetType: 'URL'; targetUrl: string };

export interface BannerEditorInput {
  title: string;
  fileId: string;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  target: BannerEditorTarget;
}

export interface BannerListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: BannerStatus;
}

export interface BannerListResult {
  items: BannerItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface UploadedBannerAsset {
  fileId: string;
  publicUrl: string | null;
}
