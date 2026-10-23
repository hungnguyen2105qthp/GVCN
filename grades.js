(function () {
  const GRADE_COLUMNS = [
    ["regular_1", "1"],
    ["regular_2", "2"],
    ["regular_3", "3"],
    ["midterm", "Giữa kỳ"],
    ["final", "Cuối kỳ"],
  ];

  function isTeacher() {
    return Boolean(state.auth && state.auth.loggedIn && state.auth.role === "gvcn");
  }

  function linkedStudentId() {
    return String(state.auth && state.auth.studentId || "");
  }

  function computeAverage(record) {
    const weighted = [
      [record.regular_1, 1],
      [record.regular_2, 1],
      [record.regular_3, 1],
      [record.midterm, 2],
      [record.final, 3],
    ].filter(([score]) => score !== null && score !== undefined && score !== "");
    if (!weighted.length) return "";
    const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    const total = weighted.reduce((sum, [score, weight]) => sum + Number(score) * weight, 0);
    return (Math.round((total / totalWeight) * 10) / 10).toFixed(1);
  }

  function selectedContext() {
    return {
      subject: (document.getElementById("grade-subject") || {}).value || "Toán",
      academic_year: (document.getElementById("grade-year") || {}).value || state.academicYear || "",
      semester: (document.getElementById("grade-semester") || {}).value || "HK1",
    };
  }

  function gradeFor(studentId, context) {
    return (state.gradeRows || []).find(row =>
      String(row.student_id) === String(studentId) &&
      row.subject === context.subject &&
      row.academic_year === context.academic_year &&
      row.semester === context.semester
    ) || {};
  }

  function renderGradeRow(student, index, context) {
    const row = gradeFor(student.id, context);
    const cells = GRADE_COLUMNS.map(([field, label]) => {
      const value = row[field] ?? "";
      return `<td class="border border-slate-200 bg-white p-1.5 text-center">
        ${isTeacher()
          ? `<input aria-label="${escapeHtmlText(label)} - ${escapeHtmlText(student.name)}" data-student-id="${escapeHtmlText(student.id)}" type="number" min="0" max="10" step="0.1" value="${escapeHtmlAttr(value)}" class="grade-input w-20 rounded-lg border border-slate-200 px-2 py-2 text-center font-bold text-slate-800 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-100" onchange="saveGradeField(this.dataset.studentId,'${field}',this.value)">`
          : `<span class="font-bold text-slate-800">${value === "" ? "—" : escapeHtmlText(value)}</span>`}
      </td>`;
    }).join("");
    return `<tr class="hover:bg-teal-50/40">
      <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-bold text-slate-500">${index + 1}</td>
      <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-semibold text-slate-600">${escapeHtmlText(student.code || "—")}</td>
      <td class="min-w-48 border border-slate-200 bg-slate-50 px-3 py-3 font-bold text-slate-800">${escapeHtmlText(student.name || "Học sinh")}</td>
      ${cells}
      <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-black text-teal-800">${computeAverage(row) || "—"}</td>
      <td class="min-w-64 border border-slate-200 bg-white p-2">
        ${isTeacher()
          ? `<textarea aria-label="Nhận xét - ${escapeHtmlText(student.name)}" data-student-id="${escapeHtmlText(student.id)}" rows="2" class="w-full resize-y rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-teal-500" onchange="saveGradeField(this.dataset.studentId,'comment',this.value)">${escapeHtmlText(row.comment || "")}</textarea>`
          : `<span class="text-sm text-slate-600">${escapeHtmlText(row.comment || "Chưa có nhận xét")}</span>`}
      </td>
    </tr>`;
  }

  window.renderGradesView = function () {
    const students = isTeacher()
      ? (state.students || [])
      : (state.students || []).filter(student => String(student.id) === linkedStudentId());
    const years = state.academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    const context = {
      subject: (document.getElementById("grade-subject") || {}).value || "Toán",
      academic_year: (document.getElementById("grade-year") || {}).value || years,
      semester: (document.getElementById("grade-semester") || {}).value || "HK1",
    };
    const roleHeading = isTeacher() ? "BẢNG NHẬP ĐIỂM CẢ LỚP" : "KẾT QUẢ HỌC TẬP CỦA BẠN";

    return `<section class="animate-fade-in space-y-5">
      <div class="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-emerald-900 to-teal-800 p-6 text-white shadow-lg md:flex-row md:items-center md:justify-between">
        <div><div class="text-xs font-black tracking-[0.18em] text-emerald-200">${isTeacher() ? "CHỈ GVCN ĐƯỢC NHẬP/XEM ĐIỂM CẢ LỚP" : "BẢNG ĐIỂM CÁ NHÂN"}</div>
          <h2 class="mt-2 text-2xl font-black">${roleHeading}</h2>
          <p class="mt-1 text-sm text-emerald-100">${isTeacher() ? "Điểm được lưu trong database; học sinh chỉ xem được điểm của chính mình." : "Thông tin này chỉ GVCN và tài khoản của bạn được phép xem."}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <select id="grade-subject" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            ${["Toán", "Ngữ văn", "Tiếng Anh", "Vật lý", "Hóa học", "Sinh học", "Lịch sử", "Địa lý", "Tin học", "Khác"].map(subject => `<option class="text-slate-900" ${context.subject === subject ? "selected" : ""}>${subject}</option>`).join("")}
          </select>
          <select id="grade-year" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            <option class="text-slate-900" ${context.academic_year === years ? "selected" : ""}>${escapeHtmlText(years)}</option>
          </select>
          <select id="grade-semester" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            ${["HK1", "HK2"].map(semester => `<option class="text-slate-900" ${context.semester === semester ? "selected" : ""}>${semester}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="grade-access-error" class="hidden rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"></div>
      <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="min-w-[1050px] border-collapse text-sm">
            <thead class="bg-sky-700 text-white">
              <tr>
                <th rowspan="2" class="border border-white/20 px-3 py-3">STT</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Mã định danh Bộ GD&amp;ĐT</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Họ tên</th>
                <th colspan="3" class="border border-white/20 px-3 py-2">ĐĐGtx</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐĐGgk</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐĐGck</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐTBmhk</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Nhận xét sự tiến bộ, ưu điểm nổi bật, hạn chế chủ yếu</th>
              </tr>
              <tr>${["1", "2", "3"].map(label => `<th class="border border-white/20 px-3 py-2">${label}</th>`).join("")}</tr>
            </thead>
            <tbody>${students.length
              ? students.map((student, index) => renderGradeRow(student, index, context)).join("")
              : `<tr><td colspan="10" class="p-10 text-center font-semibold text-slate-500">${isTeacher() ? "Chưa có học sinh trong danh sách lớp." : "Tài khoản này chưa được liên kết với hồ sơ học sinh."}</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          Điểm trung bình tính theo trọng số: thường xuyên ×1, giữa kỳ ×2, cuối kỳ ×3; chỉ tính các cột đã có điểm.
        </div>
      </div>
    </section>`;
  };

  window.loadGrades = async function () {
    if (!state.auth || !state.auth.loggedIn) return;
    const client = await window.cloudReady;
    const { data, error } = await client.from("grades").select("*").order("student_id");
    if (error) throw error;
    state.gradeRows = data || [];
    if (state.currentTab === "diem-so") renderLayout();
  };

  window.saveGradeField = async function (studentId, field, rawValue) {
    if (!isTeacher()) {
      showToast("Chỉ GVCN được nhập hoặc sửa điểm.", "error");
      await window.loadGrades();
      renderLayout();
      return;
    }
    if (!["regular_1", "regular_2", "regular_3", "midterm", "final", "comment"].includes(field)) {
      showToast("Cột điểm không hợp lệ.", "error");
      return;
    }
    const value = field === "comment" ? String(rawValue || "").trim() : rawValue === "" ? null : Number(rawValue);
    if (field !== "comment" && value !== null && (!Number.isFinite(value) || value < 0 || value > 10)) {
      showToast("Điểm phải nằm trong khoảng từ 0 đến 10.", "error");
      await window.loadGrades();
      renderLayout();
      return;
    }

    try {
      const context = selectedContext();
      const existing = gradeFor(studentId, context);
      const record = {
        ...existing,
        class_id: state.cloudProfile.class_id,
        student_id: String(studentId),
        ...context,
        [field]: value,
        updated_at: new Date().toISOString(),
      };
      delete record.id;
      const client = await window.cloudReady;
      const { error } = await client.from("grades").upsert(record, {
        onConflict: "class_id,student_id,subject,academic_year,semester",
      });
      if (error) throw error;
      await window.loadGrades();
      showToast("Đã lưu điểm vào database.", "success");
    } catch (error) {
      console.error("Không thể lưu điểm:", error);
      showToast(error.message || "Không thể lưu điểm. Hãy kiểm tra kết nối và phân quyền database.", "error");
    }
  };

  window.addEventListener("load", () => {
    if (state && state.auth && state.auth.loggedIn) {
      window.loadGrades().catch(error => {
        console.error("Không thể tải bảng điểm:", error);
        showToast(error.message || "Không thể tải điểm từ database.", "error");
      });
    }
  });
})();
