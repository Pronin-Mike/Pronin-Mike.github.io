-- Covers the audit foreign key and authenticated-user history lookups.
create index if not exists product_movements_created_by_idx
  on public.product_movements (created_by, created_at desc)
  where created_by is not null;
