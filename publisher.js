"use strict";

const SUBJECTS = [
  { key: "chinese", name: "语文", max: 150 },
  { key: "math", name: "数学", max: 150 },
  { key: "english", name: "英语", max: 150 },
  { key: "physics", name: "物理", max: 100 },
  { key: "chemistry", name: "化学", max: 100 },
  { key: "biology", name: "生物", max: 100 },
];

const EMPTY_MARKERS = new Set(["", "—", "-", "--", "无", "暂无", "null", "undefined", "nan", "/"]);
const MAX_EXAM_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PROJECT_FILE_BYTES = 24 * 1024 * 1024;
const state = {
  exam: null,
  project: null,
  examFileName: "",
  projectFileName: "",
  projectWarnings: [],
  generated: null,
  backupSaved: false,
  generating: false,
  uploading: false,
};

const $ = (id) => document.getElementById(id);
const examDropZone = $("examDropZone");
const examFile = $("examFile");
const projectFile = $("projectFile");
const metadataForm = $("metadataForm");
const messageStack = $("messageStack");
const validationSummary = $("validationSummary");
const previewWrap = $("previewWrap");
const toast = $("toast");

function normalizeText(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[\s_\-—/\\:：()（）[\]【】]/g, "");
}

function isEmpty(value) {
  return EMPTY_MARKERS.has(normalizeText(value).toLowerCase());
}

function cleanValue(value) {
  return isEmpty(value) ? null : value;
}

function toNumber(value) {
  const cleaned = cleanValue(value);
  if (cleaned == null) return null;
  const text = normalizeText(cleaned).replace(/[，,]/g, "").replace(/分$/, "");
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  const number = toNumber(value);
  return number != null && Number.isInteger(number) ? number : null;
}

function checkedNumber(value, label, issues) {
  if (isEmpty(value)) return null;
  const number = toNumber(value);
  if (number == null) issues.push(`${label}“${normalizeText(value)}”不是有效数字。`);
  return number;
}

function checkedInteger(value, label, issues) {
  return checkedNumber(value, label, issues);
}

