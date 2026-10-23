do $$
declare
  gvcn_user_id uuid;
begin
  select id
  into gvcn_user_id
  from auth.users
  where email = 'u.6776636e@accounts.example.com';

  if gvcn_user_id is null then
    raise exception 'Create the GVCN Auth user first with email u.6776636e@accounts.example.com';
  end if;

  insert into public.profiles (id, username, full_name, role, student_id, class_id)
  values (gvcn_user_id, 'gvcn', 'Giáo viên chủ nhiệm', 'gvcn', null, '12C1')
  on conflict (id) do update
  set username = excluded.username,
      full_name = excluded.full_name,
      role = excluded.role,
      student_id = excluded.student_id,
      class_id = excluded.class_id;
end
$$;
