-- Durable Google discovery, WhatsApp and automated voice delivery.
alter table public.jobs drop constraint jobs_kind_check;
alter table public.jobs add constraint jobs_kind_check check(kind in ('discovery','enrichment','email','followup','whatsapp','call'));
alter table public.deliveries add column channel text not null default 'email' check(channel in ('email','whatsapp','call'));
alter table public.deliveries add column callback_sequence bigint not null default -1;
alter table public.campaigns add column call_approval_hash text;
alter table public.campaigns add column call_approved_by uuid references auth.users(id);
create index campaigns_call_approver on public.campaigns(call_approved_by) where call_approved_by is not null;

create or replace function public.eligible_recipient(w uuid,r jsonb) returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from leads l where l.workspace_id=w and l.id=(r->>'lead_id')::uuid
and l.data->>'jurisdiction_approved'='true' and coalesce(l.data->>'stopped','false')<>'true'
and not exists(select 1 from suppressions s where s.workspace_id=w and s.address=lower(r->>'to'))
and case r->>'channel'
when 'email' then l.data->>'email_permission'='granted' and lower(l.data->>'email')=lower(r->>'to') and l.data#>>'{facts,email,status}'='verified'
when 'whatsapp' then l.data->>'whatsapp_opt_in'='true' and l.data->>'whatsapp'=r->>'to' and l.data#>>'{facts,whatsapp,status}'='verified' and coalesce(r->>'template_id','')<>'' and coalesce(r->>'template_fingerprint','')<>''
when 'call' then l.data->>'call_permission'='granted' and l.data->>'phone'=r->>'to' and l.data#>>'{facts,phone,status}'='verified' and r->>'body' like 'This is an automated call from %' and r->>'body' like '%Press 9 to opt out of future outreach.' and (r->>'call_max_seconds')::int between 15 and 120
else false end)$$;
create or replace function public.save_campaign(w uuid,campaign_name text,rs jsonb,campaign uuid default null) returns uuid language plpgsql security definer set search_path=public as $$declare c uuid;r jsonb;begin perform require_member(w);perform 1 from workspaces where id=w for update;if jsonb_array_length(rs)<1 or jsonb_array_length(rs)>500 then raise exception 'Choose 1–500 recipients';end if;for r in select * from jsonb_array_elements(rs) loop if not exists(select 1 from leads where workspace_id=w and id=(r->>'lead_id')::uuid) then raise exception 'Recipient outside workspace';end if;if coalesce(r->>'channel','') not in ('email','whatsapp','call') or length(coalesce(r->>'body','')) not between 1 and 20000 or (r->>'estimated_cost')::numeric<0 then raise exception 'Invalid channel, content or cost';end if;end loop;

 if campaign is null then insert into campaigns(workspace_id,name,recipients) values(w,campaign_name,rs) returning id into c;else update campaigns set name=campaign_name,recipients=rs,version=version+1,status='Draft',approved_hash=null,approved_by=null,approved_at=null,call_approval_hash=null,call_approved_by=null where id=campaign and workspace_id=w returning id into c;update jobs set status='cancelled' where workspace_id=w and payload->>'campaign_id'=c::text and status='queued';end if;

 if c is null then raise exception 'Campaign not found';end if;return c;end$$;

create or replace function public.approve_campaign(w uuid,campaign uuid,v int) returns void language plpgsql security definer set search_path=public as $$declare c campaigns;r jsonb;begin perform require_member(w,true);perform 1 from workspaces where id=w for update;select * into c from campaigns where workspace_id=w and id=campaign for update;if c.id is null or c.version<>v then raise exception 'Campaign version changed';end if;if exists(select 1 from jsonb_array_elements(c.recipients) q(value) where q.value->>'channel'='call') and c.call_approval_hash is distinct from campaign_hash(c.recipients,c.version) then raise exception 'Separate automated calling approval required';end if;if jsonb_array_length(c.recipients)=0 then raise exception 'Recipients required';end if;for r in select * from jsonb_array_elements(c.recipients) loop if not eligible_recipient(w,r) then raise exception 'Recipient eligibility unresolved: %',r->>'to';end if;end loop;

 update campaigns set status='Approved',approved_hash=campaign_hash(recipients,version),approved_by=auth.uid(),approved_at=now() where id=campaign;

 insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'campaign.approved',campaign::text,jsonb_build_object('version',v,'hash',campaign_hash(c.recipients,v)));end$$;

