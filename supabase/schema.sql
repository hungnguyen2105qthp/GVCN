create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  full_name text not null,
  role text not null check (role in ('gvcn', 'bcs', 'hocsinh')),
  student_id text,
  class_id text not null,
  created_at timestamptz not null default now(),
  constraint profile_student_link check (
    (role = 'gvcn' and student_id is null) or
    (role in ('bcs', 'hocsinh') and student_id is not null)
  )
);

create table if not exists public.class_data (
  class_id text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.grades (
  id uuid primary key default gen_random_uuid(),
  class_id text not null,
  student_id text not null,
  subject text not null,
  academic_year text not null,
  semester text not null check (semester in ('HK1', 'HK2')),
  regular_1 numeric(3, 1) check (regular_1 between 0 and 10),
  regular_2 numeric(3, 1) check (regular_2 between 0 and 10),
  regular_3 numeric(3, 1) check (regular_3 between 0 and 10),
  regular_4 numeric(3, 1) check (regular_4 between 0 and 10),
  regular_5 numeric(3, 1) check (regular_5 between 0 and 10),
  midterm numeric(3, 1) check (midterm between 0 and 10),
  final numeric(3, 1) check (final between 0 and 10),
  reported_average numeric(3, 1) check (reported_average between 0 and 10),
  comment text not null default '',
  updated_at timestamptz not null default now(),
  unique (class_id, student_id, subject, academic_year, semester)
);

alter table public.grades
  add column if not exists regular_4 numeric(3, 1)
  check (regular_4 between 0 and 10);

alter table public.grades
  add column if not exists regular_5 numeric(3, 1)
  check (regular_5 between 0 and 10);

alter table public.grades
  add column if not exists reported_average numeric(3, 1)
  check (reported_average between 0 and 10);

create table if not exists public.class_reminders (
  id uuid primary key default gen_random_uuid(),
  class_id text not null,
  recipient_ids text[] not null check (cardinality(recipient_ids) > 0),
  message text not null check (char_length(message) between 1 and 500),
  created_by uuid not null references auth.users (id) on delete cascade,
  sender_name text not null,
  sender_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists grades_student_lookup
  on public.grades (class_id, student_id, academic_year, semester);
create index if not exists class_reminders_recipient_lookup
  on public.class_reminders using gin (recipient_ids);
create unique index if not exists profiles_one_student_account
  on public.profiles (class_id, student_id)
  where role in ('bcs', 'hocsinh');

create or replace function public.current_class_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select class_id from public.profiles where id = (select auth.uid())
$$;

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

create or replace function public.current_student_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select student_id from public.profiles where id = (select auth.uid())
$$;

alter table public.profiles enable row level security;
alter table public.class_data enable row level security;
alter table public.grades enable row level security;
alter table public.class_reminders enable row level security;
revoke all on table public.profiles, public.class_data, public.grades, public.class_reminders from public, anon, authenticated;

drop policy if exists "profiles_read_own_or_teacher" on public.profiles;
create policy "profiles_read_own_or_teacher"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid()) or
    (public.current_role() = 'gvcn' and class_id = public.current_class_id())
  );

drop policy if exists "class_data_read_class" on public.class_data;
create policy "class_data_read_class"
  on public.class_data for select to authenticated
  using (class_id = public.current_class_id());

drop policy if exists "class_data_teacher_write" on public.class_data;
create policy "class_data_teacher_write"
  on public.class_data for all to authenticated
  using (public.current_role() = 'gvcn' and class_id = public.current_class_id())
  with check (public.current_role() = 'gvcn' and class_id = public.current_class_id());

drop policy if exists "grades_teacher_or_self_read" on public.grades;
create policy "grades_teacher_or_self_read"
  on public.grades for select to authenticated
  using (
    class_id = public.current_class_id() and (
      public.current_role() = 'gvcn' or
      (
        public.current_role() in ('hocsinh', 'bcs') and
        student_id = public.current_student_id()
      )
    )
  );

drop policy if exists "class_reminders_read_teacher_or_recipient" on public.class_reminders;
create policy "class_reminders_read_teacher_or_recipient"
  on public.class_reminders for select to authenticated
  using (
    class_id = public.current_class_id() and (
      public.current_role() = 'gvcn' or
      (
        public.current_role() in ('hocsinh', 'bcs') and
        public.current_student_id() = any(recipient_ids)
      )
    )
  );

drop policy if exists "grades_teacher_insert" on public.grades;
create policy "grades_teacher_insert"
  on public.grades for insert to authenticated
  with check (public.current_role() = 'gvcn' and class_id = public.current_class_id());

drop policy if exists "grades_teacher_update" on public.grades;
create policy "grades_teacher_update"
  on public.grades for update to authenticated
  using (public.current_role() = 'gvcn' and class_id = public.current_class_id())
  with check (public.current_role() = 'gvcn' and class_id = public.current_class_id());

grant select on public.profiles, public.class_data, public.grades, public.class_reminders to authenticated;
grant insert, update, delete on public.class_data to authenticated;
grant insert, update on public.grades to authenticated;
revoke all on function public.current_class_id(), public.current_role(), public.current_student_id() from public, anon;
grant execute on function public.current_class_id(), public.current_role(), public.current_student_id() to authenticated;
notify pgrst, 'reload schema';

-- After creating the GVCN Auth user, run supabase/create-gvcn-profile.sql
-- separately to create its application profile.
