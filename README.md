# 12C1 K60 QT

## Deploy to Vercel with Supabase

The static page alone cannot share data between browsers. Vercel serves the page and Supabase stores the class data, accounts, and grades. Grade privacy is enforced by PostgreSQL Row Level Security, not only by hiding controls in the page.

### 1. Create the database

1. Create a Supabase project.
2. Open **SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql).
   If the project already has the previous schema, run the updated file again to create the reminders table and its access policy, and add the imported-average, average-visibility, and regular-score 4–5 grade columns. Average visibility is off by default; GVCN can explicitly publish each subject's average to the linked student. The script reloads the PostgREST schema cache after applying changes. Regular-score 4–5 require this migration.
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
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`: server-only service-role/secret key. Used by `/api/admin-users` and `/api/reminders` for privileged operations.

`VITE_SUPABASE_URL` is also accepted instead of `SUPABASE_URL`. `/api/config` exposes only the public URL and publishable/anon key; the service-role key stays in the Vercel function environment. Do not add a service-role or secret key to any `VITE_` variable or browser code.
For local Vercel development, copy `.env.example` to `.env.local` and fill it in; never commit the populated file.
After signing in as GVCN, use **Đổi banner** on the top banner to upload a wide image from your computer. The image is compressed and saved with the class data.

### 3. Create accounts and recover saved data

- Sign in as GVCN using the Supabase Auth user created above.
- Before the first GVCN sign-in, use **Tải dữ liệu cũ** on the old browser/origin to export its backup, then **Chọn tệp backup JSON** on the deployed page. The first GVCN sign-in copies that `classManagerData` and eligible student/BCS accounts into the class database if there is no class row yet. A backup can be explicitly confirmed to replace an existing class row. Accounts with passwords shorter than six characters are not imported and must be recreated. Browser storage from another browser/device or origin cannot be read by Vercel without this export/import step.
- New student/BCS accounts can be created from **Cài đặt → Quản lý tài khoản**. Use passwords of at least six characters.
- Each student/BCS profile is linked to one existing student ID. Only GVCN should create or link accounts.
- In **Điểm học tập**, GVCN can download the Excel template, fill in the class grades, and import the completed file. Students see every subject in one view; GVCN can publish or hide the semester average for each student and subject.
- In **Thời khóa biểu**, click a subject to add a reminder for its exact date, select a group and individual recipients, and edit reminders later. Students see only reminders addressed to them in the top-right bell, which refreshes while the page is open. The home-page class reminder supports the same group/member selection, and GVCN can edit its text.
- In **Điểm danh → Bảng thống kê**, select a month or a week to view attendance by exact date. GVCN can click a date heading to open that session and edit its attendance.

Grades live in a separate table. GVCN can read and write every grade in their class; a student or class officer can read only rows linked to their own student ID. Class officers cannot read classmates' grades, even by querying the database directly.

Class reminders are stored in `class_reminders`. GVCN can send reminders to the whole class or selected students, edit reminder text, and filter recipients by group; class leaders can address the class or selected students; group leaders can only address members of their own group. Students and class officers can read only reminders addressed to their linked student ID. The server validates sender permissions and recipient IDs, and database row-level security limits which reminders each account can read. On an existing project, run [`supabase/add-class-reminders.sql`](./supabase/add-class-reminders.sql) once in the Supabase SQL Editor. New projects get the same table from `schema.sql`. Configure `SUPABASE_SERVICE_ROLE_KEY` for the `/api/reminders` server function.

## Local preview

Run `node .\.vscode\serve.js` from the repository root or use the VS Code task **Run website with Supabase APIs** (port `8001` to avoid conflicting with another local server). The local server loads `.env.local`, serves the page and the `/api/config`, `/api/admin-users`, and `/api/reminders` routes, and connects to the same Supabase project as production. For account management and sending reminders locally, set `SUPABASE_SERVICE_ROLE_KEY` in the ignored `.env.local`; never commit or expose that key. The database schema must already be installed in Supabase.
