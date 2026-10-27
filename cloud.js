(function () {
  const ACCOUNT_DOMAIN = "@accounts.example.com";

  function usernameToEmail(username) {
    const bytes = new TextEncoder().encode(String(username || "").trim().toLowerCase());
    const localPart = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    return `u.${localPart}${ACCOUNT_DOMAIN}`;
  }

  async function loadClient() {
    const configResponse = await fetch("/api/config", { cache: "no-store" });
    const config = await configResponse.json().catch(() => null);
    if (!configResponse.ok) throw new Error(config && config.error || "Không tải được cấu hình database.");
    if (!config) throw new Error("Không nhận được cấu hình database. Hãy chạy ứng dụng qua Vercel.");

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Không tải được thư viện kết nối database."));
      document.head.appendChild(script);
    });

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("Thư viện Supabase không sẵn sàng.");
    }
    window.cloudClient = window.supabase.createClient(config.url, config.anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      global: { headers: { "Cache-Control": "no-cache, no-store" } },
    });
    return window.cloudClient;
  }

  window.cloudReady = loadClient();
  window.usernameToCloudEmail = usernameToEmail;

  window.cloudAccountRequest = async function (payload) {
    const client = await window.cloudReady;
    const { data } = await client.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    const response = await fetch("/api/admin-users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể thực hiện thao tác tài khoản.");
    return result;
  };

  window.cloudReminderRequest = async function (payload, method = "POST") {
    const client = await window.cloudReady;
    const { data } = await client.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    const response = await fetch("/api/reminders", {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
      const fallbackMessage = method === "PUT"
        ? "Không thể sửa lời nhắc."
        : method === "DELETE"
          ? "Không thể xóa lời nhắc."
          : "Không thể gửi lời nhắc.";
      throw new Error(result.error || fallbackMessage);
    }
    return result;
  };

  window.loadCloudClass = async function (legacyState, replaceExisting = false) {
    const client = await window.cloudReady;
    const { data: sessionData } = await client.auth.getSession();
    const session = sessionData.session;
    if (!session) return false;

    const { data: profile, error: profileError } = await client
      .from("profiles")
      .select("id,username,full_name,role,student_id,class_id")
      .eq("id", session.user.id)
      .single();
    if (profileError) throw profileError;

    const { data: classRow, error: classError } = await client
      .from("class_data")
      .select("state")
      .eq("class_id", profile.class_id)
      .maybeSingle();
    if (classError) throw classError;

    let nextState = classRow && classRow.state ? classRow.state : null;
    let classNameRenamed = false;
    const importedBackup = Boolean(legacyState && legacyState._legacyBackupPending);
    const shouldImport = profile.role === "gvcn" && (!nextState || (importedBackup && replaceExisting));
    if (shouldImport) {
      const migration = { ...(legacyState || {}) };
      const legacyAttendanceRecords = migration.attendanceRecords;
      delete migration.attendanceRecords;
      delete migration.auth;
      delete migration.users;
      delete migration.database;
      delete migration.loginRoleSelect;
      delete migration.gradeRows;
      delete migration.classReminders;
      delete migration.cloudProfile;
      delete migration._legacyBackupPending;
      if (!migration.admin) migration.admin = {};
      migration.admin.className = migration.admin.className || profile.class_id;
      const { error: migrationError } = await client
        .from("class_data")
        [classRow ? "upsert" : "insert"]({ class_id: profile.class_id, state: migration }, classRow ? { onConflict: "class_id" } : undefined);
      if (migrationError && migrationError.code !== "23505") throw migrationError;
      nextState = migration;
      state.cloudMigrationPerformed = true;
      state.cloudMigrationHadLegacy = Object.keys(legacyState || {}).length > 0;
      state.pendingAttendanceImport = legacyAttendanceRecords || {};
      state.attendanceImportPending = true;
    }
    if (profile.class_id === "12C1" && nextState && nextState.admin && nextState.admin.className === "LỚP 12A1") {
      nextState = { ...nextState, admin: { ...nextState.admin, className: "LỚP 12C1" } };
      classNameRenamed = true;
    }
    state.cloudBackupPending = importedBackup && Boolean(classRow) && !replaceExisting;

    if (nextState) {
      const auth = state.auth;
      const currentTab = state.currentTab;
      state = { ...state, ...nextState, auth, currentTab };
    }

    const { data: profiles, error: usersError } = await client
      .from("profiles")
      .select("id,username,full_name,role,student_id,class_id")
      .eq("class_id", profile.class_id);
    if (usersError) throw usersError;
    state.users = (profiles || []).map(item => ({
      id: item.id,
      username: item.username,
      fullName: item.full_name,
      role: item.role,
      studentId: item.student_id,
      className: item.class_id,
    }));
    state.cloudProfile = profile;
    state.auth = {
      loggedIn: true,
      role: profile.role,
      userId: profile.id,
      studentId: profile.student_id,
      username: profile.username,
      fullName: profile.full_name,
    };
    const legacyAccounts = Array.isArray(legacyState && legacyState.users)
      ? legacyState.users
      : Array.isArray(legacyState && legacyState.database && legacyState.database.accounts)
        ? legacyState.database.accounts
        : [];
    if (shouldImport && profile.role === "gvcn" && legacyAccounts.length) {
      const imported = new Set();
      const assignedStudents = new Set(state.users.map(user => String(user.studentId || "")));
      let accountMigrationErrors = 0;
      for (const account of legacyAccounts) {
        const role = normalizeAccountRole(account.role);
        const username = String(account.username || "").trim();
        const studentId = String(account.studentId || "");
        if (!["bcs", "hocsinh"].includes(role) || !username || !account.password || !studentId) continue;
        if (state.users.some(user => user.username.toLowerCase() === username.toLowerCase()) || assignedStudents.has(studentId)) continue;
        try {
          const { account: migratedAccount } = await window.cloudAccountRequest({
            action: "create",
            username,
            password: account.password,
            role,
            fullName: account.fullName || account.name || username,
            studentId,
          });
          state.users.push({
            id: migratedAccount.id,
            username: migratedAccount.username,
            fullName: migratedAccount.fullName,
            role: migratedAccount.role,
            studentId: migratedAccount.studentId,
          });
          assignedStudents.add(studentId);
          imported.add(username);
        } catch (error) {
          accountMigrationErrors++;
          console.error(`Không thể chuyển tài khoản cũ "${username}":`, error.message);
        }
      }
      state.cloudMigratedAccounts = imported.size;
      state.cloudAccountMigrationErrors = accountMigrationErrors;
    }
    applyStateDefaults();
    await window.loadAttendanceRecords();
    if (classNameRenamed && profile.role === "gvcn") await window.persistCloudClass();
    return true;
  };

  window.persistCloudClass = async function () {
    const client = await window.cloudReady;
    if (!state.auth || !state.auth.loggedIn || !state.cloudProfile) return;
    if (state.auth.role !== "gvcn") return;

    const persisted = JSON.parse(JSON.stringify(state));
    delete persisted.auth;
    delete persisted.users;
    delete persisted.database;
    delete persisted.cloudProfile;
    delete persisted.loginRoleSelect;
    delete persisted.gradeRows;
    delete persisted.attendanceRecords;
    delete persisted.pendingAttendanceImport;
    delete persisted.attendanceImportPending;
    delete persisted.cloudMigrationPerformed;
    delete persisted.cloudMigrationHadLegacy;
    delete persisted.cloudMigratedAccounts;
    delete persisted.cloudAccountMigrationErrors;
    delete persisted.cloudBackupPending;
    delete persisted._legacyBackupPending;
    delete persisted.classReminders;

    const { error } = await client.from("class_data").upsert(
      { class_id: state.cloudProfile.class_id, state: persisted },
      { onConflict: "class_id" }
    );
    if (error) throw error;
  };

  window.loadAttendanceRecords = async function () {
    const client = await window.cloudReady;
    if (!state.auth || !state.auth.loggedIn || !state.cloudProfile) return;

    const legacyRecords = state.attendanceImportPending ? state.pendingAttendanceImport : null;
    if (state.auth.role === "gvcn" && legacyRecords && typeof legacyRecords === "object") {
      const records = Object.entries(legacyRecords).flatMap(([key, students]) => {
        const separator = key.lastIndexOf("_");
        const attendanceDate = separator < 0 ? "" : key.slice(0, separator);
        const session = separator < 0 ? "" : key.slice(separator + 1);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(attendanceDate) || !["Sáng", "Chiều"].includes(session)) return [];
        return Object.entries(students || {}).flatMap(([studentId, status]) =>
          ["present", "late", "excused", "unexcused"].includes(status)
            ? [{
                class_id: state.cloudProfile.class_id,
                attendance_date: attendanceDate,
                session,
                student_id: String(studentId),
                status,
                updated_by: state.auth.userId,
              }]
            : []
        );
      });
      if (state.cloudMigrationPerformed) {
        const { error: deleteError } = await client.from("attendance_records")
          .delete().eq("class_id", state.cloudProfile.class_id);
        if (deleteError) throw deleteError;
      }
      if (records.length) {
        const { error: importError } = await client.from("attendance_records")
          .upsert(records, { onConflict: "class_id,attendance_date,session,student_id" });
        if (importError) throw importError;
      }
      delete state.pendingAttendanceImport;
      state.attendanceImportPending = false;
    }

    const { data, error } = await client.from("attendance_records")
      .select("attendance_date,session,student_id,status")
      .order("attendance_date");
    if (error) throw error;
    const attendanceRecords = {};
    (data || []).forEach(record => {
      const key = `${record.attendance_date}_${record.session}`;
      if (!attendanceRecords[key]) attendanceRecords[key] = {};
      attendanceRecords[key][String(record.student_id)] = record.status;
    });
    state.attendanceRecords = attendanceRecords;
  };

  window.saveAttendanceRecord = async function (studentId, status, attendanceDate, session) {
    const client = await window.cloudReady;
    if (!state.auth || !state.auth.loggedIn || !state.cloudProfile) {
      throw new Error("Vui lòng đăng nhập để điểm danh.");
    }
    const key = {
      class_id: state.cloudProfile.class_id,
      attendance_date: attendanceDate,
      session,
      student_id: String(studentId),
    };
    if (status === null) {
      const { error } = await client.from("attendance_records").delete()
        .match(key);
      if (error) throw error;
      return;
    }
    if (!["present", "late", "excused", "unexcused"].includes(status)) {
      throw new Error("Trạng thái điểm danh không hợp lệ.");
    }
    const { error } = await client.from("attendance_records").upsert(
      { ...key, status, updated_by: state.auth.userId, updated_at: new Date().toISOString() },
      { onConflict: "class_id,attendance_date,session,student_id" }
    );
    if (error) throw error;
  };

  window.saveAttendanceRecords = async function (records) {
    const client = await window.cloudReady;
    if (!state.auth || !state.auth.loggedIn || !state.cloudProfile) {
      throw new Error("Vui lòng đăng nhập để điểm danh.");
    }
    if (!records.length) return;
    const rows = records.map(record => ({
      class_id: state.cloudProfile.class_id,
      attendance_date: record.attendanceDate,
      session: record.session,
      student_id: String(record.studentId),
      status: record.status,
      updated_by: state.auth.userId,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await client.from("attendance_records").upsert(
      rows,
      { onConflict: "class_id,attendance_date,session,student_id" }
    );
    if (error) throw error;
  };

  window.initializeCloudSession = async function () {
    const client = await window.cloudReady;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) return false;
    const backup = localStorage.getItem("classManagerImportBackup");
    const localState = JSON.parse(backup || localStorage.getItem("classManagerData") || "{}");
    if (localState._legacyBackupPending) return false;
    return window.loadCloudClass(localState);
  };
})();
