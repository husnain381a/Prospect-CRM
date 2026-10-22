-- Apply once to a fresh Supabase project. Demo data is never inserted here.

-- Uses built-in gen_random_uuid() and SHA-256 (PostgreSQL 14+).

create table public.workspaces(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 120),emergency_stop boolean not null default false,created_at timestamptz not null default now());

create table public.workspace_members(workspace_id uuid references public.workspaces(id) on delete cascade,user_id uuid references auth.users(id) on delete cascade,role text not null check(role in ('Admin','Manager','Agent')),primary key(workspace_id,user_id));

create or replace function public.workspace_role(w uuid) returns text language sql stable security definer set search_path=public as $$select role from workspace_members where workspace_id=w and user_id=auth.uid()$$;

create or replace function public.create_workspace(workspace_name text) returns uuid language plpgsql security definer set search_path=public as $$declare w uuid;begin if auth.uid() is null then raise exception 'Authentication required';end if;insert into workspaces(name) values(workspace_name) returning id into w;insert into workspace_members values(w,auth.uid(),'Admin');return w;end$$;

create table public.leads(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,data jsonb not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(workspace_id,id),check(length(data->>'name') between 1 and 200));

create index leads_workspace_created on public.leads(workspace_id,created_at desc);

create index leads_stage on public.leads(workspace_id,(data->>'stage'));

create index leads_website_status on public.leads(workspace_id,(data->>'website_status'));

create index leads_search on public.leads using gin(to_tsvector('simple',coalesce(data->>'name','')||' '||coalesce(data->>'category','')||' '||coalesce(data->>'city','')));

create unique index leads_source_unique on public.leads(workspace_id,(data->>'source'),(data->>'source_id')) where coalesce(data->>'source_id','')<>'';

create table public.tasks(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,lead_id uuid,title text not null,owner text not null default '',due_at timestamptz not null,done boolean not null default false,foreign key(workspace_id,lead_id) references public.leads(workspace_id,id));

create index tasks_due on public.tasks(workspace_id,done,due_at);

create table public.discoveries(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,data jsonb not null,progress int not null default 0,status text not null default 'Queued',created_at timestamptz not null default now(),unique(workspace_id,id));

create table public.campaigns(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,name text not null,recipients jsonb not null default '[]',version int not null default 1,status text not null default 'Draft',approved_hash text,approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now(),sent int not null default 0,replies int not null default 0,opened int not null default 0,unique(workspace_id,id),check(jsonb_typeof(recipients)='array'),check(jsonb_array_length(recipients)<=500));

create table public.suppressions(workspace_id uuid not null references public.workspaces(id) on delete cascade,address text not null,reason text not null,created_at timestamptz not null default now(),primary key(workspace_id,address));

create table public.jobs(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,kind text not null check(kind in ('discovery','enrichment','email','followup')),payload jsonb not null,status text not null default 'queued' check(status in ('queued','running','completed','cancelled','dead','uncertain')),attempts int not null default 0,run_at timestamptz not null default now(),locked_at timestamptz,locked_by text,last_error text,checkpoint jsonb not null default '{}',unique_key text not null,created_at timestamptz not null default now(),unique(workspace_id,unique_key));

create index jobs_poll on public.jobs(status,run_at) where status='queued';

create table public.deliveries(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,campaign_id uuid not null,lead_id uuid not null,version int not null,recipient text not null,provider_id text,idempotency_key text not null unique,status text not null default 'reserved',last_event_at timestamptz,created_at timestamptz not null default now(),foreign key(workspace_id,campaign_id) references public.campaigns(workspace_id,id),foreign key(workspace_id,lead_id) references public.leads(workspace_id,id));

create index deliveries_provider on public.deliveries(provider_id);

create table public.audit_log(id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,actor uuid,event text not null,entity_id text,details jsonb not null default '{}',created_at timestamptz not null default now());

create index audit_workspace on public.audit_log(workspace_id,created_at desc);

create table public.webhook_events(id text primary key,provider text not null,event_type text not null,received_at timestamptz not null default now(),processed_at timestamptz);

create table public.worker_heartbeats(id text primary key,last_seen timestamptz not null default now());



-- All tenant tables are deny-by-default. Service keys belong ONLY to the worker/webhooks.

alter table public.workspaces enable row level security;

alter table public.workspace_members enable row level security;

alter table public.leads enable row level security;

alter table public.tasks enable row level security;

alter table public.discoveries enable row level security;

alter table public.campaigns enable row level security;

alter table public.jobs enable row level security;

alter table public.suppressions enable row level security;

alter table public.deliveries enable row level security;

alter table public.audit_log enable row level security;

