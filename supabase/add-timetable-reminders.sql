create table if not exists public.timetable_reminders (
  id uuid primary key default gen_random_uuid(),
  class_id text not null,
  day smallint not null check (day between 1 and 6),
  reminder_date date not null,
  session text not null check (session in ('Sáng', 'Chiều')),
  period text not null,
  time text not null,
  subject text not null,
  message text not null check (char_length(message) between 1 and 500),
  recipient_ids text[] not null check (cardinality(recipient_ids) > 0),
  created_by uuid references auth.users (id) on delete set null,
  sender_name text not null,
  sender_role text not null,
  created_at timestamptz not null default now()
);

create index if not exists timetable_reminders_class_date
  on public.timetable_reminders (class_id, reminder_date desc);
create index if not exists timetable_reminders_recipient_lookup
  on public.timetable_reminders using gin (recipient_ids);

alter table public.timetable_reminders enable row level security;
revoke all on table public.timetable_reminders from public, anon, authenticated;
grant all on table public.timetable_reminders to service_role;

alter table public.attendance_records
  drop constraint if exists attendance_records_updated_by_fkey;
alter table public.attendance_records
  add constraint attendance_records_updated_by_fkey
  foreign key (updated_by) references auth.users (id) on delete set null;

notify pgrst, 'reload schema';