function toDate(value) {
  const text = normalizeText(value);
  if (!text) return "";
  const normalized = text.replace(/[年月]/g, "-").replace(/日$/, "").replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return "";
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function normalizeScope(value) {
  const text = normalizeText(value).toLowerCase();
  if (text.includes("市") || text === "city") return "city";
  if (text.includes("校") || text === "school") return "school";
  if (text.includes("班") || text === "class" || !text) return "class";
  return "";
}

function checkedDate(value, label, issues) {
  if (isEmpty(value)) return "";
  const date = toDate(value);
  if (!date) issues.push(`${label}“${normalizeText(value)}”不是有效日期，请使用 YYYY-MM-DD。`);
  return date;
}

function checkedScope(value, label, issues) {
  if (isEmpty(value)) return "class";
  const scope = normalizeScope(value);
  if (!scope) issues.push(`${label}“${normalizeText(value)}”无法识别，只能填写 city/全市、school/校内或 class/班级。`);
  return scope || "class";
}

function normalizeSubjectKey(value) {
  const key = normalizeText(value);
  const subject = SUBJECTS.find((item) => normalizeKey(item.key) === normalizeKey(key) || normalizeKey(item.name) === normalizeKey(key));
  return subject?.key || key;
}

function canonicalStudentId(value) {
  return normalizeText(value).replace(/\s+/g, "").toUpperCase();
}

function displayNumber(value, digits = 1) {
  const number = toNumber(value);
  if (number == null) return "—";
  return Number(number).toFixed(digits).replace(/\.0$/, "");
}

function signed(value) {
  const number = toNumber(value);
  if (number == null) return "—";
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateProjectBackup(payload) {
  const errors = [];
  const warnings = [];
  if (!payload || payload.kind !== "grade-project" || payload.schemaVersion !== 2) {
    errors.push("这不是成绩发布工作台生成的 v2 项目备份。");
    return { errors, warnings };
  }
  if (!Array.isArray(payload.exams)) errors.push("项目备份缺少 exams 历史考试数组。");
  if (!Array.isArray(payload.students)) errors.push("项目备份缺少 students 学生数组。");
  if (errors.length) return { errors, warnings };
  if (!payload.exams.length) warnings.push("项目备份中没有历史考试，本次会从当前考试重新建立记录。");
  const ids = new Set();
  payload.students.forEach((student, index) => {
    const id = canonicalStudentId(student?.studentId);
    if (!id) errors.push(`项目备份第 ${index + 1} 位学生缺少查询识别码。`);
    else if (ids.has(id)) errors.push(`项目备份中查询识别码重复：${id}。`);
    else ids.add(id);
    if (!normalizeText(student?.name)) warnings.push(`项目备份中的 ${id || `第 ${index + 1} 位学生`}缺少姓名。`);
    if (!Array.isArray(student?.exams)) warnings.push(`项目备份中的 ${id || `第 ${index + 1} 位学生`}没有历次考试数组，将在合并时补全。`);
  });
  return { errors, warnings };
}

function rowValue(row, aliases) {
  const entries = Object.entries(row || {});
  const wanted = aliases.map(normalizeKey);
  const entry = entries.find(([key]) => wanted.includes(normalizeKey(key)));
  return entry ? entry[1] : null;
}

function metadataValue(metadata, aliases) {
  for (const alias of aliases) {
    const wanted = normalizeKey(alias);
    const entry = Object.entries(metadata || {}).find(([key]) => normalizeKey(key) === wanted);
    if (entry && !isEmpty(entry[1])) return entry[1];
  }
  return null;
}

function subjectAliases(subject, field) {
  const suffix = field === "score" ? ["score", "分数", "成绩", "得分"] : ["rank", "排名", "名次"];
  return [
    `${subject.key}${field}`,
    `${subject.name}${suffix[0]}`,
    `${subject.name}${suffix[1]}`,
    `${subject.name}${suffix[2]}`,
    `${subject.name}${suffix[3]}`,
  ];
}

function normalizeSubject(subject, raw, label, issues) {
  const isRecord = raw && typeof raw === "object" && !Array.isArray(raw);
  const score = checkedNumber(isRecord ? raw.score : raw, `${label}${subject.name}分数`, issues);
  const rank = checkedInteger(isRecord ? raw.rank : null, `${label}${subject.name}排名`, issues);
  return { score, rank };
}

function normalizeExam(payload) {
  const source = payload.exam || payload;
  const fieldIssues = [];
  const dataIssues = [...(payload.dataIssues || [])];
  const rawSubjects = Array.isArray(payload.subjects) ? payload.subjects : SUBJECTS;
  const subjects = SUBJECTS.map((fallback) => {
    const found = rawSubjects.find((item) => normalizeKey(item.key || item.name) === normalizeKey(fallback.key) || normalizeKey(item.name) === normalizeKey(fallback.name));
    const rawMax = found?.max ?? found?.maxScore;
    const parsedMax = checkedNumber(rawMax, `${fallback.name}满分`, dataIssues);
    return {
      ...fallback,
      ...(found || {}),
      key: fallback.key,
      name: normalizeText(found?.name) || fallback.name,
      max: parsedMax ?? fallback.max,
    };
  });
  const cutoffs = {};
  for (const subject of subjects) {
    const raw = source.cutoffs?.[subject.key] || payload.cutoffs?.[subject.key] || {};
    cutoffs[subject.key] = {
      controlLine: checkedNumber(raw.controlLine ?? raw.control ?? raw.特控线, `${subject.name}特控线`, dataIssues),
      bachelorLine: checkedNumber(raw.bachelorLine ?? raw.bachelor ?? raw.本科线, `${subject.name}本科线`, dataIssues),
    };
  }
  const students = (payload.students || source.students || []).map((item, index) => {
    const label = item.__sourceLabel || `学生记录第 ${index + 1} 条：`;
    const totalRaw = item.totalScore ?? item.total ?? item.总分;
    const student = {
      _sourceLabel: label,
      studentId: canonicalStudentId(item.studentId ?? item.id ?? item.学号),
      name: normalizeText(item.name ?? item.studentName ?? item.姓名),
      className: normalizeText(item.className ?? item.class ?? item.班级 ?? source.className),
      totalScore: checkedNumber(totalRaw, `${label}总分`, dataIssues),
      cityRank: checkedInteger(item.cityRank ?? item.全市排名, `${label}全市排名`, dataIssues),
      schoolRank: checkedInteger(item.schoolRank ?? item.校内排名, `${label}校内排名`, dataIssues),
      classRank: checkedInteger(item.classRank ?? item.班级排名, `${label}班级排名`, dataIssues),
      note: normalizeText(item.note ?? item.备注),
      subjects: {},
    };
    for (const subject of subjects) {
      const raw = item.subjects?.[subject.key] ?? item[subject.key] ?? {
        score: item[`${subject.key}Score`],
        rank: item[`${subject.key}Rank`],
      };
      student.subjects[subject.key] = normalizeSubject(subject, raw, label, dataIssues);
    }
    const points = subjects.map((subject) => student.subjects[subject.key].score).filter((value) => value != null);
    student._filledScoreCount = points.length;
    student._autoTotal = isEmpty(totalRaw) && points.length > 0;
    if (student._autoTotal) student.totalScore = points.reduce((sum, value) => sum + value, 0);
    return student;
  });
  const knowledge = (payload.knowledge || source.knowledge || []).map((item, index) => {
    const label = item.__sourceLabel || `知识点记录第 ${index + 1} 条：`;
    return {
      _sourceLabel: label,
      studentId: canonicalStudentId(item.studentId ?? item.id ?? item.学号),
      subjectKey: normalizeSubjectKey(item.subjectKey ?? item.subject ?? item.科目),
      knowledge: normalizeText(item.knowledge ?? item.知识点),
      question: normalizeText(item.question ?? item.题号 ?? item.题目),
      loss: checkedNumber(item.loss ?? item.失分, `${label}失分`, dataIssues),
    };
  });
  const rawDate = source.examDate ?? source.date ?? source.考试日期;
  const rawScope = source.scope ?? source.rankScope ?? source.排名范围;
  return {
    kind: "exam-input",
    schemaVersion: 2,
    exam: {
      examId: normalizeText(source.examId ?? source.id ?? source.考试编号),
      examName: normalizeText(source.examName ?? source.name ?? source.考试名称),
      examDate: checkedDate(rawDate, "考试日期", fieldIssues),
      scope: checkedScope(rawScope, "排名范围", fieldIssues),
      className: normalizeText(source.className ?? source.class ?? source.班级),
      controlLine: checkedNumber(source.controlLine ?? source.特控线, "总分特控线", fieldIssues),
      bachelorLine: checkedNumber(source.bachelorLine ?? source.本科线, "总分本科线", fieldIssues),
      note: normalizeText(source.note ?? source.备注),
    },
    subjects,
    cutoffs,
    students,
    knowledge,
    fieldIssues,
    dataIssues,
  };
}

function metadataRowsToObject(rows) {
  const metadata = {};
  for (const row of rows || []) {
    const key = rowValue(row, ["字段", "key", "field", "项目"]);
    const value = rowValue(row, ["值", "value", "内容"]);
    if (key != null) metadata[normalizeText(key)] = cleanValue(value);
  }
  return metadata;
}

function buildExamFromRows(metadataRows, subjectRows, studentRows, knowledgeRows) {
  const metadata = metadataRowsToObject(metadataRows);
  const source = {
    examId: metadataValue(metadata, ["examId", "考试编号", "考试ID"]),
    examName: metadataValue(metadata, ["examName", "考试名称"]),
    examDate: metadataValue(metadata, ["examDate", "考试日期"]),
    scope: metadataValue(metadata, ["scope", "排名范围"]),
    className: metadataValue(metadata, ["className", "班级名称", "班级"]),
    controlLine: metadataValue(metadata, ["controlLine", "特控线"]),
    bachelorLine: metadataValue(metadata, ["bachelorLine", "本科线"]),
    note: metadataValue(metadata, ["note", "备注"]),
  };
  const subjects = SUBJECTS.map((fallback) => {
    const row = (subjectRows || []).find((item) => {
      const key = rowValue(item, ["科目键", "subjectKey", "key"]);
      const name = rowValue(item, ["科目名称", "subjectName", "科目"]);
      return normalizeKey(key) === normalizeKey(fallback.key) || normalizeKey(name) === normalizeKey(fallback.name);
    });
    return {
      ...fallback,
      name: normalizeText(rowValue(row, ["科目名称", "subjectName", "科目"])) || fallback.name,
      max: row ? rowValue(row, ["满分", "maxScore", "max"]) : fallback.max,
    };
  });
  const cutoffs = {};
  for (const subject of subjects) {
    const row = (subjectRows || []).find((item) => {
      const key = rowValue(item, ["科目键", "subjectKey", "key"]);
      const name = rowValue(item, ["科目名称", "subjectName", "科目"]);
      return normalizeKey(key) === normalizeKey(subject.key) || normalizeKey(name) === normalizeKey(subject.name);
    });
    cutoffs[subject.key] = {
      controlLine: rowValue(row, ["特控线", "controlLine", "control"]),
      bachelorLine: rowValue(row, ["本科线", "bachelorLine", "bachelor"]),
    };
  }
  const students = (studentRows || []).map((row, index) => {
    const student = {
      __sourceLabel: row.__sourceLabel || `学生数据第 ${index + 1} 条：`,
      studentId: canonicalStudentId(rowValue(row, ["学号", "studentId", "id", "查询识别码"])),
      name: normalizeText(rowValue(row, ["姓名", "学生姓名", "name", "studentName"])),
      className: normalizeText(rowValue(row, ["班级", "班级名称", "className"])) || normalizeText(source.className),
      totalScore: rowValue(row, ["总分", "totalScore", "total"]),
      cityRank: rowValue(row, ["全市排名", "市排名", "cityRank"]),
      schoolRank: rowValue(row, ["校内排名", "校排名", "schoolRank"]),
      classRank: rowValue(row, ["班级排名", "班排名", "classRank"]),
      note: normalizeText(rowValue(row, ["备注", "note"])),
      subjects: {},
    };
    for (const subject of subjects) {
      student.subjects[subject.key] = {
        score: rowValue(row, subjectAliases(subject, "score")),
        rank: rowValue(row, subjectAliases(subject, "rank")),
      };
    }
    return student;
  }).filter((student) => student.studentId || student.name);
  const knowledge = (knowledgeRows || []).map((row, index) => ({
    __sourceLabel: row.__sourceLabel || `知识点数据第 ${index + 1} 条：`,
    studentId: canonicalStudentId(rowValue(row, ["学号", "studentId", "id"])),
    subjectKey: normalizeText(rowValue(row, ["科目键", "subjectKey", "科目"])),
    knowledge: normalizeText(rowValue(row, ["知识点", "knowledge"])),
    question: normalizeText(rowValue(row, ["题号", "题目", "question"])),
    loss: rowValue(row, ["失分", "loss"]),
  }));
  return normalizeExam({ kind: "exam-input", exam: source, subjects, cutoffs, students, knowledge });
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  const metadata = {};
  const dataLines = [];
  for (const line of lines) {
    if (/^\s*#/.test(line)) {
      const match = line.replace(/^\s*#\s*/, "").match(/^([^=]+)=(.*)$/);
      if (match) metadata[normalizeText(match[1])] = normalizeText(match[2]);
    } else if (line.trim()) dataLines.push(line);
  }
  if (!dataLines.length) return { metadata, rows: [] };
  const rows = [];
  let cells = [];
  let cell = "";
  let quoted = false;
  const pushCell = () => { cells.push(cell); cell = ""; };
  const pushRow = () => { pushCell(); rows.push(cells); cells = []; };
  for (const line of dataLines) {
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
        else quoted = !quoted;
      } else if (char === "," && !quoted) pushCell();
      else cell += char;
    }
    if (!quoted) pushRow(); else cell += "\n";
  }
  if (quoted) throw new Error("CSV 中存在未闭合的双引号，请检查包含逗号或换行的单元格。");
  const headers = rows.shift().map((header) => normalizeText(header));
  const duplicateHeaders = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`CSV 表头重复：${[...new Set(duplicateHeaders)].join("、")}。`);
  return { metadata, rows: rows.filter((row) => row.some((value) => normalizeText(value))).map((row, rowIndex) => ({ ...Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])), __sourceLabel: `CSV 学生数据第 ${rowIndex + 1} 条：` })) };
}