alter table public.webhook_events enable row level security;

alter table public.worker_heartbeats enable row level security;

create policy workspace_read on public.workspaces for select to authenticated using(public.workspace_role(id) is not null);

create policy membership_read on public.workspace_members for select to authenticated using(public.workspace_role(workspace_id) is not null);

do $$declare t text;begin foreach t in array array['leads','tasks','discoveries','campaigns','jobs','suppressions','deliveries','audit_log'] loop execute format('create policy tenant_read on public.%I for select to authenticated using (public.workspace_role(workspace_id) is not null)',t);end loop;end$$;

-- Mutations run only through narrowly scoped functions that check the caller.

revoke all on public.leads,public.campaigns,public.tasks,public.discoveries,public.jobs,public.suppressions,public.deliveries,public.audit_log,public.workspaces,public.workspace_members from anon,authenticated;

grant select on public.leads,public.campaigns,public.tasks,public.discoveries,public.jobs,public.suppressions,public.deliveries,public.audit_log,public.workspaces,public.workspace_members to authenticated;



create or replace function public.require_member(w uuid,admin_only boolean default false) returns void language plpgsql security definer set search_path=public as $$begin if workspace_role(w) is null or (admin_only and workspace_role(w)<>'Admin') then raise exception 'Forbidden';end if;end$$;

create or replace function public.campaign_hash(rs jsonb,v int) returns text language sql immutable set search_path=public as $$select encode(sha256(convert_to(jsonb_build_object('recipients',rs,'version',v)::text,'UTF8')),'hex')$$;

create or replace function public.import_lead(w uuid,d jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare existing uuid;result uuid;begin

 perform require_member(w);perform 1 from workspaces where id=w for update;perform pg_advisory_xact_lock(hashtext(w::text));

 if coalesce(d->>'name','')='' then raise exception 'Business name required';end if;

 -- Source identity wins. Domain/phone alone do not merge different branches.

 select id into existing from leads where workspace_id=w and (((d->>'source_id')<>'' and data->>'source'=d->>'source' and data->>'source_id'=d->>'source_id') or (coalesce(d->>'address','')<>'' and lower(regexp_replace(data->>'address','[^a-zA-Z0-9]','','g'))=lower(regexp_replace(d->>'address','[^a-zA-Z0-9]','','g')) and lower(coalesce(data->>'country',''))=lower(coalesce(d->>'country','')) and (lower(data->>'name')=lower(d->>'name') or (coalesce(d->>'website','')<>'' and lower(regexp_replace(data->>'website','^https?://(www\.)?|/.*$','','g'))=lower(regexp_replace(d->>'website','^https?://(www\.)?|/.*$','','g'))) or (coalesce(d->>'phone','')<>'' and regexp_replace(data->>'phone','[^0-9]','','g')=regexp_replace(d->>'phone','[^0-9]','','g'))))) limit 1;

 if existing is not null then return existing;end if;

 -- Importing is never permission or verification evidence.

 d:=d||jsonb_build_object('email_permission','unresolved','jurisdiction_approved',false,'whatsapp_opt_in',false,'stopped',false,'facts',coalesce(d->'facts','{}'::jsonb),'notes','[]'::jsonb);

 insert into leads(workspace_id,data) values(w,d) returning id into result;

 insert into audit_log(workspace_id,actor,event,entity_id) values(w,auth.uid(),'lead.imported',result::text);return result;end$$;

create or replace function public.update_lead(w uuid,lead uuid,patch jsonb) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w);perform 1 from workspaces where id=w for update;

 if exists(select 1 from jsonb_object_keys(patch) k where k not in ('stage','owner','tags','notes','website_status','stopped')) then raise exception 'Protected lead fields require a permission review';end if;

 if patch ? 'stage' and patch->>'stage' not in ('New','Qualified','Approved','Contacted','Replied','Meeting','Proposal','Won','Lost') then raise exception 'Invalid stage';end if;

 update leads set data=data||patch,updated_at=now() where id=lead and workspace_id=w;if not found then raise exception 'Lead not found';end if;

 if patch->>'stopped'='true' then update jobs set status='cancelled' where workspace_id=w and payload->>'lead_id'=lead::text and status='queued';end if;

 insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'lead.updated',lead::text,jsonb_build_object('fields',(select jsonb_agg(k) from jsonb_object_keys(patch) k)));end$$;

