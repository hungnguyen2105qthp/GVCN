# 12C1 K60 QT

## Deploy to Vercel with Supabase

The static page alone cannot share data between browsers. Vercel serves the page and Supabase stores the class data, accounts, and grades. Grade privacy is enforced by PostgreSQL Row Level Security, not only by hiding controls in the page.

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql).
   If the project already has the previous schema, run the updated file again to create the reminders and attendance tables and their access policies, migrate existing attendance data out of the shared class state, and add the imported-average, average-visibility, and regular-score 4–5 grade columns. Average visibility is off by default; GVCN can explicitly publish each subject's average to the linked student. The script reloads the PostgREST schema cache after applying changes. Regular-score 4–5 and role-scoped attendance require this migration. If the tables already exist but student accounts still cannot read grades or reminders, run [`supabase/repair-student-sync.sql`](./supabase/repair-student-sync.sql) in this same project's SQL Editor. It restores the scoped read policies and the unique grade key required for upserts without exposing another student's records.
3. In **Authentication → Providers → Email**, disable public sign-ups.
4. Run the setup command from the repository root:

   ```powershell
   node .\scripts\create-gvcn.js
   ```

   The script reads `SUPABASE_URL` from `.env.local`, asks for the service-role key and password without saving or echoing them, then creates both the Supabase Auth user and its `profiles` row. Use username `gvcn` and class ID `12C1` at the prompts unless you want different values. The script generates the internal Auth email required by the app. Never put the service-role key in browser code or commit it.

### 2. Configure Vercel

Import this repository into Vercel and add these Environment Variables to the deployment. The app accepts either the `SUPABASE_*` names below or the `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` names:

- `SUPABASE_URL`: Project URL from Supabase **Settings → API**.
- `SUPABASE_ANON_KEY`: Supabase publishable/anon key. You can instead set `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY`: server-only secret/service-role key from the same Supabase project as `SUPABASE_URL`. Used by `/api/admin-users` and `/api/reminders` for privileged operations. New `sb_secret_...` keys are sent only in the `apikey` header; legacy JWT `service_role` keys are also supported.

In Vercel, open **Project → Settings → Environment Variables**, add the variables for the environments you deploy (Production/Preview/Development), then redeploy the latest deployment. `/api/config` exposes only the public URL and publishable/anon key; the service-role key stays in the Vercel function environment. Do not add a service-role or secret key to any `VITE_` variable or browser code. The URL and both keys must belong to the same Supabase project. The publishable/anon key identifies the browser client, and the secret/service-role key is used by server functions; neither key automatically grants SQL table permissions. Pushing to GitHub updates the application only if this repository is connected to Vercel for automatic deployment. GitHub Pages cannot run the required `/api/config` and `/api/reminders` server functions. Supabase Realtime may remain disabled: the app polls for grade and reminder changes while student accounts are signed in, but this depends on the table read policies above and on Vercel using the same Supabase project.
For local Vercel development, copy `.env.example` to `.env.local` and fill it in; never commit the populated file.
If login or account management returns `permission denied for table profiles` (code `42501`), the Auth login may have succeeded but the app cannot read the matching profile. Open **Supabase → SQL Editor**, run [`supabase/fix-service-role-grants.sql`](./supabase/fix-service-role-grants.sql) against the same project as the Vercel URL, then retry. This restores profile-read permission for signed-in users and table access for server functions; it does not expose profile rows because row-level security remains enabled. The main `schema.sql` also grants these privileges for new or rebuilt projects. If you changed Vercel environment variables, redeploy the app after saving them.
After signing in as GVCN, use **Đổi banner** on the top banner to upload a wide image from your computer. The image is compressed and saved with the class data.

### 3. Create accounts and recover saved data

- Sign in as GVCN using the Supabase Auth user created above.
- Student records are stored in the `state` JSON column of the matching `public.class_data` row (under `state.students`), not in a separate `students` table. In Supabase Table Editor, open `class_data`, find the row whose `class_id` matches the GVCN profile, and inspect `state`. If the row is missing, import the old browser backup while signed in as GVCN; if the row exists but is stale, verify that Vercel's URL and publishable/secret keys all belong to this same Supabase project.
- Before the first GVCN sign-in, use **Tải dữ liệu cũ** on the old browser/origin to export its backup, then **Chọn tệp backup JSON** on the deployed page. The first GVCN sign-in copies that `classManagerData` and eligible student/BCS accounts into the class database if there is no class row yet. A backup can be explicitly confirmed to replace an existing class row. Accounts with passwords shorter than six characters are not imported and must be recreated. Browser storage from another browser/device or origin cannot be read by Vercel without this export/import step.
- New student/BCS accounts can be created from **Cài đặt → Quản lý tài khoản**. Use passwords of at least six characters.
- Each student/BCS profile is linked to one existing student ID. Only GVCN should create or link accounts.
- In **Điểm học tập**, GVCN can download the Excel template, fill in the class grades, and import the completed file. The teacher view can show the whole class or filter by group and includes each student's date of birth from their profile. Students see every subject in one view; GVCN can publish or hide the semester average for each student and subject.
- In **Thời khóa biểu**, click a subject to add a reminder for its exact date, select a group and individual recipients, and edit or delete reminders later. Students see only reminders addressed to them in the top-right bell, which refreshes while the page is open. The home-page class reminder supports the same group/member selection, and GVCN can edit or delete its text.
- **Trò chơi** groups the reward store and random name picker; choose either activity from its landing page. The home-page weekly topic can be browsed with the date picker or previous/next week buttons, and each week's topic is saved separately.
- In **Điểm danh**, students can mark only their own attendance; group leaders can view and mark their group; class leaders and GVCN can view and mark the whole class. **Bảng thống kê** follows the same visibility scope. Attendance records have their own table and row-level security policies.
- In **Thời khóa biểu**, **Tải TKB PDF** downloads only the timetable subjects and periods; reminders are not included in the exported PDF.

Grades live in a separate table. GVCN can read and write every grade in their class; a student or class officer can read only rows linked to their own student ID. Class officers cannot read classmates' grades, even by querying the database directly.

Class reminders are stored in `class_reminders`. GVCN can send reminders to the whole class or selected students, edit reminder text, and filter recipients by group; class leaders can address the class or selected students; group leaders can only address members of their own group. Students and class officers can read only reminders addressed to their linked student ID. The server validates sender permissions and recipient IDs, and database row-level security limits which reminders each account can read. On an existing project, run [`supabase/add-class-reminders.sql`](./supabase/add-class-reminders.sql) once in the Supabase SQL Editor. New projects get the same table from `schema.sql`. Configure `SUPABASE_SERVICE_ROLE_KEY` for the `/api/reminders` server function.

## Local preview

Run `node .\.vscode\serve.js` from the repository root or use the VS Code task **Run website with Supabase APIs** (port `8001` to avoid conflicting with another local server). The local server loads `.env.local`, serves the page and the `/api/config`, `/api/admin-users`, and `/api/reminders` routes, and connects to the same Supabase project as production. For account management and sending reminders locally, set `SUPABASE_SERVICE_ROLE_KEY` in the ignored `.env.local`; never commit or expose that key. The database schema must already be installed in Supabase.
