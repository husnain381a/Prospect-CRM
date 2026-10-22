alter table public.workspaces add column discovery_provider text not null default 'osm' check(discovery_provider in ('osm','google','licensed'));

-- Internal provider cache and global request pacing; never exposed to clients.
create table public.place_source_cache(cache_key text primary key,payload jsonb not null,expires_at timestamptz not null);
create index place_source_cache_expiry on public.place_source_cache(expires_at);
create table public.place_source_limits(provider text primary key,next_request_at timestamptz not null default now(),request_day date not null default current_date,requests int not null default 0);
alter table public.place_source_cache enable row level security;
alter table public.place_source_limits enable row level security;
create policy internal_places_cache_deny on public.place_source_cache for all to anon,authenticated using(false) with check(false);
create policy internal_places_limits_deny on public.place_source_limits for all to anon,authenticated using(false) with check(false);
revoke all on public.place_source_cache,public.place_source_limits from public,anon,authenticated;
grant select,insert,update,delete on public.place_source_cache,public.place_source_limits to service_role;

create schema if not exists private;
revoke all on schema private from public,anon;
grant usage on schema private to authenticated,service_role;
create function private.set_discovery_provider(w uuid,provider text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.workspace_role(w) is null or public.workspace_role(w) not in ('Admin','Manager') then raise exception 'Forbidden';end if;
 if provider not in ('osm','google','licensed') then raise exception 'Invalid discovery provider';end if;
 perform 1 from public.workspaces where id=w for update;
 update public.workspaces set discovery_provider=provider where id=w;
 insert into public.audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'discovery.provider_selected',jsonb_build_object('provider',provider));
end$$;
revoke all on function private.set_discovery_provider(uuid,text) from public,anon,authenticated;
grant execute on function private.set_discovery_provider(uuid,text) to authenticated,service_role;
create function public.set_discovery_provider(w uuid,provider text) returns void language sql security invoker set search_path='' as $$select private.set_discovery_provider(w,provider)$$;
revoke all on function public.set_discovery_provider(uuid,text) from public,anon,authenticated;
grant execute on function public.set_discovery_provider(uuid,text) to authenticated,service_role;
