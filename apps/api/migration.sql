create extension if not exists pgcrypto;

create table if not exists workspaces(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 plan text not null default 'starter',
 created_at timestamptz not null default now()
);
create table if not exists users(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 full_name text not null,
 email text not null unique,
 password_hash text,
 role text not null check(role in ('agent','manager','admin')),
 status text not null default 'active',
 created_at timestamptz not null default now()
);
create table if not exists properties(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 owner_id uuid references users(id),
 name text not null, location text, price numeric, currency char(3) default 'MYR',
 tenure text, bedrooms int, bathrooms int, built_up text, lot_type text,
 verified_usps jsonb not null default '[]'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists properties_workspace_idx on properties(workspace_id);

create table if not exists media(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 property_id uuid references properties(id) on delete cascade,
 storage_key text not null, original_name text, mime_type text, size_bytes bigint, tag text,
 created_at timestamptz not null default now()
);
create table if not exists leads(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 property_id uuid references properties(id),
 owner_id uuid references users(id),
 name text not null, phone text, email text, stage text not null default 'new'
   check(stage in ('new','contacted','viewing','closed')),
 source text, notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 campaign_id uuid,
 creative_id uuid,
 funnel_stage text
);
create index if not exists leads_workspace_stage_idx on leads(workspace_id,stage);

create table if not exists ai_jobs(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 owner_id uuid references users(id), property_id uuid references properties(id),
 funnel_stage text, request jsonb, response jsonb, provider text, model text,
 status text not null default 'queued', created_at timestamptz not null default now()
);
create table if not exists creative_renders(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 owner_id uuid references users(id), property_id uuid references properties(id),
 format text not null, brief jsonb not null, status text not null default 'draft',
 output_storage_key text, created_at timestamptz not null default now()
);
create table if not exists campaigns(
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references workspaces(id) on delete cascade,
 name text not null, platform text, funnel_stage text, status text default 'draft',
 budget numeric, start_at timestamptz, end_at timestamptz, created_at timestamptz default now()
);
create table if not exists audit_logs(
 id bigserial primary key,workspace_id uuid,actor_id uuid,action text,entity_type text,entity_id uuid,metadata jsonb,created_at timestamptz default now()
);

-- V4.5.1 lead attribution
alter table leads add column if not exists campaign_id uuid;
alter table leads add column if not exists creative_id uuid;
alter table leads add column if not exists funnel_stage text;
create index if not exists leads_campaign_idx on leads(workspace_id,campaign_id);