function parseCsvExam(text) {
  const parsed = parseCsv(text);
  const metaRows = Object.entries(parsed.metadata).map(([字段, 值]) => ({ 字段, 值 }));
  return buildExamFromRows(metaRows, [], parsed.rows, []);
}

function sheetRows(workbook, names) {
  const target = workbook.SheetNames.find((name) => names.some((wanted) => normalizeKey(name) === normalizeKey(wanted))) || workbook.SheetNames.find((name) => names.some((wanted) => normalizeKey(name).includes(normalizeKey(wanted))));
  if (!target) return [];
  const matrix = window.XLSX.utils.sheet_to_json(workbook.Sheets[target], { header: 1, defval: "" });
  const headerIndex = matrix.findIndex((row) => row.some((value) => ["字段", "学号", "科目键", "知识点"].includes(normalizeText(value))));
  if (headerIndex < 0) return [];
  const headers = matrix[headerIndex].map((value, index) => normalizeText(value) || `__empty_${index}`);
  const duplicateHeaders = headers.filter((header, index) => !header.startsWith("__empty_") && headers.indexOf(header) !== index);
  if (duplicateHeaders.length) throw new Error(`${target}工作表表头重复：${[...new Set(duplicateHeaders)].join("、")}。`);
  return matrix.slice(headerIndex + 1)
    .map((row, index) => ({ row, rowNumber: headerIndex + index + 2 }))
    .filter(({ row }) => row.some((value) => normalizeText(value)))
    .map(({ row, rowNumber }) => ({ ...Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])), __sourceLabel: `Excel 第 ${rowNumber} 行：` }));
}

function parseXlsx(arrayBuffer) {
  if (!window.XLSX) throw new Error("Excel解析组件未加载，请联网后刷新工作台，或改用 JSON 模板。");
  const workbook = window.XLSX.read(arrayBuffer, { type: "array", cellDates: true });
  const metadataRows = sheetRows(workbook, ["考试信息", "考试元数据", "metadata"]);
  const subjectRows = sheetRows(workbook, ["科目分数线", "科目线", "subjects"]);
  const studentRows = sheetRows(workbook, ["学生成绩", "成绩数据", "students"]);
  const knowledgeRows = sheetRows(workbook, ["知识点失分", "小题知识点", "knowledge"]);
  if (!studentRows.length) throw new Error("没有找到“学生成绩”工作表，或者表头为空。");
  return buildExamFromRows(metadataRows, subjectRows, studentRows, knowledgeRows);
}

function projectFromExam(exam) {
  const project = {
    kind: "grade-project",
    schemaVersion: 2,
    dataVersion: `v2-${exam.exam.examId || "draft"}`,
    generatedAt: new Date().toISOString(),
    meta: { className: exam.exam.className, note: exam.exam.note, source: "publisher" },
    subjects: clone(exam.subjects),
    exams: [],
    students: [],
  };
  return mergeExamIntoProject(project, exam);
}

function primaryRank(student, scope) {
  if (scope === "city") return student.cityRank ?? student.schoolRank ?? student.classRank;
  if (scope === "school") return student.schoolRank ?? student.classRank ?? student.cityRank;
  return student.classRank ?? student.schoolRank ?? student.cityRank;
}

function makeStudentExam(exam, student) {
  const scores = { total: student.totalScore };
  const subjectRanks = {};
  const currentSubjects = {};
  for (const subject of exam.subjects) {
    const item = student.subjects[subject.key] || { score: null, rank: null };
    const cutoff = exam.cutoffs[subject.key] || {};
    scores[subject.key] = item.score;
    subjectRanks[subject.key] = item.rank;
    currentSubjects[subject.key] = {
      score: item.score,
      rank: item.rank,
      controlDiff: item.score != null && cutoff.controlLine != null ? item.score - cutoff.controlLine : null,
      bachelorDiff: item.score != null && cutoff.bachelorLine != null ? item.score - cutoff.bachelorLine : null,
    };
  }
  const examRecord = {
    examId: exam.exam.examId,
    name: exam.exam.examName,
    date: exam.exam.examDate,
    scope: exam.exam.scope,
    className: student.className || exam.exam.className,
    total: student.totalScore,
    rank: primaryRank(student, exam.exam.scope),
    cityRank: student.cityRank,
    schoolRank: student.schoolRank,
    classRank: student.classRank,
    scores,
    subjectRanks,
    knowledge: knowledgeForStudent(exam, student.studentId),
  };
  const current = {
    totalScore: student.totalScore,
    cityRank: student.cityRank,
    schoolRank: student.schoolRank,
    classRank: student.classRank,
    controlLine: exam.exam.controlLine,
    bachelorLine: exam.exam.bachelorLine,
    controlDiff: student.totalScore != null && exam.exam.controlLine != null ? student.totalScore - exam.exam.controlLine : null,
    bachelorDiff: student.totalScore != null && exam.exam.bachelorLine != null ? student.totalScore - exam.exam.bachelorLine : null,
    subjects: currentSubjects,
  };
  return { examRecord, current };
}

function compareExamOrder(left, right) {
  const leftDate = normalizeText(left?.date ?? left?.examDate);
  const rightDate = normalizeText(right?.date ?? right?.examDate);
  if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  if (leftDate !== rightDate) return leftDate ? 1 : -1;
  return normalizeText(left?.examId).localeCompare(normalizeText(right?.examId));
}

function currentFromExamRecord(examRecord, examMeta, subjects) {
  const currentSubjects = {};
  for (const subject of subjects) {
    const score = toNumber(examRecord?.scores?.[subject.key]);
    const rank = toInteger(examRecord?.subjectRanks?.[subject.key]);
    const cutoff = examMeta?.cutoffs?.[subject.key] || {};
    currentSubjects[subject.key] = {
      score,
      rank,
      controlDiff: score != null && cutoff.controlLine != null ? score - cutoff.controlLine : null,
      bachelorDiff: score != null && cutoff.bachelorLine != null ? score - cutoff.bachelorLine : null,
    };
  }
  const totalScore = toNumber(examRecord?.total ?? examRecord?.scores?.total);
  return {
    totalScore,
    cityRank: toInteger(examRecord?.cityRank),
    schoolRank: toInteger(examRecord?.schoolRank),
    classRank: toInteger(examRecord?.classRank),
    controlLine: toNumber(examMeta?.controlLine),
    bachelorLine: toNumber(examMeta?.bachelorLine),
    controlDiff: totalScore != null && examMeta?.controlLine != null ? totalScore - examMeta.controlLine : null,
    bachelorDiff: totalScore != null && examMeta?.bachelorLine != null ? totalScore - examMeta.bachelorLine : null,
    subjects: currentSubjects,
  };
}

function knowledgeForStudent(exam, studentId) {
  const result = {};
  for (const item of exam.knowledge.filter((point) => point.studentId === studentId)) {
    if (!result[item.subjectKey]) result[item.subjectKey] = { weak: [] };
    result[item.subjectKey].weak.push({ knowledge: item.knowledge, question: item.question, loss: item.loss });
  }
  return result;
}

function makeClassSummary(exam) {
  const scores = exam.students.map((student) => student.totalScore).filter((value) => value != null);
  return {
    className: exam.exam.className,
    students: exam.students.length,
    average: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null,
    controlCount: exam.exam.controlLine == null ? null : scores.filter((value) => value >= exam.exam.controlLine).length,
    bachelorCount: exam.exam.bachelorLine == null ? null : scores.filter((value) => value >= exam.exam.bachelorLine).length,
  };
}