create or replace function public.control_campaign(w uuid,campaign uuid,operation text,v int) returns void language plpgsql security definer set search_path=public as $$declare c campaigns;r jsonb;i int:=0;begin perform require_member(w);perform 1 from workspaces where id=w for update;if workspace_role(w)='Agent' then raise exception 'Manager or admin required';end if;select * into c from campaigns where workspace_id=w and id=campaign for update;if c.id is null or c.version<>v then raise exception 'Campaign version changed';end if;

 if operation='launch' then

 if c.status not in ('Approved','Paused') or c.approved_hash is null or c.approved_hash<>campaign_hash(c.recipients,c.version) or exists(select 1 from workspaces where id=w and emergency_stop) then raise exception 'Valid approval required; check emergency stop';end if;

 for r in select * from jsonb_array_elements(c.recipients) loop if r->>'channel'='call' and c.call_approval_hash is distinct from campaign_hash(c.recipients,c.version) then raise exception 'Separate automated calling approval required';end if;if not eligible_recipient(w,r) then raise exception 'Eligibility changed';end if;

 insert into jobs(workspace_id,kind,payload,run_at,unique_key) values(w,r->>'channel',jsonb_build_object('campaign_id',c.id,'version',c.version,'lead_id',r->>'lead_id','recipient',r),greatest(now(),(r->>'scheduled_at')::timestamptz),c.id::text||':'||c.version||':'||i) on conflict(workspace_id,unique_key) do nothing;i:=i+1;end loop;

 update campaigns set status='Running' where id=campaign;

 elsif operation='pause' then update campaigns set status='Paused' where id=campaign;

 elsif operation='stop' then update campaigns set status='Stopped',approved_hash=null,call_approval_hash=null,call_approved_by=null where id=campaign;update jobs set status='cancelled' where workspace_id=w and payload->>'campaign_id'=campaign::text and status='queued';

 else raise exception 'Unknown operation';end if;

 insert into audit_log(workspace_id,actor,event,entity_id) values(w,auth.uid(),'campaign.'||operation,campaign::text);end$$;

create or replace function public.emergency_stop_workspace(w uuid,stopped boolean default true) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w,true);perform 1 from workspaces where id=w for update;update workspaces set emergency_stop=stopped where id=w;if stopped then update campaigns set status='Stopped',approved_hash=null,call_approval_hash=null,call_approved_by=null where workspace_id=w;update jobs set status='cancelled' where workspace_id=w and kind in ('email','followup','whatsapp','call') and status='queued';end if;insert into audit_log(workspace_id,actor,event,details) values(w,auth.uid(),'workspace.emergency_stop',jsonb_build_object('stopped',stopped));end$$;


create or replace function public.approve_automated_calls(w uuid,campaign uuid,v int) returns void language plpgsql security definer set search_path=public as $$
declare c campaigns;r jsonb;begin perform require_member(w,true);perform 1 from workspaces where id=w for update;
select * into c from campaigns where workspace_id=w and id=campaign for update;
if c.id is null or c.version<>v then raise exception 'Campaign version changed';end if;
if not exists(select 1 from jsonb_array_elements(c.recipients) q(value) where q.value->>'channel'='call') then raise exception 'No automated calls in campaign';end if;
for r in select * from jsonb_array_elements(c.recipients) loop if r->>'channel'='call' and not eligible_recipient(w,r) then raise exception 'Calling eligibility unresolved';end if;end loop;
update campaigns set call_approval_hash=campaign_hash(recipients,version),call_approved_by=auth.uid() where id=campaign;
insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'calls.separately_approved',campaign::text,jsonb_build_object('version',v,'hash',campaign_hash(c.recipients,v)));end$$;

create or replace function public.record_channel_permission(w uuid,lead uuid,channel text,address text,granted boolean,jurisdiction boolean,evidence text) returns void language plpgsql security definer set search_path=public as $$
declare d jsonb; field text;begin perform require_member(w);perform 1 from workspaces where id=w for update;
if workspace_role(w)='Agent' then raise exception 'Manager or admin review required';end if;
if channel not in ('whatsapp','call') or address !~ '^\+[1-9][0-9]{6,14}$' or evidence !~ '^https://' then raise exception 'Channel, E.164 phone and HTTPS consent evidence required';end if;
select data into d from leads where workspace_id=w and id=lead for update;if d is null then raise exception 'Lead not found';end if;
field:=case channel when 'call' then 'phone' else 'whatsapp' end;
d:=d||jsonb_build_object(field,address,'jurisdiction_approved',jurisdiction);
if channel='call' then d:=d||jsonb_build_object('call_permission',case when granted then 'granted' else 'denied' end);else d:=d||jsonb_build_object('whatsapp_opt_in',granted);end if;
d:=jsonb_set(d,'{facts}',coalesce(d->'facts','{}')||jsonb_build_object(field,jsonb_build_object('status','verified','source',evidence,'retrievedAt',now())),true);
update leads set data=d,updated_at=now() where workspace_id=w and id=lead;
if not granted then update jobs set status='cancelled',last_error='Channel consent revoked' where workspace_id=w and payload->>'lead_id'=lead::text and kind=channel and status='queued';end if;
insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'channel.consent_reviewed',lead::text,jsonb_build_object('channel',channel,'granted',granted,'jurisdiction',jurisdiction,'evidence',evidence));end$$;
revoke all on function public.approve_automated_calls(uuid,uuid,int),public.record_channel_permission(uuid,uuid,text,text,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.approve_automated_calls(uuid,uuid,int),public.record_channel_permission(uuid,uuid,text,text,boolean,boolean,text) to authenticated,service_role;
revoke all on function public.eligible_recipient(uuid,jsonb) from public,anon,authenticated;
alter table public.deliveries add column voice_started boolean not null default false;
