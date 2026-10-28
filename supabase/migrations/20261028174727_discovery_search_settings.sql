-- Workspace defaults are copied into each search, keeping scheduled runs reproducible.
alter table public.workspaces add column discovery_settings jsonb not null default '{}';

create function private.normalize_discovery_settings(s jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare
 defaults jsonb := '{"target":"balanced","strategy":"area","website":"any","low_review_max":20,"mid_review_max":100,"min_reviews":0,"max_reviews":1000000,"include_unreviewed":true,"min_rating":0,"radius_km":10,"area_points":5,"pages_per_area":1,"max_requests":30,"default_limit":50,"default_keyword":"","default_locations":[],"exclusions":[]}';
 key text; value jsonb; n numeric;
begin
 if s is null or jsonb_typeof(s)<>'object' then raise exception 'Discovery settings must be an object'; end if;
 for key in select jsonb_object_keys(s) loop
   if not defaults ? key then raise exception 'Unknown discovery setting: %',key; end if;
 end loop;
 s:=defaults||s;
 foreach key in array array['target','strategy','website','default_keyword'] loop
   if jsonb_typeof(s->key) is distinct from 'string' then raise exception 'Invalid text setting: %',key;end if;
 end loop;
 if s->>'target' not in ('balanced','low_reviews','mid_reviews','high_reviews','custom') or s->>'strategy' not in ('area','relevance') or s->>'website' not in ('any','not_listed','listed') then raise exception 'Invalid discovery choice';end if;
 if length(s->>'default_keyword')>200 then raise exception 'Keyword too long';end if;
 if jsonb_typeof(s->'include_unreviewed') is distinct from 'boolean' then raise exception 'Invalid unrated preference';end if;
 foreach key in array array['low_review_max','mid_review_max','min_reviews','max_reviews','min_rating','radius_km','area_points','pages_per_area','max_requests','default_limit'] loop
   if jsonb_typeof(s->key) is distinct from 'number' then raise exception 'Invalid numeric setting: %',key;end if;
   n:=(s->>key)::numeric;
   if n<0 or n>1000000 or (key not in ('min_rating','radius_km') and trunc(n)<>n) then raise exception 'Invalid range: %',key;end if;
 end loop;
 if (s->>'low_review_max')::int >= (s->>'mid_review_max')::int or (s->>'min_reviews')::int>(s->>'max_reviews')::int then raise exception 'Invalid review range';end if;
 if (s->>'min_rating')::numeric>5 or (s->>'radius_km')::numeric not between 1 and 50 or (s->>'area_points')::int not in (1,5,9) or (s->>'pages_per_area')::int not between 1 and 3 or (s->>'max_requests')::int not between 1 and 100 or (s->>'default_limit')::int not between 1 and 500 then raise exception 'Invalid search limits';end if;
 foreach key in array array['default_locations','exclusions'] loop
   if jsonb_typeof(s->key) is distinct from 'array' then raise exception 'Invalid list: %',key;end if;
   if jsonb_array_length(s->key)>(case when key='default_locations' then 25 else 100 end) then raise exception 'Too many list entries';end if;
   for value in select v from jsonb_array_elements(s->key) as t(v) loop
     if jsonb_typeof(value) is distinct from 'string' or length(btrim(value#>>'{}')) not between 1 and 200 then raise exception 'Invalid list entry';end if;
   end loop;
 end loop;
 return s;
end$$;
revoke all on function private.normalize_discovery_settings(jsonb) from public,anon,authenticated;
grant execute on function private.normalize_discovery_settings(jsonb) to service_role;
update public.workspaces set discovery_settings=private.normalize_discovery_settings(discovery_settings);

create function private.configure_discovery(w uuid,settings jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.workspace_role(w) is null or public.workspace_role(w) not in ('Admin','Manager') then raise exception 'Forbidden';end if;
 settings:=private.normalize_discovery_settings(settings);
 update public.workspaces set discovery_settings=settings where id=w;
 insert into public.audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'discovery.settings_updated',settings);
end$$;
revoke all on function private.configure_discovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.configure_discovery(uuid,jsonb) to authenticated,service_role;
create function public.configure_discovery(w uuid,settings jsonb) returns void
language sql security invoker set search_path='' as $$select private.configure_discovery(w,settings)$$;
revoke all on function public.configure_discovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_discovery(uuid,jsonb) to authenticated,service_role;

create function private.create_configured_discovery(w uuid,d jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; settings jsonb;
begin
 if auth.uid() is null or public.workspace_role(w) is null or public.workspace_role(w) not in ('Admin','Manager') then raise exception 'Forbidden';end if;
 select discovery_settings into settings from public.workspaces where id=w for update;
 if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'provider','google')<>'google' then raise exception 'Only official Google Places is available';end if;
 if jsonb_typeof(d->'limit') is distinct from 'number' or (d->>'limit')::numeric<>trunc((d->>'limit')::numeric) or (d->>'limit')::numeric not between 1 and 500 then raise exception 'Limit must be 1–500';end if;
 if jsonb_typeof(d->'keyword') is distinct from 'string' or length(btrim(d->>'keyword')) not between 1 and 200 then raise exception 'Business keyword required';end if;
 if jsonb_typeof(d->'locations') is distinct from 'array' then raise exception 'Locations required';end if;
 if jsonb_array_length(d->'locations') not between 1 and 25 then raise exception 'Provide 1–25 locations';end if;
 settings:=private.normalize_discovery_settings(settings||coalesce(d->'search_settings','{}'::jsonb));
 -- Validate per-run location and exclusion lists through the same strict normalizer.
 perform private.normalize_discovery_settings(settings||jsonb_build_object('default_locations',d->'locations','exclusions',coalesce(d->'exclusions','[]'::jsonb)));
 if coalesce(d->>'schedule','once') not in ('once','daily','weekly') then raise exception 'Invalid schedule';end if;
 if d ? 'auto_enrich' and jsonb_typeof(d->'auto_enrich') is distinct from 'boolean' then raise exception 'Invalid enrichment choice';end if;
 d:=d||jsonb_build_object('provider','google','search_settings',settings,'radius',settings->'radius_km');
 insert into public.discoveries(workspace_id,data) values(w,d) returning id into result;
 insert into public.jobs(workspace_id,kind,payload,unique_key) values(w,'discovery',jsonb_build_object('discovery_id',result),'discovery:'||result);
 return result;
end$$;
revoke all on function private.create_configured_discovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function private.create_configured_discovery(uuid,jsonb) to authenticated,service_role;
create or replace function public.create_discovery(w uuid,d jsonb) returns uuid
language sql security invoker set search_path='' as $$select private.create_configured_discovery(w,d)$$;
revoke all on function public.create_discovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_discovery(uuid,jsonb) to authenticated,service_role;
