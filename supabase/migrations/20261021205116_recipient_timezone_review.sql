create or replace function public.update_lead(w uuid,lead uuid,patch jsonb) returns void language plpgsql security definer set search_path=public as $$begin perform require_member(w);perform 1 from workspaces where id=w for update;

 if exists(select 1 from jsonb_object_keys(patch) k where k not in ('stage','owner','tags','notes','website_status','stopped','timezone')) then raise exception 'Protected lead fields require a permission review';end if;

 if patch ? 'timezone' and (workspace_role(w) not in ('Admin','Manager') or not exists(select 1 from pg_timezone_names where name=patch->>'timezone')) then raise exception 'Manager review and valid IANA timezone required';end if;
 if patch ? 'stage' and patch->>'stage' not in ('New','Qualified','Approved','Contacted','Replied','Meeting','Proposal','Won','Lost') then raise exception 'Invalid stage';end if;

 update leads set data=data||patch,updated_at=now() where id=lead and workspace_id=w;if not found then raise exception 'Lead not found';end if;

 if patch->>'stopped'='true' then update jobs set status='cancelled' where workspace_id=w and payload->>'lead_id'=lead::text and status='queued';end if;

 insert into audit_log(workspace_id,actor,event,entity_id,details) values(w,auth.uid(),'lead.updated',lead::text,jsonb_build_object('fields',(select jsonb_agg(k) from jsonb_object_keys(patch) k)));end$$;

create or replace function public.eligible_recipient(w uuid,r jsonb) returns boolean language sql stable security definer set search_path=public as $$
select exists(select 1 from leads l where l.workspace_id=w and l.id=(r->>'lead_id')::uuid
and l.data->>'timezone'=r->>'timezone' and l.data->>'jurisdiction_approved'='true' and coalesce(l.data->>'stopped','false')<>'true'
and not exists(select 1 from suppressions s where s.workspace_id=w and s.address=lower(r->>'to'))
and case r->>'channel'
when 'email' then l.data->>'email_permission'='granted' and lower(l.data->>'email')=lower(r->>'to') and l.data#>>'{facts,email,status}'='verified'
when 'whatsapp' then l.data->>'whatsapp_opt_in'='true' and l.data->>'whatsapp'=r->>'to' and l.data#>>'{facts,whatsapp,status}'='verified' and coalesce(r->>'template_id','')<>'' and coalesce(r->>'template_fingerprint','')<>''
when 'call' then l.data->>'call_permission'='granted' and l.data->>'phone'=r->>'to' and l.data#>>'{facts,phone,status}'='verified' and r->>'body' like 'This is an automated call from %' and r->>'body' like '%Press 9 to opt out of future outreach.' and (r->>'call_max_seconds')::int between 15 and 120
else false end)$$;
revoke all on function public.eligible_recipient(uuid,jsonb) from public,anon,authenticated;
