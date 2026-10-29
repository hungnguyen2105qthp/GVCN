(function () {
  const GRADE_COLUMNS = [
    ["regular_1", "1"],
    ["regular_2", "2"],
    ["regular_3", "3"],
    ["regular_4", "4"],
    ["regular_5", "5"],
    ["midterm", "Giữa kỳ"],
    ["final", "Cuối kỳ"],
  ];

  function isTeacher() {
    return Boolean(state.auth && state.auth.loggedIn && state.auth.role === "gvcn");
  }

  function linkedStudentId() {
    return String(state.auth && state.auth.studentId || "");
  }

  function formatStudentDob(value) {
    const dob = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : dob || "—";
  }

  function teacherGradeScopeStudents() {
    let students = state.students || [];
    const filter = String(state.gradeGroupFilter || (Array.isArray(state.gradeImportOrder) ? "import" : "all"));
    if (filter === "import" && Array.isArray(state.gradeImportOrder)) {
      const byId = new Map(students.map(student => [String(student.id), student]));
      students = state.gradeImportOrder.map(id => byId.get(String(id))).filter(Boolean);
    } else if (filter !== "all") {
      students = students.filter(student => String(student.group || "").trim() === filter);
    }
    const roleFilter = String(state.gradeRoleFilter || "");
    const search = String(state.gradeSearch || "").trim().toLocaleLowerCase("vi");
    if (roleFilter) students = students.filter(student => String(student.role || "") === roleFilter);
    if (search) students = students.filter(student =>
      [student.name, student.code, student.identifier].some(value =>
        String(value || "").toLocaleLowerCase("vi").includes(search)
      )
    );
    return students;
  }

  function computeAverage(record) {
    const weighted = [
      [record.regular_1, 1],
      [record.regular_2, 1],
      [record.regular_3, 1],
      [record.regular_4, 1],
      [record.regular_5, 1],
      [record.midterm, 2],
      [record.final, 3],
    ].filter(([score]) => score !== null && score !== undefined && score !== "");
    if (!weighted.length) return "";
    const totalWeight = weighted.reduce((sum, [, weight]) => sum + weight, 0);
    const total = weighted.reduce((sum, [score, weight]) => sum + Number(score) * weight, 0);
    return (Math.round((total / totalWeight) * 10) / 10).toFixed(1);
  }

  function publishedAverage(record) {
    if (!record || record.average_visible !== true) return null;
    const rawAverage = record.reported_average ?? computeAverage(record);
    if (rawAverage === "") return null;
    const average = Number(rawAverage);
    return Number.isFinite(average) ? average : null;
  }

  function selectedContext() {
    return {
      subject: (document.getElementById("grade-subject") || {}).value || "Toán",
      academic_year: (document.getElementById("grade-year") || {}).value || state.academicYear || "",
      semester: (document.getElementById("grade-semester") || {}).value || "HK1",
    };
  }

  function normalizeStudentKey(value) {
    return normalizeHeader(value);
  }

  function normalizeHeader(value) {
    return String(value ?? "")
      .replace(/[\u0110\u0111]/g, "d")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("vi")
      .replace(/[^a-z0-9]/g, "");
  }

  function findScoreColumns(rows, headerRowIndex, worksheet) {
    const header = rows[headerRowIndex] || [];
    const expandedHeader = [...header];
    for (const merge of worksheet["!merges"] || []) {
      if (merge.s.r <= headerRowIndex && merge.e.r >= headerRowIndex) {
        const value = header[merge.s.c];
        if (value !== undefined && value !== null) {
          for (let column = merge.s.c; column <= merge.e.c; column++) expandedHeader[column] = value;
        }
      }
    }
    const normalizedHeaders = expandedHeader.map(normalizeHeader);
    const midterm = normalizedHeaders.findIndex(value => value.includes("ddggk") || value.includes("giuaky"));
    const final = normalizedHeaders.findIndex(value => value.includes("ddgck") || value.includes("cuoiky"));
    const reportedAverage = normalizedHeaders.findIndex(value =>
      value.includes("dtbmhk") || value.includes("diemtrungbinhhocky") || value.includes("diemtrungbinh")
    );
    const comment = normalizedHeaders.findIndex(value => value.includes("nhanxet") || value.includes("comment"));
    const regular = [1, 2, 3, 4, 5].map(number => {
      const subheaderIndex = headerRowIndex + 1;
      const subheader = rows[subheaderIndex] || [];
      return subheader.findIndex((value, column) =>
        Number(value) === number && normalizedHeaders[column].includes("ddgtx")
      );
    });

    if (midterm < 0 || final < 0 || regular.slice(0, 3).some(column => column < 0)) {
      throw new Error("Không nhận diện được đủ cột điểm. Cần có ĐĐGtx 1–3, ĐĐGgk và ĐĐGck; ĐĐGtx 4–5 là tùy chọn.");
    }
    return { regular, midterm, final, reportedAverage, comment };
  }

  function parseGradeFile(file) {
    if (!window.XLSX) throw new Error("Thư viện đọc Excel chưa tải xong. Vui lòng tải lại trang và thử lại.");
    return file.arrayBuffer().then(buffer => {
      const workbook = XLSX.read(buffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!worksheet) throw new Error("File Excel không có trang tính.");
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
      const headerRowIndex = rows.findIndex((row, index) => {
        const cells = row.map(normalizeHeader);
        const hasIdentity = cells.some(value => value.includes("madinhdanh")) && cells.some(value => value.includes("hovaten"));
        const hasStudentId = cells.some(value => value === "stt");
        return hasIdentity && (hasStudentId || index === 0);
      });
      if (headerRowIndex < 0) throw new Error("Không tìm thấy hàng tiêu đề có “Mã định danh” và “Họ và tên”.");

      const header = rows[headerRowIndex].map(normalizeHeader);
      const idColumn = header.findIndex(value => value.includes("madinhdanh"));
      const nameColumn = header.findIndex(value => value.includes("hovaten"));
      const scoreColumns = findScoreColumns(rows, headerRowIndex, worksheet);
      const students = state.students || [];
      const byKey = new Map();
      for (const student of students) {
        for (const key of [student.identifier, student.code]) {
          const normalized = normalizeStudentKey(key);
          if (!normalized) continue;
          const matches = byKey.get(normalized) || [];
          if (!matches.some(item => String(item.id) === String(student.id))) matches.push(student);
          byKey.set(normalized, matches);
        }
      }

      const imported = [];
      const seenStudents = new Set();
      const seenIdentifiers = new Set();
      const reservedCodes = new Set(students.map(student => normalizeStudentKey(student.code)).filter(Boolean));
      let nextStudentId = students.length
        ? Math.max(...students.map(student => Number(student.id) || 0)) + 1
        : 1;
      for (let index = headerRowIndex + 2; index < rows.length; index++) {
        const row = rows[index];
        const identifier = row[idColumn];
        const name = String(row[nameColumn] ?? "").trim();
        if (!name) continue;

        const identifierMatches = identifier === "" || identifier === null || identifier === undefined
          ? []
          : byKey.get(normalizeStudentKey(identifier)) || [];
        const normalizedIdentifier = normalizeStudentKey(identifier);
        if (normalizedIdentifier && seenIdentifiers.has(normalizedIdentifier)) {
          throw new Error(`Mã định danh “${identifier}” xuất hiện nhiều lần trong file. Vui lòng kiểm tra trước khi nhập.`);
        }
        if (identifierMatches.length > 1) {
          throw new Error(`Mã định danh “${identifier}” đang gắn với nhiều học sinh. Vui lòng kiểm tra danh sách lớp.`);
        }
        let student = identifierMatches.length === 1 ? identifierMatches[0] : null;
        if (student && normalizeStudentKey(student.name) !== normalizeStudentKey(name)) {
          throw new Error(`Mã định danh “${identifier}” khớp với học sinh “${student.name}”, không phải “${name}”. Vui lòng kiểm tra file.`);
        }
        if (!student) {
          const nameKey = normalizeStudentKey(name);
          const nameMatches = students.filter(item =>
            normalizeStudentKey(item.name) === nameKey && !seenStudents.has(String(item.id))
          );
          if (nameMatches.length === 1) student = nameMatches[0];
          else if (nameMatches.length > 1) {
            throw new Error(`Có nhiều học sinh cùng tên “${name}”. File cần có mã định danh khớp để ghép đúng học sinh.`);
          }
        }
        const isNewStudent = !student;
        if (isNewStudent) {
          const importedCode = identifier === "" || identifier === null || identifier === undefined
            ? ""
            : String(identifier).trim();
          if (importedCode && byKey.has(normalizeStudentKey(importedCode))) {
            throw new Error(`Mã định danh “${importedCode}” đã thuộc học sinh khác. Vui lòng kiểm tra tên và mã trong file.`);
          }
          let code = generateUniqueCode();
          let codeAttempts = 0;
          while (reservedCodes.has(normalizeStudentKey(code)) && codeAttempts < 100) {
            code = generateUniqueCode();
            codeAttempts++;
          }
          if (reservedCodes.has(normalizeStudentKey(code))) {
            throw new Error("Không tạo được mã tra cứu duy nhất cho học sinh mới. Vui lòng thử nhập lại file.");
          }
          reservedCodes.add(normalizeStudentKey(code));
          student = {
            id: nextStudentId++,
            name,
            identifier: importedCode,
            code,
            gender: "",
            group: "Tổ 1",
            role: "",
            goal: "",
            talent: "",
            dob: "",
            boardingType: "Ngoại trú",
            ethnicity: "Kinh",
            isUnionMember: "Chưa",
            prevAcademic: "",
            prevConduct: "",
            avatarUrl: "",
            points: 0,
            stars: 0,
            history: [],
          };
          const importedKey = normalizeStudentKey(student.code);
          if (importedKey) {
            const matches = byKey.get(importedKey) || [];
            matches.push(student);
            byKey.set(importedKey, matches);
          }
        }
        if (normalizedIdentifier) seenIdentifiers.add(normalizedIdentifier);
        if (seenStudents.has(String(student.id))) {
          throw new Error(`Học sinh “${name}” xuất hiện nhiều lần trong file. Vui lòng kiểm tra trước khi nhập.`);
        }
        seenStudents.add(String(student.id));

        const values = scoreColumns.regular.map(column => column < 0 ? "" : row[column]);
        values.push(row[scoreColumns.midterm], row[scoreColumns.final]);
        const fields = [...GRADE_COLUMNS.slice(0, 5).map(([field]) => field), "midterm", "final"];
        const grades = {};
        values.forEach((rawValue, valueIndex) => {
          if (rawValue === "" || rawValue === null || rawValue === undefined) return;
          const value = typeof rawValue === "string" ? Number(rawValue.trim().replace(",", ".")) : Number(rawValue);
          if (!Number.isFinite(value) || value < 0 || value > 10) {
            throw new Error(`Điểm của “${name}” phải là số từ 0 đến 10.`);
          }
          grades[fields[valueIndex]] = value;
        });
        const averageValue = scoreColumns.reportedAverage >= 0 ? row[scoreColumns.reportedAverage] : "";
        if (averageValue !== "" && averageValue !== null && averageValue !== undefined) {
          const value = typeof averageValue === "string"
            ? Number(averageValue.trim().replace(",", "."))
            : Number(averageValue);
          if (!Number.isFinite(value) || value < 0 || value > 10) {
            throw new Error(`Điểm trung bình của “${name}” phải là số từ 0 đến 10.`);
          }
          grades.reported_average = value;
        }
        const commentValue = scoreColumns.comment >= 0 ? String(row[scoreColumns.comment] ?? "").trim() : "";
        if (commentValue) grades.comment = commentValue;
        imported.push({
          student,
          grades,
          isNewStudent,
          identifier: identifier === "" || identifier === null || identifier === undefined
            ? ""
            : String(identifier).trim(),
        });
      }
      if (!imported.length) throw new Error("Không ghép được học sinh nào trong file với danh sách lớp.");
      if (!imported.some(item => Object.keys(item.grades).length)) {
        throw new Error("File không có điểm nào để nhập.");
      }
      return { imported, fileName: file.name };
    });
  }

  window.prepareGradeImport = async function (input) {
    const status = document.getElementById("grade-import-status");
    const file = input.files && input.files[0];
    if (!file || !status) return;
    status.innerHTML = `<p class="text-sm font-semibold text-slate-600">Đang đọc file ${escapeHtmlText(file.name)}...</p>`;
    try {
      const pending = await parseGradeFile(file);
      window.pendingGradeImport = pending;
      status.innerHTML = `<div class="space-y-2 text-sm">
        <p class="font-bold text-emerald-800">Đã nhận diện ${pending.imported.length} học sinh trong “${escapeHtmlText(pending.fileName)}”. Học sinh mới: ${pending.imported.filter(item => item.isNewStudent).length}. Thứ tự trên bảng sẽ theo thứ tự trong file.</p>
        <p class="text-slate-600">Điểm thành phần và điểm trung bình trong file được lưu riêng. Điểm trống không xóa điểm đã có. Học sinh chưa có trong lớp sẽ được thêm hồ sơ mới.</p>
        <button type="button" onclick="importGradeFile()" class="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800">Nhập điểm và lọc bảng</button>
      </div>`;
    } catch (error) {
      window.pendingGradeImport = null;
      status.innerHTML = `<p class="text-sm font-bold text-red-700">${escapeHtmlText(error.message || "Không thể đọc file Excel.")}</p>`;
    }
  };

  window.downloadGradeTemplate = function () {
    if (!window.XLSX) {
      showToast("Thư viện Excel chưa tải xong. Vui lòng tải lại trang và thử lại.", "error");
      return;
    }
    try {
      const rows = [
        ["STT", "Mã định danh Bộ GD&ĐT", "Họ và tên", "ĐĐGtx", "", "", "", "", "ĐĐGgk", "ĐĐGck", "ĐTBmhk", "Nhận xét"],
        ["", "", "", "1", "2", "3", "4", "5", "", "", "", ""],
      ];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);
      worksheet["!merges"] = [{ s: { r: 0, c: 3 }, e: { r: 0, c: 7 } }];
      worksheet["!cols"] = [
        { wch: 7 }, { wch: 24 }, { wch: 28 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
        { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 42 },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Nhap diem");
      XLSX.writeFile(workbook, "Mau_nhap_diem_ca_lop.xlsx");
    } catch (error) {
      console.error("Không thể tạo file mẫu nhập điểm:", error);
      showToast(error.message || "Không thể tải file mẫu nhập điểm.", "error");
    }
  };

  window.importGradeFile = async function () {
    const pending = window.pendingGradeImport;
    if (!pending || !isTeacher()) {
      showToast("Chỉ GVCN mới được nhập điểm từ file.", "error");
      return;
    }
    try {
      const newStudents = pending.imported
        .filter(item => item.isNewStudent)
        .map(item => item.student);
      const identifierChanged = pending.imported.some(({ student, identifier }) =>
        identifier && student.identifier !== identifier
      );
      pending.imported.forEach(({ student, identifier }) => {
        if (identifier) student.identifier = identifier;
      });
      if (newStudents.length) state.students.push(...newStudents);
      if (newStudents.length || identifierChanged) {
        saveData();
        await window.persistCloudClass();
      }
      const context = selectedContext();
      const records = pending.imported.map(({ student, grades }) => {
        const existing = gradeFor(student.id, context);
        const record = {
          ...existing,
          class_id: state.cloudProfile.class_id,
          student_id: String(student.id),
          ...context,
          ...grades,
          updated_at: new Date().toISOString(),
        };
        delete record.id;
        return record;
      });
      const client = await window.cloudReady;
      const { omittedAverage } = await upsertGradeRecords(client, records);
      state.gradeImportOrder = pending.imported.map(({ student }) => String(student.id));
      window.pendingGradeImport = null;
      await window.loadGrades();
      showToast(
        omittedAverage
          ? `Đã nhập điểm cho ${records.length} học sinh. Database chưa có cột ĐTB từ file nên hệ thống sẽ tự tính; hãy chạy lại supabase/schema.sql để lưu cột này.`
          : `Đã nhập điểm cho ${records.length} học sinh theo thứ tự file.`,
        "success"
      );
    } catch (error) {
      console.error("Không thể nhập điểm từ file:", error);
      showToast(gradeSaveErrorMessage(error, "Không thể nhập điểm từ file."), "error");
    }
  };

  window.clearGradeImportOrder = function () {
    state.gradeImportOrder = null;
    renderLayout();
  };

  function gradeFor(studentId, context) {
    return (state.gradeRows || []).find(row =>
      String(row.student_id) === String(studentId) &&
      row.subject === context.subject &&
      row.academic_year === context.academic_year &&
      row.semester === context.semester
    ) || {};
  }

  function isMissingAverageColumn(error) {
    const message = String(error && (error.message || error.details || error.hint) || "");
    return /reported_average/i.test(message) && /column|schema cache|PGRST204/i.test(message);
  }

  function gradeSaveErrorMessage(error, fallback) {
    const message = String(error && (error.message || error.details || error.hint) || "");
    if (/regular_[45]/i.test(message) && /column|schema cache|PGRST204/i.test(message)) {
      return "Database chưa có cột điểm thường xuyên 4 và 5. Hãy chạy lại supabase/schema.sql trong Supabase SQL Editor rồi tải lại trang.";
    }
    if (/average_visible/i.test(message) && /column|schema cache|PGRST204/i.test(message)) {
      return "Database chưa có cột quyền công bố ĐTBmhk. Hãy chạy lại supabase/schema.sql trong Supabase SQL Editor rồi tải lại trang.";
    }
    return message || fallback;
  }

  async function upsertGradeRecords(client, records) {
    const options = { onConflict: "class_id,student_id,subject,academic_year,semester" };
    const firstAttempt = await client.from("grades").upsert(records, options);
    if (!firstAttempt.error) return { omittedAverage: false };
    if (!isMissingAverageColumn(firstAttempt.error)) throw firstAttempt.error;

    const compatibleRecords = records.map(record => {
      const compatibleRecord = { ...record };
      delete compatibleRecord.reported_average;
      return compatibleRecord;
    });
    const retry = await client.from("grades").upsert(compatibleRecords, options);
    if (retry.error) throw retry.error;
    return { omittedAverage: true };
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
      <td class="min-w-48 border border-slate-200 bg-slate-50 px-3 py-3 font-bold text-slate-800">${window.getStudentDisplayName ? window.getStudentDisplayName(student) : escapeHtmlText(student.name || "Học sinh")}</td>
      <td class="whitespace-nowrap border border-slate-200 bg-slate-50 px-3 py-3 text-center font-semibold text-slate-600">${escapeHtmlText(formatStudentDob(student.dob))}</td>
      ${cells}
      <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-black text-teal-800">
        ${isTeacher()
          ? `<div class="flex min-w-24 flex-col items-center gap-2"><span class="text-base">${escapeHtmlText(row.reported_average ?? computeAverage(row)) || "—"}</span><label class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border ${row.average_visible === true ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"} px-2 py-1 text-[10px] font-bold transition hover:border-emerald-300"><input type="checkbox" ${row.average_visible === true ? "checked" : ""} aria-label="Hiện điểm trung bình với ${escapeHtmlText(student.name)}" onchange="saveGradeVisibility(this.dataset.studentId,this.checked)" data-student-id="${escapeHtmlText(student.id)}" class="peer sr-only"><span class="flex h-3.5 w-3.5 items-center justify-center rounded-full border ${row.average_visible === true ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white"} text-[9px] text-white">${row.average_visible === true ? "✓" : ""}</span><span>${row.average_visible === true ? "Đã hiện" : "Hiện với HS"}</span></label></div>`
          : row.average_visible === true
            ? escapeHtmlText(row.reported_average ?? computeAverage(row)) || "—"
            : `<span class="text-xs font-semibold text-slate-400">Chưa công bố</span>`}
      </td>
      <td class="min-w-64 border border-slate-200 bg-white p-2">
        ${isTeacher()
          ? `<textarea aria-label="Nhận xét - ${escapeHtmlText(student.name)}" data-student-id="${escapeHtmlText(student.id)}" rows="2" class="w-full resize-y rounded-lg border border-slate-200 p-2 text-sm outline-none focus:border-teal-500" onchange="saveGradeField(this.dataset.studentId,'comment',this.value)">${escapeHtmlText(row.comment || "")}</textarea>`
          : `<span class="text-sm text-slate-600">${escapeHtmlText(row.comment || "Chưa có nhận xét")}</span>`}
      </td>
    </tr>`;
  }

  function renderStudentGradesTable(student, subjects, context) {
    if (!student) {
      return `<div class="rounded-2xl border border-slate-200 bg-white p-10 text-center font-semibold text-slate-500">Tài khoản này chưa được liên kết với hồ sơ học sinh.</div>`;
    }
    if (context.semester === "Cả năm") {
      const rows = subjects.map(subject => {
        const hk1 = gradeFor(student.id, { ...context, subject, semester: "HK1" });
        const hk2 = gradeFor(student.id, { ...context, subject, semester: "HK2" });
        const hk1Average = publishedAverage(hk1);
        const hk2Average = publishedAverage(hk2);
        const annualAverage = hk1Average !== null && hk2Average !== null
          ? ((hk1Average + 2 * hk2Average) / 3).toFixed(1)
          : null;
        const comment = hk2.comment || hk1.comment || "Chưa có nhận xét";
        const formatAverage = value => value === null
          ? `<span class="text-xs font-semibold text-slate-400">Chưa công bố</span>`
          : escapeHtmlText(value.toFixed ? value.toFixed(1) : value);
        return `<tr class="hover:bg-teal-50/40">
          <td class="border border-slate-200 bg-emerald-50 px-3 py-3 font-black text-emerald-900">${escapeHtmlText(subject)}</td>
          <td class="border border-slate-200 px-3 py-3 text-center font-black text-slate-700">${formatAverage(hk1Average)}</td>
          <td class="border border-slate-200 px-3 py-3 text-center font-black text-slate-700">${formatAverage(hk2Average)}</td>
          <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-black text-teal-800">${annualAverage === null ? `<span class="text-xs font-semibold text-slate-400">Chưa công bố đủ 2 học kỳ</span>` : formatAverage(Number(annualAverage))}</td>
          <td class="min-w-52 border border-slate-200 px-3 py-3 text-sm text-slate-600">${escapeHtmlText(comment)}</td>
        </tr>`;
      }).join("");
      return `<div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table class="min-w-[850px] border-collapse text-sm">
          <thead class="bg-sky-700 text-white"><tr>
            <th class="border border-white/20 px-3 py-3">Môn học</th>
            <th class="border border-white/20 px-3 py-3">ĐTB học kỳ 1</th>
            <th class="border border-white/20 px-3 py-3">ĐTB học kỳ 2</th>
            <th class="border border-white/20 px-3 py-3">ĐTB cả năm</th>
            <th class="border border-white/20 px-3 py-3">Nhận xét</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Điểm cả năm được tính theo công thức (HK1 + 2 × HK2) / 3 và chỉ hiển thị khi cả hai học kỳ đã được công bố.</p>
      </div>`;
    }

    const rows = subjects.map(subject => {
      const row = gradeFor(student.id, { ...context, subject });
      const scores = GRADE_COLUMNS.map(([field]) => {
        const value = row[field] ?? "";
        return `<td class="border border-slate-200 px-3 py-3 text-center font-bold text-slate-800">${value === "" ? "—" : escapeHtmlText(value)}</td>`;
      }).join("");
      const average = row.average_visible === true
        ? escapeHtmlText(row.reported_average ?? computeAverage(row)) || "—"
        : `<span class="text-xs font-semibold text-slate-400">Chưa công bố</span>`;
      return `<tr class="hover:bg-teal-50/40">
        <td class="border border-slate-200 bg-emerald-50 px-3 py-3 font-black text-emerald-900">${escapeHtmlText(subject)}</td>
        ${scores}
        <td class="border border-slate-200 bg-slate-50 px-3 py-3 text-center font-black text-teal-800">${average}</td>
        <td class="min-w-52 border border-slate-200 px-3 py-3 text-sm text-slate-600">${escapeHtmlText(row.comment || "Chưa có nhận xét")}</td>
      </tr>`;
    }).join("");
    return `<div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="min-w-[1150px] border-collapse text-sm">
        <thead class="bg-sky-700 text-white"><tr>
          <th class="border border-white/20 px-3 py-3">Môn học</th>
          ${GRADE_COLUMNS.slice(0, 5).map(([, label]) => `<th class="border border-white/20 px-3 py-3">TX ${label}</th>`).join("")}
          <th class="border border-white/20 px-3 py-3">Giữa kỳ</th>
          <th class="border border-white/20 px-3 py-3">Cuối kỳ</th>
          <th class="border border-white/20 px-3 py-3">ĐTB</th>
          <th class="border border-white/20 px-3 py-3">Nhận xét</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  window.renderGradesView = function () {
    let students = isTeacher()
      ? teacherGradeScopeStudents()
      : (state.students || []).filter(student => String(student.id) === linkedStudentId());
    const groupFilter = isTeacher()
      ? String(state.gradeGroupFilter || (Array.isArray(state.gradeImportOrder) ? "import" : "all"))
      : "all";
    const gradeGroups = [...new Set((state.students || []).map(student => String(student.group || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    const gradeRoles = [...new Set((state.students || []).map(student => String(student.role || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "vi"));
    const gradeRoleFilter = String(state.gradeRoleFilter || "");
    const gradeSearch = String(state.gradeSearch || "");
    const gradeScopeParts = [
      groupFilter === "all" ? "cả lớp" : groupFilter === "import" ? "danh sách vừa nhập" : groupFilter,
      gradeRoleFilter ? `chức vụ ${gradeRoleFilter}` : "",
      gradeSearch ? `tìm “${gradeSearch}”` : "",
    ].filter(Boolean);
    const gradeScopeLabel = gradeScopeParts.join(" · ");
    const years = state.academicYear || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`;
    const context = {
      subject: (document.getElementById("grade-subject") || {}).value || "Toán",
      academic_year: (document.getElementById("grade-year") || {}).value || years,
      semester: (document.getElementById("grade-semester") || {}).value || "HK1",
    };
    const roleHeading = isTeacher()
      ? `BẢNG NHẬP ĐIỂM ${gradeScopeLabel.toLocaleUpperCase("vi")}`
      : `KẾT QUẢ HỌC TẬP CỦA ${escapeHtmlText(String(students[0] && students[0].name || "HỌC SINH").toLocaleUpperCase("vi"))}`;
    const subjects = ["Toán", "Ngữ văn", "Tiếng Anh", "Vật lý", "Hóa học", "Sinh học", "Lịch sử", "Địa lý", "Tin học", "Khác"];
    const visibleSubjects = isTeacher()
      ? [context.subject]
      : [...new Set([
        ...subjects,
        ...(state.gradeRows || []).map(row => row.subject).filter(Boolean),
      ])];
    const allAveragesVisible = students.length > 0 && students.every(student =>
      gradeFor(student.id, context).average_visible === true
    );
    const renderTable = (subject) => {
      const subjectContext = { ...context, subject };
      return `<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        ${!isTeacher() ? `<h3 class="border-b border-slate-100 bg-emerald-50 px-5 py-3 text-lg font-black text-emerald-900">${escapeHtmlText(subject)}</h3>` : ""}
        <div class="overflow-x-auto">
          <table class="min-w-[1320px] border-collapse text-sm">
            <thead class="bg-sky-700 text-white">
              <tr>
                <th rowspan="2" class="border border-white/20 px-3 py-3">STT</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Mã định danh Bộ GD&amp;ĐT</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Họ tên</th>
                <th rowspan="2" class="whitespace-nowrap border border-white/20 px-3 py-3">Ngày sinh</th>
                <th colspan="5" class="border border-white/20 px-3 py-2">ĐĐGtx</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐĐGgk</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐĐGck</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">ĐTBmhk</th>
                <th rowspan="2" class="border border-white/20 px-3 py-3">Nhận xét sự tiến bộ, ưu điểm nổi bật, hạn chế chủ yếu</th>
              </tr>
              <tr>${["1", "2", "3", "4", "5"].map(label => `<th class="border border-white/20 px-3 py-2">${label}</th>`).join("")}</tr>
            </thead>
            <tbody>${students.length
              ? students.map((student, index) => renderGradeRow(student, index, subjectContext)).join("")
              : `<tr><td colspan="13" class="p-10 text-center font-semibold text-slate-500">${isTeacher() ? "Chưa có học sinh trong danh sách lớp." : "Tài khoản này chưa được liên kết với hồ sơ học sinh."}</td></tr>`}
            </tbody>
          </table>
        </div>
        ${isTeacher() ? `<div class="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/70 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><div class="text-sm font-black text-slate-800">Công bố ĐTBmhk môn ${escapeHtmlText(subject)} cho ${escapeHtmlText(gradeScopeLabel)}</div><p class="mt-1 text-xs text-slate-500">Có thể bật/tắt riêng từng học sinh ngay trong cột điểm trung bình.</p></div>
          <label class="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border ${allAveragesVisible ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-600"} px-4 py-2.5 text-xs font-black shadow-sm transition hover:border-emerald-300">
            <input id="grade-visibility-all" type="checkbox" ${allAveragesVisible ? "checked" : ""} ${state.gradeVisibilitySaving ? "disabled" : ""} onchange="setGradeVisibilityForScope(this.checked)" class="h-4 w-4 accent-emerald-600">
            ${state.gradeVisibilitySaving ? "Đang cập nhật…" : allAveragesVisible ? `Đang hiện với ${escapeHtmlText(gradeScopeLabel)}` : `Hiện ĐTBmhk ${escapeHtmlText(gradeScopeLabel)}`}
          </label>
        </div>` : ""}
        <div class="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">Điểm trung bình hiển thị theo file nếu có; nếu không, hệ thống tính theo trọng số từ các điểm thành phần.</div>
      </div>`;
    };

    return `<section class="animate-fade-in space-y-5">
      <div class="flex flex-col gap-4 rounded-3xl bg-gradient-to-r from-emerald-900 to-teal-800 p-6 text-white shadow-lg md:flex-row md:items-center md:justify-between">
        <h2 class="text-2xl font-black">${roleHeading}</h2>
        <div class="flex flex-wrap gap-2">
          ${isTeacher() ? `<select id="grade-subject" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            ${subjects.map(subject => `<option class="text-slate-900" ${context.subject === subject ? "selected" : ""}>${subject}</option>`).join("")}
          </select>
          <input type="search" value="${escapeHtmlAttr(gradeSearch)}" aria-label="Tìm học sinh theo tên hoặc mã" placeholder="Tìm học sinh..." onchange="state.gradeSearch=this.value.trim();renderLayout()" class="w-40 rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none placeholder:text-emerald-100">
          <select id="grade-group-filter" aria-label="Lọc học sinh theo tổ" onchange="state.gradeGroupFilter=this.value;renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            <option value="all" class="text-slate-900" ${groupFilter === "all" ? "selected" : ""}>Cả lớp</option>
            ${Array.isArray(state.gradeImportOrder) ? `<option value="import" class="text-slate-900" ${groupFilter === "import" ? "selected" : ""}>Danh sách vừa nhập</option>` : ""}
            ${gradeGroups.map(group => `<option value="${escapeHtmlAttr(group)}" class="text-slate-900" ${groupFilter === group ? "selected" : ""}>${escapeHtmlText(group)}</option>`).join("")}
          </select>
          <select aria-label="Lọc học sinh theo chức vụ" onchange="state.gradeRoleFilter=this.value;renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            <option value="" class="text-slate-900">Tất cả chức vụ</option>
            ${gradeRoles.map(role => `<option value="${escapeHtmlAttr(role)}" class="text-slate-900" ${gradeRoleFilter === role ? "selected" : ""}>${escapeHtmlText(role)}</option>`).join("")}
          </select>` : ""}
          <select id="grade-year" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            <option class="text-slate-900" ${context.academic_year === years ? "selected" : ""}>${escapeHtmlText(years)}</option>
          </select>
          <select id="grade-semester" onchange="renderLayout()" class="rounded-xl border border-white/20 bg-white/10 px-3 py-2 font-bold text-white outline-none">
            ${(isTeacher() ? ["HK1", "HK2"] : ["HK1", "HK2", "Cả năm"]).map(semester => `<option class="text-slate-900" ${context.semester === semester ? "selected" : ""}>${semester}</option>`).join("")}
          </select>
        </div>
      </div>
      <div id="grade-access-error" class="hidden rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700"></div>
      ${isTeacher() ? `<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 class="font-black text-emerald-900">Nhập điểm cả lớp từ máy tính</h3>
            <p class="mt-1 text-sm text-emerald-800">Tải file mẫu, điền thông tin và điểm, rồi chọn tệp để nhập. Học sinh được ghép theo mã định danh hoặc họ tên.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick="downloadGradeTemplate()" class="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-100">
              Tải file mẫu
            </button>
            <label class="cursor-pointer rounded-xl bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-800">
              Chọn file từ máy
              <input type="file" accept=".xlsx,.xls,.csv" class="hidden" onchange="prepareGradeImport(this)">
            </label>
            ${Array.isArray(state.gradeImportOrder) ? `<button type="button" onclick="clearGradeImportOrder()" class="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Hiện cả lớp</button>` : ""}
          </div>
        </div>
        <div id="grade-import-status" class="mt-3"></div>
      </div>` : ""}
      ${isTeacher()
        ? `<div class="space-y-5">${visibleSubjects.map(renderTable).join("")}</div>`
        : renderStudentGradesTable(students[0], visibleSubjects, context)}
    </section>`;
  };

  window.loadGrades = async function () {
    if (!state.auth || !state.auth.loggedIn) return;
    const client = await window.cloudReady;
    const { data, error } = await client.from("grades")
      .select("*")
      .order("student_id")
      .order("subject")
      .order("academic_year")
      .order("semester");
    if (error) throw error;
    const nextRows = data || [];
    const changed = JSON.stringify(nextRows) !== JSON.stringify(state.gradeRows || []);
    state.gradeRows = nextRows;
    window.studentGradeSyncErrorShown = false;
    if (changed && state.currentTab === "diem-so") renderLayout();
  };

  window.startStudentGradeSync = function () {
    if (window.studentGradeSyncInterval) clearInterval(window.studentGradeSyncInterval);
    if (!state.auth || !state.auth.loggedIn || !["hocsinh", "bcs"].includes(state.auth.role)) return;
    window.studentGradeSyncInterval = setInterval(() => window.loadGrades().catch(error => {
        console.error("Không thể đồng bộ điểm học sinh:", error);
        if (!window.studentGradeSyncErrorShown) {
          window.studentGradeSyncErrorShown = true;
          showToast(error.message || "Không thể đồng bộ điểm mới.", "error");
        }
      }), 10000);
  };

  window.saveGradeVisibility = async function (studentId, visible) {
    if (!isTeacher()) {
      showToast("Chỉ GVCN được công bố hoặc ẩn điểm trung bình.", "error");
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
        average_visible: Boolean(visible),
        updated_at: new Date().toISOString(),
      };
      delete record.id;
      await upsertGradeRecords(await window.cloudReady, [record]);
      await window.loadGrades();
      showToast(visible ? "Đã công bố điểm trung bình cho học sinh." : "Đã ẩn điểm trung bình với học sinh.", "success");
    } catch (error) {
      console.error("Không thể cập nhật quyền xem điểm trung bình:", error);
      showToast(gradeSaveErrorMessage(error, "Không thể cập nhật quyền xem điểm trung bình. Hãy chạy lại supabase/schema.sql."), "error");
      await window.loadGrades();
    }
  };

  window.setGradeVisibilityForScope = async function (visible) {
    if (!isTeacher()) {
      showToast("Chỉ GVCN được công bố hoặc ẩn điểm trung bình.", "error");
      await window.loadGrades();
      renderLayout();
      return;
    }
    if (state.gradeVisibilitySaving) return;
    state.gradeVisibilitySaving = true;
    renderLayout();
    try {
      const context = selectedContext();
      const records = teacherGradeScopeStudents().map(student => {
        const existing = gradeFor(student.id, context);
        const record = {
          ...existing,
          class_id: state.cloudProfile.class_id,
          student_id: String(student.id),
          ...context,
          average_visible: Boolean(visible),
          updated_at: new Date().toISOString(),
        };
        delete record.id;
        return record;
      });
      if (!records.length) {
        showToast("Không có học sinh trong phạm vi đang chọn.", "error");
        return;
      }
      await upsertGradeRecords(await window.cloudReady, records);
      await window.loadGrades();
      const filter = String(state.gradeGroupFilter || (Array.isArray(state.gradeImportOrder) ? "import" : "all"));
      const scopeParts = [
        filter === "all" ? "cả lớp" : filter === "import" ? "danh sách vừa nhập" : filter,
        state.gradeRoleFilter ? `chức vụ ${state.gradeRoleFilter}` : "",
        state.gradeSearch ? `tìm “${state.gradeSearch}”` : "",
      ].filter(Boolean);
      const scope = scopeParts.join(" · ");
      showToast(visible ? `Đã công bố ĐTBmhk cho ${scope}.` : `Đã ẩn ĐTBmhk với ${scope}.`, "success");
    } catch (error) {
      console.error("Không thể cập nhật quyền xem điểm trung bình:", error);
      showToast(gradeSaveErrorMessage(error, "Không thể cập nhật quyền xem ĐTBmhk. Hãy kiểm tra cấu hình database."), "error");
      await window.loadGrades();
    } finally {
      state.gradeVisibilitySaving = false;
      renderLayout();
    }
  };

  window.saveGradeField = async function (studentId, field, rawValue) {
    if (!isTeacher()) {
      showToast("Chỉ GVCN được nhập hoặc sửa điểm.", "error");
      await window.loadGrades();
      renderLayout();
      return;
    }
    if (!["regular_1", "regular_2", "regular_3", "regular_4", "regular_5", "midterm", "final", "comment"].includes(field)) {
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
      if (field !== "comment") record.reported_average = null;
      delete record.id;
      const client = await window.cloudReady;
      const { omittedAverage } = await upsertGradeRecords(client, [record]);
      await window.loadGrades();
      showToast(
        omittedAverage
          ? "Đã lưu điểm. Database chưa có cột ĐTB từ file; hệ thống sẽ tự tính. Hãy chạy lại supabase/schema.sql để lưu cột này."
          : "Đã lưu điểm vào database.",
        "success"
      );
    } catch (error) {
      console.error("Không thể lưu điểm:", error);
      showToast(gradeSaveErrorMessage(error, "Không thể lưu điểm. Hãy kiểm tra kết nối và phân quyền database."), "error");
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