create or replace function public.record_permission(w uuid,lead uuid,permission text,jurisdiction boolean,evidence text,verified boolean) returns void language plpgsql security definer set search_path=public as $$declare fact jsonb;begin perform require_member(w);perform 1 from workspaces where id=w for update;if workspace_role(w)='Agent' then raise exception 'Manager or admin review required';end if;if permission not in ('granted','unresolved','denied') or evidence !~ '^https://' then raise exception 'Valid permission and HTTPS evidence required';end if;

 fact:=jsonb_build_object('source',evidence,'retrievedAt',now(),'status',case when verified then 'verified' else 'unverified' end);

 update leads set data=jsonb_set(data||jsonb_build_object('email_permission',permission,'jurisdiction_approved',jurisdiction),'{facts,email}',fact,true),updated_at=now() where id=lead and workspace_id=w;

 if not found then raise exception 'Lead not found';end if;

 insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'permission.reviewed',lead::text,jsonb_build_object('permission',permission,'jurisdiction',jurisdiction,'evidence',evidence,'verified',verified));end$$;



create or replace function public.eligible_recipient(w uuid,r jsonb) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from leads l where l.workspace_id=w and l.id=(r->>'lead_id')::uuid and l.data->>'email_permission'='granted' and l.data->>'jurisdiction_approved'='true' and coalesce(l.data->>'stopped','false')<>'true' and lower(l.data->>'email')=lower(r->>'to') and l.data#>>'{facts,email,status}'='verified' and r->>'channel'='email' and not exists(select 1 from suppressions s where s.workspace_id=w and s.address=lower(r->>'to')))$$;

create or replace function public.save_campaign(w uuid,campaign_name text,rs jsonb,campaign uuid default null) returns uuid language plpgsql security definer set search_path=public as $$declare c uuid;r jsonb;begin perform require_member(w);perform 1 from workspaces where id=w for update;if jsonb_array_length(rs)<1 or jsonb_array_length(rs)>500 then raise exception 'Choose 1–500 recipients';end if;for r in select * from jsonb_array_elements(rs) loop if not exists(select 1 from leads where workspace_id=w and id=(r->>'lead_id')::uuid) then raise exception 'Recipient outside workspace';end if;if r->>'channel'<>'email' then raise exception 'Advanced channels disabled';end if;end loop;

 if campaign is null then insert into campaigns(workspace_id,name,recipients) values(w,campaign_name,rs) returning id into c;else update campaigns set name=campaign_name,recipients=rs,version=version+1,status='Draft',approved_hash=null,approved_by=null,approved_at=null where id=campaign and workspace_id=w returning id into c;update jobs set status='cancelled' where workspace_id=w and payload->>'campaign_id'=c::text and status='queued';end if;

 if c is null then raise exception 'Campaign not found';end if;return c;end$$;

create or replace function public.approve_campaign(w uuid,campaign uuid,v int) returns void language plpgsql security definer set search_path=public as $$declare c campaigns;r jsonb;begin perform require_member(w,true);perform 1 from workspaces where id=w for update;select * into c from campaigns where workspace_id=w and id=campaign for update;if c.id is null or c.version<>v then raise exception 'Campaign version changed';end if;if jsonb_array_length(c.recipients)=0 then raise exception 'Recipients required';end if;for r in select * from jsonb_array_elements(c.recipients) loop if not eligible_recipient(w,r) then raise exception 'Recipient eligibility unresolved: %',r->>'to';end if;end loop;

 update campaigns set status='Approved',approved_hash=campaign_hash(recipients,version),approved_by=auth.uid(),approved_at=now() where id=campaign;

 insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'campaign.approved',campaign::text,jsonb_build_object('version',v,'hash',campaign_hash(c.recipients,v)));end$$;

create or replace function public.control_campaign(w uuid,campaign uuid,operation text,v int) returns void language plpgsql security definer set search_path=public as $$declare c campaigns;r jsonb;i int:=0;begin perform require_member(w);perform 1 from workspaces where id=w for update;if workspace_role(w)='Agent' then raise exception 'Manager or admin required';end if;select * into c from campaigns where workspace_id=w and id=campaign for update;if c.id is null or c.version<>v then raise exception 'Campaign version changed';end if;

 if operation='launch' then

 if c.status not in ('Approved','Paused') or c.approved_hash is null or c.approved_hash<>campaign_hash(c.recipients,c.version) or exists(select 1 from workspaces where id=w and emergency_stop) then raise exception 'Valid approval required; check emergency stop';end if;

 for r in select * from jsonb_array_elements(c.recipients) loop if not eligible_recipient(w,r) then raise exception 'Eligibility changed';end if;

 insert into jobs(workspace_id,kind,payload,run_at,unique_key) values(w,'email',jsonb_build_object('campaign_id',c.id,'version',c.version,'lead_id',r->>'lead_id','recipient',r),greatest(now(),(r->>'scheduled_at')::timestamptz),c.id::text||':'||c.version||':'||i) on conflict(workspace_id,unique_key) do nothing;i:=i+1;end loop;

 update campaigns set status='Running' where id=campaign;

 elsif operation='pause' then update campaigns set status='Paused' where id=campaign;

 elsif operation='stop' then update campaigns set status='Stopped',approved_hash=null where id=campaign;update jobs set status='cancelled' where workspace_id=w and payload->>'campaign_id'=campaign::text and status='queued';

 else raise exception 'Unknown operation';end if;

 insert into audit_log(workspace_id,actor,event,entity_id) values(w,auth.uid(),'campaign.'||operation,campaign::text);end$$;

