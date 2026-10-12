-- The deployed menu now uses the store-scoped v3 checkout RPC.
-- Disable unscoped legacy endpoints so orders cannot silently land in the primary store.
revoke all on function public.create_pending_order_with_location(text,text,text,text,text,text,text,jsonb,double precision,double precision,double precision,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.create_pending_order_with_location_v2(text,text,text,text,text,text,text,jsonb,double precision,double precision,double precision,text,text,text,text,text,text,text) from public,anon,authenticated;
