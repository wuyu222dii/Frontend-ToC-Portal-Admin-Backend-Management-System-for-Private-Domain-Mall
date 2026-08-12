-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AccountRole" AS ENUM ('SUPER_ADMIN', 'AGENT_ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DELETION_PENDING', 'ANONYMIZED');

-- CreateEnum
CREATE TYPE "SessionAssurance" AS ENUM ('WECHAT', 'PASSWORD', 'MFA');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ProductAuthorizationMode" AS ENUM ('ALL_ACTIVE_PRODUCTS', 'CUSTOM_WHITELIST');

-- CreateEnum
CREATE TYPE "InviteCodeStatus" AS ENUM ('ACTIVE', 'DISABLED', 'ROTATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PromotionTargetType" AS ENUM ('STOREFRONT', 'PRODUCT');

-- CreateEnum
CREATE TYPE "PromotionAssetStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AttributionCandidateStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "BindingEndReason" AS ENUM ('TRANSFERRED', 'DIRECTED', 'ACCOUNT_DELETED');

-- CreateEnum
CREATE TYPE "EntityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkuStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('PENDING', 'READY', 'REJECTED', 'DELETED');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('PRODUCT_IMAGE', 'BRAND_LOGO', 'CATEGORY_ICON', 'BANNER', 'AFTERSALE_EVIDENCE', 'WITHDRAWAL_PROOF', 'PROMOTION_QR');

-- CreateEnum
CREATE TYPE "BannerTargetType" AS ENUM ('NONE', 'PRODUCT', 'CATEGORY', 'URL');

-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryLedgerType" AS ENUM ('INITIAL', 'MANUAL_INCREASE', 'MANUAL_DECREASE', 'ORDER_PAID_DEDUCT', 'ORDER_RESERVE', 'ORDER_RELEASE', 'REFUND_RESTOCK', 'RETURN_RESTOCK', 'RETURN_DAMAGED', 'COMPENSATION');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('CART', 'BUY_NOW');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PROCESSING', 'PAID');

-- CreateEnum
CREATE TYPE "RefundProgressStatus" AS ENUM ('NONE', 'PARTIAL', 'FULL');

-- CreateEnum
CREATE TYPE "RefundProcessingStatus" AS ENUM ('IDLE', 'REFUNDING', 'FAILED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderCloseReason" AS ENUM ('USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT');

-- CreateEnum
CREATE TYPE "OrderCompletionReason" AS ENUM ('CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT');

-- CreateEnum
CREATE TYPE "PaymentResolution" AS ENUM ('NORMAL', 'LATE_SUCCESS_REFUND_PENDING', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED');

-- CreateEnum
CREATE TYPE "AttributionChannel" AS ENUM ('DIRECT', 'AGENT');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('WECHAT', 'MOCK');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATING', 'OPEN', 'CLOSE_PENDING', 'CLOSED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'SUCCEEDED', 'SUCCEEDED_LATE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CallbackStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('SHIPPED', 'IN_TRANSIT', 'DELIVERED');

-- CreateEnum
CREATE TYPE "RefundOriginType" AS ENUM ('AFTERSALE', 'LATE_PAYMENT', 'MANUAL_COMPENSATION');

-- CreateEnum
CREATE TYPE "AftersaleType" AS ENUM ('REFUND_ONLY', 'RETURN_REFUND', 'AMOUNT_COMPENSATION');

-- CreateEnum
CREATE TYPE "AftersaleStatus" AS ENUM ('PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT', 'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnInspectionStatus" AS ENUM ('PASS', 'ABNORMAL');

-- CreateEnum
CREATE TYPE "ReturnInspectionResolution" AS ENUM ('CONTINUE_REFUND', 'REJECT_AFTER_RETURN');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundAttemptStatus" AS ENUM ('INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CommissionRuleVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CommissionTargetType" AS ENUM ('PLATFORM', 'CATEGORY', 'SKU');

-- CreateEnum
CREATE TYPE "CommissionSourceType" AS ENUM ('PLATFORM', 'CATEGORY', 'SKU');

-- CreateEnum
CREATE TYPE "CommissionSnapshotState" AS ENUM ('NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE');

-- CreateEnum
CREATE TYPE "CommissionLedgerType" AS ENUM ('EXPECTED_CREATED', 'EXPECTED_REDUCED', 'EXPECTED_CANCELLED', 'AVAILABLE_CREDIT', 'REFUND_DEBIT', 'WITHDRAWAL_FREEZE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAID');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "ManualCompensationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReauthAction" AS ENUM ('PAYOUT_ACCOUNT_REVEAL');

-- CreateEnum
CREATE TYPE "MfaFactorStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MfaChallengePurpose" AS ENUM ('ENROLL', 'LOGIN', 'REAUTH', 'RECOVERY');

-- CreateEnum
CREATE TYPE "MfaChallengeStatus" AS ENUM ('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'LOCKED');

-- CreateEnum
CREATE TYPE "ReauthGrantStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('USER_AGREEMENT', 'PRIVACY_POLICY', 'PHONE_AUTHORIZATION');

-- CreateEnum
CREATE TYPE "AccountDeletionStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "ConfigVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OfflineRecoveryStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OfflineRecoveryDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "account" (
    "id" CHAR(26) NOT NULL,
    "role" "AccountRole" NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "login_name" VARCHAR(80),
    "password_hash" VARCHAR(255),
    "wechat_open_id" VARCHAR(128),
    "wechat_union_id" VARCHAR(128),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "access_jti" VARCHAR(80) NOT NULL,
    "refresh_token_hash" VARCHAR(128),
    "assurance" "SessionAssurance" NOT NULL,
    "restriction" VARCHAR(40) NOT NULL DEFAULT 'NONE',
    "mfa_factor_id" CHAR(26),
    "mfa_verified_at" TIMESTAMPTZ(3),
    "session_family" CHAR(26) NOT NULL,
    "rotation_counter" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_factor" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "secret_ciphertext" BYTEA NOT NULL,
    "secret_fingerprint" CHAR(64) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "status" "MfaFactorStatus" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMPTZ(3),
    "last_used_timestep" BIGINT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "totp_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "totp_recovery_code" (
    "id" CHAR(26) NOT NULL,
    "factor_id" CHAR(26) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "totp_recovery_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_challenge" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "session_id" CHAR(26),
    "factor_id" CHAR(26),
    "purpose" "MfaChallengePurpose" NOT NULL,
    "target_id" CHAR(26),
    "challenge_token_hash" CHAR(64) NOT NULL,
    "status" "MfaChallengeStatus" NOT NULL DEFAULT 'PENDING',
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_rate_limit" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "purpose" "MfaChallengePurpose" NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mfa_rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profile" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "nickname" VARCHAR(80),
    "avatar_url" VARCHAR(500),
    "city" VARCHAR(120),
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymized_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_phone_verification" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "consent_version" VARCHAR(80) NOT NULL,
    "verified_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_phone_verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_record" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "document_version" VARCHAR(80) NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL,
    "source_terminal" VARCHAR(30) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_request" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "status" "AccountDeletionStatus" NOT NULL DEFAULT 'SUBMITTED',
    "block_summary" JSONB,
    "rejection_reason" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "account_deletion_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_reauth_attempt" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "action" "ReauthAction" NOT NULL,
    "target_id" CHAR(26) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "failure_reason" VARCHAR(120),
    "attempted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_reauth_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_reauth_grant" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "session_id" CHAR(26) NOT NULL,
    "action" "ReauthAction" NOT NULL,
    "target_id" CHAR(26) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "status" "ReauthGrantStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_reauth_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_offline_recovery" (
    "id" CHAR(26) NOT NULL,
    "target_account_id" CHAR(26) NOT NULL,
    "requested_by_id" CHAR(26) NOT NULL,
    "target_account_version" INTEGER NOT NULL,
    "executed_by_id" CHAR(26),
    "status" "OfflineRecoveryStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "reason" VARCHAR(500) NOT NULL,
    "new_credential_fingerprint" CHAR(64),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "executed_at" TIMESTAMPTZ(3),
    "sessions_revoked_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_offline_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_offline_recovery_approval" (
    "id" CHAR(26) NOT NULL,
    "recovery_id" CHAR(26) NOT NULL,
    "approver_id" CHAR(26) NOT NULL,
    "decision" "OfflineRecoveryDecision" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_offline_recovery_approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_profile" (
    "id" CHAR(26) NOT NULL,
    "account_id" CHAR(26) NOT NULL,
    "agent_no" VARCHAR(32) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "contact_name" VARCHAR(80),
    "contact_phone_ciphertext" BYTEA,
    "contact_phone_last4" CHAR(4),
    "contact_phone_encryption_key_id" VARCHAR(80),
    "status" "AgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "product_authorization_mode" "ProductAuthorizationMode" NOT NULL DEFAULT 'ALL_ACTIVE_PRODUCTS',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_invite_code" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "code_ciphertext" BYTEA NOT NULL,
    "code_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "status" "InviteCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_invite_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_product_whitelist" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_product_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_asset" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "invite_code_id" CHAR(26) NOT NULL,
    "target_type" "PromotionTargetType" NOT NULL,
    "target_product_id" CHAR(26),
    "status" "PromotionAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorization_version" INTEGER NOT NULL DEFAULT 1,
    "public_url" VARCHAR(500) NOT NULL,
    "qr_file_id" CHAR(26),
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_candidate" (
    "id" CHAR(26) NOT NULL,
    "candidate_token_hash" CHAR(64),
    "customer_id" CHAR(26),
    "agent_id" CHAR(26) NOT NULL,
    "invite_code_id" CHAR(26) NOT NULL,
    "promotion_asset_id" CHAR(26) NOT NULL,
    "status" "AttributionCandidateStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "invalid_reason" VARCHAR(120),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attribution_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_agent_binding" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "BindingEndReason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_agent_binding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "binding_change_log" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "old_binding_id" CHAR(26),
    "new_binding_id" CHAR(26),
    "old_agent_id" CHAR(26),
    "new_agent_id" CHAR(26),
    "actor_account_id" CHAR(26) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "binding_change_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand" (
    "id" CHAR(26) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "logo_file_id" CHAR(26),
    "description" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" CHAR(26) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "icon_file_id" CHAR(26),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" CHAR(26) NOT NULL,
    "spu_code" VARCHAR(80) NOT NULL,
    "brand_id" CHAR(26) NOT NULL,
    "category_id" CHAR(26) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "subtitle" VARCHAR(300),
    "introduction" TEXT,
    "ingredients" TEXT,
    "usage_method" TEXT,
    "status" "EntityStatus" NOT NULL DEFAULT 'DRAFT',
    "is_hot" BOOLEAN NOT NULL DEFAULT false,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "sales_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sku" (
    "id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "spec_json" JSONB,
    "retail_price" DECIMAL(18,2) NOT NULL,
    "is_recommended" BOOLEAN NOT NULL DEFAULT false,
    "status" "SkuStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "sku_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_asset" (
    "id" CHAR(26) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "visibility" "FileVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "FileStatus" NOT NULL DEFAULT 'PENDING',
    "purpose" "FilePurpose" NOT NULL,
    "created_by_id" CHAR(26),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "file_asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_image" (
    "id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "file_id" CHAR(26) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "product_image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banner" (
    "id" CHAR(26) NOT NULL,
    "file_id" CHAR(26) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "target_type" "BannerTargetType" NOT NULL,
    "target_id" CHAR(26),
    "target_url" VARCHAR(500),
    "status" "EntityStatus" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "banner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_item" (
    "id" CHAR(26) NOT NULL,
    "cart_id" CHAR(26) NOT NULL,
    "sku_id" CHAR(26) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_address" (
    "id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "recipient_name" VARCHAR(80) NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "province" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "detail_ciphertext" BYTEA NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balance" (
    "id" CHAR(26) NOT NULL,
    "sku_id" CHAR(26) NOT NULL,
    "physical_qty" INTEGER NOT NULL DEFAULT 0,
    "locked_qty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_balance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservation" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_reservation_item" (
    "id" CHAR(26) NOT NULL,
    "reservation_id" CHAR(26) NOT NULL,
    "sku_id" CHAR(26) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_reservation_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_ledger" (
    "id" CHAR(26) NOT NULL,
    "sku_id" CHAR(26) NOT NULL,
    "ledger_type" "InventoryLedgerType" NOT NULL,
    "business_id" CHAR(26),
    "physical_change" INTEGER NOT NULL DEFAULT 0,
    "locked_change" INTEGER NOT NULL DEFAULT 0,
    "physical_after" INTEGER NOT NULL,
    "locked_after" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actor_account_id" CHAR(26),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_order" (
    "id" CHAR(26) NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "source" "OrderSource" NOT NULL,
    "order_status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "refund_progress_status" "RefundProgressStatus" NOT NULL DEFAULT 'NONE',
    "refund_processing_status" "RefundProcessingStatus" NOT NULL DEFAULT 'IDLE',
    "fulfillment_status" "FulfillmentStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "close_reason" "OrderCloseReason",
    "completion_reason" "OrderCompletionReason",
    "payment_resolution" "PaymentResolution" NOT NULL DEFAULT 'NORMAL',
    "final_channel" "AttributionChannel",
    "final_agent_id" CHAR(26),
    "goods_amount" DECIMAL(18,2) NOT NULL,
    "shipping_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "payable_amount" DECIMAL(18,2) NOT NULL,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pay_expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 minutes'),
    "paid_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "aftersale_expires_at" TIMESTAMPTZ(3),
    "business_rule_version_id" CHAR(26),
    "closed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "product_id" CHAR(26) NOT NULL,
    "category_id" CHAR(26) NOT NULL,
    "sku_id" CHAR(26) NOT NULL,
    "product_name_snapshot" VARCHAR(200) NOT NULL,
    "brand_name_snapshot" VARCHAR(120) NOT NULL,
    "category_name_snapshot" VARCHAR(120) NOT NULL,
    "sku_name_snapshot" VARCHAR(160) NOT NULL,
    "sku_code_snapshot" VARCHAR(80) NOT NULL,
    "unit_price" DECIMAL(18,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_paid_amount" DECIMAL(18,2) NOT NULL,
    "refunded_qty" INTEGER NOT NULL DEFAULT 0,
    "pre_shipment_refunded_qty" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aftersale_reserved_qty" INTEGER NOT NULL DEFAULT 0,
    "aftersale_reserved_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "shipped_qty" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_address_snapshot" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "recipient_name" VARCHAR(80) NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "province" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "detail_ciphertext" BYTEA NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_address_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_attribution_candidate" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "submit_channel" "AttributionChannel" NOT NULL,
    "candidate_agent_id" CHAR(26),
    "binding_id" CHAR(26),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "finalization_result" VARCHAR(80),
    "finalized_at" TIMESTAMPTZ(3),

    CONSTRAINT "order_attribution_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_attribution_snapshot" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "final_channel" "AttributionChannel" NOT NULL,
    "agent_id_snapshot" CHAR(26),
    "binding_id_snapshot" CHAR(26),
    "captured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_attribution_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_customer_privacy_projection" (
    "id" CHAR(26) NOT NULL,
    "attribution_snapshot_id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "customer_alias" VARCHAR(80) NOT NULL,
    "nickname_masked" VARCHAR(80),
    "phone_tail" CHAR(4),
    "city" VARCHAR(120),
    "anonymized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_customer_privacy_projection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intent" (
    "id" CHAR(26) NOT NULL,
    "intent_no" VARCHAR(32) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_intent_id" VARCHAR(128),
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATING',
    "amount" DECIMAL(18,2) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "create_requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(3),
    "close_requested_at" TIMESTAMPTZ(3),
    "close_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "reconciliation_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_reconcile_at" TIMESTAMPTZ(3),
    "last_reconciled_at" TIMESTAMPTZ(3),
    "provider_state" VARCHAR(80),
    "last_error_code" VARCHAR(120),
    "closed_at" TIMESTAMPTZ(3),
    "succeeded_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_intent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempt" (
    "id" CHAR(26) NOT NULL,
    "payment_intent_id" CHAR(26) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_transaction_id" VARCHAR(128),
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "amount" DECIMAL(18,2) NOT NULL,
    "provider_payload" JSONB,
    "failure_code" VARCHAR(80),
    "initiated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "callback_inbox" (
    "id" CHAR(26) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "event_type" VARCHAR(80) NOT NULL,
    "provider_event_id" VARCHAR(128) NOT NULL,
    "raw_body" BYTEA NOT NULL,
    "headers" JSONB NOT NULL,
    "payload" JSONB,
    "signature_valid" BOOLEAN NOT NULL,
    "signature_timestamp" VARCHAR(40),
    "signature_nonce" VARCHAR(80),
    "provider_serial_no" VARCHAR(128),
    "verified_at" TIMESTAMPTZ(3),
    "status" "CallbackStatus" NOT NULL DEFAULT 'RECEIVED',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),
    "error_message" VARCHAR(500),

    CONSTRAINT "callback_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment" (
    "id" CHAR(26) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'SHIPPED',
    "carrier_code" VARCHAR(40) NOT NULL,
    "carrier_name" VARCHAR(80) NOT NULL,
    "tracking_no" VARCHAR(120) NOT NULL,
    "shipped_at" TIMESTAMPTZ(3) NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_item" (
    "id" CHAR(26) NOT NULL,
    "shipment_id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logistics_event" (
    "id" CHAR(26) NOT NULL,
    "shipment_id" CHAR(26) NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "status_code" VARCHAR(40),
    "carrier_code" VARCHAR(40),
    "carrier_name" VARCHAR(80),
    "tracking_no" VARCHAR(120),
    "description" VARCHAR(300) NOT NULL,
    "reason" VARCHAR(500),
    "location" VARCHAR(160),
    "source" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "event_key" VARCHAR(80) NOT NULL,
    "actor_account_id" CHAR(26),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logistics_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aftersale" (
    "id" CHAR(26) NOT NULL,
    "aftersale_no" VARCHAR(32) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "type" "AftersaleType" NOT NULL,
    "status" "AftersaleStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "reason_code" VARCHAR(80) NOT NULL,
    "reason_text" VARCHAR(500),
    "review_reason" VARCHAR(500),
    "reviewed_by_id" CHAR(26),
    "reviewed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "aftersale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aftersale_item" (
    "id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "requested_qty" INTEGER NOT NULL,
    "requested_amount" DECIMAL(18,2) NOT NULL,
    "reserved_qty" INTEGER NOT NULL,
    "reserved_amount" DECIMAL(18,2) NOT NULL,
    "refunded_qty" INTEGER NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aftersale_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aftersale_evidence" (
    "id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26) NOT NULL,
    "return_inspection_id" CHAR(26),
    "file_id" CHAR(26) NOT NULL,
    "purpose" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aftersale_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_shipment" (
    "id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26) NOT NULL,
    "carrier_code" VARCHAR(40) NOT NULL,
    "carrier_name" VARCHAR(80) NOT NULL,
    "tracking_no" VARCHAR(120) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_address_version" (
    "id" CHAR(26) NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "ConfigVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "recipient_name" VARCHAR(80) NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "province" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "detail_ciphertext" BYTEA NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" CHAR(26) NOT NULL,
    "effective_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_address_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_address_snapshot" (
    "id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26) NOT NULL,
    "source_version_id" CHAR(26) NOT NULL,
    "recipient_name" VARCHAR(80) NOT NULL,
    "phone_ciphertext" BYTEA NOT NULL,
    "phone_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "province" VARCHAR(80) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "district" VARCHAR(80) NOT NULL,
    "detail_ciphertext" BYTEA NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_address_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspection" (
    "id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26) NOT NULL,
    "status" "ReturnInspectionStatus" NOT NULL,
    "inspected_by_id" CHAR(26) NOT NULL,
    "abnormal_reason" VARCHAR(500),
    "evidence_manifest" JSONB NOT NULL,
    "evidence_count" INTEGER NOT NULL,
    "resolution" "ReturnInspectionResolution",
    "resolution_note" VARCHAR(500),
    "inspected_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "return_inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspection_item" (
    "id" CHAR(26) NOT NULL,
    "inspection_id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "received_qty" INTEGER NOT NULL,
    "approved_refund_qty" INTEGER NOT NULL,
    "restock_qty" INTEGER NOT NULL DEFAULT 0,
    "damaged_qty" INTEGER NOT NULL DEFAULT 0,
    "scrap_qty" INTEGER NOT NULL DEFAULT 0,
    "return_to_customer_qty" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_inspection_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" CHAR(26) NOT NULL,
    "refund_no" VARCHAR(32) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "aftersale_id" CHAR(26),
    "manual_compensation_id" CHAR(26),
    "origin_type" "RefundOriginType" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_refund_id" VARCHAR(128),
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "is_late_payment_refund" BOOLEAN NOT NULL DEFAULT false,
    "failure_code" VARCHAR(80),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_attempt" (
    "id" CHAR(26) NOT NULL,
    "refund_id" CHAR(26) NOT NULL,
    "attempt_no" INTEGER NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_request_id" VARCHAR(128),
    "status" "RefundAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "provider_payload" JSONB,
    "failure_code" VARCHAR(80),
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "refund_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_item" (
    "id" CHAR(26) NOT NULL,
    "refund_id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "aftersale_item_id" CHAR(26),
    "quantity" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "auto_restock" BOOLEAN NOT NULL DEFAULT false,
    "commission_reversal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_compensation" (
    "id" CHAR(26) NOT NULL,
    "compensation_no" VARCHAR(32) NOT NULL,
    "order_id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "customer_id" CHAR(26) NOT NULL,
    "approved_by_id" CHAR(26) NOT NULL,
    "type" "AftersaleType" NOT NULL DEFAULT 'AMOUNT_COMPENSATION',
    "status" "ManualCompensationStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "reserved_amount" DECIMAL(18,2) NOT NULL,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commission_reversal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" VARCHAR(500) NOT NULL,
    "failure_code" VARCHAR(120),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "manual_compensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rule_version" (
    "id" CHAR(26) NOT NULL,
    "version_no" INTEGER NOT NULL,
    "base_version_id" CHAR(26),
    "status" "CommissionRuleVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" CHAR(26) NOT NULL,
    "effective_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rule_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rule_entry" (
    "id" CHAR(26) NOT NULL,
    "rule_version_id" CHAR(26) NOT NULL,
    "target_type" "CommissionTargetType" NOT NULL,
    "target_id" CHAR(26),
    "target_key" VARCHAR(80) NOT NULL,
    "configured_rate" DECIMAL(7,4) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rule_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_commission_snapshot" (
    "id" CHAR(26) NOT NULL,
    "order_item_id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "rule_version_id" CHAR(26) NOT NULL,
    "source_type" "CommissionSourceType" NOT NULL,
    "category_id_snapshot" CHAR(26) NOT NULL,
    "category_name_snapshot" VARCHAR(120) NOT NULL,
    "product_id_snapshot" CHAR(26) NOT NULL,
    "sku_id_snapshot" CHAR(26) NOT NULL,
    "effective_rate" DECIMAL(7,4) NOT NULL,
    "commission_base" DECIMAL(18,2) NOT NULL,
    "original_commission" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_commission_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_commission_position" (
    "id" CHAR(26) NOT NULL,
    "snapshot_id" CHAR(26) NOT NULL,
    "state" "CommissionSnapshotState" NOT NULL,
    "original_commission" DECIMAL(18,2) NOT NULL,
    "expected_remaining" DECIMAL(18,2) NOT NULL,
    "reversed_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "order_item_commission_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_ledger" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "snapshot_id" CHAR(26),
    "refund_id" CHAR(26),
    "withdrawal_id" CHAR(26),
    "ledger_type" "CommissionLedgerType" NOT NULL,
    "expected_change" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "available_change" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "frozen_change" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" VARCHAR(500) NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_wallet" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "available_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "frozen_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agent_wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_bank_account" (
    "id" CHAR(26) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "account_holder" VARCHAR(120) NOT NULL,
    "bank_name" VARCHAR(160) NOT NULL,
    "account_no_ciphertext" BYTEA NOT NULL,
    "account_no_hash" CHAR(64) NOT NULL,
    "account_no_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "agent_bank_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal" (
    "id" CHAR(26) NOT NULL,
    "withdrawal_no" VARCHAR(32) NOT NULL,
    "agent_id" CHAR(26) NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(18,2) NOT NULL,
    "available_before" DECIMAL(18,2) NOT NULL,
    "frozen_after" DECIMAL(18,2) NOT NULL,
    "review_reason" VARCHAR(500),
    "reviewed_by_id" CHAR(26),
    "reviewed_at" TIMESTAMPTZ(3),
    "paid_by_id" CHAR(26),
    "paid_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_bank_snapshot" (
    "id" CHAR(26) NOT NULL,
    "withdrawal_id" CHAR(26) NOT NULL,
    "source_bank_account_id" CHAR(26),
    "account_holder" VARCHAR(120) NOT NULL,
    "bank_name" VARCHAR(160) NOT NULL,
    "account_no_ciphertext" BYTEA NOT NULL,
    "account_no_last4" CHAR(4) NOT NULL,
    "encryption_key_id" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_bank_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_proof" (
    "id" CHAR(26) NOT NULL,
    "withdrawal_id" CHAR(26) NOT NULL,
    "file_id" CHAR(26) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawal_proof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rule_version" (
    "id" CHAR(26) NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "ConfigVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "minimum_withdrawal_amount" DECIMAL(18,2) NOT NULL,
    "aftersale_window_days" INTEGER NOT NULL,
    "legal_record_retention_years" INTEGER NOT NULL,
    "order_payment_timeout_minutes" INTEGER NOT NULL DEFAULT 30,
    "reason" VARCHAR(500) NOT NULL,
    "created_by_id" CHAR(26) NOT NULL,
    "effective_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_rule_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" CHAR(26) NOT NULL,
    "actor_id" CHAR(26) NOT NULL,
    "scope" VARCHAR(160) NOT NULL,
    "idempotency_key" VARCHAR(80) NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB,
    "response_body_hash" CHAR(64),
    "resource_id" CHAR(26),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "high_risk_operation_preview" (
    "id" CHAR(26) NOT NULL,
    "actor_account_id" CHAR(26) NOT NULL,
    "session_id" CHAR(26) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "target_type" VARCHAR(80) NOT NULL,
    "target_id" VARCHAR(80) NOT NULL,
    "resource_version" INTEGER NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "confirmation_hash" CHAR(64) NOT NULL,
    "preview_token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "high_risk_operation_preview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" CHAR(26) NOT NULL,
    "aggregate_type" VARCHAR(80) NOT NULL,
    "aggregate_id" CHAR(26) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "next_retry_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "error_message" VARCHAR(500),

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" CHAR(26) NOT NULL,
    "actor_account_id" CHAR(26),
    "actor_role" "AccountRole",
    "module" VARCHAR(80) NOT NULL,
    "object_type" VARCHAR(80) NOT NULL,
    "object_id" VARCHAR(80) NOT NULL,
    "action" VARCHAR(120) NOT NULL,
    "reason" VARCHAR(500),
    "before_json" JSONB,
    "after_json" JSONB,
    "result" "AuditResult" NOT NULL,
    "request_id" VARCHAR(80) NOT NULL,
    "idempotency_key" VARCHAR(80),
    "result_code" VARCHAR(120),
    "ip_hash" CHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_daily_aggregate" (
    "id" CHAR(26) NOT NULL,
    "business_date" DATE NOT NULL,
    "channel" "AttributionChannel",
    "agent_id" CHAR(26),
    "scope_key" VARCHAR(40) NOT NULL,
    "created_order_count" INTEGER NOT NULL DEFAULT 0,
    "paid_order_count" INTEGER NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_sales_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paid_units" INTEGER NOT NULL DEFAULT 0,
    "refunded_units" INTEGER NOT NULL DEFAULT 0,
    "net_units" INTEGER NOT NULL DEFAULT 0,
    "new_registration_count" INTEGER NOT NULL DEFAULT 0,
    "new_binding_count" INTEGER NOT NULL DEFAULT 0,
    "active_agent_count" INTEGER NOT NULL DEFAULT 0,
    "customer_total_snapshot" INTEGER NOT NULL DEFAULT 0,
    "timezone" VARCHAR(40) NOT NULL DEFAULT 'Asia/Shanghai',
    "rebuilt_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_daily_aggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_login_name_key" ON "account"("login_name");

-- CreateIndex
CREATE UNIQUE INDEX "account_wechat_open_id_key" ON "account"("wechat_open_id");

-- CreateIndex
CREATE INDEX "account_role_status_idx" ON "account"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_access_jti_key" ON "auth_session"("access_jti");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refresh_token_hash_key" ON "auth_session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "auth_session_account_id_revoked_at_idx" ON "auth_session"("account_id", "revoked_at");

-- CreateIndex
CREATE INDEX "auth_session_session_family_rotation_counter_idx" ON "auth_session"("session_family", "rotation_counter");

-- CreateIndex
CREATE INDEX "totp_factor_account_id_status_idx" ON "totp_factor"("account_id", "status");

-- CreateIndex
CREATE INDEX "totp_factor_secret_fingerprint_idx" ON "totp_factor"("secret_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "totp_recovery_code_code_hash_key" ON "totp_recovery_code"("code_hash");

-- CreateIndex
CREATE INDEX "totp_recovery_code_factor_id_consumed_at_idx" ON "totp_recovery_code"("factor_id", "consumed_at");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_challenge_challenge_token_hash_key" ON "mfa_challenge"("challenge_token_hash");

-- CreateIndex
CREATE INDEX "mfa_challenge_account_id_purpose_status_expires_at_idx" ON "mfa_challenge"("account_id", "purpose", "status", "expires_at");

-- CreateIndex
CREATE INDEX "mfa_challenge_session_id_status_idx" ON "mfa_challenge"("session_id", "status");

-- CreateIndex
CREATE INDEX "mfa_rate_limit_locked_until_idx" ON "mfa_rate_limit"("locked_until");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_rate_limit_account_id_purpose_key" ON "mfa_rate_limit"("account_id", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profile_account_id_key" ON "customer_profile"("account_id");

-- CreateIndex
CREATE INDEX "customer_phone_verification_customer_id_revoked_at_idx" ON "customer_phone_verification"("customer_id", "revoked_at");

-- CreateIndex
CREATE INDEX "customer_phone_verification_phone_hash_idx" ON "customer_phone_verification"("phone_hash");

-- CreateIndex
CREATE INDEX "consent_record_account_id_consent_type_accepted_at_idx" ON "consent_record"("account_id", "consent_type", "accepted_at");

-- CreateIndex
CREATE INDEX "account_deletion_request_account_id_status_idx" ON "account_deletion_request"("account_id", "status");

-- CreateIndex
CREATE INDEX "admin_reauth_attempt_account_id_action_attempted_at_idx" ON "admin_reauth_attempt"("account_id", "action", "attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_reauth_grant_token_hash_key" ON "admin_reauth_grant"("token_hash");

-- CreateIndex
CREATE INDEX "admin_reauth_grant_account_id_action_target_id_status_idx" ON "admin_reauth_grant"("account_id", "action", "target_id", "status");

-- CreateIndex
CREATE INDEX "admin_offline_recovery_target_account_id_status_created_at_idx" ON "admin_offline_recovery"("target_account_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "admin_offline_recovery_status_expires_at_idx" ON "admin_offline_recovery"("status", "expires_at");

-- CreateIndex
CREATE INDEX "admin_offline_recovery_approval_approver_id_created_at_idx" ON "admin_offline_recovery_approval"("approver_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "admin_offline_recovery_approval_recovery_id_approver_id_key" ON "admin_offline_recovery_approval"("recovery_id", "approver_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_profile_account_id_key" ON "agent_profile"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_profile_agent_no_key" ON "agent_profile"("agent_no");

-- CreateIndex
CREATE INDEX "agent_profile_status_created_at_idx" ON "agent_profile"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_invite_code_code_hash_key" ON "agent_invite_code"("code_hash");

-- CreateIndex
CREATE INDEX "agent_invite_code_agent_id_status_expires_at_idx" ON "agent_invite_code"("agent_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "agent_product_whitelist_product_id_deleted_at_idx" ON "agent_product_whitelist"("product_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_product_whitelist_agent_id_product_id_key" ON "agent_product_whitelist"("agent_id", "product_id");

-- CreateIndex
CREATE INDEX "promotion_asset_agent_id_status_target_type_idx" ON "promotion_asset"("agent_id", "status", "target_type");

-- CreateIndex
CREATE INDEX "attribution_candidate_candidate_token_hash_status_expires_a_idx" ON "attribution_candidate"("candidate_token_hash", "status", "expires_at");

-- CreateIndex
CREATE INDEX "attribution_candidate_customer_id_status_expires_at_idx" ON "attribution_candidate"("customer_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "customer_agent_binding_customer_id_ended_at_idx" ON "customer_agent_binding"("customer_id", "ended_at");

-- CreateIndex
CREATE INDEX "customer_agent_binding_agent_id_ended_at_started_at_idx" ON "customer_agent_binding"("agent_id", "ended_at", "started_at");

-- CreateIndex
CREATE INDEX "binding_change_log_customer_id_created_at_idx" ON "binding_change_log"("customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "brand_name_key" ON "brand"("name");

-- CreateIndex
CREATE INDEX "brand_status_sort_order_idx" ON "brand"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "category_name_key" ON "category"("name");

-- CreateIndex
CREATE INDEX "category_status_sort_order_idx" ON "category"("status", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "product_spu_code_key" ON "product"("spu_code");

-- CreateIndex
CREATE INDEX "product_status_category_id_brand_id_published_at_idx" ON "product"("status", "category_id", "brand_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "sku_code_key" ON "sku"("code");

-- CreateIndex
CREATE INDEX "sku_product_id_status_idx" ON "sku"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "file_asset_object_key_key" ON "file_asset"("object_key");

-- CreateIndex
CREATE INDEX "file_asset_purpose_status_visibility_idx" ON "file_asset"("purpose", "status", "visibility");

-- CreateIndex
CREATE INDEX "file_asset_created_by_id_created_at_idx" ON "file_asset"("created_by_id", "created_at");

-- CreateIndex
CREATE INDEX "product_image_product_id_sort_order_deleted_at_idx" ON "product_image"("product_id", "sort_order", "deleted_at");

-- CreateIndex
CREATE INDEX "product_image_product_id_file_id_deleted_at_idx" ON "product_image"("product_id", "file_id", "deleted_at");

-- CreateIndex
CREATE INDEX "banner_status_sort_order_starts_at_ends_at_idx" ON "banner"("status", "sort_order", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_customer_id_product_id_key" ON "favorite"("customer_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_customer_id_key" ON "cart"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_item_cart_id_sku_id_key" ON "cart_item"("cart_id", "sku_id");

-- CreateIndex
CREATE INDEX "customer_address_customer_id_is_default_deleted_at_idx" ON "customer_address"("customer_id", "is_default", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balance_sku_id_key" ON "inventory_balance"("sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservation_order_id_key" ON "inventory_reservation"("order_id");

-- CreateIndex
CREATE INDEX "inventory_reservation_status_expires_at_idx" ON "inventory_reservation"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_reservation_item_reservation_id_sku_id_key" ON "inventory_reservation_item"("reservation_id", "sku_id");

-- CreateIndex
CREATE INDEX "inventory_ledger_sku_id_occurred_at_idx" ON "inventory_ledger"("sku_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_ledger_business_id_idx" ON "inventory_ledger"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_order_order_no_key" ON "sales_order"("order_no");

-- CreateIndex
CREATE INDEX "sales_order_customer_id_created_at_idx" ON "sales_order"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "sales_order_order_status_created_at_idx" ON "sales_order"("order_status", "created_at");

-- CreateIndex
CREATE INDEX "sales_order_final_agent_id_paid_at_idx" ON "sales_order"("final_agent_id", "paid_at");

-- CreateIndex
CREATE INDEX "order_item_sku_id_created_at_idx" ON "order_item"("sku_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_order_id_sku_id_key" ON "order_item"("order_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_address_snapshot_order_id_key" ON "order_address_snapshot"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_attribution_candidate_order_id_key" ON "order_attribution_candidate"("order_id");

-- CreateIndex
CREATE INDEX "order_attribution_candidate_candidate_agent_id_submitted_at_idx" ON "order_attribution_candidate"("candidate_agent_id", "submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_attribution_snapshot_order_id_key" ON "order_attribution_snapshot"("order_id");

-- CreateIndex
CREATE INDEX "order_attribution_snapshot_agent_id_snapshot_captured_at_idx" ON "order_attribution_snapshot"("agent_id_snapshot", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_customer_privacy_projection_attribution_snapshot_id_key" ON "agent_customer_privacy_projection"("attribution_snapshot_id");

-- CreateIndex
CREATE INDEX "agent_customer_privacy_projection_customer_id_anonymized_at_idx" ON "agent_customer_privacy_projection"("customer_id", "anonymized_at");

-- CreateIndex
CREATE INDEX "agent_customer_privacy_projection_agent_id_created_at_idx" ON "agent_customer_privacy_projection"("agent_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intent_intent_no_key" ON "payment_intent"("intent_no");

-- CreateIndex
CREATE INDEX "payment_intent_order_id_status_idx" ON "payment_intent"("order_id", "status");

-- CreateIndex
CREATE INDEX "payment_intent_status_next_reconcile_at_idx" ON "payment_intent"("status", "next_reconcile_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intent_provider_provider_intent_id_key" ON "payment_intent"("provider", "provider_intent_id");

-- CreateIndex
CREATE INDEX "payment_attempt_payment_intent_id_status_idx" ON "payment_attempt"("payment_intent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_provider_provider_transaction_id_key" ON "payment_attempt"("provider", "provider_transaction_id");

-- CreateIndex
CREATE INDEX "callback_inbox_status_received_at_idx" ON "callback_inbox"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "callback_inbox_provider_provider_event_id_key" ON "callback_inbox"("provider", "provider_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_order_id_key" ON "shipment"("order_id");

-- CreateIndex
CREATE INDEX "shipment_status_shipped_at_idx" ON "shipment"("status", "shipped_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_item_shipment_id_order_item_id_key" ON "shipment_item"("shipment_id", "order_item_id");

-- CreateIndex
CREATE INDEX "logistics_event_shipment_id_occurred_at_idx" ON "logistics_event"("shipment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "logistics_event_shipment_id_event_key_key" ON "logistics_event"("shipment_id", "event_key");

-- CreateIndex
CREATE UNIQUE INDEX "aftersale_aftersale_no_key" ON "aftersale"("aftersale_no");

-- CreateIndex
CREATE INDEX "aftersale_status_created_at_idx" ON "aftersale"("status", "created_at");

-- CreateIndex
CREATE INDEX "aftersale_order_id_idx" ON "aftersale"("order_id");

-- CreateIndex
CREATE INDEX "aftersale_item_order_item_id_idx" ON "aftersale_item"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "aftersale_item_aftersale_id_order_item_id_key" ON "aftersale_item"("aftersale_id", "order_item_id");

-- CreateIndex
CREATE INDEX "aftersale_evidence_return_inspection_id_idx" ON "aftersale_evidence"("return_inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "aftersale_evidence_aftersale_id_file_id_key" ON "aftersale_evidence"("aftersale_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_shipment_aftersale_id_key" ON "return_shipment"("aftersale_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_address_version_version_no_key" ON "return_address_version"("version_no");

-- CreateIndex
CREATE INDEX "return_address_version_status_effective_at_idx" ON "return_address_version"("status", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "return_address_snapshot_aftersale_id_key" ON "return_address_snapshot"("aftersale_id");

-- CreateIndex
CREATE INDEX "return_address_snapshot_source_version_id_idx" ON "return_address_snapshot"("source_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspection_aftersale_id_key" ON "return_inspection"("aftersale_id");

-- CreateIndex
CREATE INDEX "return_inspection_status_created_at_idx" ON "return_inspection"("status", "created_at");

-- CreateIndex
CREATE INDEX "return_inspection_item_order_item_id_idx" ON "return_inspection_item"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspection_item_inspection_id_order_item_id_key" ON "return_inspection_item"("inspection_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_refund_no_key" ON "refund"("refund_no");

-- CreateIndex
CREATE UNIQUE INDEX "refund_manual_compensation_id_key" ON "refund"("manual_compensation_id");

-- CreateIndex
CREATE INDEX "refund_order_id_status_idx" ON "refund"("order_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refund_aftersale_id_key" ON "refund"("aftersale_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_provider_provider_refund_id_key" ON "refund"("provider", "provider_refund_id");

-- CreateIndex
CREATE INDEX "refund_attempt_refund_id_status_idx" ON "refund_attempt"("refund_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "refund_attempt_refund_id_attempt_no_key" ON "refund_attempt"("refund_id", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "refund_attempt_refund_id_idempotency_key_key" ON "refund_attempt"("refund_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refund_attempt_provider_provider_request_id_key" ON "refund_attempt"("provider", "provider_request_id");

-- CreateIndex
CREATE INDEX "refund_item_order_item_id_idx" ON "refund_item"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_item_refund_id_order_item_id_key" ON "refund_item"("refund_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "manual_compensation_compensation_no_key" ON "manual_compensation"("compensation_no");

-- CreateIndex
CREATE INDEX "manual_compensation_order_id_created_at_idx" ON "manual_compensation"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "manual_compensation_order_item_id_created_at_idx" ON "manual_compensation"("order_item_id", "created_at");

-- CreateIndex
CREATE INDEX "manual_compensation_status_created_at_idx" ON "manual_compensation"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rule_version_version_no_key" ON "commission_rule_version"("version_no");

-- CreateIndex
CREATE INDEX "commission_rule_version_status_effective_at_idx" ON "commission_rule_version"("status", "effective_at");

-- CreateIndex
CREATE INDEX "commission_rule_entry_target_type_target_id_idx" ON "commission_rule_entry"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "commission_rule_entry_rule_version_id_target_key_key" ON "commission_rule_entry"("rule_version_id", "target_key");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_commission_snapshot_order_item_id_key" ON "order_item_commission_snapshot"("order_item_id");

-- CreateIndex
CREATE INDEX "order_item_commission_snapshot_agent_id_created_at_idx" ON "order_item_commission_snapshot"("agent_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_item_commission_position_snapshot_id_key" ON "order_item_commission_position"("snapshot_id");

-- CreateIndex
CREATE INDEX "order_item_commission_position_state_updated_at_idx" ON "order_item_commission_position"("state", "updated_at");

-- CreateIndex
CREATE INDEX "commission_ledger_agent_id_occurred_at_idx" ON "commission_ledger"("agent_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "commission_ledger_agent_id_idempotency_key_key" ON "commission_ledger"("agent_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_wallet_agent_id_key" ON "agent_wallet"("agent_id");

-- CreateIndex
CREATE INDEX "agent_bank_account_agent_id_is_active_deleted_at_idx" ON "agent_bank_account"("agent_id", "is_active", "deleted_at");

-- CreateIndex
CREATE INDEX "agent_bank_account_account_no_hash_idx" ON "agent_bank_account"("account_no_hash");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_withdrawal_no_key" ON "withdrawal"("withdrawal_no");

-- CreateIndex
CREATE INDEX "withdrawal_agent_id_status_created_at_idx" ON "withdrawal"("agent_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "withdrawal_status_created_at_idx" ON "withdrawal"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_bank_snapshot_withdrawal_id_key" ON "withdrawal_bank_snapshot"("withdrawal_id");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawal_proof_withdrawal_id_file_id_key" ON "withdrawal_proof"("withdrawal_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_rule_version_version_no_key" ON "business_rule_version"("version_no");

-- CreateIndex
CREATE INDEX "business_rule_version_status_effective_at_idx" ON "business_rule_version"("status", "effective_at");

-- CreateIndex
CREATE INDEX "idempotency_record_expires_at_idx" ON "idempotency_record"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_actor_id_scope_idempotency_key_key" ON "idempotency_record"("actor_id", "scope", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "high_risk_operation_preview_preview_token_hash_key" ON "high_risk_operation_preview"("preview_token_hash");

-- CreateIndex
CREATE INDEX "high_risk_operation_preview_actor_account_id_action_target__idx" ON "high_risk_operation_preview"("actor_account_id", "action", "target_id", "expires_at");

-- CreateIndex
CREATE INDEX "outbox_event_status_next_retry_at_created_at_idx" ON "outbox_event"("status", "next_retry_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_event_aggregate_type_aggregate_id_idx" ON "outbox_event"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "audit_log_object_type_object_id_occurred_at_idx" ON "audit_log"("object_type", "object_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_actor_account_id_occurred_at_idx" ON "audit_log"("actor_account_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_log_module_occurred_at_idx" ON "audit_log"("module", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_daily_aggregate_business_date_scope_key_key" ON "sales_daily_aggregate"("business_date", "scope_key");

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_mfa_factor_id_fkey" FOREIGN KEY ("mfa_factor_id") REFERENCES "totp_factor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_factor" ADD CONSTRAINT "totp_factor_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "totp_recovery_code" ADD CONSTRAINT "totp_recovery_code_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "totp_factor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenge" ADD CONSTRAINT "mfa_challenge_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenge" ADD CONSTRAINT "mfa_challenge_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_challenge" ADD CONSTRAINT "mfa_challenge_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "totp_factor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_rate_limit" ADD CONSTRAINT "mfa_rate_limit_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profile" ADD CONSTRAINT "customer_profile_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_phone_verification" ADD CONSTRAINT "customer_phone_verification_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_request" ADD CONSTRAINT "account_deletion_request_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_reauth_attempt" ADD CONSTRAINT "admin_reauth_attempt_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_reauth_grant" ADD CONSTRAINT "admin_reauth_grant_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_reauth_grant" ADD CONSTRAINT "admin_reauth_grant_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_offline_recovery" ADD CONSTRAINT "admin_offline_recovery_target_account_id_fkey" FOREIGN KEY ("target_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_offline_recovery" ADD CONSTRAINT "admin_offline_recovery_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_offline_recovery" ADD CONSTRAINT "admin_offline_recovery_executed_by_id_fkey" FOREIGN KEY ("executed_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_offline_recovery_approval" ADD CONSTRAINT "admin_offline_recovery_approval_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "admin_offline_recovery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_offline_recovery_approval" ADD CONSTRAINT "admin_offline_recovery_approval_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_profile" ADD CONSTRAINT "agent_profile_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_invite_code" ADD CONSTRAINT "agent_invite_code_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_product_whitelist" ADD CONSTRAINT "agent_product_whitelist_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_product_whitelist" ADD CONSTRAINT "agent_product_whitelist_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_asset" ADD CONSTRAINT "promotion_asset_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_asset" ADD CONSTRAINT "promotion_asset_invite_code_id_fkey" FOREIGN KEY ("invite_code_id") REFERENCES "agent_invite_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_asset" ADD CONSTRAINT "promotion_asset_target_product_id_fkey" FOREIGN KEY ("target_product_id") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_asset" ADD CONSTRAINT "promotion_asset_qr_file_id_fkey" FOREIGN KEY ("qr_file_id") REFERENCES "file_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidate" ADD CONSTRAINT "attribution_candidate_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidate" ADD CONSTRAINT "attribution_candidate_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidate" ADD CONSTRAINT "attribution_candidate_invite_code_id_fkey" FOREIGN KEY ("invite_code_id") REFERENCES "agent_invite_code"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_candidate" ADD CONSTRAINT "attribution_candidate_promotion_asset_id_fkey" FOREIGN KEY ("promotion_asset_id") REFERENCES "promotion_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_agent_binding" ADD CONSTRAINT "customer_agent_binding_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_agent_binding" ADD CONSTRAINT "customer_agent_binding_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_old_binding_id_fkey" FOREIGN KEY ("old_binding_id") REFERENCES "customer_agent_binding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_new_binding_id_fkey" FOREIGN KEY ("new_binding_id") REFERENCES "customer_agent_binding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_old_agent_id_fkey" FOREIGN KEY ("old_agent_id") REFERENCES "agent_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_new_agent_id_fkey" FOREIGN KEY ("new_agent_id") REFERENCES "agent_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "binding_change_log" ADD CONSTRAINT "binding_change_log_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brand" ADD CONSTRAINT "brand_logo_file_id_fkey" FOREIGN KEY ("logo_file_id") REFERENCES "file_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_icon_file_id_fkey" FOREIGN KEY ("icon_file_id") REFERENCES "file_asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sku" ADD CONSTRAINT "sku_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_asset" ADD CONSTRAINT "file_asset_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "banner" ADD CONSTRAINT "banner_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite" ADD CONSTRAINT "favorite_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "cart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balance" ADD CONSTRAINT "inventory_balance_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservation_item" ADD CONSTRAINT "inventory_reservation_item_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "inventory_reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_reservation_item" ADD CONSTRAINT "inventory_reservation_item_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_ledger" ADD CONSTRAINT "inventory_ledger_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_final_agent_id_fkey" FOREIGN KEY ("final_agent_id") REFERENCES "agent_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_order" ADD CONSTRAINT "sales_order_business_rule_version_id_fkey" FOREIGN KEY ("business_rule_version_id") REFERENCES "business_rule_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "sku"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_address_snapshot" ADD CONSTRAINT "order_address_snapshot_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attribution_candidate" ADD CONSTRAINT "order_attribution_candidate_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attribution_candidate" ADD CONSTRAINT "order_attribution_candidate_candidate_agent_id_fkey" FOREIGN KEY ("candidate_agent_id") REFERENCES "agent_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attribution_candidate" ADD CONSTRAINT "order_attribution_candidate_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "customer_agent_binding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attribution_snapshot" ADD CONSTRAINT "order_attribution_snapshot_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_privacy_projection" ADD CONSTRAINT "agent_customer_privacy_projection_attribution_snapshot_id_fkey" FOREIGN KEY ("attribution_snapshot_id") REFERENCES "order_attribution_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_privacy_projection" ADD CONSTRAINT "agent_customer_privacy_projection_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_customer_privacy_projection" ADD CONSTRAINT "agent_customer_privacy_projection_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intent" ADD CONSTRAINT "payment_intent_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment" ADD CONSTRAINT "shipment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_item" ADD CONSTRAINT "shipment_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_event" ADD CONSTRAINT "logistics_event_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logistics_event" ADD CONSTRAINT "logistics_event_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale" ADD CONSTRAINT "aftersale_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale" ADD CONSTRAINT "aftersale_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale" ADD CONSTRAINT "aftersale_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale_item" ADD CONSTRAINT "aftersale_item_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale_item" ADD CONSTRAINT "aftersale_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale_evidence" ADD CONSTRAINT "aftersale_evidence_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale_evidence" ADD CONSTRAINT "aftersale_evidence_return_inspection_id_fkey" FOREIGN KEY ("return_inspection_id") REFERENCES "return_inspection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aftersale_evidence" ADD CONSTRAINT "aftersale_evidence_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_shipment" ADD CONSTRAINT "return_shipment_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_address_version" ADD CONSTRAINT "return_address_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_address_snapshot" ADD CONSTRAINT "return_address_snapshot_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_address_snapshot" ADD CONSTRAINT "return_address_snapshot_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "return_address_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection" ADD CONSTRAINT "return_inspection_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection" ADD CONSTRAINT "return_inspection_inspected_by_id_fkey" FOREIGN KEY ("inspected_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection_item" ADD CONSTRAINT "return_inspection_item_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "return_inspection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspection_item" ADD CONSTRAINT "return_inspection_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_aftersale_id_fkey" FOREIGN KEY ("aftersale_id") REFERENCES "aftersale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_manual_compensation_id_fkey" FOREIGN KEY ("manual_compensation_id") REFERENCES "manual_compensation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_attempt" ADD CONSTRAINT "refund_attempt_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_item" ADD CONSTRAINT "refund_item_aftersale_item_id_fkey" FOREIGN KEY ("aftersale_item_id") REFERENCES "aftersale_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_compensation" ADD CONSTRAINT "manual_compensation_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "sales_order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_compensation" ADD CONSTRAINT "manual_compensation_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_compensation" ADD CONSTRAINT "manual_compensation_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customer_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_compensation" ADD CONSTRAINT "manual_compensation_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rule_version" ADD CONSTRAINT "commission_rule_version_base_version_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "commission_rule_version"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rule_version" ADD CONSTRAINT "commission_rule_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rule_entry" ADD CONSTRAINT "commission_rule_entry_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "commission_rule_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_commission_snapshot" ADD CONSTRAINT "order_item_commission_snapshot_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_commission_snapshot" ADD CONSTRAINT "order_item_commission_snapshot_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_commission_snapshot" ADD CONSTRAINT "order_item_commission_snapshot_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "commission_rule_version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_commission_position" ADD CONSTRAINT "order_item_commission_position_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "order_item_commission_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "order_item_commission_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refund"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_ledger" ADD CONSTRAINT "commission_ledger_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_wallet" ADD CONSTRAINT "agent_wallet_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_bank_account" ADD CONSTRAINT "agent_bank_account_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal" ADD CONSTRAINT "withdrawal_paid_by_id_fkey" FOREIGN KEY ("paid_by_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_bank_snapshot" ADD CONSTRAINT "withdrawal_bank_snapshot_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_bank_snapshot" ADD CONSTRAINT "withdrawal_bank_snapshot_source_bank_account_id_fkey" FOREIGN KEY ("source_bank_account_id") REFERENCES "agent_bank_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_proof" ADD CONSTRAINT "withdrawal_proof_withdrawal_id_fkey" FOREIGN KEY ("withdrawal_id") REFERENCES "withdrawal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_proof" ADD CONSTRAINT "withdrawal_proof_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rule_version" ADD CONSTRAINT "business_rule_version_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "high_risk_operation_preview" ADD CONSTRAINT "high_risk_operation_preview_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "high_risk_operation_preview" ADD CONSTRAINT "high_risk_operation_preview_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_daily_aggregate" ADD CONSTRAINT "sales_daily_aggregate_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CH-005 PostgreSQL-only contract -------------------------------------------------
-- Prisma owns the portable logical model. Predicate indexes, cross-field CHECKs,
-- guarded state transitions, least-privilege roles and RLS are migration-owned.

-- Partial unique indexes (17).
CREATE UNIQUE INDEX "uq_payment_intent_one_active_per_order"
  ON public."payment_intent" ("order_id")
  WHERE "status" IN ('CREATING', 'OPEN', 'CLOSE_PENDING');

CREATE UNIQUE INDEX "uq_customer_phone_one_current"
  ON public."customer_phone_verification" ("customer_id")
  WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX "uq_account_deletion_one_active"
  ON public."account_deletion_request" ("account_id")
  WHERE "status" IN ('SUBMITTED', 'PROCESSING');

CREATE UNIQUE INDEX "uq_customer_one_current_agent"
  ON public."customer_agent_binding" ("customer_id")
  WHERE "ended_at" IS NULL;

CREATE UNIQUE INDEX "uq_agent_one_active_invite"
  ON public."agent_invite_code" ("agent_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "uq_active_candidate_anonymous"
  ON public."attribution_candidate" ("candidate_token_hash")
  WHERE "status" = 'ACTIVE' AND "candidate_token_hash" IS NOT NULL;

CREATE UNIQUE INDEX "uq_active_candidate_customer"
  ON public."attribution_candidate" ("customer_id")
  WHERE "status" = 'ACTIVE' AND "customer_id" IS NOT NULL;

CREATE UNIQUE INDEX "uq_agent_one_inflight_withdrawal"
  ON public."withdrawal" ("agent_id")
  WHERE "status" IN ('PENDING', 'APPROVED');

CREATE UNIQUE INDEX "uq_commission_rule_one_published"
  ON public."commission_rule_version" ("status")
  WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "uq_agent_one_active_bank_account"
  ON public."agent_bank_account" ("agent_id")
  WHERE "is_active" = TRUE AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_customer_one_default_address"
  ON public."customer_address" ("customer_id")
  WHERE "is_default" = TRUE AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_totp_factor_one_active_per_account"
  ON public."totp_factor" ("account_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "uq_business_rule_one_published"
  ON public."business_rule_version" ("status")
  WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "uq_return_address_one_published"
  ON public."return_address_version" ("status")
  WHERE "status" = 'PUBLISHED';

CREATE UNIQUE INDEX "uq_product_image_active_sort"
  ON public."product_image" ("product_id", "sort_order")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_product_image_active_file"
  ON public."product_image" ("product_id", "file_id")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "uq_offline_recovery_one_active_per_target"
  ON public."admin_offline_recovery" ("target_account_id")
  WHERE "status" IN ('PENDING_APPROVAL', 'APPROVED');

-- Numeric and cross-field CHECK constraints.
ALTER TABLE public."inventory_balance"
  ADD CONSTRAINT "chk_inventory_non_negative"
  CHECK ("physical_qty" >= 0 AND "locked_qty" >= 0 AND "locked_qty" <= "physical_qty");

ALTER TABLE public."inventory_reservation_item"
  ADD CONSTRAINT "chk_inventory_reservation_item_quantity" CHECK ("quantity" > 0);

ALTER TABLE public."inventory_ledger"
  ADD CONSTRAINT "chk_inventory_after_non_negative"
  CHECK ("physical_after" >= 0 AND "locked_after" >= 0 AND "locked_after" <= "physical_after");

ALTER TABLE public."agent_wallet"
  ADD CONSTRAINT "chk_wallet_frozen_non_negative" CHECK ("frozen_balance" >= 0);

ALTER TABLE public."brand"
  ADD CONSTRAINT "chk_brand_sort_order" CHECK ("sort_order" >= 0);

ALTER TABLE public."category"
  ADD CONSTRAINT "chk_category_sort_order" CHECK ("sort_order" >= 0);

ALTER TABLE public."product"
  ADD CONSTRAINT "chk_product_sales_count" CHECK ("sales_count" >= 0);

ALTER TABLE public."sku"
  ADD CONSTRAINT "chk_sku_retail_price" CHECK ("retail_price" > 0);

ALTER TABLE public."file_asset"
  ADD CONSTRAINT "chk_file_byte_size" CHECK ("byte_size" > 0),
  ADD CONSTRAINT "chk_file_visibility_by_purpose"
  CHECK (
    "visibility" = 'PRIVATE'
    OR "purpose" IN ('PRODUCT_IMAGE', 'BRAND_LOGO', 'CATEGORY_ICON', 'BANNER')
  );

ALTER TABLE public."product_image"
  ADD CONSTRAINT "chk_product_image_sort_order" CHECK ("sort_order" >= 0);

ALTER TABLE public."banner"
  ADD CONSTRAINT "chk_banner_sort_order" CHECK ("sort_order" >= 0),
  ADD CONSTRAINT "chk_banner_target"
  CHECK (
    ("target_type" = 'NONE' AND "target_id" IS NULL AND "target_url" IS NULL)
    OR ("target_type" IN ('PRODUCT', 'CATEGORY') AND "target_id" IS NOT NULL AND "target_url" IS NULL)
    OR ("target_type" = 'URL' AND "target_id" IS NULL AND "target_url" ~ '^https://')
  ),
  ADD CONSTRAINT "chk_banner_window"
  CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at");

ALTER TABLE public."cart_item"
  ADD CONSTRAINT "chk_cart_item_quantity" CHECK ("quantity" > 0);

ALTER TABLE public."commission_rule_entry"
  ADD CONSTRAINT "chk_commission_rate"
    CHECK ("configured_rate" >= 0 AND "configured_rate" <= 100),
  ADD CONSTRAINT "chk_commission_target"
    CHECK (
      ("target_type" = 'PLATFORM' AND "target_id" IS NULL AND "target_key" = 'PLATFORM')
      OR ("target_type" = 'CATEGORY' AND "target_id" IS NOT NULL
          AND "target_key" = 'CATEGORY:' || "target_id")
      OR ("target_type" = 'SKU' AND "target_id" IS NOT NULL
          AND "target_key" = 'SKU:' || "target_id")
    );

ALTER TABLE public."sales_order"
  ADD CONSTRAINT "chk_order_money_non_negative"
    CHECK (
      "goods_amount" >= 0 AND "shipping_amount" >= 0 AND "payable_amount" >= 0
      AND "paid_amount" >= 0 AND "refunded_amount" >= 0 AND "refunded_amount" <= "paid_amount"
    ),
  ADD CONSTRAINT "chk_order_close_reason"
    CHECK (
      ("order_status" = 'CLOSED' AND "close_reason" IS NOT NULL AND "completion_reason" IS NULL)
      OR ("order_status" = 'COMPLETED' AND "close_reason" IS NULL AND "completion_reason" IS NOT NULL)
      OR ("order_status" NOT IN ('CLOSED', 'COMPLETED') AND "close_reason" IS NULL AND "completion_reason" IS NULL)
    ),
  ADD CONSTRAINT "chk_order_refund_progress_status"
    CHECK (
      ("refund_progress_status" = 'NONE' AND "refunded_amount" = 0)
      OR ("refund_progress_status" = 'PARTIAL' AND "refunded_amount" > 0 AND "refunded_amount" < "paid_amount")
      OR ("refund_progress_status" = 'FULL' AND "paid_amount" > 0 AND "refunded_amount" = "paid_amount")
    ),
  ADD CONSTRAINT "chk_order_payment_window"
    CHECK ("pay_expires_at" = "created_at" + INTERVAL '30 minutes');

ALTER TABLE public."payment_intent"
  ADD CONSTRAINT "chk_payment_intent_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "chk_payment_intent_counters"
    CHECK ("close_attempt_count" >= 0 AND "reconciliation_attempt_count" >= 0),
  ADD CONSTRAINT "chk_payment_intent_times"
    CHECK ("expires_at" > "create_requested_at");

ALTER TABLE public."payment_attempt"
  ADD CONSTRAINT "chk_payment_attempt_amount_positive" CHECK ("amount" > 0);

ALTER TABLE public."callback_inbox"
  ADD CONSTRAINT "chk_callback_retry_count" CHECK ("retry_count" >= 0);

ALTER TABLE public."order_item"
  ADD CONSTRAINT "chk_order_item_money_positive"
    CHECK ("unit_price" > 0 AND "quantity" > 0 AND "line_paid_amount" = "unit_price" * "quantity"),
  ADD CONSTRAINT "chk_order_item_refund_counters"
  CHECK (
    "refunded_qty" >= 0
    AND "refunded_qty" <= "quantity"
    AND "pre_shipment_refunded_qty" >= 0
    AND "pre_shipment_refunded_qty" <= "refunded_qty"
    AND "aftersale_reserved_qty" >= 0
    AND "refunded_qty" + "aftersale_reserved_qty" <= "quantity"
    AND "refunded_amount" >= 0
    AND "aftersale_reserved_amount" >= 0
    AND "refunded_amount" + "aftersale_reserved_amount" <= "line_paid_amount"
    AND "refunded_amount" >= "unit_price" * "refunded_qty"
    AND "aftersale_reserved_amount" >= "unit_price" * "aftersale_reserved_qty"
    AND "shipped_qty" >= 0
    AND "shipped_qty" <= "quantity"
    AND "shipped_qty" + "pre_shipment_refunded_qty" <= "quantity"
  );

ALTER TABLE public."shipment"
  ADD CONSTRAINT "chk_shipment_created_shipped"
  CHECK (
    "status" IN ('SHIPPED', 'IN_TRANSIT', 'DELIVERED')
    AND "shipped_at" IS NOT NULL
    AND ("status" <> 'DELIVERED' OR "delivered_at" IS NOT NULL)
    AND ("delivered_at" IS NULL OR "delivered_at" >= "shipped_at")
  );

ALTER TABLE public."shipment_item"
  ADD CONSTRAINT "chk_shipment_item_quantity" CHECK ("quantity" > 0);

ALTER TABLE public."logistics_event"
  ADD CONSTRAINT "chk_logistics_event_shape"
  CHECK (
    ("event_type" = 'STATUS' AND "status_code" IS NOT NULL
      AND num_nonnulls("carrier_code", "carrier_name", "tracking_no") = 0)
    OR
    ("event_type" = 'TRACKING_CORRECTION' AND "status_code" IS NULL
      AND "carrier_code" IS NOT NULL AND "carrier_name" IS NOT NULL
      AND "tracking_no" IS NOT NULL AND "reason" IS NOT NULL)
  );

ALTER TABLE public."aftersale_item"
  ADD CONSTRAINT "chk_aftersale_item_money"
    CHECK (
      "requested_qty" > 0 AND "requested_amount" > 0
      AND "reserved_qty" > 0 AND "reserved_amount" > 0
      AND "refunded_qty" >= 0 AND "refunded_amount" >= 0
      AND "requested_qty" = "reserved_qty"
      AND "requested_amount" = "reserved_amount"
      AND "refunded_qty" <= "requested_qty"
      AND "refunded_amount" <= "requested_amount"
    );

ALTER TABLE public."return_inspection"
  ADD CONSTRAINT "chk_return_inspection_envelope"
  CHECK (
    "version" >= 1
    AND "evidence_count" >= 0
    AND jsonb_typeof("evidence_manifest") = 'array'
    AND jsonb_array_length("evidence_manifest") = "evidence_count"
  ),
  ADD CONSTRAINT "chk_return_inspection_decision"
  CHECK (
    ("status" = 'PASS' AND "abnormal_reason" IS NULL)
    OR
    ("status" = 'ABNORMAL' AND "abnormal_reason" IS NOT NULL
      AND length(btrim("abnormal_reason")) >= 2)
  ),
  ADD CONSTRAINT "chk_return_inspection_resolution"
  CHECK (
    ("resolution" IS NULL AND "resolved_at" IS NULL AND "resolution_note" IS NULL)
    OR
    ("status" = 'ABNORMAL' AND "resolution" IS NOT NULL
      AND "resolved_at" IS NOT NULL AND "resolution_note" IS NOT NULL
      AND length(btrim("resolution_note")) >= 2)
  );

ALTER TABLE public."return_inspection_item"
  ADD CONSTRAINT "chk_return_inspection_quantities"
    CHECK (
      "received_qty" >= 0 AND "approved_refund_qty" >= 0
      AND "approved_refund_qty" + "return_to_customer_qty" = "received_qty"
      AND "restock_qty" >= 0 AND "damaged_qty" >= 0
      AND "scrap_qty" >= 0 AND "return_to_customer_qty" >= 0
      AND "approved_refund_qty" = "restock_qty" + "damaged_qty" + "scrap_qty"
      AND "restock_qty" + "damaged_qty" + "scrap_qty" + "return_to_customer_qty" = "received_qty"
    );

ALTER TABLE public."refund"
  ADD CONSTRAINT "chk_refund_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "chk_refund_origin"
    CHECK (
      ("origin_type" = 'AFTERSALE' AND "aftersale_id" IS NOT NULL AND "manual_compensation_id" IS NULL AND "is_late_payment_refund" = FALSE)
      OR ("origin_type" = 'LATE_PAYMENT' AND "aftersale_id" IS NULL AND "manual_compensation_id" IS NULL AND "is_late_payment_refund" = TRUE)
      OR ("origin_type" = 'MANUAL_COMPENSATION' AND "aftersale_id" IS NULL AND "manual_compensation_id" IS NOT NULL AND "is_late_payment_refund" = FALSE)
    );

ALTER TABLE public."refund_attempt"
  ADD CONSTRAINT "chk_refund_attempt_no_positive" CHECK ("attempt_no" >= 1);

ALTER TABLE public."refund_item"
  ADD CONSTRAINT "chk_refund_item_money_positive"
    CHECK ("quantity" > 0 AND "amount" > 0 AND "commission_reversal" >= 0);

ALTER TABLE public."manual_compensation"
  ADD CONSTRAINT "chk_manual_compensation"
    CHECK (
      "type" = 'AMOUNT_COMPENSATION'
      AND "amount" > 0
      AND "reserved_amount" >= 0 AND "reserved_amount" <= "amount"
      AND "refunded_amount" >= 0 AND "refunded_amount" <= "amount"
      AND "commission_reversal" >= 0
    );

ALTER TABLE public."business_rule_version"
  ADD CONSTRAINT "chk_business_rule_values"
  CHECK (
    "minimum_withdrawal_amount" > 0
    AND "aftersale_window_days" BETWEEN 1 AND 365
    AND "legal_record_retention_years" BETWEEN 1 AND 100
    AND "order_payment_timeout_minutes" = 30
  ),
  ADD CONSTRAINT "chk_business_rule_version_no" CHECK ("version_no" >= 1);

ALTER TABLE public."return_address_version"
  ADD CONSTRAINT "chk_return_address_version_no" CHECK ("version_no" >= 1);

ALTER TABLE public."commission_rule_version"
  ADD CONSTRAINT "chk_commission_rule_version_no" CHECK ("version_no" >= 1);

ALTER TABLE public."agent_profile"
  ADD CONSTRAINT "chk_agent_contact_phone_envelope"
  CHECK (
    num_nonnulls("contact_phone_ciphertext", "contact_phone_last4", "contact_phone_encryption_key_id") IN (0, 3)
  );

ALTER TABLE public."mfa_challenge"
  ADD CONSTRAINT "chk_mfa_challenge_failures" CHECK ("failed_attempts" >= 0),
  ADD CONSTRAINT "chk_mfa_challenge_expiry" CHECK ("expires_at" > "created_at");

ALTER TABLE public."mfa_rate_limit"
  ADD CONSTRAINT "chk_mfa_rate_limit" CHECK ("failed_attempts" >= 0);

ALTER TABLE public."totp_factor"
  ADD CONSTRAINT "chk_totp_timestep_non_negative"
    CHECK ("last_used_timestep" IS NULL OR "last_used_timestep" >= 0);

ALTER TABLE public."auth_session"
  ADD CONSTRAINT "chk_auth_session_assurance"
  CHECK (
    "rotation_counter" >= 0
    AND "restriction" IN ('NONE', 'CHANGE_PASSWORD_ONLY')
    AND (
      ("restriction" = 'NONE' AND "refresh_token_hash" IS NOT NULL)
      OR ("restriction" = 'CHANGE_PASSWORD_ONLY' AND "assurance" = 'PASSWORD' AND "refresh_token_hash" IS NULL)
    )
    AND (
      ("assurance" = 'MFA' AND "mfa_factor_id" IS NOT NULL AND "mfa_verified_at" IS NOT NULL)
      OR ("assurance" <> 'MFA' AND "mfa_factor_id" IS NULL AND "mfa_verified_at" IS NULL)
    )
    AND "expires_at" > "created_at"
  );

ALTER TABLE public."order_item_commission_snapshot"
  ADD CONSTRAINT "chk_commission_snapshot_money_non_negative"
    CHECK (
      "effective_rate" >= 0 AND "effective_rate" <= 100
      AND "commission_base" >= 0 AND "original_commission" >= 0
    );

ALTER TABLE public."order_item_commission_position"
  ADD CONSTRAINT "chk_commission_position_money_non_negative"
    CHECK (
      "original_commission" >= 0
      AND "expected_remaining" >= 0
      AND "reversed_total" >= 0
      AND "expected_remaining" <= "original_commission"
      AND "reversed_total" <= "original_commission"
      AND "expected_remaining" + "reversed_total" <= "original_commission"
    );

ALTER TABLE public."commission_ledger"
  ADD CONSTRAINT "chk_commission_ledger_non_zero"
    CHECK ("expected_change" <> 0 OR "available_change" <> 0 OR "frozen_change" <> 0);

ALTER TABLE public."withdrawal"
  ADD CONSTRAINT "chk_withdrawal_money"
    CHECK ("amount" > 0 AND "available_before" >= 0 AND "frozen_after" >= 0);

ALTER TABLE public."attribution_candidate"
  ADD CONSTRAINT "chk_candidate_one_subject"
  CHECK (num_nonnulls("candidate_token_hash", "customer_id") = 1);

ALTER TABLE public."idempotency_record"
  ADD CONSTRAINT "chk_idempotency_response_status" CHECK ("response_status" BETWEEN 100 AND 599),
  ADD CONSTRAINT "chk_idempotency_expiry" CHECK ("expires_at" > "created_at");

ALTER TABLE public."high_risk_operation_preview"
  ADD CONSTRAINT "chk_high_risk_preview_expiry" CHECK ("expires_at" > "created_at");

ALTER TABLE public."outbox_event"
  ADD CONSTRAINT "chk_outbox_retry_count" CHECK ("retry_count" >= 0);

ALTER TABLE public."sales_daily_aggregate"
  ADD CONSTRAINT "chk_sales_daily_scope"
    CHECK (
      ("channel" IS NULL AND "agent_id" IS NULL AND "scope_key" = 'GLOBAL')
      OR ("channel" = 'DIRECT' AND "agent_id" IS NULL AND "scope_key" = 'DIRECT')
      OR ("channel" = 'AGENT' AND "agent_id" IS NOT NULL
          AND "scope_key" = 'AGENT:' || "agent_id")
    ),
  ADD CONSTRAINT "chk_sales_daily_totals"
    CHECK (
      "created_order_count" >= 0 AND "paid_order_count" >= 0
      AND "paid_amount" >= 0 AND "refunded_amount" >= 0
      AND "paid_units" >= 0 AND "refunded_units" >= 0
      AND "new_registration_count" >= 0 AND "new_binding_count" >= 0
      AND "active_agent_count" >= 0 AND "customer_total_snapshot" >= 0
      AND "net_sales_amount" = "paid_amount" - "refunded_amount"
      AND "net_units" = "paid_units" - "refunded_units"
    );

-- Every aggregate/entity version starts at 1 and remains positive.
DO $$
DECLARE
  version_column RECORD;
BEGIN
  FOR version_column IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'version'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (version >= 1)',
      version_column.table_name,
      'chk_' || version_column.table_name || '_version_positive'
    );
  END LOOP;
END $$;

-- All primary application IDs and session-family roots use Crockford Base32 ULIDs.
CREATE FUNCTION public.is_valid_ulid(value TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
STRICT
AS $$
  SELECT value ~ '^[0-9A-HJKMNP-TV-Z]{26}$'
$$;

DO $$
DECLARE
  id_column RECORD;
BEGIN
  FOR id_column IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'id' AND data_type = 'character'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (public.is_valid_ulid(id))',
      id_column.table_name,
      'chk_' || id_column.table_name || '_id_ulid'
    );
  END LOOP;
END $$;

ALTER TABLE public."auth_session"
  ADD CONSTRAINT "chk_auth_session_family_ulid" CHECK (public.is_valid_ulid("session_family"));

ALTER TABLE public."admin_reauth_grant"
  ADD CONSTRAINT "chk_reauth_grant_window"
  CHECK (
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + INTERVAL '60 seconds'
    AND (("status" = 'CONSUMED' AND "consumed_at" IS NOT NULL)
      OR ("status" <> 'CONSUMED' AND "consumed_at" IS NULL))
  );

ALTER TABLE public."admin_offline_recovery"
  ADD CONSTRAINT "chk_offline_recovery_window"
  CHECK ("target_account_version" >= 1 AND "expires_at" > "created_at");

-- Cross-table security invariants.
CREATE FUNCTION public.enforce_auth_session_assurance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  account_role public."AccountRole";
  account_status public."AccountStatus";
  factor_account_id CHAR(26);
  factor_status public."MfaFactorStatus";
BEGIN
  SELECT "role", "status"
    INTO account_role, account_status
  FROM public."account"
  WHERE "id" = NEW."account_id";

  IF account_role IS NULL THEN
    RAISE EXCEPTION 'auth session account does not exist';
  END IF;

  IF NEW."revoked_at" IS NULL AND account_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'active session requires an active account';
  END IF;

  IF account_role = 'SUPER_ADMIN'
     AND (NEW."assurance" <> 'MFA' OR NEW."restriction" <> 'NONE') THEN
    RAISE EXCEPTION 'SUPER_ADMIN business session requires MFA assurance';
  END IF;

  IF NEW."mfa_factor_id" IS NOT NULL THEN
    SELECT "account_id", "status"
      INTO factor_account_id, factor_status
    FROM public."totp_factor"
    WHERE "id" = NEW."mfa_factor_id";

    IF factor_account_id IS DISTINCT FROM NEW."account_id" OR factor_status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'MFA session requires an active factor owned by the same account';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_auth_session_assurance"
BEFORE INSERT OR UPDATE ON public."auth_session"
FOR EACH ROW EXECUTE FUNCTION public.enforce_auth_session_assurance();

CREATE FUNCTION public.enforce_reauth_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  grant_session public."auth_session"%ROWTYPE;
  withdrawal_status public."WithdrawalStatus";
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."account_id" IS DISTINCT FROM OLD."account_id"
    OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
    OR NEW."action" IS DISTINCT FROM OLD."action"
    OR NEW."target_id" IS DISTINCT FROM OLD."target_id"
    OR NEW."token_hash" IS DISTINCT FROM OLD."token_hash"
    OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
  ) THEN
    RAISE EXCEPTION 'reauth grant identity and expiry are immutable';
  END IF;

  IF NEW."status" = 'ACTIVE' THEN
    SELECT * INTO grant_session
    FROM public."auth_session"
    WHERE "id" = NEW."session_id";

    IF grant_session."account_id" IS DISTINCT FROM NEW."account_id"
       OR grant_session."revoked_at" IS NOT NULL
       OR grant_session."assurance" <> 'MFA'
       OR grant_session."restriction" <> 'NONE'
       OR grant_session."expires_at" <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'reauth grant requires a live MFA session for the same administrator';
    END IF;

    IF NEW."expires_at" > grant_session."expires_at" THEN
      RAISE EXCEPTION 'reauth grant cannot outlive its session';
    END IF;

    IF NEW."action" = 'PAYOUT_ACCOUNT_REVEAL' THEN
      SELECT "status" INTO withdrawal_status
      FROM public."withdrawal"
      WHERE "id" = NEW."target_id";

      IF withdrawal_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'bank account reveal is restricted to APPROVED withdrawals';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_reauth_grant"
BEFORE INSERT OR UPDATE ON public."admin_reauth_grant"
FOR EACH ROW EXECUTE FUNCTION public.enforce_reauth_grant();

CREATE FUNCTION public.enforce_offline_recovery_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  recovery public."admin_offline_recovery"%ROWTYPE;
  approver_role public."AccountRole";
  approver_status public."AccountStatus";
BEGIN
  SELECT * INTO recovery
  FROM public."admin_offline_recovery"
  WHERE "id" = NEW."recovery_id"
  FOR UPDATE;

  IF recovery."id" IS NULL
     OR recovery."status" NOT IN ('PENDING_APPROVAL', 'APPROVED')
     OR recovery."expires_at" <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'offline recovery is not open for approval';
  END IF;

  IF NEW."approver_id" IN (recovery."target_account_id", recovery."requested_by_id") THEN
    RAISE EXCEPTION 'target and requester cannot approve the same offline recovery';
  END IF;

  SELECT "role", "status"
    INTO approver_role, approver_status
  FROM public."account"
  WHERE "id" = NEW."approver_id";

  IF approver_role IS DISTINCT FROM 'SUPER_ADMIN' OR approver_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION 'offline recovery approver must be a distinct active SUPER_ADMIN';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_offline_recovery_approval"
BEFORE INSERT ON public."admin_offline_recovery_approval"
FOR EACH ROW EXECUTE FUNCTION public.enforce_offline_recovery_approval();

CREATE FUNCTION public.enforce_offline_recovery_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  approved_count INTEGER;
  rejected_count INTEGER;
  current_account_version INTEGER;
BEGIN
  IF NEW."target_account_id" IS DISTINCT FROM OLD."target_account_id"
     OR NEW."requested_by_id" IS DISTINCT FROM OLD."requested_by_id"
     OR NEW."target_account_version" IS DISTINCT FROM OLD."target_account_version"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at" THEN
    RAISE EXCEPTION 'offline recovery target, version, reason and expiry are immutable';
  END IF;

  SELECT count(*) FILTER (WHERE "decision" = 'APPROVED'),
         count(*) FILTER (WHERE "decision" = 'REJECTED')
    INTO approved_count, rejected_count
  FROM public."admin_offline_recovery_approval"
  WHERE "recovery_id" = NEW."id";

  SELECT "version" INTO current_account_version
  FROM public."account"
  WHERE "id" = NEW."target_account_id";

  IF NEW."status" = 'APPROVED' AND OLD."status" <> 'APPROVED' THEN
    IF approved_count < 2 OR rejected_count > 0
       OR NEW."approved_at" IS NULL
       OR current_account_version IS DISTINCT FROM NEW."target_account_version" THEN
      RAISE EXCEPTION 'offline recovery approval requires two distinct approvals and the frozen account version';
    END IF;
  END IF;

  IF NEW."status" = 'EXECUTED' AND OLD."status" <> 'EXECUTED' THEN
    IF OLD."status" <> 'APPROVED'
       OR approved_count < 2 OR rejected_count > 0
       OR NEW."executed_by_id" IS NULL
       OR NEW."new_credential_fingerprint" IS NULL
       OR NEW."executed_at" IS NULL
       OR NEW."sessions_revoked_at" IS NULL
       OR current_account_version IS DISTINCT FROM NEW."target_account_version" + 1 THEN
      RAISE EXCEPTION 'offline recovery execution is incomplete or account version is stale';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_offline_recovery_state"
BEFORE UPDATE ON public."admin_offline_recovery"
FOR EACH ROW EXECUTE FUNCTION public.enforce_offline_recovery_state();

-- Version payloads are immutable; only DRAFT -> PUBLISHED/ARCHIVED and
-- PUBLISHED -> ARCHIVED lifecycle transitions are allowed.
CREATE FUNCTION public.guard_config_version_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  old_payload JSONB;
  new_payload JSONB;
BEGIN
  old_payload := to_jsonb(OLD) - 'status' - 'effective_at';
  new_payload := to_jsonb(NEW) - 'status' - 'effective_at';

  IF old_payload IS DISTINCT FROM new_payload THEN
    RAISE EXCEPTION 'published configuration payload is immutable; create a new version';
  END IF;

  IF OLD."status" = NEW."status" THEN
    IF OLD."effective_at" IS DISTINCT FROM NEW."effective_at" THEN
      RAISE EXCEPTION 'effective_at may change only when a DRAFT is published';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'PUBLISHED' THEN
    IF NEW."effective_at" IS NULL THEN
      RAISE EXCEPTION 'published configuration requires effective_at';
    END IF;
  ELSIF OLD."status" = 'DRAFT' AND NEW."status" = 'ARCHIVED' THEN
    IF OLD."effective_at" IS DISTINCT FROM NEW."effective_at" THEN
      RAISE EXCEPTION 'archiving a draft cannot alter effective_at';
    END IF;
  ELSIF OLD."status" = 'PUBLISHED' AND NEW."status" = 'ARCHIVED' THEN
    IF OLD."effective_at" IS DISTINCT FROM NEW."effective_at" THEN
      RAISE EXCEPTION 'archiving a published version cannot alter effective_at';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid configuration version transition';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_commission_rule_version_immutable"
BEFORE UPDATE ON public."commission_rule_version"
FOR EACH ROW EXECUTE FUNCTION public.guard_config_version_update();

CREATE TRIGGER "trg_business_rule_version_immutable"
BEFORE UPDATE ON public."business_rule_version"
FOR EACH ROW EXECUTE FUNCTION public.guard_config_version_update();

CREATE TRIGGER "trg_return_address_version_immutable"
BEFORE UPDATE ON public."return_address_version"
FOR EACH ROW EXECUTE FUNCTION public.guard_config_version_update();

CREATE FUNCTION public.guard_commission_rule_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  parent_status public."CommissionRuleVersionStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'commission rule entries are append-only';
  END IF;

  SELECT "status" INTO parent_status
  FROM public."commission_rule_version"
  WHERE "id" = NEW."rule_version_id";

  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'commission rule entries can be added only to a DRAFT version';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_commission_rule_entry_append_only"
BEFORE INSERT OR UPDATE OR DELETE ON public."commission_rule_entry"
FOR EACH ROW EXECUTE FUNCTION public.guard_commission_rule_entry();

CREATE FUNCTION public.guard_sales_order_payment_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."pay_expires_at" IS DISTINCT FROM OLD."pay_expires_at" THEN
    RAISE EXCEPTION 'order creation time and payment expiry are immutable';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_sales_order_payment_window_guard"
BEFORE UPDATE OF "created_at", "pay_expires_at" ON public."sales_order"
FOR EACH ROW EXECUTE FUNCTION public.guard_sales_order_payment_window();

CREATE FUNCTION public.enforce_return_inspection_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  inspection_status public."ReturnInspectionStatus";
  reserved_return_qty INTEGER;
BEGIN
  SELECT ri."status", ai."reserved_qty"
    INTO inspection_status, reserved_return_qty
  FROM public."return_inspection" ri
  JOIN public."aftersale_item" ai
    ON ai."aftersale_id" = ri."aftersale_id"
   AND ai."order_item_id" = NEW."order_item_id"
  WHERE ri."id" = NEW."inspection_id"
  FOR SHARE OF ri, ai;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inspection item must reference an item reserved by the same aftersale';
  END IF;

  IF NEW."received_qty" > reserved_return_qty THEN
    RAISE EXCEPTION 'received quantity exceeds the reserved return quantity';
  END IF;

  IF inspection_status = 'PASS' THEN
    IF NEW."received_qty" <> reserved_return_qty
       OR NEW."approved_refund_qty" <> reserved_return_qty
       OR NEW."return_to_customer_qty" <> 0 THEN
      RAISE EXCEPTION 'PASS requires full receipt, full refund approval, and no return-to-customer quantity';
    END IF;
  ELSIF NEW."approved_refund_qty" <> NEW."received_qty" - NEW."return_to_customer_qty"
     OR NEW."approved_refund_qty" <> NEW."restock_qty" + NEW."damaged_qty" + NEW."scrap_qty" THEN
    RAISE EXCEPTION 'ABNORMAL inspection must refund every received item retained by headquarters';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_return_inspection_item_guard"
BEFORE INSERT OR UPDATE ON public."return_inspection_item"
FOR EACH ROW EXECUTE FUNCTION public.enforce_return_inspection_item();

CREATE FUNCTION public.guard_return_inspection_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."resolution" IS NOT NULL
       OR NEW."resolved_at" IS NOT NULL
       OR NEW."resolution_note" IS NOT NULL THEN
      RAISE EXCEPTION 'return inspection resolution must be appended after inspection creation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."aftersale_id" IS DISTINCT FROM OLD."aftersale_id"
     OR NEW."status" IS DISTINCT FROM OLD."status"
     OR NEW."inspected_by_id" IS DISTINCT FROM OLD."inspected_by_id"
     OR NEW."abnormal_reason" IS DISTINCT FROM OLD."abnormal_reason"
     OR NEW."evidence_manifest" IS DISTINCT FROM OLD."evidence_manifest"
     OR NEW."evidence_count" IS DISTINCT FROM OLD."evidence_count"
     OR NEW."inspected_at" IS DISTINCT FROM OLD."inspected_at"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
    RAISE EXCEPTION 'return inspection decision and evidence envelope are immutable';
  END IF;

  IF OLD."resolution" IS NOT NULL
     OR OLD."resolved_at" IS NOT NULL
     OR OLD."resolution_note" IS NOT NULL
     OR NEW."resolution" IS NULL
     OR NEW."resolved_at" IS NULL
     OR NEW."resolution_note" IS NULL
     OR NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'return inspection resolution is append-once and must increment version';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_return_inspection_update_guard"
BEFORE INSERT OR UPDATE ON public."return_inspection"
FOR EACH ROW EXECUTE FUNCTION public.guard_return_inspection_update();

CREATE FUNCTION public.enforce_return_inspection_coverage()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_inspection_id TEXT;
  target_aftersale_id TEXT;
BEGIN
  IF TG_TABLE_NAME = 'return_inspection' THEN
    target_inspection_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_inspection_id := COALESCE(NEW."inspection_id", OLD."inspection_id");
  END IF;

  SELECT "aftersale_id" INTO target_aftersale_id
  FROM public."return_inspection"
  WHERE "id" = target_inspection_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
      SELECT ai."order_item_id"
      FROM public."aftersale_item" ai
      WHERE ai."aftersale_id" = target_aftersale_id
      EXCEPT
      SELECT rii."order_item_id"
      FROM public."return_inspection_item" rii
      WHERE rii."inspection_id" = target_inspection_id
    ) OR EXISTS (
      SELECT rii."order_item_id"
      FROM public."return_inspection_item" rii
      WHERE rii."inspection_id" = target_inspection_id
      EXCEPT
      SELECT ai."order_item_id"
      FROM public."aftersale_item" ai
      WHERE ai."aftersale_id" = target_aftersale_id
    ) THEN
    RAISE EXCEPTION 'return inspection items must exactly cover every item in the aftersale';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "trg_return_inspection_coverage_parent"
AFTER INSERT OR UPDATE ON public."return_inspection"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_return_inspection_coverage();

CREATE CONSTRAINT TRIGGER "trg_return_inspection_coverage_items"
AFTER INSERT OR UPDATE OR DELETE ON public."return_inspection_item"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_return_inspection_coverage();

CREATE FUNCTION public.enforce_return_inspection_evidence_manifest()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_inspection_id TEXT;
  expected_aftersale_id TEXT;
  inspection_status public."ReturnInspectionStatus";
  expected_manifest JSONB;
  expected_count INTEGER;
  actual_manifest JSONB;
  actual_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'return_inspection' THEN
    target_inspection_id := COALESCE(NEW."id", OLD."id");
  ELSE
    target_inspection_id := COALESCE(NEW."return_inspection_id", OLD."return_inspection_id");
  END IF;

  IF target_inspection_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ri."aftersale_id", ri."status", ri."evidence_manifest", ri."evidence_count"
    INTO expected_aftersale_id, inspection_status, expected_manifest, expected_count
  FROM public."return_inspection" ri
  WHERE ri."id" = target_inspection_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(jsonb_agg(to_jsonb(e."file_id") ORDER BY e."file_id"), '[]'::jsonb),
    COUNT(*)::INTEGER
    INTO actual_manifest, actual_count
  FROM public."aftersale_evidence" e
  WHERE e."return_inspection_id" = target_inspection_id;

  IF EXISTS (
    SELECT 1
    FROM public."aftersale_evidence" e
    WHERE e."return_inspection_id" = target_inspection_id
      AND e."aftersale_id" <> expected_aftersale_id
  ) THEN
    RAISE EXCEPTION 'inspection evidence must belong to the same aftersale';
  END IF;

  IF inspection_status = 'ABNORMAL' AND expected_count < 1 THEN
    RAISE EXCEPTION 'ABNORMAL inspection requires at least one sealed evidence file';
  END IF;

  IF actual_count <> expected_count OR actual_manifest IS DISTINCT FROM expected_manifest THEN
    RAISE EXCEPTION 'inspection evidence must exactly match the sealed manifest';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "trg_return_inspection_evidence_parent"
AFTER INSERT OR UPDATE ON public."return_inspection"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_return_inspection_evidence_manifest();

CREATE CONSTRAINT TRIGGER "trg_return_inspection_evidence_rows"
AFTER INSERT OR UPDATE OR DELETE ON public."aftersale_evidence"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.enforce_return_inspection_evidence_manifest();

CREATE FUNCTION public.enforce_refund_item_return_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  refund_origin public."RefundOriginType";
  refund_aftersale_id TEXT;
  aftersale_type public."AftersaleType";
  reserved_quantity INTEGER;
  already_refunded_quantity INTEGER;
  approved_quantity INTEGER;
BEGIN
  SELECT "origin_type", "aftersale_id"
    INTO refund_origin, refund_aftersale_id
  FROM public."refund"
  WHERE "id" = NEW."refund_id"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund item must reference an existing refund';
  END IF;

  IF refund_origin <> 'AFTERSALE' THEN
    IF NEW."aftersale_item_id" IS NOT NULL THEN
      RAISE EXCEPTION 'non-aftersale refund item cannot reference an aftersale item';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."aftersale_item_id" IS NULL THEN
    RAISE EXCEPTION 'aftersale refund item requires aftersale_item_id';
  END IF;

  SELECT a."type", ai."reserved_qty", ai."refunded_qty"
    INTO aftersale_type, reserved_quantity, already_refunded_quantity
  FROM public."aftersale" a
  JOIN public."aftersale_item" ai
    ON ai."aftersale_id" = a."id"
   AND ai."id" = NEW."aftersale_item_id"
   AND ai."order_item_id" = NEW."order_item_id"
  WHERE a."id" = refund_aftersale_id
  FOR UPDATE OF ai;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund item must belong to the refund aftersale and order item';
  END IF;

  IF NEW."quantity" > reserved_quantity - already_refunded_quantity THEN
    RAISE EXCEPTION 'refund quantity exceeds the remaining aftersale reservation';
  END IF;

  IF aftersale_type = 'RETURN_REFUND' THEN
    SELECT rii."approved_refund_qty"
      INTO approved_quantity
    FROM public."return_inspection" ri
    JOIN public."return_inspection_item" rii
      ON rii."inspection_id" = ri."id"
     AND rii."order_item_id" = NEW."order_item_id"
    WHERE ri."aftersale_id" = refund_aftersale_id
    FOR SHARE OF ri, rii;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'returned-goods refund requires a completed inspection item';
    END IF;

    IF NEW."quantity" > approved_quantity - already_refunded_quantity THEN
      RAISE EXCEPTION 'refund quantity exceeds the frozen inspection approval';
    END IF;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_refund_item_return_limit"
BEFORE INSERT OR UPDATE ON public."refund_item"
FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_item_return_limit();

CREATE FUNCTION public.enforce_commission_position_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_original NUMERIC(18, 2);
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."snapshot_id" IS DISTINCT FROM OLD."snapshot_id" THEN
    RAISE EXCEPTION 'commission position snapshot_id is immutable';
  END IF;

  SELECT "original_commission"
    INTO snapshot_original
  FROM public."order_item_commission_snapshot"
  WHERE "id" = NEW."snapshot_id"
  FOR SHARE;

  IF NOT FOUND OR NEW."original_commission" IS DISTINCT FROM snapshot_original THEN
    RAISE EXCEPTION 'commission position original amount must equal its immutable snapshot';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_commission_position_snapshot_guard"
BEFORE INSERT OR UPDATE ON public."order_item_commission_position"
FOR EACH ROW EXECUTE FUNCTION public.enforce_commission_position_snapshot();

-- File attachment validation closes the upload -> READY -> attach contract.
CREATE FUNCTION public.assert_file_attachment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  linked_file_id TEXT;
  asset_purpose TEXT;
  asset_status TEXT;
  asset_visibility TEXT;
  asset_deleted_at TIMESTAMPTZ;
BEGIN
  linked_file_id := to_jsonb(NEW) ->> TG_ARGV[1];
  IF linked_file_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "purpose"::TEXT, "status"::TEXT, "visibility"::TEXT, "deleted_at"
    INTO asset_purpose, asset_status, asset_visibility, asset_deleted_at
  FROM public."file_asset"
  WHERE "id" = linked_file_id;

  IF asset_purpose IS DISTINCT FROM TG_ARGV[0]
     OR asset_status IS DISTINCT FROM 'READY'
     OR asset_deleted_at IS NOT NULL
     OR (TG_ARGV[2] <> '*' AND asset_visibility IS DISTINCT FROM TG_ARGV[2]) THEN
    RAISE EXCEPTION 'file attachment requires a READY, nondeleted asset with the expected purpose and visibility';
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "trg_product_image_file"
BEFORE INSERT OR UPDATE OF "file_id" ON public."product_image"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('PRODUCT_IMAGE', 'file_id', 'PUBLIC');

CREATE TRIGGER "trg_brand_logo_file"
BEFORE INSERT OR UPDATE OF "logo_file_id" ON public."brand"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('BRAND_LOGO', 'logo_file_id', 'PUBLIC');

CREATE TRIGGER "trg_category_icon_file"
BEFORE INSERT OR UPDATE OF "icon_file_id" ON public."category"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('CATEGORY_ICON', 'icon_file_id', 'PUBLIC');

CREATE TRIGGER "trg_banner_file"
BEFORE INSERT OR UPDATE OF "file_id" ON public."banner"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('BANNER', 'file_id', 'PUBLIC');

CREATE TRIGGER "trg_aftersale_evidence_file"
BEFORE INSERT OR UPDATE OF "file_id" ON public."aftersale_evidence"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('AFTERSALE_EVIDENCE', 'file_id', 'PRIVATE');

CREATE TRIGGER "trg_withdrawal_proof_file"
BEFORE INSERT OR UPDATE OF "file_id" ON public."withdrawal_proof"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('WITHDRAWAL_PROOF', 'file_id', 'PRIVATE');

CREATE TRIGGER "trg_promotion_qr_file"
BEFORE INSERT OR UPDATE OF "qr_file_id" ON public."promotion_asset"
FOR EACH ROW EXECUTE FUNCTION public.assert_file_attachment('PROMOTION_QR', 'qr_file_id', 'PRIVATE');

-- Role bootstrap. Production credentials are injected out of band; this migration
-- contains no password and must run through the privileged migration path.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mall_runtime') THEN
    CREATE ROLE mall_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mall_migrator') THEN
    CREATE ROLE mall_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO mall_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO mall_migrator;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated, service_role;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO mall_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mall_runtime;
REVOKE DELETE ON ALL TABLES IN SCHEMA public FROM mall_runtime;
GRANT DELETE ON TABLE
  public."favorite",
  public."cart_item",
  public."customer_phone_verification",
  public."customer_address"
TO mall_runtime;

-- Append-only facts cannot be overwritten by the runtime role.
REVOKE UPDATE ON TABLE
  public."consent_record",
  public."binding_change_log",
  public."inventory_ledger",
  public."order_address_snapshot",
  public."order_attribution_snapshot",
  public."shipment_item",
  public."logistics_event",
  public."aftersale_evidence",
  public."return_address_snapshot",
  public."return_inspection_item",
  public."refund_item",
  public."commission_rule_entry",
  public."order_item_commission_snapshot",
  public."commission_ledger",
  public."withdrawal_bank_snapshot",
  public."withdrawal_proof",
  public."audit_log"
FROM mall_runtime;

REVOKE UPDATE ON TABLE public."callback_inbox" FROM mall_runtime;
GRANT UPDATE ("status", "retry_count", "processed_at", "error_message")
  ON TABLE public."callback_inbox" TO mall_runtime;

REVOKE UPDATE ON TABLE public."return_inspection" FROM mall_runtime;
GRANT UPDATE ("resolution", "resolution_note", "resolved_at", "version", "updated_at")
  ON TABLE public."return_inspection" TO mall_runtime;

-- RLS is enabled for the explicit 76-table application inventory. Object-level
-- customer and agent scope remains a NestJS RBAC responsibility.
DO $$
DECLARE
  app_table TEXT;
  app_tables CONSTANT TEXT[] := ARRAY[
    'account',
    'auth_session',
    'totp_factor',
    'totp_recovery_code',
    'mfa_challenge',
    'mfa_rate_limit',
    'customer_profile',
    'customer_phone_verification',
    'consent_record',
    'account_deletion_request',
    'admin_reauth_attempt',
    'admin_reauth_grant',
    'admin_offline_recovery',
    'admin_offline_recovery_approval',
    'agent_profile',
    'agent_invite_code',
    'agent_product_whitelist',
    'promotion_asset',
    'attribution_candidate',
    'customer_agent_binding',
    'binding_change_log',
    'brand',
    'category',
    'product',
    'sku',
    'file_asset',
    'product_image',
    'banner',
    'favorite',
    'cart',
    'cart_item',
    'customer_address',
    'inventory_balance',
    'inventory_reservation',
    'inventory_reservation_item',
    'inventory_ledger',
    'sales_order',
    'order_item',
    'order_address_snapshot',
    'order_attribution_candidate',
    'order_attribution_snapshot',
    'agent_customer_privacy_projection',
    'payment_intent',
    'payment_attempt',
    'callback_inbox',
    'shipment',
    'shipment_item',
    'logistics_event',
    'aftersale',
    'aftersale_item',
    'aftersale_evidence',
    'return_shipment',
    'return_address_version',
    'return_address_snapshot',
    'return_inspection',
    'return_inspection_item',
    'refund',
    'refund_attempt',
    'refund_item',
    'manual_compensation',
    'commission_rule_version',
    'commission_rule_entry',
    'order_item_commission_snapshot',
    'order_item_commission_position',
    'commission_ledger',
    'agent_wallet',
    'agent_bank_account',
    'withdrawal',
    'withdrawal_bank_snapshot',
    'withdrawal_proof',
    'business_rule_version',
    'idempotency_record',
    'high_risk_operation_preview',
    'outbox_event',
    'audit_log',
    'sales_daily_aggregate'
  ];
BEGIN
  IF cardinality(app_tables) <> 76 THEN
    RAISE EXCEPTION 'RLS application table inventory must contain exactly 76 tables';
  END IF;

  FOREACH app_table IN ARRAY app_tables
  LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN
      RAISE EXCEPTION 'RLS inventory references missing table %', app_table;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format(
      'CREATE POLICY mall_runtime_access ON public.%I FOR ALL TO mall_runtime USING (TRUE) WITH CHECK (TRUE)',
      app_table
    );
  END LOOP;
END $$;

-- The privileged bootstrap account creates roles and the initial objects once.
-- Transfer application object ownership so every later Prisma migration can run
-- through DIRECT_URL as mall_migrator without using the project-owner account.
DO $$
DECLARE
  app_table TEXT;
  app_enum TEXT;
BEGIN
  FOR app_table IN
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public'
      AND policyname = 'mall_runtime_access'
    ORDER BY tablename
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO mall_migrator', app_table);
  END LOOP;

  IF (
    SELECT count(*)
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
  ) <> 59 THEN
    RAISE EXCEPTION 'application enum inventory must contain exactly 59 enums';
  END IF;

  FOR app_enum IN
    SELECT t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype = 'e'
    ORDER BY t.typname
  LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO mall_migrator', app_enum);
  END LOOP;
END $$;

ALTER FUNCTION public.is_valid_ulid(TEXT) OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_auth_session_assurance() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_reauth_grant() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_offline_recovery_approval() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_offline_recovery_state() OWNER TO mall_migrator;
ALTER FUNCTION public.guard_config_version_update() OWNER TO mall_migrator;
ALTER FUNCTION public.guard_commission_rule_entry() OWNER TO mall_migrator;
ALTER FUNCTION public.guard_sales_order_payment_window() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_return_inspection_item() OWNER TO mall_migrator;
ALTER FUNCTION public.guard_return_inspection_update() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_return_inspection_coverage() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_return_inspection_evidence_manifest() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_refund_item_return_limit() OWNER TO mall_migrator;
ALTER FUNCTION public.enforce_commission_position_snapshot() OWNER TO mall_migrator;
ALTER FUNCTION public.assert_file_attachment() OWNER TO mall_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO mall_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE mall_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mall_runtime;
