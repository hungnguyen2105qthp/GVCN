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

create index if not exists class_reminders_recipient_lookup
  on public.class_reminders using gin (recipient_ids);

alter table public.class_reminders enable row level security;
revoke all on table public.class_reminders from public, anon, authenticated;

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

grant select on public.class_reminders to authenticated;

notify pgrst, 'reload schema';
