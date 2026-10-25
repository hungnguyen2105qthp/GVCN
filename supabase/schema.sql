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
  average_visible boolean not null default false,
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

alter table public.grades
  add column if not exists average_visible boolean not null default false;

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

create table if not exists public.attendance_records (
  class_id text not null,
  attendance_date date not null,
  session text not null check (session in ('Sáng', 'Chiều')),
  student_id text not null,
  status text not null check (status in ('present', 'late', 'excused', 'unexcused')),
  updated_by uuid default auth.uid() references auth.users (id),
  updated_at timestamptz not null default now(),
  primary key (class_id, attendance_date, session, student_id)
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

create or replace function public.current_student_attendance_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select student->>'role'
  from public.profiles profile
  join public.class_data class on class.class_id = profile.class_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(class.state->'students') = 'array' then class.state->'students' else '[]'::jsonb end
  ) student
  where profile.id = (select auth.uid())
    and student->>'id' = profile.student_id
  limit 1
$$;

create or replace function public.current_student_attendance_group()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select student->>'group'
  from public.profiles profile
  join public.class_data class on class.class_id = profile.class_id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(class.state->'students') = 'array' then class.state->'students' else '[]'::jsonb end
  ) student
  where profile.id = (select auth.uid())
    and student->>'id' = profile.student_id
  limit 1
$$;

create or replace function public.can_access_attendance_student(target_student_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.current_role() = 'gvcn'
    or public.current_student_id() = target_student_id
    or (
      public.current_role() = 'bcs'
      and (
        position('lớp trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
        or (
          position('tổ trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
          and exists (
            select 1
            from public.profiles profile
            join public.class_data class on class.class_id = profile.class_id
            cross join lateral jsonb_array_elements(
              case when jsonb_typeof(class.state->'students') = 'array' then class.state->'students' else '[]'::jsonb end
            ) student
            where profile.id = (select auth.uid())
              and student->>'id' = target_student_id
              and student->>'group' = public.current_student_attendance_group()
          )
        )
      )
    )
$$;

alter table public.profiles enable row level security;
alter table public.class_data enable row level security;
alter table public.grades enable row level security;
alter table public.class_reminders enable row level security;
alter table public.attendance_records enable row level security;
revoke all on table public.profiles, public.class_data, public.grades, public.class_reminders, public.attendance_records from public, anon, authenticated;
grant all on table public.profiles, public.class_data, public.grades, public.class_reminders, public.attendance_records to service_role;

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

drop policy if exists "attendance_read_authorized_students" on public.attendance_records;
create policy "attendance_read_authorized_students"
  on public.attendance_records for select to authenticated
  using (
    class_id = public.current_class_id() and
    public.can_access_attendance_student(student_id)
  );

drop policy if exists "attendance_insert_authorized_students" on public.attendance_records;
create policy "attendance_insert_authorized_students"
  on public.attendance_records for insert to authenticated
  with check (
    class_id = public.current_class_id() and
    public.can_access_attendance_student(student_id) and
    updated_by = (select auth.uid()) and
    (
      public.current_role() = 'gvcn'
      or (
        public.current_role() = 'bcs'
        and (
          position('lớp trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
          or position('tổ trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
        )
      )
      or (
        student_id = public.current_student_id()
        and status = 'present'
      )
    )
  );

drop policy if exists "attendance_update_authorized_students" on public.attendance_records;
create policy "attendance_update_authorized_students"
  on public.attendance_records for update to authenticated
  using (
    class_id = public.current_class_id() and
    public.can_access_attendance_student(student_id)
  )
  with check (
    class_id = public.current_class_id() and
    public.can_access_attendance_student(student_id) and
    updated_by = (select auth.uid()) and
    (
      public.current_role() = 'gvcn'
      or (
        public.current_role() = 'bcs'
        and (
          position('lớp trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
          or position('tổ trưởng' in lower(coalesce(public.current_student_attendance_role(), ''))) > 0
        )
      )
      or (
        student_id = public.current_student_id()
        and status = 'present'
      )
    )
  );

drop policy if exists "attendance_delete_authorized_students" on public.attendance_records;
create policy "attendance_delete_authorized_students"
  on public.attendance_records for delete to authenticated
  using (
    class_id = public.current_class_id() and
    public.can_access_attendance_student(student_id)
  );

grant select on public.profiles, public.class_data, public.grades, public.class_reminders to authenticated;
grant insert, update, delete on public.class_data to authenticated;
grant insert, update on public.grades to authenticated;
grant select, insert, update, delete on public.attendance_records to authenticated;
revoke all on function public.current_class_id(), public.current_role(), public.current_student_id(),
  public.current_student_attendance_role(), public.current_student_attendance_group(),
  public.can_access_attendance_student(text) from public, anon;
grant execute on function public.current_class_id(), public.current_role(), public.current_student_id(),
  public.current_student_attendance_role(), public.current_student_attendance_group(),
  public.can_access_attendance_student(text) to authenticated;

insert into public.attendance_records (class_id, attendance_date, session, student_id, status, updated_by)
select
  class.class_id,
  split_part(day.key, '_', 1)::date,
  split_part(day.key, '_', 2),
  attendance.key,
  attendance.value #>> '{}',
  (select id from public.profiles where class_id = class.class_id and role = 'gvcn' order by created_at limit 1)
from public.class_data class
cross join lateral jsonb_each(
  case when jsonb_typeof(class.state->'attendanceRecords') = 'object' then class.state->'attendanceRecords' else '{}'::jsonb end
) day
cross join lateral jsonb_each(
  case when jsonb_typeof(day.value) = 'object' then day.value else '{}'::jsonb end
) attendance
where day.key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}_(Sáng|Chiều)$'
  and attendance.value #>> '{}' in ('present', 'late', 'excused', 'unexcused')
on conflict (class_id, attendance_date, session, student_id)
do update set status = excluded.status, updated_at = now();

update public.class_data
set state = state - 'attendanceRecords'
where state ? 'attendanceRecords';

notify pgrst, 'reload schema';

-- After creating the GVCN Auth user, run supabase/create-gvcn-profile.sql
-- separately to create its application profile.
