import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const output = process.env.TEMPLATE_OUTPUT || new URL("../templates/exam-template.xlsx", import.meta.url).pathname;
const workbook = Workbook.create();

const navy = "#173C4B";
const jade = "#E8F2EE";
const gold = "#F7EDDD";
const ink = "#1D3037";
const muted = "#718189";
const line = "#DDE7E2";

function title(sheet, range, text) {
  sheet.getRange(range).merge();
  sheet.getRange(range.split(":")[0]).values = [[text]];
  sheet.getRange(range).format = { fill: navy, font: { bold: true, color: "#FFFFFF", size: 16 }, horizontalAlignment: "left", verticalAlignment: "center" };
  sheet.getRange(range).format.rowHeight = 30;
}

function header(sheet, range) {
  sheet.getRange(range).format = { fill: jade, font: { bold: true, color: ink }, borders: { preset: "all", style: "thin", color: line }, horizontalAlignment: "center", verticalAlignment: "center", wrapText: true };
}

function body(sheet, range) {
  sheet.getRange(range).format = { font: { color: ink, size: 10 }, borders: { preset: "inside", style: "thin", color: "#EEF2EF" }, verticalAlignment: "center" };
}

const info = workbook.worksheets.add("填写说明");
info.showGridLines = false;
title(info, "A1:F1", "成绩发布输入模板 · v2");
info.getRange("A3:F3").merge();
info.getRange("A3").values = [["填写本次考试数据后，打开 publisher.html 导入。灰色示例行请删除或覆盖；空白、—、无表示缺失，数字 0 会保留。"]];
info.getRange("A3:F3").format = { fill: gold, font: { color: ink, size: 10 }, wrapText: true, verticalAlignment: "center" };
info.getRange("A3:F3").format.rowHeight = 34;
info.getRange("A5:C5").values = [["工作表", "用途", "是否必填"]];
header(info, "A5:C5");
info.getRange("A6:C10").values = [
  ["考试信息", "填写考试名称、编号、日期、排名范围、班级和总分线", "是"],
  ["科目分数线", "填写科目满分及可选的科目线差", "建议"],
  ["学生成绩", "每行一名学生，姓名和学号/查询识别码必填", "是"],
  ["知识点失分", "可选，每行一条主要失分知识点", "否"],
  ["发布流程", "导入项目备份（第二次起） → 导入本次模板 → 校验 → 生成加密发布包 → 上传", "—"],
];
body(info, "A6:C10");
info.getRange("A12:F16").merge(true);
info.getRange("A12:A16").values = [
  ["版本规则：考试编号相同会覆盖同一场考试，考试编号不同会追加到历次趋势。"],
  ["总分留空时，系统会按已填写科目分数合计；总分与科目合计不一致时只提醒，不擅自修改。"],
  ["第一次生成后下载 grade-project-*.json；下次考试先导入这份项目备份，再导入新模板即可累计历史数据。"],
  ["项目备份是明文工作文件，仅保存到本地；发布包中的学生报告会在浏览器端逐条 AES-GCM 加密。"],
  ["TEST0001 等示例行只用于说明格式；正式导入时必须删除或完全替换，否则工作台会阻止发布。"],
];
info.getRange("A12:F16").format = { font: { color: muted, size: 10 }, wrapText: true, verticalAlignment: "center" };
info.getRange("A1:F16").format.columnWidth = 20;
info.getRange("A:A").format.columnWidth = 18;
info.getRange("B:B").format.columnWidth = 58;
info.getRange("C:C").format.columnWidth = 14;
info.getRange("D:F").format.columnWidth = 16;

const exam = workbook.worksheets.add("考试信息");
exam.showGridLines = false;
title(exam, "A1:C1", "考试信息");
exam.getRange("A3:C3").values = [["字段", "值", "填写说明"]];
header(exam, "A3:C3");
exam.getRange("A4:C11").values = [
  ["考试编号", "2026-zero-demo", "唯一编号；同编号再次导入会覆盖该场考试"],
  ["考试名称", "高二下零诊（示例）", "报告中显示的考试名称"],
  ["考试日期", "2026-07-16", "推荐 YYYY-MM-DD"],
  ["排名范围", "city", "city/全市、school/校内、class/班级"],
  ["班级名称", "高二4班", "本次考试所属班级"],
  ["特控线", 430, "总分特控线，可留空"],
  ["本科线", 320, "总分本科线，可留空"],
  ["备注", "请删除示例学生后填写", "可留空"],
];
body(exam, "A4:C11");
exam.getRange("B9:B10").format.numberFormat = "0.0";
exam.getRange("B4:B8").format.numberFormat = "@";
exam.getRange("B11").format.numberFormat = "@";
exam.getRange("B7").dataValidation = { rule: { type: "list", values: ["city", "school", "class"] } };
exam.getRange("A:A").format.columnWidth = 18; exam.getRange("B:B").format.columnWidth = 28; exam.getRange("C:C").format.columnWidth = 48;
exam.freezePanes.freezeRows(3);

