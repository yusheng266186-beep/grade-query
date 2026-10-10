import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('../vendor/xlsx.full.min.js');
const moduleSource = fs.readFileSync(new URL('../question-data.js', import.meta.url), 'utf8');
vm.runInThisContext(moduleSource);
const api = globalThis.GradeQuestionData;
const students = [{studentId: 'CODE0001', name: '学生甲', className: '高三4班'}, {studentId: 'CODE0002', name: '学生乙', className: '高三4班'}];
const point = {studentId: 'CODE0001', subjectKey: 'math', question: '13.1', knowledge: '向量', maxScore: 5, score: 0};

assert.equal(api.normalizePoint(point).loss, 5);
assert.equal(api.normalizePoint({...point, score: ''}).score, null);
assert.equal(api.normalizePoint({...point, score: ''}).loss, null);
assert.equal(api.normalizePoint({...point, score: 3.5}).loss, 1.5);
const marked = api.normalizePoint({...point, maxScore: '14*', score: 16});
assert.equal(marked.score, 16);
assert.equal(marked.maxScore, null);
assert.equal(marked.loss, null);
assert.equal(api.pointErrors(marked).length, 0);
assert.ok(api.pointErrors(api.normalizePoint({...point, score: -1})).length);
assert.ok(api.pointErrors(api.normalizePoint({...point, score: 6})).length);
assert.ok(api.pointErrors(api.normalizePoint({...point, maxScore: 0})).length);
assert.ok(api.normalizePoint({...point, score: '错误'})._issues.length);
assert.ok(api.normalizePoint({...point, score: true})._issues.length);
assert.ok(api.matchRows([point, point], students).errors.some(v => /重复/.test(v)));
assert.ok(api.matchRows([{...point, name: '学生乙'}], students).errors.some(v => /不一致/.test(v)));
const ambiguous = [...students, {studentId: 'CODE0003', name: '学生甲', className: '高三5班'}];
assert.ok(api.matchRows([{subjectKey: 'math', question: '1', name: '学生甲', score: 1}], ambiguous).errors.some(v => /同名/.test(v)));
assert.equal(api.matchRows([{subjectKey: 'math', question: '1', name: '学生甲', className: '4', score: 1}], ambiguous).rows[0].studentId, 'CODE0001');
const scoped = api.matchRows([{...point, examCode: '51'}, {...point, examCode: '52'}], students, '52');
assert.equal(scoped.rows.length, 1);
assert.equal(scoped.skippedRows, 1);

const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
  ['', 51, '题号', 1], ['', '', '分值', 5], ['', '', '知识点', '旧知识点'],
  ['', 52, '题号', 1, '13.1', '总分'], ['', '', '分值', 5, '14*', ''], ['', '', '知识点', '集合', '综合', ''],
  ['51物', 4, '学生甲', 4], ['52物', 4, '学生甲', 0, 16, 16], ['52物', 4, '学生乙', '', 2, 2],
]), '数学');
assert.deepEqual(api.workbookExamCodes(workbook, XLSX), ['51', '52']);
assert.throws(() => api.workbookRows(workbook, XLSX), /请选择/);
const result = api.matchRows(api.workbookRows(workbook, XLSX, '52'), students, '52');
assert.equal(result.errors.length, 0);
assert.equal(result.rows.length, 4);
assert.equal(result.rows.find(r => r.studentId === 'CODE0002' && r.question === '1').score, null);
const detail = api.details(result.rows.filter(r => r.studentId === 'CODE0001'));
assert.equal(detail.math.questions.length, 2);
assert.equal(detail.math.weak.length, 1);
assert.equal(detail.math.weak[0].loss, 5);
assert.ok(api.hasData(detail));
const html = api.render(detail, [{key: 'math', name: '数学'}]);
assert.match(html, /待核实/);
assert.equal((html.match(/scope="row"/g) || []).length, 2);
assert.ok(!api.render({math: {questions: [{question: '<script>', knowledge: '<img>', score: 0, maxScore: 5, loss: 5}]}}, [{key:'math',name:'数学'}]).includes('<script>'));
const legacy = api.normalizePoint({studentId:'CODE0001',subjectKey:'math',knowledge:'函数',question:'12',loss:6});
assert.equal(api.normalizePoint(legacy).kind, 'loss');
assert.equal(api.details([legacy]).math.weak[0].loss, 6);
assert.match(api.render(api.details([legacy]), [{key:'math',name:'数学'}]), /失 6 分/);

const long = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(long, XLSX.utils.aoa_to_sheet([
  ['学号','姓名','班级','考试代码','科目键','题号','知识点','满分','得分'],
  ['CODE0001','学生甲','高三4班','52','math','13.1','向量',5,0],
]), '小题得分');
assert.equal(api.matchRows(api.workbookRows(long, XLSX), students, '52').rows[0].question, '13.1');
const roundTrip = XLSX.read(XLSX.write(long, {type:'buffer',bookType:'xlsx'}), {type:'buffer'});
assert.equal(api.matchRows(api.workbookRows(roundTrip, XLSX), students, '52').rows[0].score, 0);
const template = XLSX.read(fs.readFileSync(new URL('../templates/question-template.xlsx', import.meta.url)), {type:'buffer'});
assert.equal(api.workbookRows(template, XLSX).length, 2);

if (process.argv[2]) {
  const real = XLSX.read(fs.readFileSync(process.argv[2]), {type:'buffer', sheets:['语文','数学','英语','物理','化学','生物']});
  const exam = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  const points = api.matchRows(api.workbookRows(real, XLSX, '52'), exam.students, '52');
  assert.equal(points.errors.length, 0);
  assert.equal(points.studentCount, 47);
  assert.equal(points.rows.length, 5398);
  assert.equal(points.rows.filter(p => p.maxScoreNote).length, 230);
  fs.writeFileSync(process.argv[4], JSON.stringify(points, null, 2));
  console.log(JSON.stringify({realWorkbookStudents: points.studentCount, questionScores: points.rows.length, uncertainPhysicsMaxima: 230}));
}
console.log('Question checks passed: exam selection, matching, duplicate and range validation, zero/missing values, marked maxima, legacy compatibility, full rendering, and Excel round trip.');
