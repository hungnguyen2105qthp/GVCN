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

  window.cloudReminderRequest = async function (payload) {
    const client = await window.cloudReady;
    const { data } = await client.auth.getSession();
    const token = data.session && data.session.access_token;
    if (!token) throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
    const response = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không thể gửi lời nhắc.");
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