const cutoffs = workbook.worksheets.add("科目分数线");
cutoffs.showGridLines = false;
title(cutoffs, "A1:E1", "科目分数线");
cutoffs.getRange("A3:E3").values = [["科目键", "科目名称", "满分", "特控线", "本科线"]];
header(cutoffs, "A3:E3");
cutoffs.getRange("A4:E9").values = [
  ["chinese", "语文", 150, "", ""],
  ["math", "数学", 150, "", ""],
  ["english", "英语", 150, "", ""],
  ["physics", "物理", 100, "", ""],
  ["chemistry", "化学", 100, "", ""],
  ["biology", "生物", 100, "", ""],
];
body(cutoffs, "A4:E9");
cutoffs.getRange("C4:E9").format.numberFormat = "0.0";
cutoffs.getRange("A:A").format.columnWidth = 16; cutoffs.getRange("B:B").format.columnWidth = 16; cutoffs.getRange("C:E").format.columnWidth = 14;
cutoffs.freezePanes.freezeRows(3);

const students = workbook.worksheets.add("学生成绩");
students.showGridLines = false;
title(students, "A1:T1", "学生成绩 · 每行一名学生");
students.getRange("A3:T3").values = [["学号", "姓名", "班级", "总分", "全市排名", "校内排名", "班级排名", "语文分数", "语文排名", "数学分数", "数学排名", "英语分数", "英语排名", "物理分数", "物理排名", "化学分数", "化学排名", "生物分数", "生物排名", "备注"]];
header(students, "A3:T3");
students.getRange("A4:T5").values = [
  ["TEST0001", "示例学生甲", "高二4班", 468, 120, 8, 1, 112, 3, 126, 1, 108, 5, 58, 2, 32, 4, 32, 6, ""],
  ["TEST0002", "示例学生乙", "高二4班", "", "", 19, 2, 98, "", 0, "", 101, "", 46, "", 29, "", 27, "", "总分留空会自动计算"],
];
body(students, "A4:T5");
students.getRange("A4:A104").format.numberFormat = "@";
students.getRange("D4:D104").format.numberFormat = "0.0";
for (const column of ["H", "J", "L", "N", "P", "R"]) students.getRange(`${column}4:${column}104`).format.numberFormat = "0.0";
for (const column of ["E", "F", "G", "I", "K", "M", "O", "Q", "S"]) students.getRange(`${column}4:${column}104`).format.numberFormat = "0";
students.getRange("A:A").format.columnWidth = 18; students.getRange("B:B").format.columnWidth = 16; students.getRange("C:C").format.columnWidth = 14; students.getRange("D:S").format.columnWidth = 12; students.getRange("T:T").format.columnWidth = 28;
students.freezePanes.freezeRows(3);
students.freezePanes.freezeColumns(3);
students.tables.add("A3:T5", true, "StudentScores");

const knowledge = workbook.worksheets.add("知识点失分");
knowledge.showGridLines = false;
title(knowledge, "A1:E1", "知识点失分 · 可选");
knowledge.getRange("A3:E3").values = [["学号", "科目键", "知识点", "题号", "失分"]];
header(knowledge, "A3:E3");
knowledge.getRange("A4:E4").values = [["TEST0001", "math", "函数单调性", "第12题", 6]];
body(knowledge, "A4:E4");
knowledge.getRange("A4:A104").format.numberFormat = "@";
knowledge.getRange("B4:B104").dataValidation = { rule: { type: "list", values: ["chinese", "math", "english", "physics", "chemistry", "biology"] } };
knowledge.getRange("E4:E104").format.numberFormat = "0.0";
knowledge.getRange("A:A").format.columnWidth = 18; knowledge.getRange("B:B").format.columnWidth = 16; knowledge.getRange("C:C").format.columnWidth = 28; knowledge.getRange("D:D").format.columnWidth = 16; knowledge.getRange("E:E").format.columnWidth = 12;
knowledge.freezePanes.freezeRows(3);

await fs.mkdir(new URL("../templates/", import.meta.url), { recursive: true });
const file = await SpreadsheetFile.exportXlsx(workbook);
await file.save(output);
console.log(output);
