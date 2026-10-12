-- Branch-scope privileged functions and checkout operations.
DROP FUNCTION IF EXISTS public.admin_list_delivery_zones();
DROP FUNCTION IF EXISTS private.admin_list_delivery_zones();
CREATE FUNCTION private.admin_list_delivery_zones(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then
    raise exception 'NO_AUTORIZADO';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',z.id,
        'name',z.name,
        'fee',z.fee,
        'priority',z.priority,
        'enabled',z.enabled,
        'geojson',case when z.geom is null then null else extensions.st_asgeojson(z.geom)::jsonb end
      )
      order by z.priority,z.name
    ),
    '[]'::jsonb
  )
  into v_result
  from public.delivery_zones z where z.store_id=p_store_id;

  return v_result;
end;
$function$


DROP FUNCTION IF EXISTS public.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
DROP FUNCTION IF EXISTS private.admin_save_delivery_zone(uuid,numeric,boolean,jsonb);
CREATE FUNCTION private.admin_save_delivery_zone(p_store_id uuid,p_id uuid, p_fee numeric, p_enabled boolean, p_geojson jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_geom extensions.geometry;
  v_zone public.delivery_zones%rowtype;
begin
  if not private.pastehot_store_owner_allowed(p_store_id) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if p_fee is null or p_fee < 0 then
    raise exception 'TARIFA_INVALIDA';
  end if;

  if p_geojson is not null then
    v_geom := extensions.st_setsrid(extensions.st_geomfromgeojson(p_geojson::text),4326);
    if extensions.st_geometrytype(v_geom) not in ('ST_Polygon','ST_MultiPolygon') then
      raise exception 'AREA_INVALIDA';
    end if;
    if not extensions.st_isvalid(v_geom) then
      raise exception 'AREA_INVALIDA';
    end if;
  end if;

  update public.delivery_zones
  set fee=p_fee,
      enabled=coalesce(p_enabled,true),
      geom=v_geom,
      updated_at=now()
  where id=p_id and store_id=p_store_id
  returning * into v_zone;

  if not found then raise exception 'ZONA_NO_ENCONTRADA'; end if;

  return jsonb_build_object(
    'id',v_zone.id,
    'name',v_zone.name,
    'fee',v_zone.fee,
    'priority',v_zone.priority,
    'enabled',v_zone.enabled,
    'geojson',case when v_zone.geom is null then null else extensions.st_asgeojson(v_zone.geom)::jsonb end
  );
end;
$function$


DROP FUNCTION IF EXISTS public.pastehot_add_category(text);
DROP FUNCTION IF EXISTS private.pastehot_add_category(text);
CREATE FUNCTION private.pastehot_add_category(p_store_id uuid,p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text:=trim(coalesce(p_name,''));
  v_value text;
  v_categories jsonb;
begin
  if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id)) then
    raise exception 'NO_AUTORIZADO';
  end if;
  if length(v_name) not between 1 and 80 then raise exception 'Usa un nombre de categoría de 1 a 80 caracteres.'; end if;
  select value into v_value from public.settings where store_id=p_store_id and key='categories' limit 1 for update;
  if v_value is null then raise exception 'No se encontró la lista actual de categorías.'; end if;
  v_categories:=v_value::jsonb;
  if jsonb_typeof(v_categories)<>'array' then raise exception 'La lista actual de categorías no es válida.'; end if;
  if exists(select 1 from jsonb_array_elements_text(v_categories) e(value) where lower(e.value)=lower(v_name)) then
    raise exception 'Esa categoría ya existe.';
  end if;
  v_categories:=v_categories||jsonb_build_array(v_name);
  update public.settings set value=v_categories::text,updated_at=now() where store_id=p_store_id and key='categories';
  return v_categories;
end;
$function$


CREATE OR REPLACE FUNCTION private.pastehot_reject_closed_store_order()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform 1 from private.pastehot_access_config where singleton for share;
 if new.order_status in ('nuevo','pendiente_confirmacion') and exists(select 1 from public.settings where store_id=new.store_id and key='store_manual_closed' and value='true') then
   raise exception 'TIENDA_CERRADA: la tienda está cerrada temporalmente. Intenta cuando vuelva a abrir.';
 end if;
 return new;
end;$function$


