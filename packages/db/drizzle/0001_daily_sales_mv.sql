CREATE MATERIALIZED VIEW daily_sales_mv AS
SELECT o.tenant_id,
       oi.event_id,
       (date_trunc('day', o.created_at AT TIME ZONE 'UTC'))::date AS day,
       count(*)::int AS tickets,
       COALESCE(sum(oi.price_cents), 0)::bigint AS revenue_cents
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.status = 'paid'
GROUP BY o.tenant_id, oi.event_id, (date_trunc('day', o.created_at AT TIME ZONE 'UTC'))::date;
--> statement-breakpoint
CREATE UNIQUE INDEX daily_sales_mv_pk ON daily_sales_mv (event_id, day);