function mergeExamIntoProject(inputProject, exam) {
  const project = clone(inputProject || { kind: "grade-project", schemaVersion: 2, subjects: SUBJECTS, exams: [], students: [] });
  project.kind = "grade-project";
  project.schemaVersion = 2;
  project.subjects = clone(exam.subjects || project.subjects || SUBJECTS);
  project.exams = Array.isArray(project.exams) ? project.exams : [];
  project.students = Array.isArray(project.students) ? project.students : [];
  const examMeta = { ...clone(exam.exam), cutoffs: clone(exam.cutoffs), subjects: clone(exam.subjects), summary: makeClassSummary(exam) };
  const oldExamIndex = project.exams.findIndex((item) => item.examId === exam.exam.examId);
  if (oldExamIndex >= 0) project.exams.splice(oldExamIndex, 1, examMeta); else project.exams.push(examMeta);
  const byId = new Map(project.students.map((student) => [canonicalStudentId(student.studentId), student]));
  if (oldExamIndex >= 0) {
    for (const target of byId.values()) {
      target.exams = (Array.isArray(target.exams) ? target.exams : []).filter((item) => item.examId !== exam.exam.examId);
    }
  }
  for (const sourceStudent of exam.students) {
    if (!sourceStudent.studentId) continue;
    const id = canonicalStudentId(sourceStudent.studentId);
    const target = byId.get(id) || { studentId: id, name: sourceStudent.name, className: sourceStudent.className || exam.exam.className, exams: [], knowledge: {} };
    target.name = sourceStudent.name || target.name;
    target.className = sourceStudent.className || target.className || exam.exam.className;
    target.exams = Array.isArray(target.exams) ? target.exams : [];
    const { examRecord, current } = makeStudentExam(exam, sourceStudent);
    const index = target.exams.findIndex((item) => item.examId === exam.exam.examId);
    if (index >= 0) target.exams.splice(index, 1, examRecord); else target.exams.push(examRecord);
    target.exams.sort(compareExamOrder);
    if (!target.current || target.exams[target.exams.length - 1]?.examId === exam.exam.examId) target.current = current;
    byId.set(id, target);
  }
  project.exams.sort(compareExamOrder);
  const examById = new Map(project.exams.map((item) => [item.examId, item]));
  project.students = Array.from(byId.values()).filter((student) => Array.isArray(student.exams) && student.exams.length).map((student) => {
    student.exams.sort(compareExamOrder);
    const latestRecord = student.exams[student.exams.length - 1];
    const latestMeta = examById.get(latestRecord.examId) || examMeta;
    student.currentExamId = latestRecord.examId;
    student.className = latestRecord.className || student.className || latestMeta.className;
    student.current = currentFromExamRecord(latestRecord, latestMeta, project.subjects);
    student.currentExam = clone(latestMeta);
    student.classSummary = clone(latestMeta.summary || null);
    student.knowledge = clone(latestRecord.knowledge || (latestRecord.examId === exam.exam.examId ? knowledgeForStudent(exam, student.studentId) : {}));
    return student;
  });
  const latestExam = project.exams[project.exams.length - 1] || examMeta;
  project.meta = { ...(project.meta || {}), className: latestExam.className || exam.exam.className || project.meta?.className, latestExam: latestExam.examName, latestExamDate: latestExam.examDate };
  project.dataVersion = `v2-${Date.now()}`;
  project.generatedAt = new Date().toISOString();
  return project;
}

function validateExam(exam) {
  const errors = [...(exam?.fieldIssues || []), ...(exam?.dataIssues || [])];
  const warnings = [];
  const studentErrorIndexes = new Set();
  if (!exam) return { errors: ["请先导入一份考试模板。"], warnings: [], validStudents: 0, studentErrorIndexes };
  const meta = exam.exam;
  if (!meta.examName) errors.push("考试名称不能为空。");
  if (!meta.examId) errors.push("考试编号不能为空；它用于识别和覆盖同一场考试。");
  if (!meta.className) errors.push("班级名称不能为空。");
  if (!meta.examDate) warnings.push("未填写考试日期，历次趋势会按导入顺序保留。");
  if (!exam.students.length) errors.push("没有可识别的学生记录。");
  const totalMax = exam.subjects.reduce((sum, subject) => sum + (toNumber(subject.max) || 0), 0);
  if (meta.controlLine != null && (meta.controlLine < 0 || meta.controlLine > totalMax)) errors.push(`总分特控线 ${meta.controlLine} 超出 0–${totalMax} 范围。`);
  if (meta.bachelorLine != null && (meta.bachelorLine < 0 || meta.bachelorLine > totalMax)) errors.push(`总分本科线 ${meta.bachelorLine} 超出 0–${totalMax} 范围。`);
  if (meta.controlLine != null && meta.bachelorLine != null && meta.controlLine < meta.bachelorLine) errors.push("总分特控线不能低于本科线，请检查两条分数线是否填反。");
  for (const subject of exam.subjects) {
    if (subject.max <= 0) errors.push(`${subject.name}满分必须大于 0。`);
    const cutoff = exam.cutoffs?.[subject.key] || {};
    if (cutoff.controlLine != null && (cutoff.controlLine < 0 || cutoff.controlLine > subject.max)) errors.push(`${subject.name}特控线 ${cutoff.controlLine} 超出 0–${subject.max} 范围。`);
    if (cutoff.bachelorLine != null && (cutoff.bachelorLine < 0 || cutoff.bachelorLine > subject.max)) errors.push(`${subject.name}本科线 ${cutoff.bachelorLine} 超出 0–${subject.max} 范围。`);
    if (cutoff.controlLine != null && cutoff.bachelorLine != null && cutoff.controlLine < cutoff.bachelorLine) errors.push(`${subject.name}特控线不能低于本科线。`);
  }
  const sampleStudents = exam.students.filter((student, index) => {
    const sample = /^TEST\d+$/i.test(student.studentId) || /示例学生|测试学生/.test(student.name);
    if (sample) studentErrorIndexes.add(index);
    return sample;
  });
  if (sampleStudents.length) errors.push(`检测到 ${sampleStudents.length} 条模板示例学生，请删除示例行并填入正式数据后再发布。`);
  if (meta.controlLine == null) warnings.push("未填写总分特控线，将不显示总分特控线差。");
  if (meta.bachelorLine == null) warnings.push("未填写总分本科线，将不显示总分本科线差。");
  const ids = new Set();
  const names = new Set();
  let validStudents = 0;
  exam.students.forEach((student, index) => {
    const label = student._sourceLabel || `学生记录第 ${index + 1} 条：`;
    const addError = (message) => { errors.push(`${label}${message}`); studentErrorIndexes.add(index); };
    if ((exam.dataIssues || []).some((issue) => issue.startsWith(label))) studentErrorIndexes.add(index);
    if (!student.studentId) addError("缺少学号/查询识别码。");
    else if (ids.has(student.studentId)) addError(`查询识别码重复：${student.studentId}。`);
    else ids.add(student.studentId);
    if (!student.name) addError("缺少学生姓名。");
    else if (names.has(student.name)) warnings.push(`姓名“${student.name}”出现多次，请确认查询识别码不同且准确。`);
    else names.add(student.name);
    if (!student.className) warnings.push(`${label}未填写班级，将使用考试信息中的班级。`);
    const filledScores = [];
    for (const subject of exam.subjects) {
      const score = student.subjects?.[subject.key]?.score;
      if (score != null) {
        filledScores.push(score);
        if (score < 0 || score > subject.max) addError(`${subject.name}分数 ${score} 超出 0–${subject.max} 范围。`);
      }
      const rank = student.subjects?.[subject.key]?.rank;
      if (rank != null && (rank < 1 || !Number.isInteger(rank))) addError(`${subject.name}排名必须是正整数。`);
    }
    for (const [key, value] of [["全市排名", student.cityRank], ["校内排名", student.schoolRank], ["班级排名", student.classRank]]) {
      if (value != null && (value < 1 || !Number.isInteger(value))) addError(`${key}必须是正整数。`);
    }
    if (student.totalScore != null && (student.totalScore < 0 || student.totalScore > totalMax)) addError(`总分 ${student.totalScore} 超出 0–${totalMax} 范围。`);
    if (student.totalScore == null && !filledScores.length) addError("没有总分，也没有任何科目分数。");
    if (student._autoTotal && filledScores.length < exam.subjects.length) warnings.push(`${label}总分由已填写的 ${filledScores.length}/${exam.subjects.length} 个科目自动合计，请确认其余科目确实应留空。`);
    if (student.totalScore != null && filledScores.length && Math.abs(student.totalScore - filledScores.reduce((sum, value) => sum + value, 0)) > 0.11) warnings.push(`${label}${student.name || student.studentId}的总分与已填科目合计不一致，系统保留你填写的总分。`);
    const primaryValue = meta.scope === "city" ? student.cityRank : meta.scope === "school" ? student.schoolRank : student.classRank;
    if (primaryValue == null) warnings.push(`${label}${student.name || student.studentId || "该学生"}未填写${meta.scope === "city" ? "全市" : meta.scope === "school" ? "校内" : "班级"}排名，报告对应排名将显示为空。`);
    if (!studentErrorIndexes.has(index) && student.studentId && student.name && (student.totalScore != null || filledScores.length)) validStudents += 1;
  });
  const validStudentIds = new Set(exam.students.map((student) => student.studentId).filter(Boolean));
  const validSubjectKeys = new Set(exam.subjects.map((subject) => subject.key));
  exam.knowledge.forEach((item, index) => {
    const label = item._sourceLabel || `知识点记录第 ${index + 1} 条：`;
    if (!item.studentId) errors.push(`${label}缺少学号/查询识别码。`);
    else if (!validStudentIds.has(item.studentId)) errors.push(`${label}学号 ${item.studentId} 不在本次学生成绩中。`);
    if (!item.subjectKey) errors.push(`${label}缺少科目键。`);
    else if (!validSubjectKeys.has(item.subjectKey)) errors.push(`${label}科目“${item.subjectKey}”无法识别。`);
    if (!item.knowledge) errors.push(`${label}缺少知识点名称。`);
    if (item.loss != null && item.loss < 0) errors.push(`${label}失分不能为负数。`);
  });
  return { errors, warnings, validStudents, studentErrorIndexes };
}

