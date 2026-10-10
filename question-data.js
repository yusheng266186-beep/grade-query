"use strict";
(function (root) {
  const SUBJECTS = {chinese: "语文", math: "数学", english: "英语", physics: "物理", chemistry: "化学", biology: "生物"};
  const EMPTY = new Set(["", "—", "-", "--", "无", "暂无", "null", "undefined", "nan", "/"]);
  const text = value => String(value ?? "").normalize("NFKC").trim();
  const key = value => text(value).toLowerCase().replace(/\s/g, "");
  const id = value => text(value).replace(/\s/g, "").toUpperCase();
  const name = value => text(value).replace(/\s+/g, " ");
  const empty = value => value == null || EMPTY.has(key(value));
  const subjectKey = value => Object.keys(SUBJECTS).find(k => key(k) === key(value) || key(SUBJECTS[k]) === key(value)) || key(value);
  const value = (row, aliases) => {
    const field = Object.keys(row).find(k => aliases.some(alias => key(alias) === key(k)));
    return field == null ? undefined : row[field];
  };
  const number = (raw, label, issues) => {
    if (empty(raw)) return null;
    if ((typeof raw !== "number" && typeof raw !== "string") || !Number.isFinite(Number(raw))) {
      issues.push(`${label}不是有效数字。`); return null;
    }
    return Number(raw);
  };

  function normalizePoint(row, index = 0) {
    const label = row._sourceLabel || row.__sourceLabel || `小题记录第 ${index + 1} 条：`;
    const issues = [];
    const rawScore = value(row, ["score", "得分", "小题得分"]);
    const rawMax = value(row, ["maxScore", "满分", "分值"]);
    const rawLoss = value(row, ["loss", "失分"]);
    const uncertain = /\*|＊/.test(text(rawMax)) || Boolean(row.maxScoreNote);
    const kind = row.kind === "loss" ? "loss" : row.kind === "question" || rawScore !== undefined || rawMax !== undefined ? "question" : "loss";
    const score = number(rawScore, `${label}得分`, issues);
    const maxScore = uncertain ? null : number(rawMax, `${label}满分`, issues);
    const suppliedLoss = number(rawLoss, `${label}失分`, issues);
    const loss = kind === "question" ? score != null && maxScore != null ? maxScore - score : null : suppliedLoss;
    if (kind === "question" && suppliedLoss != null && loss != null && Math.abs(loss - suppliedLoss) > 0.000001) issues.push(`${label}失分与“满分−得分”不一致。`);
    return {
      _sourceLabel: label, kind,
      studentId: id(value(row, ["studentId", "学号", "查询识别码", "身份证", "身份证号码", "id"])),
      name: name(value(row, ["name", "姓名", "学生姓名"])),
      className: text(value(row, ["className", "班级"])),
      examCode: text(value(row, ["examCode", "考试代码", "考试编号", "考试"])),
      subjectKey: subjectKey(value(row, ["subjectKey", "科目键", "科目", "学科"])),
      question: text(value(row, ["question", "题号", "题目"])),
      knowledge: text(value(row, ["knowledge", "知识点"])),
      score, maxScore, loss,
      maxScoreNote: uncertain ? "满分待核实" : "",
      sourceMaxScore: uncertain ? text(row.sourceMaxScore ?? rawMax) : "",
      _issues: issues,
    };
  }

  function pointErrors(point) {
    const errors = [...(point._issues || [])];
    const label = point._sourceLabel || "小题记录：";
    if (!SUBJECTS[point.subjectKey]) errors.push(`${label}科目无法识别。`);
    if (point.kind === "question" && !point.question) errors.push(`${label}缺少题号。`);
    if (point.kind === "loss" && !point.knowledge) errors.push(`${label}缺少知识点名称。`);
    if (point.score != null && point.score < 0) errors.push(`${label}得分不能为负数。`);
    if (point.maxScore != null && point.maxScore <= 0) errors.push(`${label}满分必须大于0。`);
    if (point.score != null && point.maxScore != null && point.score > point.maxScore) errors.push(`${label}得分超出满分。`);
    if (point.loss != null && point.loss < 0) errors.push(`${label}失分不能为负数。`);
    return errors;
  }

  function matrixRows(matrix, sheetName) {
    const headerIndex = matrix.findIndex(row => row.some(v => ["题号", "question"].includes(key(v))) && row.some(v => ["科目键", "科目", "学科", "subjectkey"].includes(key(v))));
    if (headerIndex < 0) return [];
    const headers = matrix[headerIndex].map(text);
    const meaningful = headers.filter(Boolean);
    if (new Set(meaningful.map(key)).size !== meaningful.length) throw new Error(`${sheetName}表头重复。`);
    return matrix.slice(headerIndex + 1).map((r, index) => ({r, index})).filter(({r}) => r.some(v => !empty(v))).map(({r, index}) => ({
      ...Object.fromEntries(headers.filter(Boolean).map(header => [header, r[headers.indexOf(header)] ?? ""])),
      __sourceLabel: `${sheetName}第 ${headerIndex + index + 2} 行：`,
    }));
  }

  const longSheet = workbook => workbook.SheetNames.find(s => ["小题得分", "小题成绩", "questions", "question-scores"].includes(key(s)));
  const matrix = (workbook, XLSX, sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {header: 1, defval: ""});

  function workbookExamCodes(workbook, XLSX) {
    const long = longSheet(workbook);
    if (long) return [...new Set(matrixRows(matrix(workbook, XLSX, long), long).map(row => text(value(row, ["examCode", "考试代码", "考试编号", "考试"]))).filter(Boolean))];
    const codes = new Set();
    for (const sheet of workbook.SheetNames.filter(s => Object.values(SUBJECTS).includes(text(s)))) {
      for (const row of matrix(workbook, XLSX, sheet)) if (text(row[2]) === "题号" && !empty(row[1])) codes.add(text(row[1]));
    }
    return [...codes];
  }

  function workbookRows(workbook, XLSX, examCode = "") {
    const long = longSheet(workbook);
    if (long) return matrixRows(matrix(workbook, XLSX, long), long);
    if (!examCode) throw new Error("请选择质量复盘表中的考试代码，避免混入其他考试。 ");
    const rows = [];
    for (const sheet of workbook.SheetNames.filter(s => Object.values(SUBJECTS).includes(text(s)))) {
      const grid = matrix(workbook, XLSX, sheet);
      const headerIndex = grid.findIndex(r => text(r[2]) === "题号" && text(r[1]) === text(examCode));
      if (headerIndex < 0) continue;
      const questions = grid[headerIndex];
      const next = grid.slice(headerIndex + 1, headerIndex + 4);
      const maxima = next.find(r => text(r[2]) === "分值") || [];
      const knowledge = next.find(r => text(r[2]) === "知识点") || [];
      const columns = questions.map((q, i) => ({q, i})).filter(({q, i}) => i >= 3 && !empty(q) && !["客观分", "主观分", "总分", "合计"].includes(text(q)) && (!empty(maxima[i]) || !empty(knowledge[i])));
      for (let r = 0; r < grid.length; r += 1) {
        const source = grid[r];
        const code = text(source[0]).replace(/[物历]$/, "");
        if (code !== text(examCode) || empty(source[2])) continue;
        for (const {q, i} of columns) rows.push({
          kind: "question", name: source[2], className: source[1], examCode: code,
          subjectKey: subjectKey(sheet), question: q, knowledge: knowledge[i],
          score: source[i], maxScore: maxima[i], __sourceLabel: `${sheet}第 ${r + 1} 行，题${q}：`,
        });
      }
    }
    if (!rows.length) throw new Error("所选考试没有可识别的小题数据。");
    return rows;
  }

  function classKey(value) {
    const source = text(value);
    return source.match(/(\d+)\s*班$/)?.[1] || (/^\d+$/.test(source) ? source : source);
  }

  function matchRows(rows, students, examCode = "") {
    const byId = new Map(students.filter(s => s.studentId).map(s => [id(s.studentId), s]));
    const byName = new Map();
    for (const student of students) {
      const normalizedName = name(student.name);
      if (!byName.has(normalizedName)) byName.set(normalizedName, []);
      byName.get(normalizedName).push(student);
    }
    const matched = [], errors = [], warnings = [], seen = new Set();
    let skippedRows = 0;
    for (const [index, row] of rows.entries()) {
      const point = normalizePoint(row, index);
      if (point.examCode && examCode && point.examCode !== text(examCode)) { skippedRows += 1; continue; }
      let candidates = point.studentId ? [byId.get(point.studentId)].filter(Boolean) : byName.get(point.name) || [];
      if (point.className) candidates = candidates.filter(s => classKey(s.className) === classKey(point.className));
      if (candidates.length > 1) { errors.push(`${point._sourceLabel}同名学生无法唯一匹配，请填写查询识别码。`); continue; }
      const student = candidates[0];
      if (!student) { skippedRows += 1; continue; }
      if (point.name && name(student.name) !== point.name) { errors.push(`${point._sourceLabel}姓名与识别码对应学生不一致。`); continue; }
      if (!student.studentId) { errors.push(`${point._sourceLabel}对应学生缺少查询识别码。`); continue; }
      point.studentId = id(student.studentId);
      errors.push(...pointErrors(point));
      const address = JSON.stringify([point.studentId, point.subjectKey, point.question]);
      if (seen.has(address)) errors.push(`${point._sourceLabel}同一学生、科目和题号重复。`);
      seen.add(address);
      matched.push(point);
    }
    const uncertain = matched.filter(p => p.maxScoreNote).length;
    if (uncertain) warnings.push(`${uncertain}条小题满分带有待核实标记，仅保留原始得分，不计算失分。`);
    if (!matched.length) errors.push("没有匹配到本次考试学生的小题，请核对考试代码、姓名和班级。 ");
    return {rows: matched, errors, warnings, skippedRows, studentCount: new Set(matched.map(p => p.studentId)).size};
  }

  function details(points) {
    const result = {};
    for (const p of points) {
      if (!result[p.subjectKey]) result[p.subjectKey] = {questions: [], weak: []};
      const item = {question: p.question, knowledge: p.knowledge, score: p.score, maxScore: p.maxScore, loss: p.loss};
      if (p.maxScoreNote) Object.assign(item, {maxScoreNote: p.maxScoreNote, sourceMaxScore: p.sourceMaxScore});
      if (p.kind === "question") result[p.subjectKey].questions.push(item);
      if (p.loss > 0) result[p.subjectKey].weak.push(item);
    }
    for (const data of Object.values(result)) data.weak.sort((a, b) => b.loss - a.loss);
    return result;
  }

  const escape = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
  const fmt = v => v == null ? "—" : Number(v).toLocaleString("zh-CN", {maximumFractionDigits: 2});
  const hasData = knowledge => Object.values(knowledge || {}).some(s => s?.questions?.length || s?.weak?.length);

  function render(knowledge, subjects) {
    const sections = [];
    for (const subject of subjects) {
      const data = knowledge?.[subject.key];
      if (data?.questions?.length) {
        const points = data.questions;
        const rawScore = points.filter(p => p.score != null).reduce((sum, p) => sum + p.score, 0);
        const scored = points.filter(p => p.score != null).length;
        const uncertain = points.some(p => p.maxScoreNote);
        sections.push(`<details class="question-subject"><summary><b>${escape(subject.name)}</b><span>${points.length}条明细 · 已录入${scored}条 · 原始得分${fmt(rawScore)}</span></summary>
          ${uncertain ? '<p class="question-note">部分小题满分待核实，先展示原始得分。</p>' : ''}
          <div class="question-table-wrap"><table class="question-table"><thead><tr><th>题号</th><th>知识点</th><th>得分</th><th>满分</th><th>失分</th></tr></thead><tbody>${points.map(p => `<tr><th scope="row">${escape(p.question)}</th><td>${escape(p.knowledge || "未标注")}</td><td>${fmt(p.score)}</td><td>${p.maxScoreNote ? '待核实' : fmt(p.maxScore)}</td><td>${fmt(p.loss)}</td></tr>`).join("")}</tbody></table></div></details>`);
      } else if (data?.weak?.length) {
        sections.push(...data.weak.slice(0, 2).map(p => `<div class="knowledge-item"><b>${escape(subject.name)}</b><span>${escape(p.knowledge)} · ${escape(p.question)}</span><small>失 ${fmt(p.loss)} 分</small></div>`));
      }
    }
    return sections.length ? `<p class="question-note">小题按原始分记录；化学、生物与上方赋分可能不同。空白表示未录入，0分为有效得分。</p>${sections.join("")}` : '<p class="panel-subtitle">暂未匹配到小题知识点数据。</p>';
  }
  root.GradeQuestionData = {normalizePoint, pointErrors, workbookExamCodes, workbookRows, matchRows, details, render, hasData};
})(typeof window !== "undefined" ? window : globalThis);
