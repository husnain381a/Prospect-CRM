-- Retire free-source execution without converting existing jobs to paid requests.
alter table public.workspaces alter column discovery_provider set default 'google';
update public.workspaces set discovery_provider='google' where discovery_provider='osm';
update public.jobs j set status='cancelled',locked_at=null,locked_by=null,last_error='Open-source places removed; create a new official Google Places search'
where j.kind='discovery' and j.status in ('queued','running','dead','uncertain') and exists(select 1 from public.discoveries d where d.workspace_id=j.workspace_id and d.id::text=j.payload->>'discovery_id' and d.data->>'provider'='osm');
update public.discoveries set status='Cancelled',data=data||jsonb_build_object('retired_reason','Open-source places removed') where data->>'provider'='osm' and status<>'Completed';

create or replace function private.set_discovery_provider(w uuid,provider text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.workspace_role(w) is null or public.workspace_role(w) not in ('Admin','Manager') then raise exception 'Forbidden';end if;
 if provider is distinct from 'google' then raise exception 'Only official Google Places is available';end if;
 perform 1 from public.workspaces where id=w for update;
 update public.workspaces set discovery_provider='google' where id=w;
 insert into public.audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'discovery.provider_selected',jsonb_build_object('provider','google'));
end$$;

create or replace function public.create_discovery(w uuid,d jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin
 perform require_member(w);perform 1 from workspaces where id=w for update;
 if workspace_role(w)='Agent' then raise exception 'Manager or admin required';end if;
 if coalesce(d->>'provider','google')<>'google' then raise exception 'Only official Google Places is available';end if;
 if (d->>'limit')::int not between 1 and 500 then raise exception 'Limit must be 1–500';end if;
 d:=d||jsonb_build_object('provider','google');
 insert into discoveries(workspace_id,data) values(w,d) returning id into result;
 insert into jobs(workspace_id,kind,payload,unique_key) values(w,'discovery',jsonb_build_object('discovery_id',result),'discovery:'||result);return result;end$$;
