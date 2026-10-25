grant usage on schema public to authenticated, service_role;
grant select on public.profiles to authenticated;

grant all on table
  public.profiles,
  public.class_data,
  public.grades,
  public.class_reminders,
  public.attendance_records
to service_role;

notify pgrst, 'reload schema';