function getMergePreview(exam) {
  const history = Array.isArray(state.project?.exams) ? state.project.exams : [];
  const replacement = Boolean(exam?.exam?.examId && history.some((item) => item.examId === exam.exam.examId));
  const historicalIds = new Set((state.project?.students || []).map((student) => canonicalStudentId(student.studentId)).filter(Boolean));
  const currentIds = new Set((exam?.students || []).map((student) => canonicalStudentId(student.studentId)).filter(Boolean));
  const studentIds = new Set([...historicalIds, ...currentIds]);
  return {
    historyCount: history.length,
    examCount: history.length + (replacement ? 0 : 1),
    studentCount: studentIds.size,
    replacement,
    newStudentCount: [...currentIds].filter((id) => !historicalIds.has(id)).length,
    missingStudentCount: [...historicalIds].filter((id) => !currentIds.has(id)).length,
  };
}

function renderMergePreview(exam) {
  const preview = $("mergePreview");
  if (!preview || !exam) {
    if (preview) preview.hidden = true;
    return;
  }
  const summary = getMergePreview(exam);
  $("mergePreviewTitle").textContent = `${exam.exam.examName || "未命名考试"} · ${exam.exam.examId || "待填写编号"}`;
  $("mergeMode").textContent = summary.replacement ? "覆盖同编号" : state.project ? "新增考试" : "首次建立";
  $("mergeMode").className = `merge-mode${summary.replacement ? " replace" : ""}`;
  $("mergeExamCount").textContent = summary.examCount;
  $("mergeStudentCount").textContent = summary.studentCount;
  $("mergeHistoryCount").textContent = summary.historyCount;
  $("mergePreviewCopy").textContent = summary.replacement
    ? `项目备份中已经存在“${exam.exam.examName || exam.exam.examId}”。本次会覆盖这一场考试，其他 ${Math.max(0, summary.historyCount - 1)} 场历史记录保持不变。`
    : state.project
      ? `本次会新增一场考试，并为 ${exam.students.length} 条当前记录更新个人报告；新增学生 ${summary.newStudentCount} 人，本次未出现的历史学生 ${summary.missingStudentCount} 人。`
      : "这是第一次建立发布项目；生成项目备份后，下次考试即可继续累计趋势。";
  preview.hidden = false;
}

function invalidateGenerated() {
  state.generated = null;
  state.backupSaved = false;
  for (const id of ["downloadZip", "downloadBundle", "downloadVersion"]) {
    const anchor = $(id);
    if (anchor?.dataset.url) URL.revokeObjectURL(anchor.dataset.url);
    if (anchor) { delete anchor.dataset.url; anchor.removeAttribute("href"); }
  }
  const downloadPanel = $("downloadPanel");
  if (downloadPanel) downloadPanel.hidden = true;
  const releaseManifest = $("releaseManifest");
  if (releaseManifest) releaseManifest.hidden = true;
  const pagesResult = $("pagesResult");
  if (pagesResult) pagesResult.hidden = true;
  const uploadButton = $("uploadButton");
  if (uploadButton) uploadButton.disabled = true;
  const uploadStatus = $("uploadStatus");
  if (uploadStatus) uploadStatus.textContent = "生成加密发布包后可上传";
}

function setEditingDisabled(disabled) {
  for (const control of metadataForm.querySelectorAll("input, select")) control.disabled = disabled;
  examFile.disabled = disabled;
  projectFile.disabled = disabled;
  $("chooseExamButton").disabled = disabled;
  $("clearExamButton").disabled = disabled;
  $("clearProjectButton").disabled = disabled;
}

function renderMessages(result) {
  const messages = [
    ...result.errors.slice(0, 36).map((text) => `<div class="message error"><b>错误</b><span>${escapeHtml(text)}</span></div>`),
    ...result.warnings.slice(0, 24).map((text) => `<div class="message warning"><b>提醒</b><span>${escapeHtml(text)}</span></div>`),
  ];
  if (result.errors.length > 36 || result.warnings.length > 24) messages.push(`<div class="message info"><b>提示</b><span>还有 ${Math.max(0, result.errors.length - 36)} 条错误、${Math.max(0, result.warnings.length - 24)} 条提醒未展开。</span></div>`);
  messageStack.innerHTML = messages.join("");
  messageStack.hidden = messages.length === 0;
}

