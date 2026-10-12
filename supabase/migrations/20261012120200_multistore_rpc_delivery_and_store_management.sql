DROP FUNCTION IF EXISTS public.validate_delivery_location(double precision,double precision,double precision);
CREATE FUNCTION public.validate_delivery_location(p_store_id uuid,p_lat double precision, p_lng double precision, p_accuracy_m double precision)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_inside_yucatan boolean := false;
  v_zone record;
  v_configured_count integer := 0;
  v_rain_enabled boolean := false;
  v_rain_amount numeric := 0;
  v_rain_message text := '';
  v_effective_fee numeric := 0;
  v_store_id uuid := p_store_id;
begin
  if v_store_id is null or not exists(select 1 from public.stores s where s.id=v_store_id and s.is_active) then
    return jsonb_build_object('ok',false,'code','SUCURSAL_NO_DISPONIBLE','inside_yucatan',false);
  end if;

  if p_lat is null or p_lng is null or p_accuracy_m is null then
    return jsonb_build_object('ok',false,'code','UBICACION_REQUERIDA','inside_yucatan',false);
  end if;

  if p_accuracy_m <= 0 or p_accuracy_m > 150 then
    return jsonb_build_object(
      'ok',false,'code','UBICACION_IMPRECISA','inside_yucatan',false,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select exists(
    select 1
    from private.delivery_service_areas a
    where a.area_key='yucatan_state'
      and extensions.st_covers(a.geom,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326))
  ) into v_inside_yucatan;

  if not v_inside_yucatan then
    return jsonb_build_object(
      'ok',false,'code','UBICACION_FUERA_DE_YUCATAN','inside_yucatan',false,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select count(*) into v_configured_count
  from public.delivery_zones
  where store_id=v_store_id and enabled=true and geom is not null;

  if v_configured_count=0 then
    return jsonb_build_object(
      'ok',false,'code','ZONAS_NO_CONFIGURADAS','inside_yucatan',true,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select z.id,z.name,z.fee,z.priority
  into v_zone
  from public.delivery_zones z
  where z.store_id=v_store_id and z.enabled=true
    and z.geom is not null
    and extensions.st_covers(z.geom,extensions.st_setsrid(extensions.st_makepoint(p_lng,p_lat),4326))
  order by z.priority,z.name
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok',false,'code','FUERA_DE_ZONA_DE_REPARTO','inside_yucatan',true,
      'accuracy_m',round(p_accuracy_m::numeric,0)
    );
  end if;

  select
    coalesce(bool_or(case when key='rain_surcharge_enabled'
      then lower(trim(value)) in ('true','1','yes','on') else false end),false),
    coalesce(max(case when key='rain_surcharge_amount'
      then case when trim(value) ~ '^[0-9]+([.][0-9]+)?$' then trim(value)::numeric else 10 end end),10),
    coalesce(max(case when key='rain_surcharge_message' then value end),'')
  into v_rain_enabled,v_rain_amount,v_rain_message
  from public.settings
  where store_id=v_store_id and key in ('rain_surcharge_enabled','rain_surcharge_amount','rain_surcharge_message');

  if not v_rain_enabled then v_rain_amount := 0; end if;
  v_effective_fee := coalesce(v_zone.fee,0) + coalesce(v_rain_amount,0);

  return jsonb_build_object(
    'ok',true,'code','OK','inside_yucatan',true,
    'accuracy_m',round(p_accuracy_m::numeric,0),
    'zone_id',v_zone.id,'zone_name',v_zone.name,
    'base_fee',v_zone.fee,
    'rain_surcharge_enabled',v_rain_enabled,
    'rain_surcharge',v_rain_amount,
    'rain_message',v_rain_message,
    'fee',v_effective_fee
  );
end;
$function$




DROP FUNCTION IF EXISTS public.admin_list_delivery_zones();
CREATE FUNCTION public.admin_list_delivery_zones(p_store_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_list_delivery_zones(p_store_id); $$;
DROP FUNCTION IF EXISTS public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
CREATE FUNCTION public.admin_save_delivery_zone(p_store_id uuid,p_id uuid,p_fee numeric,p_enabled boolean,p_geojson jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.admin_save_delivery_zone(p_store_id,p_id,p_fee,p_enabled,p_geojson); $$;
DROP FUNCTION IF EXISTS public.pastehot_add_category(text);
CREATE FUNCTION public.pastehot_add_category(p_store_id uuid,p_name text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_add_category(p_store_id,p_name); $$;
CREATE OR REPLACE FUNCTION public.pastehot_store_state(p_store_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'state'); $$;
CREATE OR REPLACE FUNCTION public.pastehot_set_store_closed(p_store_id uuid,p_closed boolean,p_reason text,p_expected_closed boolean,p_public_reason text DEFAULT null) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'set',jsonb_build_object('closed',p_closed,'reason',p_reason,'expected_closed',p_expected_closed,'public_reason',p_public_reason)); $$;
CREATE OR REPLACE FUNCTION public.pastehot_store_history(p_store_id uuid,p_day date DEFAULT null,p_offset integer DEFAULT 0,p_only_during_hours boolean DEFAULT false) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT private.pastehot_store_dispatch(p_store_id,'history',jsonb_build_object('day',p_day,'offset',p_offset,'only_during_hours',p_only_during_hours)); $$;

REVOKE ALL ON FUNCTION private.admin_list_delivery_zones(uuid),private.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),private.pastehot_add_category(uuid,text),private.pastehot_store_dispatch(uuid,text,jsonb),private.pastehot_store_snapshot(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION private.admin_list_delivery_zones(uuid),private.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),private.pastehot_add_category(uuid,text),private.pastehot_store_dispatch(uuid,text,jsonb),private.pastehot_store_snapshot(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_list_delivery_zones(uuid),public.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),public.pastehot_add_category(uuid,text),public.pastehot_store_state(uuid),public.pastehot_set_store_closed(uuid,boolean,text,boolean,text),public.pastehot_store_history(uuid,date,integer,boolean),public.validate_delivery_location(uuid,double precision,double precision,double precision) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.admin_list_delivery_zones(uuid),public.admin_save_delivery_zone(uuid,uuid,numeric,boolean,jsonb),public.pastehot_add_category(uuid,text),public.pastehot_store_state(uuid),public.pastehot_set_store_closed(uuid,boolean,text,boolean,text),public.pastehot_store_history(uuid,date,integer,boolean),public.validate_delivery_location(uuid,double precision,double precision,double precision) TO anon,authenticated;
