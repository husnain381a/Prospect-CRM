alter table public.workspaces add column score_weights jsonb not null default '{"rating":0.65,"volume":0.35,"fit":0.45,"website":0.35,"contact":0.2}';
alter table public.leads add column opportunity_score int generated always as (coalesce((data->>'opportunity')::int,0)) stored;
create index leads_opportunity on public.leads(workspace_id,opportunity_score desc);
alter table public.leads add column search_document tsvector generated always as (to_tsvector('simple',coalesce(data->>'name','')||' '||coalesce(data->>'category','')||' '||coalesce(data->>'city',''))) stored;
drop index public.leads_search;
create index leads_search on public.leads using gin(search_document);
create or replace function public.workspace_metrics(w uuid) returns jsonb language sql stable security invoker set search_path=public as $$select jsonb_build_object('total',count(*),'found',count(*) filter(where data->>'website_status'='found'),'not_found',count(*) filter(where data->>'website_status'='not_found'),'unverified',count(*) filter(where data->>'website_status'='unverified'),'qualified',count(*) filter(where data->>'stage' not in ('New','Lost')),'new',count(*) filter(where data->>'stage'='New'),'won',count(*) filter(where data->>'stage'='Won'),'meetings',count(*) filter(where data->>'stage'='Meeting')) from leads where workspace_id=w$$;
revoke all on function public.workspace_metrics(uuid) from public,anon;
grant execute on function public.workspace_metrics(uuid) to authenticated,service_role;
create or replace function public.apply_lead_score() returns trigger language plpgsql security definer set search_path=public as $$declare w jsonb;reputation int;opportunity int;begin
 select score_weights into w from workspaces where id=new.workspace_id;
 reputation:=round(least(100,greatest(0,coalesce((new.data->>'rating')::numeric,0)/5*100*(w->>'rating')::numeric+least(1,log(10,coalesce((new.data->>'reviews')::numeric,0)+1)/3)*100*(w->>'volume')::numeric)));
 opportunity:=round(least(100,greatest(0,coalesce((new.data->>'niche_fit')::numeric,50)*(w->>'fit')::numeric+(case new.data->>'website_status' when 'not_found' then 100 when 'found' then 45 else 30 end)*(w->>'website')::numeric+(case when coalesce(new.data->>'email','')<>'' then 100 when coalesce(new.data->>'phone','')<>'' then 60 else 0 end)*(w->>'contact')::numeric)));
 new.data:=new.data||jsonb_build_object('reputation',reputation,'opportunity',opportunity);return new;end$$;
create trigger score_before_write before insert or update of data on public.leads for each row execute function public.apply_lead_score();
create or replace function public.configure_scoring(w uuid,weights jsonb) returns void language plpgsql security definer set search_path=public as $$declare key text;begin perform require_member(w,true);foreach key in array array['rating','volume','fit','website','contact'] loop if not weights ? key or (weights->>key)::numeric not between 0 and 1 then raise exception 'Weights must be between zero and one';end if;end loop;
 if abs((weights->>'rating')::numeric+(weights->>'volume')::numeric-1)>.001 or abs((weights->>'fit')::numeric+(weights->>'website')::numeric+(weights->>'contact')::numeric-1)>.001 then raise exception 'Each score group must sum to 100 percent';end if;
 update workspaces set score_weights=weights where id=w;update leads set data=data where workspace_id=w;insert into audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'scoring.updated',weights);end$$;
revoke all on function public.apply_lead_score(),public.configure_scoring(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_scoring(uuid,jsonb) to authenticated,service_role;
-- Lock order matches the worker: workspace -> campaign -> lead.
-- Prevent emergency-stop deadlocks and make stop completion a serialization barrier.
create or replace function public.stop_workspace_guard() returns trigger language plpgsql security definer set search_path=public as $$begin perform 1 from workspaces where id=old.workspace_id for update;return new;end$$;
-- Emergency stop itself holds this row before changing campaigns/jobs.

revoke execute on function public.stop_workspace_guard() from public,anon,authenticated;

-- Cover tenant foreign keys and explicitly deny client access to internal ledgers.
create index if not exists campaigns_approved_by_idx on public.campaigns(approved_by);
create index if not exists deliveries_campaign_idx on public.deliveries(workspace_id,campaign_id);
create index if not exists deliveries_lead_idx on public.deliveries(workspace_id,lead_id);
create index if not exists tasks_lead_idx on public.tasks(workspace_id,lead_id);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create policy internal_events_deny_clients on public.webhook_events for all to anon,authenticated using(false) with check(false);
create policy internal_heartbeats_deny_clients on public.worker_heartbeats for all to anon,authenticated using(false) with check(false);