function renderPreview(exam, result) {
  const tbody = $("previewTable").querySelector("tbody");
  tbody.innerHTML = exam.students.slice(0, 12).map((student, index) => {
    const hasError = result.studentErrorIndexes?.has(index);
    const autoTotal = student._autoTotal;
    const status = hasError ? "需修正" : autoTotal ? "总分已计算" : "可发布";
    return `<tr><td><strong>${escapeHtml(student.name || "未填写")}</strong></td><td>${escapeHtml(student.studentId || "未填写")}</td><td>${displayNumber(student.totalScore)}</td><td>${displayNumber(primaryRank(student, exam.exam.scope), 0)}</td><td class="row-status ${hasError ? "error" : autoTotal ? "warn" : ""}">${status}</td></tr>`;
  }).join("");
  $("previewCaption").textContent = exam.students.length > 12 ? `显示前 12 条，共 ${exam.students.length} 条` : `${exam.students.length} 条记录`;
  previewWrap.hidden = !exam.students.length;
  $("studentCount").textContent = exam.students.length;
  $("validCount").textContent = result.validStudents;
  $("warningCount").textContent = result.warnings.length;
  $("errorCount").textContent = result.errors.length;
  validationSummary.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function syncMetadataFromForm() {
  if (!state.exam) return;
  invalidateGenerated();
  const issues = [];
  state.exam.exam.examName = normalizeText($("metaExamName").value);
  state.exam.exam.examId = normalizeText($("metaExamId").value);
  state.exam.exam.examDate = checkedDate($("metaExamDate").value, "考试日期", issues);
  state.exam.exam.scope = checkedScope($("metaScope").value, "排名范围", issues);
  state.exam.exam.className = normalizeText($("metaClassName").value);
  state.exam.exam.controlLine = checkedNumber($("metaControlLine").value, "总分特控线", issues);
  state.exam.exam.bachelorLine = checkedNumber($("metaBachelorLine").value, "总分本科线", issues);
  state.exam.exam.note = normalizeText($("metaNote").value);
  state.exam.fieldIssues = issues;
  renderReview();
}

function fillMetadataForm(exam) {
  $("metaExamName").value = exam.exam.examName || "";
  $("metaExamId").value = exam.exam.examId || "";
  $("metaExamDate").value = exam.exam.examDate || "";
  $("metaScope").value = exam.exam.scope || "city";
  $("metaClassName").value = exam.exam.className || "";
  $("metaControlLine").value = exam.exam.controlLine ?? "";
  $("metaBachelorLine").value = exam.exam.bachelorLine ?? "";
  $("metaNote").value = exam.exam.note || "";
  metadataForm.hidden = false;
}

function renderReview() {
  if (!state.exam) {
    $("reviewState").textContent = "尚未导入";
    $("reviewState").className = "panel-state muted";
    $("generateButton").disabled = true;
    $("backupButton").disabled = true;
    renderMergePreview(null);
    return;
  }
  const result = validateExam(state.exam);
  if (state.projectWarnings.length) result.warnings.unshift(...state.projectWarnings);
  const merge = getMergePreview(state.exam);
  if (merge.replacement) result.warnings.unshift(`项目备份中已有考试编号 ${state.exam.exam.examId}，生成时会覆盖该场考试。`);
  if (state.project && merge.missingStudentCount) result.warnings.unshift(`本次模板未包含 ${merge.missingStudentCount} 位历史学生；他们的历史报告会保留，但不会新增本次考试记录。`);
  if (state.project) {
    const historicalNames = new Map((state.project.students || []).map((student) => [canonicalStudentId(student.studentId), normalizeText(student.name)]));
    const changedNames = state.exam.students.filter((student) => {
      const previousName = historicalNames.get(canonicalStudentId(student.studentId));
      return previousName && student.name && previousName !== normalizeText(student.name);
    });
    if (changedNames.length) result.warnings.unshift(`有 ${changedNames.length} 位学生的查询识别码与历史项目相同、姓名不同；生成后会以本次模板姓名为准，请确认不是学号错配。`);
  }
  renderMergePreview(state.exam);
  renderMessages(result);
  renderPreview(state.exam, result);
  const valid = result.errors.length === 0 && result.validStudents > 0;
  $("reviewState").textContent = valid ? (result.warnings.length ? "可发布 · 有提醒" : "校验通过") : "需要修正";
  $("reviewState").className = `panel-state ${valid ? "" : "muted"}`;
  $("exportState").textContent = valid ? "可以生成" : "等待校验通过";
  $("exportState").className = `panel-state ${valid ? "" : "muted"}`;
  $("generateButton").disabled = !valid;
  $("backupButton").disabled = !valid;
  $("exportEstimate").textContent = valid ? `将为 ${result.validStudents} 位学生生成独立加密记录` : "导入并通过校验后可生成";
  $("sideStatus").textContent = valid ? "待加密" : "待校验";
  $("sideStatusCopy").textContent = valid ? "数据已准备好，可以生成发布包。" : result.errors.length ? "请先处理下方错误，再进入加密。" : "模板已经导入，正在等待检查。";
  $("progressBar").style.width = valid ? "64%" : "34%";
  $("importState").textContent = "已导入";
  $("importState").className = "panel-state";
}

async function readExamFile(file) {
  if (file.size > MAX_EXAM_FILE_BYTES) throw new Error(`考试文件超过 12 MB（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB），请删除无关图片、格式或工作表后重试。`);
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const payload = JSON.parse(await file.text());
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("JSON 顶层必须是一个考试对象。");
    if (payload.kind === "grade-project") throw new Error("这里选择的是项目备份；请在“导入上一次项目备份”处载入该文件。");
    if (payload.schemaVersion != null && Number(payload.schemaVersion) !== 2) throw new Error(`不支持数据格式 v${payload.schemaVersion}，请重新下载当前 v2 模板。`);
    return normalizeExam(payload);
  }
  if (name.endsWith(".csv")) return parseCsvExam(await file.text());
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsx(await file.arrayBuffer());
  throw new Error("只支持 .xlsx、.xls、.csv 或 .json 文件。");
}

async function importExam(file) {
  $("importState").textContent = "正在读取…";
  $("importState").className = "panel-state muted";
  try {
    const exam = await readExamFile(file);
    invalidateGenerated();
    state.exam = exam;
    state.examFileName = file.name;
    $("examDropZone").hidden = true;
    $("examFileRow").hidden = false;
    $("examFileName").textContent = file.name;
    $("examFileInfo").textContent = `${exam.students.length} 条学生记录 · ${exam.subjects.length} 个科目`;
    fillMetadataForm(exam);
    renderReview();
    showToast("考试模板已导入，正在等待校验结果");
    $("step-review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    const message = error.message || "导入失败";
    showToast(message);
    $("importState").textContent = state.exam ? "原文件已保留" : "导入失败";
    $("importState").className = "panel-state muted";
    if (state.exam) {
      const result = validateExam(state.exam);
      result.errors.unshift(`新文件导入失败，已保留当前文件：${message}`);
      renderMessages(result);
    } else {
      messageStack.innerHTML = `<div class="message error"><b>导入失败</b><span>${escapeHtml(message)}</span></div>`;
      messageStack.hidden = false;
    }
    examFile.value = "";
  }
}

async function importProject(file) {
  try {
    if (file.size > MAX_PROJECT_FILE_BYTES) throw new Error(`项目备份超过 24 MB（当前 ${(file.size / 1024 / 1024).toFixed(1)} MB），请确认选择的是工作台生成的 JSON 备份。`);
    const payload = JSON.parse(await file.text());
    const check = validateProjectBackup(payload);
    if (check.errors.length) throw new Error(check.errors[0]);
    invalidateGenerated();
    state.project = clone(payload);
    state.projectWarnings = check.warnings;
    state.projectFileName = file.name;
    $("projectFileRow").hidden = false;
    $("projectFileName").textContent = `${file.name} · ${payload.students?.length || 0} 位学生 · ${payload.exams?.length || 0} 场考试`;
    showToast(check.warnings.length ? `历史项目已载入，有 ${check.warnings.length} 条提醒` : "历史项目备份已载入；导入本次考试后会自动合并");
    if (state.exam) renderReview();
  } catch (error) {
    const message = error.message || "项目备份导入失败";
    showToast(message);
    projectFile.value = "";
    if (state.exam) {
      const result = validateExam(state.exam);
      result.warnings.unshift(`项目备份未载入，当前考试仍可作为首次项目生成：${message}`);
      renderMessages(result);
    }
  }
}

function clearExam() {
  state.exam = null; state.examFileName = "";
  invalidateGenerated();
  examFile.value = ""; $("examDropZone").hidden = false; $("examFileRow").hidden = true; metadataForm.hidden = true; validationSummary.hidden = true; previewWrap.hidden = true; messageStack.hidden = true; $("importState").textContent = "等待文件"; $("importState").className = "panel-state"; renderReview();
}

function clearProject() {
  state.project = null; state.projectWarnings = []; state.projectFileName = ""; projectFile.value = ""; $("projectFileRow").hidden = true; invalidateGenerated(); showToast("已移除历史项目备份");
  if (state.exam) renderReview();
}

function setDownload(anchor, blob, filename) {
  if (anchor.dataset.url) URL.revokeObjectURL(anchor.dataset.url);
  const url = URL.createObjectURL(blob);
  anchor.href = url; anchor.download = filename; anchor.dataset.url = url; anchor.hidden = false;
}

function downloadText(text, filename, mime = "application/json") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob); anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

function textToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function base64ToText(value) {
  const clean = String(value || "").replace(/\s/g, "");
  return new TextDecoder().decode(Uint8Array.from(atob(clean), (char) => char.charCodeAt(0)));
}

