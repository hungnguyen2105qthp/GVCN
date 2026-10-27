begin;

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

revoke all on function public.current_class_id(), public.current_role(), public.current_student_id()
  from public, anon;
grant execute on function public.current_class_id(), public.current_role(), public.current_student_id()
  to authenticated, service_role;

alter table public.grades enable row level security;
alter table public.class_reminders enable row level security;

revoke all on table public.grades, public.class_reminders from public, anon, authenticated;
grant select, insert, update on table public.grades to authenticated;
grant select on table public.class_reminders to authenticated;
grant all on table public.grades, public.class_reminders to service_role;

drop policy if exists "grades_teacher_or_self_read" on public.grades;
create policy "grades_teacher_or_self_read"
  on public.grades for select to authenticated
  using (
    class_id = (select public.current_class_id()) and (
      (select public.current_role()) = 'gvcn' or
      (
        (select public.current_role()) in ('hocsinh', 'bcs') and
        student_id = (select public.current_student_id())
      )
    )
  );

drop policy if exists "grades_teacher_insert" on public.grades;
create policy "grades_teacher_insert"
  on public.grades for insert to authenticated
  with check (
    (select public.current_role()) = 'gvcn' and
    class_id = (select public.current_class_id())
  );

drop policy if exists "grades_teacher_update" on public.grades;
create policy "grades_teacher_update"
  on public.grades for update to authenticated
  using (
    (select public.current_role()) = 'gvcn' and
    class_id = (select public.current_class_id())
  )
  with check (
    (select public.current_role()) = 'gvcn' and
    class_id = (select public.current_class_id())
  );

drop policy if exists "class_reminders_read_teacher_or_recipient" on public.class_reminders;
create policy "class_reminders_read_teacher_or_recipient"
  on public.class_reminders for select to authenticated
  using (
    class_id = (select public.current_class_id()) and (
      (select public.current_role()) = 'gvcn' or
      (
        (select public.current_role()) in ('hocsinh', 'bcs') and
        (select public.current_student_id()) = any(recipient_ids)
      )
    )
  );

create unique index if not exists grades_student_subject_context_unique
  on public.grades (class_id, student_id, subject, academic_year, semester);

notify pgrst, 'reload schema';

commit;