create or replace function public.emergency_stop_workspace(w uuid,stopped boolean default true) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w,true);perform 1 from workspaces where id=w for update;update workspaces set emergency_stop=stopped where id=w;if stopped then update campaigns set status='Stopped',approved_hash=null where workspace_id=w;update jobs set status='cancelled' where workspace_id=w and kind in ('email','followup') and status='queued';end if;insert into audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'workspace.emergency_stop',jsonb_build_object('stopped',stopped));end$$;

create or replace function public.create_discovery(w uuid,d jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin perform require_member(w);perform 1 from workspaces where id=w for update;if workspace_role(w)='Agent' then raise exception 'Manager or admin required';end if;if (d->>'limit')::int not between 1 and 500 then raise exception 'Limit must be 1–500';end if;insert into discoveries(workspace_id,data) values(w,d) returning id into result;insert into jobs(workspace_id,kind,payload,unique_key) values(w,'discovery',jsonb_build_object('discovery_id',result),'discovery:'||result);return result;end$$;

create or replace function public.cancel_discovery(w uuid,discovery uuid) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w);perform 1 from workspaces where id=w for update;if workspace_role(w)='Agent' then raise exception 'Manager or admin required';end if;update discoveries set status='Cancelled' where id=discovery and workspace_id=w;update jobs set status='cancelled' where workspace_id=w and payload->>'discovery_id'=discovery::text and status='queued';end$$;

create or replace function public.save_task(w uuid,t jsonb) returns uuid language plpgsql security definer set search_path=public as $$declare result uuid;begin perform require_member(w);perform 1 from workspaces where id=w for update;insert into tasks(workspace_id,lead_id,title,owner,due_at) values(w,nullif(t->>'lead_id','')::uuid,t->>'title',coalesce(t->>'owner',''),(t->>'due_at')::timestamptz) returning id into result;return result;end$$;

create or replace function public.complete_task(w uuid,task uuid,completed boolean) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w);perform 1 from workspaces where id=w for update;update tasks set done=completed where id=task and workspace_id=w;if not found then raise exception 'Task not found';end if;end$$;

create or replace function public.log_call(w uuid,lead uuid) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w);perform 1 from workspaces where id=w for update;if not exists(select 1 from leads where id=lead and workspace_id=w) then raise exception 'Lead not found';end if;insert into audit_log(workspace_id,actor,event,entity_id) values(w,auth.uid(),'call.click_initiated',lead::text);end$$;

-- Never grant public execution of security-definer entry points.

revoke execute on all functions in schema public from public,anon,authenticated;

grant execute on function public.workspace_role(uuid),public.create_workspace(text),public.import_lead(uuid,jsonb),public.update_lead(uuid,uuid,jsonb),public.record_permission(uuid,uuid,text,boolean,text,boolean),public.save_campaign(uuid,text,jsonb,uuid),public.approve_campaign(uuid,uuid,int),public.control_campaign(uuid,uuid,text,int),public.emergency_stop_workspace(uuid,boolean),public.create_discovery(uuid,jsonb),public.cancel_discovery(uuid,uuid),public.save_task(uuid,jsonb),public.complete_task(uuid,uuid,boolean),public.log_call(uuid,uuid) to authenticated;

grant execute on all functions in schema public to service_role;

-- Publication may already exist in Supabase.

do $$begin alter publication supabase_realtime add table public.leads,public.jobs;exception when duplicate_object then null;end$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('workspace-files','workspace-files',false,2097152,array['text/csv','application/pdf']) on conflict do nothing;

create policy tenant_files_read on storage.objects for select to authenticated using(bucket_id='workspace-files' and workspace_role((storage.foldername(name))[1]::uuid) is not null);

create policy tenant_files_write on storage.objects for insert to authenticated with check(bucket_id='workspace-files' and workspace_role((storage.foldername(name))[1]::uuid) in ('Admin','Manager'));


revoke all on public.webhook_events,public.worker_heartbeats from anon,authenticated;