async function githubRequest(url, token, options = {}) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 25000);
  let response;
  let text;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("GitHub 请求超过 25 秒，请检查网络后重试；尚未完成的提交不会覆盖原数据。");
    throw new Error(`无法连接 GitHub：${error?.message || "网络请求失败"}`);
  } finally {
    window.clearTimeout(timer);
  }
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (error) { body = { message: text }; }
  if (!response.ok) {
    const detail = body?.message || `GitHub API ${response.status}`;
    const hint = response.status === 401
      ? "Token 无效或已过期"
      : response.status === 403
        ? "Token 缺少 Contents 读写权限，或触发了 GitHub 访问限制"
        : response.status === 404
          ? "未找到仓库、分支或文件，请检查仓库地址和 Token 的仓库范围"
          : response.status === 409 || response.status === 422
            ? "仓库版本发生变化，请刷新工作台后重新生成并上传"
            : "GitHub 返回了错误";
    throw new Error(`${hint}：${detail}（${response.status}）`);
  }
  return body;
}

function parseRepository(value) {
  const text = normalizeText(value).replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
  const parts = text.split("/").filter(Boolean);
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error("仓库格式应为 owner/repository，例如 yusheng266186-beep/grade-query。");
  return { owner: parts[0], repo: parts[1] };
}

async function uploadRelease() {
  if (state.uploading) return;
  const uploadButton = $("uploadButton");
  const tokenInput = $("githubToken");
  const token = normalizeText(tokenInput.value);
  let repoInfo;
  try { repoInfo = parseRepository($("githubRepo").value); } catch (error) { showToast(error.message); return; }
  const branch = normalizeText($("githubBranch").value) || "main";
  if (!token) { showToast("请输入 Fine-grained Token 后再上传。"); tokenInput.focus(); return; }
  if (!state.generated) { showToast("请先生成加密发布包。"); return; }
  const generated = state.generated;
  const apiRoot = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
  const files = [
    { path: "data/grade-data.v2.json", content: JSON.stringify(generated.bundle, null, 2) },
    { path: "data/version.json", content: JSON.stringify(generated.version, null, 2) },
  ];
  state.uploading = true;
  setEditingDisabled(true);
  $("generateButton").disabled = true;
  uploadButton.disabled = true;
  uploadButton.textContent = "正在发布…";
  $("githubRepo").disabled = true;
  $("githubBranch").disabled = true;
  tokenInput.disabled = true;
  $("toggleTokenButton").disabled = true;
  $("uploadStatus").textContent = "正在读取仓库版本…";
  $("pagesResult").hidden = true;
  try {
    const ref = await githubRequest(`${apiRoot}/git/ref/heads/${encodeURIComponent(branch)}`, token);
    const headSha = ref.object.sha;
    const headCommit = await githubRequest(`${apiRoot}/git/commits/${headSha}`, token);
    const treeEntries = [];
    for (const file of files) {
      $("uploadStatus").textContent = `正在上传 ${file.path}…`;
      const blob = await githubRequest(`${apiRoot}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: textToBase64(file.content), encoding: "base64" }) });
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    $("uploadStatus").textContent = "正在创建发布提交…";
    const tree = await githubRequest(`${apiRoot}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: headCommit.tree.sha, tree: treeEntries }) });
    const commit = await githubRequest(`${apiRoot}/git/commits`, token, { method: "POST", body: JSON.stringify({ message: `data: publish ${generated.version.latestExam || "grade report"}`, tree: tree.sha, parents: [headSha] }) });
    await githubRequest(`${apiRoot}/git/refs/heads/${encodeURIComponent(branch)}`, token, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
    $("uploadStatus").textContent = "正在回读 GitHub 版本…";
    let verificationText = "提交已完成";
    try {
      const remoteVersionFile = await githubRequest(`${apiRoot}/contents/data/version.json?ref=${encodeURIComponent(branch)}`, token);
      const remoteVersion = JSON.parse(base64ToText(remoteVersionFile.content));
      if (remoteVersion.releaseId !== generated.version.releaseId || remoteVersion.bundleSha256 !== generated.version.bundleSha256) {
        throw new Error("GitHub 返回的版本与本次发布不一致");
      }
      verificationText = "GitHub 文件已回读校验";
    } catch (error) {
      verificationText = `提交已完成，版本回读暂未通过：${error.message}`;
    }
    let pagesUrl = repoInfo.repo.toLowerCase() === `${repoInfo.owner}.github.io`.toLowerCase()
      ? `https://${repoInfo.owner}.github.io/`
      : `https://${repoInfo.owner}.github.io/${repoInfo.repo}/`;
    try {
      const pages = await githubRequest(`${apiRoot}/pages`, token);
      if (pages?.html_url) pagesUrl = pages.html_url;
    } catch (error) {
      // Contents-only tokens may not have Pages read permission; the deterministic URL is still valid.
    }
    const pagesReleaseUrl = new URL(pagesUrl);
    pagesReleaseUrl.searchParams.set("v", generated.version.releaseId);
    $("pagesLink").href = pagesReleaseUrl.href;
    $("commitLink").href = commit.html_url || `https://github.com/${repoInfo.owner}/${repoInfo.repo}/commit/${commit.sha}`;
    $("pagesResult").hidden = false;
    $("pagesResultTitle").textContent = "Pages 正在更新";
    $("pagesResultText").textContent = `${verificationText}（${commit.sha.slice(0, 7)}），正在确认查询页已读取本次版本…`;
    $("uploadStatus").textContent = "GitHub 已提交，正在等待 Pages 生效…";
    tokenInput.value = "";
    tokenInput.disabled = false;
    const pagesReady = await waitForPagesRelease(pagesUrl, generated.version.releaseId);
    if (pagesReady) {
      $("pagesResultTitle").textContent = "发布完成，可以查询";
      $("pagesResultText").textContent = `${verificationText}（${commit.sha.slice(0, 7)}），Pages 已读取本次发布版本。`;
      $("uploadStatus").textContent = state.backupSaved ? "发布完成" : "发布完成 · 请再下载项目备份";
      showToast("发布完成，成绩查询页已经生效");
    } else {
      $("pagesResultTitle").textContent = "提交成功，Pages 仍在刷新";
      $("pagesResultText").textContent = `${verificationText}（${commit.sha.slice(0, 7)}）。等待超时但提交未丢失，请稍后打开查询页确认版本。`;
      $("uploadStatus").textContent = "提交成功，Pages 尚在刷新";
      showToast("GitHub 已提交，Pages 仍在刷新");
    }
  } catch (error) {
    $("uploadStatus").textContent = `上传失败：${error.message}`;
    showToast(`GitHub 上传失败：${error.message}`);
  } finally {
    tokenInput.value = "";
    tokenInput.disabled = false;
    $("toggleTokenButton").disabled = false;
    $("githubRepo").disabled = false;
    $("githubBranch").disabled = false;
    setEditingDisabled(false);
    uploadButton.textContent = "一键上传并发布";
    uploadButton.disabled = !state.generated;
    const valid = state.exam && validateExam(state.exam).errors.length === 0;
    $("generateButton").disabled = !valid;
    $("backupButton").disabled = !valid;
    state.uploading = false;
  }
}

