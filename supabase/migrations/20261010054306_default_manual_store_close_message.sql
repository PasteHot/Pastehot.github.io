-- Set the required default notice and keep it as the public fallback for every manual closure.
insert into public.settings(key,value) values('store_manual_close_reason','En unos instantes volveremos a recibir pedidos.')
on conflict(key) do update set value=excluded.value,updated_at=now();

-- Preserve the saved public closure notice when any approved role closes the store.
create or replace function private.pastehot_store_dispatch(p_action text,p_args jsonb default '{}'::jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_state jsonb;v_closed boolean;v_requested boolean;v_expected boolean;v_reason text;v_public text;
 v_member private.pastehot_members;v_label text;v_day date;v_offset integer;v_only boolean;v_rows jsonb;
begin
 -- Serialize closures, order insertion and revocation. Identity/time are never supplied by the caller.
 if p_action='set' then perform 1 from private.pastehot_access_config where singleton for update;end if;
 if not (private.pastehot_owner_allowed() or private.pastehot_staff_allowed()) then raise exception 'NO_AUTORIZADO';end if;
 v_state:=private.pastehot_store_snapshot();
 if p_action='set' then
   v_requested:=(p_args->>'closed')::boolean;v_expected:=(p_args->>'expected_closed')::boolean;
   if v_requested is null or v_expected is null then raise exception 'ESTADO_INVALIDO';end if;
   v_closed:=(v_state->>'manual_closed')::boolean;
   if v_expected<>v_closed then raise exception 'ESTADO_CAMBIO: otra persona modificó la tienda. Actualiza antes de continuar.';end if;
   if v_closed=v_requested then
     if private.pastehot_owner_allowed() and p_args->>'public_reason' is not null then
       insert into public.settings(key,value) values('store_manual_close_reason',left(trim(p_args->>'public_reason'),160))
       on conflict(key) do update set value=excluded.value,updated_at=now();
     end if;
     return v_state||jsonb_build_object('changed',false);
   end if;
   v_reason:=trim(p_args->>'reason');
   if v_reason is null or length(v_reason) not between 5 and 240 then raise exception 'MOTIVO_REQUERIDO: escribe entre 5 y 240 caracteres.';end if;
   select * into v_member from private.pastehot_members where user_id=auth.uid();
   select label into v_label from private.pastehot_sessions where user_id=auth.uid() and auth_session_id=(auth.jwt()->>'session_id')::uuid;
   -- Keep the proprietor's saved public message for closures from every role.
   -- Only an owner can edit the saved message; reopening does not erase it.
   select nullif(trim(value),'') into v_public from public.settings where key='store_manual_close_reason';
   if v_member.role='owner' and p_args->>'public_reason' is not null then v_public:=left(trim(p_args->>'public_reason'),160);end if;
   if v_requested then v_public:=coalesce(nullif(trim(v_public),''),'En unos instantes volveremos a recibir pedidos.');else v_public:=coalesce(v_public,'');end if;
   insert into public.settings(key,value) values('store_manual_closed',v_requested::text),('store_manual_close_reason',v_public)
   on conflict(key) do update set value=excluded.value,updated_at=now();
   insert into private.pastehot_store_events(closed,actor_id,actor_name,actor_role,session_label,reason,during_hours,schedule_snapshot)
   values(v_requested,v_member.user_id,v_member.display_name,v_member.role,coalesce(v_label,'Mi navegador'),v_reason,(v_state->>'scheduled_open')::boolean,v_state->'schedule');
   v_state:=private.pastehot_store_snapshot()||jsonb_build_object('changed',true);
 elsif p_action='history' then
   if not (private.pastehot_owner_allowed() or private.pastehot_manager_allowed()) then raise exception 'NO_AUTORIZADO';end if;
   v_day:=(p_args->>'day')::date;v_offset:=greatest(0,least(coalesce((p_args->>'offset')::integer,0),1000000));v_only:=coalesce((p_args->>'only_during_hours')::boolean,false);
   select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]') into v_rows from (
     select id,created_at,closed,actor_name,actor_role,session_label,reason,during_hours from private.pastehot_store_events
     where (v_day is null or (created_at>=v_day::timestamp at time zone 'America/Merida' and created_at<(v_day+1)::timestamp at time zone 'America/Merida'))
       and (not v_only or during_hours)
     order by created_at desc,id desc offset v_offset limit 51
   ) e;
   return jsonb_build_object('events',case when jsonb_array_length(v_rows)>50 then v_rows-50 else v_rows end,'has_more',jsonb_array_length(v_rows)>50);
 elsif p_action<>'state' then raise exception 'ACCION_INVALIDA';end if;
 return v_state||jsonb_build_object('history_allowed',private.pastehot_owner_allowed() or private.pastehot_manager_allowed(),'last_event_id',(select coalesce(max(id),0) from private.pastehot_store_events));
end;$$;