CREATE OR REPLACE FUNCTION private.pastehot_staff_schedule_allowed()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raw text;
  v_schedule jsonb;
  v_now timestamp := now() at time zone 'America/Merida';
  v_day date;
  v_key text;
  v_entry jsonb;
  v_open time;
  v_close time;
  v_start timestamp;
  v_end timestamp;
begin
  select value into v_raw from public.settings where store_id=private.pastehot_request_store_id() and key='weekly_schedule' limit 1;
  if v_raw is null then return false; end if;
  begin v_schedule:=v_raw::jsonb; exception when others then return false; end;
  if jsonb_typeof(v_schedule)<>'object' then return false; end if;
  for v_day in select (v_now::date - n)::date from generate_series(0,1) n loop
    v_key:=case extract(dow from v_day)::integer
      when 0 then 'sun' when 1 then 'mon' when 2 then 'tue' when 3 then 'wed'
      when 4 then 'thu' when 5 then 'fri' when 6 then 'sat' end;
    v_entry:=v_schedule->v_key;
    if jsonb_typeof(v_entry)='object' and v_entry->>'enabled'='true'
       and coalesce(v_entry->>'open','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       and coalesce(v_entry->>'close','') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_open:=(v_entry->>'open')::time;
      v_close:=(v_entry->>'close')::time;
      v_start:=v_day+v_open-interval '30 minutes';
      v_end:=v_day+v_close;
      if v_close<=v_open then v_end:=v_end+interval '1 day'; end if;
      if v_now>=v_start and v_now<v_end then return true; end if;
    end if;
  end loop;
  return false;
end $function$


DROP FUNCTION IF EXISTS public.pastehot_store_state();
DROP FUNCTION IF EXISTS public.pastehot_set_store_closed(boolean,text,boolean,text);
DROP FUNCTION IF EXISTS public.pastehot_store_history(date,integer,boolean);
DROP FUNCTION IF EXISTS private.pastehot_store_dispatch(text,jsonb);
CREATE FUNCTION private.pastehot_store_dispatch(p_store_id uuid,p_action text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_state jsonb;v_closed boolean;v_requested boolean;v_expected boolean;v_reason text;v_public text;
 v_member private.pastehot_members;v_label text;v_day date;v_offset integer;v_only boolean;v_rows jsonb;
begin
 -- Serialize closures, order insertion and revocation. Identity/time are never supplied by the caller.
 if p_action='set' then perform 1 from private.pastehot_access_config where singleton for update;end if;
 if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_access_allowed(p_store_id)) then raise exception 'NO_AUTORIZADO';end if;
 v_state:=private.pastehot_store_snapshot(p_store_id);
 if p_action='set' then
   v_requested:=(p_args->>'closed')::boolean;v_expected:=(p_args->>'expected_closed')::boolean;
   if v_requested is null or v_expected is null then raise exception 'ESTADO_INVALIDO';end if;
   v_closed:=(v_state->>'manual_closed')::boolean;
   if v_expected<>v_closed then raise exception 'ESTADO_CAMBIO: otra persona modificó la tienda. Actualiza antes de continuar.';end if;
   if v_closed=v_requested then
     if private.pastehot_store_owner_allowed(p_store_id) and p_args->>'public_reason' is not null then
       insert into public.settings(store_id,key,value) values(p_store_id,'store_manual_close_reason',left(trim(p_args->>'public_reason'),160))
       on conflict(store_id,key) do update set value=excluded.value,updated_at=now();
     end if;
     return v_state||jsonb_build_object('changed',false);
   end if;
   v_reason:=trim(p_args->>'reason');
   if v_reason is null or length(v_reason) not between 5 and 240 then raise exception 'MOTIVO_REQUERIDO: escribe entre 5 y 240 caracteres.';end if;
   select * into v_member from private.pastehot_members where user_id=auth.uid();
   select label into v_label from private.pastehot_sessions where user_id=auth.uid() and auth_session_id=(auth.jwt()->>'session_id')::uuid;
   -- Keep the proprietor's saved public message for closures from every role.
   -- Only an owner can edit the saved message; reopening does not erase it.
   select nullif(trim(value),'') into v_public from public.settings where store_id=p_store_id and key='store_manual_close_reason';
   if v_member.role='owner' and p_args->>'public_reason' is not null then v_public:=left(trim(p_args->>'public_reason'),160);end if;
   if v_requested then v_public:=coalesce(nullif(trim(v_public),''),'En unos instantes volveremos a recibir pedidos.');else v_public:=coalesce(v_public,'');end if;
   insert into public.settings(store_id,key,value) values(p_store_id,'store_manual_closed',v_requested::text),(p_store_id,'store_manual_close_reason',v_public)
   on conflict(store_id,key) do update set value=excluded.value,updated_at=now();
   insert into private.pastehot_store_events(store_id,closed,actor_id,actor_name,actor_role,session_label,reason,during_hours,schedule_snapshot)
   values(p_store_id,v_requested,v_member.user_id,v_member.display_name,v_member.role,coalesce(v_label,'Mi navegador'),v_reason,(v_state->>'scheduled_open')::boolean,v_state->'schedule');
   v_state:=private.pastehot_store_snapshot(p_store_id)||jsonb_build_object('changed',true);
 elsif p_action='history' then
   if not (private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id)) then raise exception 'NO_AUTORIZADO';end if;
   v_day:=(p_args->>'day')::date;v_offset:=greatest(0,least(coalesce((p_args->>'offset')::integer,0),1000000));v_only:=coalesce((p_args->>'only_during_hours')::boolean,false);
   select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into v_rows from (
     select id,created_at,closed,actor_name,actor_role,session_label,reason,during_hours from private.pastehot_store_events
     where store_id=p_store_id and (v_day is null or (created_at>=v_day::timestamp at time zone 'America/Merida' and created_at<(v_day+1)::timestamp at time zone 'America/Merida'))
       and (not v_only or during_hours)
     order by created_at desc,id desc offset v_offset limit 51
   ) e;
   return jsonb_build_object('events',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
 elsif p_action<>'state' then raise exception 'ACCION_INVALIDA';end if;
 return v_state||jsonb_build_object('history_allowed',private.pastehot_store_owner_allowed(p_store_id) or private.pastehot_store_manager_allowed(p_store_id),'last_event_id',(select coalesce(max(id),0) from private.pastehot_store_events where store_id=p_store_id));
end;$function$


DROP FUNCTION IF EXISTS private.pastehot_store_snapshot();
CREATE FUNCTION private.pastehot_store_snapshot(p_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 v_settings jsonb;v_week jsonb;v_day text;v_today jsonb;v_time timestamp:=now() at time zone 'America/Merida';
 v_open text;v_close text;v_minutes integer;v_start integer;v_end integer;v_scheduled boolean:=false;v_closed boolean;
begin
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into v_settings from public.settings
 where store_id=p_store_id and key in ('store_manual_closed','weekly_schedule','opening_time','closing_time');
 v_day:=(array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from v_time)::integer+1];
 begin v_week:=(v_settings->>'weekly_schedule')::jsonb;exception when others then v_week:=null;end;
 if jsonb_typeof(v_week)='object' then v_today:=coalesce(v_week->v_day,'{}');
 else v_today:=jsonb_build_object('enabled',v_day<>'sun','open',coalesce(v_settings->>'opening_time','12:00'),'close',coalesce(v_settings->>'closing_time','21:00'));end if;
 v_open:=v_today->>'open';v_close:=v_today->>'close';
 if coalesce(v_today->>'enabled','false')='true' and v_open ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and v_close ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
   v_minutes:=extract(hour from v_time)::integer*60+extract(minute from v_time)::integer;
   v_start:=split_part(v_open,':',1)::integer*60+split_part(v_open,':',2)::integer;
   v_end:=split_part(v_close,':',1)::integer*60+split_part(v_close,':',2)::integer;
   v_scheduled:=case when v_start=v_end then true when v_end>v_start then v_minutes>=v_start and v_minutes<v_end else v_minutes>=v_start or v_minutes<v_end end;
 end if;
 v_closed:=coalesce(v_settings->>'store_manual_closed','false')='true';
 return jsonb_build_object('manual_closed',v_closed,'scheduled_open',v_scheduled,'open',not v_closed and v_scheduled,'schedule',jsonb_build_object('timezone','America/Merida','day',v_day,'hours',v_today));
end;$function$
