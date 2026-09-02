export const B13_PREDEPLOY_CHECKS = Object.freeze([
  {
    key: "agent-promotion",
    error: "agent, invite, promotion or attribution data have invalid envelope(s)",
    sql: `SELECT count(*)
      FROM (
        SELECT a.id
        FROM public.account a
        LEFT JOIN public.agent_profile ap ON ap.account_id = a.id
        WHERE (a.role = 'AGENT_ADMIN' AND ap.id IS NULL)
           OR (a.role <> 'AGENT_ADMIN' AND ap.id IS NOT NULL)
        UNION ALL
        SELECT ap.id
        FROM public.agent_profile ap
        LEFT JOIN public.account a ON a.id = ap.account_id
        WHERE a.id IS NULL
           OR a.role IS DISTINCT FROM 'AGENT_ADMIN'
           OR ap.version < 1
           OR (ap.status = 'ACTIVE' AND ap.deleted_at IS NOT NULL)
           OR (ap.contact_phone_ciphertext IS NOT NULL AND (
             octet_length(ap.contact_phone_ciphertext) = 0
             OR ap.contact_phone_last4 !~ '^[0-9]{4}$'
             OR length(btrim(ap.contact_phone_encryption_key_id)) < 3
           ))
        UNION ALL
        SELECT i.id
        FROM public.agent_invite_code i
        WHERE octet_length(i.code_ciphertext) = 0
           OR i.code_hash !~ '^[0-9a-f]{64}$'
           OR length(btrim(i.code_last4)) <> 4
           OR length(btrim(i.encryption_key_id)) < 3
           OR (i.expires_at IS NOT NULL AND i.expires_at <= i.effective_at)
           OR (i.ended_at IS NOT NULL AND i.ended_at < i.effective_at)
           OR ((i.ended_at IS NULL) <> (i.end_reason IS NULL))
           OR (i.end_reason IS NOT NULL AND length(btrim(i.end_reason)) < 2)
           OR (i.status = 'ACTIVE' AND i.ended_at IS NOT NULL)
           OR (i.status IN ('ROTATED', 'EXPIRED') AND i.ended_at IS NULL)
           OR (i.status = 'EXPIRED' AND i.expires_at IS NULL)
           OR (i.status = 'EXPIRED' AND i.ended_at < i.expires_at)
        UNION ALL
        SELECT p.id
        FROM public.promotion_asset p
        LEFT JOIN public.agent_invite_code i ON i.id = p.invite_code_id
        WHERE i.id IS NULL
           OR i.agent_id IS DISTINCT FROM p.agent_id
           OR p.authorization_version < 1
           OR length(btrim(p.public_url)) = 0
           OR (p.target_type = 'STOREFRONT' AND p.target_product_id IS NOT NULL)
           OR (p.target_type = 'PRODUCT' AND p.target_product_id IS NULL)
           OR (p.expires_at IS NOT NULL AND p.expires_at <= p.created_at)
           OR (p.revoked_at IS NOT NULL AND p.revoked_at < p.created_at)
           OR (p.status = 'ACTIVE' AND p.revoked_at IS NOT NULL)
           OR (p.status IN ('REVOKED', 'EXPIRED') AND p.revoked_at IS NULL)
           OR (p.status = 'EXPIRED' AND p.expires_at IS NULL)
           OR (p.status = 'EXPIRED' AND p.revoked_at < p.expires_at)
        UNION ALL
        SELECT c.id
        FROM public.attribution_candidate c
        LEFT JOIN public.agent_invite_code i ON i.id = c.invite_code_id
        LEFT JOIN public.promotion_asset p ON p.id = c.promotion_asset_id
        WHERE i.id IS NULL
           OR p.id IS NULL
           OR i.agent_id IS DISTINCT FROM c.agent_id
           OR p.agent_id IS DISTINCT FROM c.agent_id
           OR p.invite_code_id IS DISTINCT FROM c.invite_code_id
           OR c.expires_at <= c.created_at
           OR (c.confirmed_at IS NOT NULL AND c.confirmed_at < c.created_at)
           OR (c.status = 'ACTIVE' AND (c.confirmed_at IS NOT NULL OR c.invalid_reason IS NOT NULL))
           OR (c.status = 'CONFIRMED' AND (c.confirmed_at IS NULL OR c.invalid_reason IS NOT NULL))
           OR (c.status IN ('REJECTED', 'EXPIRED', 'INVALIDATED') AND (
             c.confirmed_at IS NOT NULL OR c.invalid_reason IS NULL
             OR length(btrim(c.invalid_reason)) < 2
           ))
      ) AS invalid_agent_promotion_facts`,
  },
  {
    key: "commission-rule",
    error: "commission rule data have invalid lifecycle or base reference(s)",
    sql: `SELECT count(*)
      FROM public.commission_rule_version v
      WHERE v.base_version_id IS NOT DISTINCT FROM v.id
         OR (v.status = 'PUBLISHED' AND v.effective_at IS NULL)`,
  },
  {
    key: "commission-snapshot",
    error: "commission snapshot data have invalid order-item or agent envelope(s)",
    sql: `SELECT count(*)
      FROM public.order_item_commission_snapshot s
      LEFT JOIN public.order_item oi ON oi.id = s.order_item_id
      LEFT JOIN public.sales_order o ON o.id = oi.order_id
      WHERE oi.id IS NULL
         OR o.id IS NULL
         OR s.category_id_snapshot IS DISTINCT FROM oi.category_id
         OR s.product_id_snapshot IS DISTINCT FROM oi.product_id
         OR s.sku_id_snapshot IS DISTINCT FROM oi.sku_id
         OR s.commission_base IS DISTINCT FROM oi.line_paid_amount
         OR s.original_commission IS DISTINCT FROM round(
           s.commission_base * s.effective_rate / 100,
           2
         )
         OR o.final_channel IS DISTINCT FROM 'AGENT'
         OR o.final_agent_id IS DISTINCT FROM s.agent_id`,
  },
  {
    key: "commission-ledger",
    error: "commission ledger data have invalid reference or balance-change envelope(s)",
    sql: `SELECT count(*)
      FROM public.commission_ledger l
      LEFT JOIN public.order_item_commission_snapshot s ON s.id = l.snapshot_id
      LEFT JOIN public.order_item oi ON oi.id = s.order_item_id
      LEFT JOIN public.refund r ON r.id = l.refund_id
      LEFT JOIN public.withdrawal w ON w.id = l.withdrawal_id
      WHERE (l.snapshot_id IS NOT NULL AND (
          s.id IS NULL OR s.agent_id IS DISTINCT FROM l.agent_id
        ))
        OR (l.refund_id IS NOT NULL AND (
          r.id IS NULL OR oi.id IS NULL OR r.order_id IS DISTINCT FROM oi.order_id
        ))
        OR (l.withdrawal_id IS NOT NULL AND (
          w.id IS NULL
          OR w.agent_id IS DISTINCT FROM l.agent_id
          OR CASE l.ledger_type
            WHEN 'WITHDRAWAL_FREEZE' THEN
              -l.available_change IS DISTINCT FROM w.amount
              OR l.frozen_change IS DISTINCT FROM w.amount
            WHEN 'WITHDRAWAL_RELEASE' THEN
              l.available_change IS DISTINCT FROM w.amount
              OR -l.frozen_change IS DISTINCT FROM w.amount
            WHEN 'WITHDRAWAL_PAID' THEN
              -l.frozen_change IS DISTINCT FROM w.amount
            ELSE TRUE
          END
        ))
        OR NOT (
          (l.ledger_type = 'EXPECTED_CREATED'
            AND l.snapshot_id IS NOT NULL AND l.refund_id IS NULL AND l.withdrawal_id IS NULL
            AND l.expected_change > 0 AND l.available_change = 0 AND l.frozen_change = 0)
          OR (l.ledger_type IN ('EXPECTED_REDUCED', 'EXPECTED_CANCELLED')
            AND l.snapshot_id IS NOT NULL AND l.refund_id IS NOT NULL AND l.withdrawal_id IS NULL
            AND l.expected_change < 0 AND l.available_change = 0 AND l.frozen_change = 0)
          OR (l.ledger_type = 'AVAILABLE_CREDIT'
            AND l.snapshot_id IS NOT NULL AND l.refund_id IS NULL AND l.withdrawal_id IS NULL
            AND l.expected_change < 0 AND l.available_change = -l.expected_change
            AND l.frozen_change = 0)
          OR (l.ledger_type = 'REFUND_DEBIT'
            AND l.snapshot_id IS NOT NULL AND l.refund_id IS NOT NULL AND l.withdrawal_id IS NULL
            AND l.expected_change = 0 AND l.available_change < 0 AND l.frozen_change = 0)
          OR (l.ledger_type = 'WITHDRAWAL_FREEZE'
            AND l.snapshot_id IS NULL AND l.refund_id IS NULL AND l.withdrawal_id IS NOT NULL
            AND l.expected_change = 0 AND l.available_change < 0
            AND l.frozen_change = -l.available_change)
          OR (l.ledger_type = 'WITHDRAWAL_RELEASE'
            AND l.snapshot_id IS NULL AND l.refund_id IS NULL AND l.withdrawal_id IS NOT NULL
            AND l.expected_change = 0 AND l.available_change > 0
            AND l.frozen_change = -l.available_change)
          OR (l.ledger_type = 'WITHDRAWAL_PAID'
            AND l.snapshot_id IS NULL AND l.refund_id IS NULL AND l.withdrawal_id IS NOT NULL
            AND l.expected_change = 0 AND l.available_change = 0 AND l.frozen_change < 0)
        )`,
  },
  {
    key: "commission-ledger-duplicates",
    error: "commission ledger data have duplicate withdrawal lifecycle fact group(s)",
    sql: `SELECT count(*)
      FROM (
        SELECT 1
        FROM public.commission_ledger
        WHERE withdrawal_id IS NOT NULL
        GROUP BY withdrawal_id, ledger_type
        HAVING count(*) > 1
      ) AS duplicate_withdrawal_ledger_facts`,
  },
  {
    key: "wallet",
    error: "agent wallet data have invalid version envelope(s)",
    sql: `SELECT count(*) FROM public.agent_wallet WHERE version < 1`,
  },
  {
    key: "bank-account",
    error: "agent bank account data have invalid encrypted-value envelope(s)",
    sql: `SELECT count(*)
      FROM public.agent_bank_account b
      WHERE length(btrim(b.account_holder)) < 2
         OR length(btrim(b.bank_name)) < 2
         OR octet_length(b.account_no_ciphertext) = 0
         OR b.account_no_hash !~ '^[0-9a-f]{64}$'
         OR b.account_no_last4 !~ '^[0-9]{4}$'
         OR length(btrim(b.encryption_key_id)) < 3
         OR b.version < 1
         OR (b.deleted_at IS NOT NULL AND b.is_active)`,
  },
  {
    key: "withdrawal-bank-snapshot",
    error: "withdrawal data have forged bank snapshot envelope(s)",
    sql: `SELECT count(*)
      FROM public.withdrawal_bank_snapshot s
      LEFT JOIN public.withdrawal w ON w.id = s.withdrawal_id
      LEFT JOIN public.agent_bank_account b ON b.id = s.source_bank_account_id
      WHERE w.id IS NULL
         OR b.id IS NULL
         OR b.agent_id IS DISTINCT FROM w.agent_id
         OR s.account_holder IS DISTINCT FROM b.account_holder
         OR s.bank_name IS DISTINCT FROM b.bank_name
         OR s.account_no_ciphertext IS DISTINCT FROM b.account_no_ciphertext
         OR s.account_no_last4 IS DISTINCT FROM b.account_no_last4
         OR s.encryption_key_id IS DISTINCT FROM b.encryption_key_id
         OR length(btrim(s.account_holder)) < 2
         OR length(btrim(s.bank_name)) < 2
         OR octet_length(s.account_no_ciphertext) = 0
         OR s.account_no_last4 !~ '^[0-9]{4}$'
         OR length(btrim(s.encryption_key_id)) < 3`,
  },
  {
    key: "withdrawal-envelope",
    error: "withdrawal data have invalid state, amount or administrator envelope(s)",
    sql: `SELECT count(*)
      FROM public.withdrawal w
      LEFT JOIN public.account reviewer ON reviewer.id = w.reviewed_by_id
      LEFT JOIN public.account payer ON payer.id = w.paid_by_id
      WHERE w.amount > w.available_before
         OR w.frozen_after < w.amount
         OR w.version < 1
         OR w.updated_at < w.created_at
         OR (w.reviewed_by_id IS NOT NULL AND reviewer.role IS DISTINCT FROM 'SUPER_ADMIN')
         OR (w.paid_by_id IS NOT NULL AND payer.role IS DISTINCT FROM 'SUPER_ADMIN')
         OR NOT (
           (w.status = 'PENDING' AND num_nonnulls(
             w.review_reason, w.reviewed_by_id, w.reviewed_at, w.paid_by_id, w.paid_at
           ) = 0)
           OR (w.status = 'APPROVED'
             AND w.review_reason IS NULL
             AND w.reviewed_by_id IS NOT NULL AND w.reviewed_at IS NOT NULL
             AND w.paid_by_id IS NULL AND w.paid_at IS NULL)
           OR (w.status = 'REJECTED'
             AND w.review_reason IS NOT NULL AND length(btrim(w.review_reason)) >= 2
             AND w.reviewed_by_id IS NOT NULL AND w.reviewed_at IS NOT NULL
             AND w.paid_by_id IS NULL AND w.paid_at IS NULL)
           OR (w.status = 'PAID'
             AND w.review_reason IS NULL
             AND w.reviewed_by_id IS NOT NULL AND w.reviewed_at IS NOT NULL
             AND w.paid_by_id IS NOT NULL AND w.paid_at IS NOT NULL
             AND w.paid_at >= w.reviewed_at)
         )`,
  },
  {
    key: "withdrawal-completeness",
    error: "withdrawal data have incomplete bank snapshot, ledger or proof envelope(s)",
    sql: `SELECT count(*)
      FROM public.withdrawal w
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS snapshot_count
        FROM public.withdrawal_bank_snapshot s WHERE s.withdrawal_id = w.id
      ) bank ON TRUE
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS proof_count
        FROM public.withdrawal_proof p WHERE p.withdrawal_id = w.id
      ) proof ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          count(*) FILTER (WHERE ledger_type = 'WITHDRAWAL_FREEZE')::integer AS freeze_count,
          count(*) FILTER (WHERE ledger_type = 'WITHDRAWAL_RELEASE')::integer AS release_count,
          count(*) FILTER (WHERE ledger_type = 'WITHDRAWAL_PAID')::integer AS paid_count
        FROM public.commission_ledger l WHERE l.withdrawal_id = w.id
      ) ledger ON TRUE
      WHERE bank.snapshot_count <> 1
         OR ledger.freeze_count <> 1
         OR ledger.release_count <> CASE WHEN w.status = 'REJECTED' THEN 1 ELSE 0 END
         OR ledger.paid_count <> CASE WHEN w.status = 'PAID' THEN 1 ELSE 0 END
         OR (w.status = 'PAID' AND proof.proof_count < 1)
         OR (w.status NOT IN ('APPROVED', 'PAID') AND proof.proof_count <> 0)`,
  },
]);