async function waitForPagesRelease(pagesUrl, releaseId, attempts = 12, interval = 5000) {
  const versionUrl = new URL("data/version.json", pagesUrl).href;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${versionUrl}?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok && (await response.json())?.releaseId === releaseId) return true;
    } catch (error) {
      // Pages may briefly return an old version or a network error while deploying.
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

function currentProject() {
  const result = validateExam(state.exam);
  if (result.errors.length) throw new Error("还有字段错误，暂时不能生成项目备份。");
  return state.project ? mergeExamIntoProject(state.project, state.exam) : projectFromExam(state.exam);
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

async function encryptStudent(student) {
  const secret = `${student.name.trim()}|${canonicalStudentId(student.studentId)}`;
  const fileId = await sha256Hex(`grade-query-v2|${secret}`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 240000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const payload = new TextEncoder().encode(JSON.stringify(student));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
  return [fileId, { v: 2, salt: bytesToBase64(salt), iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) }];
}

async function buildEncryptedBundle(project) {
  if (!window.crypto?.subtle || !window.isSecureContext) throw new Error("加密需要在 HTTPS 或 localhost 环境运行，请不要直接双击本地 HTML 文件。");
  const records = {};
  for (let index = 0; index < project.students.length; index += 1) {
    const student = project.students[index];
    const [fileId, encrypted] = await encryptStudent(student);
    records[fileId] = encrypted;
    $("sideStatusCopy").textContent = `正在加密第 ${index + 1} / ${project.students.length} 位学生…`;
    $("progressBar").style.width = `${68 + ((index + 1) / project.students.length) * 25}%`;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  const generatedAt = new Date().toISOString();
  const bundle = {
    kind: "grade-query-bundle",
    schemaVersion: 2,
    dataVersion: project.dataVersion,
    generatedAt,
    className: project.meta?.className || "",
    studentCount: project.students.length,
    examCount: project.exams.length,
    latestExam: project.meta?.latestExam || "",
    latestExamId: project.exams[project.exams.length - 1]?.examId || "",
    recordCount: Object.keys(records).length,
    records,
  };
  const bundleSha256 = await sha256Hex(JSON.stringify(bundle));
  const releaseId = `${project.dataVersion}-${bundleSha256.slice(0, 12)}`;
  const version = {
    kind: "grade-query-version",
    schemaVersion: 2,
    dataVersion: project.dataVersion,
    generatedAt,
    className: bundle.className,
    studentCount: bundle.studentCount,
    examCount: bundle.examCount,
    latestExam: bundle.latestExam,
    latestExamId: bundle.latestExamId,
    recordCount: bundle.recordCount,
    releaseId,
    bundleSha256,
    generatedBy: "grade-query-publisher-v2",
    replaceFiles: ["data/grade-data.v2.json", "data/version.json"],
  };
  return { bundle, version };
}

async function makeZip(bundle, version) {
  if (!window.JSZip) return null;
  const zip = new window.JSZip();
  zip.file("data/grade-data.v2.json", JSON.stringify(bundle, null, 2));
  zip.file("data/version.json", JSON.stringify(version, null, 2));
  zip.file("README-发布说明.txt", `成绩查询发布包\n\n1. 将 data/grade-data.v2.json 和 data/version.json 上传到现有仓库的 data/ 目录。\n2. 覆盖同名文件即可，查询页会自动优先读取 v2 数据。\n3. 不要把项目备份文件上传到公开仓库；项目备份仅用于下一次考试继续合并。\n4. 发布编号：${version.releaseId}\n5. 数据校验：SHA-256 ${version.bundleSha256}\n6. 本包生成时间：${version.generatedAt}\n`);
  try {
    const response = await fetch("index.html", { cache: "no-store" });
    if (response.ok) zip.file("index.html", await response.text());
  } catch (error) {
    // Local file mode cannot fetch index.html; the data-only ZIP remains useful.
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

async function generateRelease() {
  if (state.generating) return;
  const generateButton = $("generateButton");
  state.generating = true;
  generateButton.disabled = true;
  generateButton.textContent = "正在加密…";
  $("backupButton").disabled = true;
  setEditingDisabled(true);
  $("sideStatus").textContent = "正在生成";
  try {
    const project = currentProject();
    const { bundle, version } = await buildEncryptedBundle(project);
    const bundleBlob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const versionBlob = new Blob([JSON.stringify(version, null, 2)], { type: "application/json" });
    const bundleName = `grade-data-v2-${version.dataVersion.replace(/[^a-z0-9-]/gi, "-")}.json`;
    const versionName = "version.json";
    setDownload($("downloadBundle"), bundleBlob, bundleName);
    setDownload($("downloadVersion"), versionBlob, versionName);
    const zipBlob = await makeZip(bundle, version);
    if (zipBlob) setDownload($("downloadZip"), zipBlob, `grade-query-release-${version.dataVersion.replace(/[^a-z0-9-]/gi, "-")}.zip`);
    else $("downloadZip").hidden = true;
    $("downloadSummary").textContent = `${bundle.studentCount} 位学生 · ${bundle.examCount} 场考试 · ${new Date(version.generatedAt).toLocaleString("zh-CN")}`;
    $("releaseVersion").textContent = version.releaseId;
    $("releaseHash").textContent = `SHA-256 ${version.bundleSha256.slice(0, 16)}…`;
    $("releaseFiles").textContent = `${version.recordCount} 条加密记录 · ${version.replaceFiles.join(" + ")}`;
    $("releaseManifest").hidden = false;
    $("downloadPanel").hidden = false;
    $("sideStatus").textContent = "已生成";
    $("sideStatusCopy").textContent = "发布包已准备好：可一键上传到 GitHub，并请下载项目备份供下次考试继续合并。";
    $("progressBar").style.width = "100%";
    $("exportState").textContent = "生成完成";
    state.generated = { project, bundle, version };
    state.backupSaved = false;
    $("uploadButton").disabled = false;
    $("uploadStatus").textContent = "已生成；建议先下载项目备份，再一键上传";
    showToast("加密发布包已生成");
    $("downloadPanel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    showToast(error.message || "生成失败");
    $("sideStatus").textContent = "生成失败";
    $("sideStatusCopy").textContent = error.message || "请检查模板和浏览器环境。";
  } finally {
    state.generating = false;
    setEditingDisabled(false);
    generateButton.textContent = "生成加密发布包";
    const valid = state.exam && validateExam(state.exam).errors.length === 0;
    generateButton.disabled = !valid;
    $("backupButton").disabled = !valid;
  }
}

function saveBackup() {
  try {
    const project = state.generated?.project || currentProject();
    const name = `grade-project-${project.dataVersion.replace(/[^a-z0-9-]/gi, "-")}.json`;
    downloadText(JSON.stringify(project, null, 2), name);
    state.backupSaved = true;
    if (state.generated && !state.uploading) $("uploadStatus").textContent = "项目备份已保存，可一键上传发布";
    showToast("项目备份已下载，请妥善保存在本地");
  } catch (error) { showToast(error.message || "备份失败"); }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

examDropZone.addEventListener("click", () => examFile.click());
examDropZone.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); examFile.click(); } });
examDropZone.addEventListener("dragover", (event) => { event.preventDefault(); examDropZone.classList.add("dragging"); });
examDropZone.addEventListener("dragleave", () => examDropZone.classList.remove("dragging"));
examDropZone.addEventListener("drop", (event) => { event.preventDefault(); examDropZone.classList.remove("dragging"); const file = event.dataTransfer.files[0]; if (file) importExam(file); });
examFile.addEventListener("change", () => { if (examFile.files[0]) importExam(examFile.files[0]); });
projectFile.addEventListener("change", () => { if (projectFile.files[0]) importProject(projectFile.files[0]); });
$("chooseExamButton").addEventListener("click", (event) => { event.stopPropagation(); examFile.click(); });
$("clearExamButton").addEventListener("click", clearExam);
$("clearProjectButton").addEventListener("click", clearProject);
$("generateButton").addEventListener("click", generateRelease);
$("backupButton").addEventListener("click", saveBackup);
$("uploadButton").addEventListener("click", uploadRelease);
$("toggleTokenButton").addEventListener("click", () => {
  const input = $("githubToken");
  const showing = input.type === "text";
  input.type = showing ? "password" : "text";
  $("toggleTokenButton").textContent = showing ? "显示" : "隐藏";
  $("toggleTokenButton").setAttribute("aria-pressed", String(!showing));
});
for (const input of metadataForm.querySelectorAll("input, select")) input.addEventListener("input", syncMetadataFromForm);

window.addEventListener("beforeunload", (event) => {
  if (!state.uploading && (!state.generated || state.backupSaved)) return;
  event.preventDefault();
  event.returnValue = "";
});

$("sideStatusCopy").textContent = window.isSecureContext ? "先下载模板，填入本次考试数据后导入。" : "请通过 GitHub Pages 或 localhost 打开工作台，才能使用浏览器加密。";
