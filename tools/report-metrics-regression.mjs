import assert from 'node:assert/strict';
import '../report-metrics.js';
const M=globalThis.GradeReportMetrics;
const student={exams:[
 {name:'难卷',scope:'city',rank:3000,gradeRankScope:'school-physics',gradeRanks:{total:100,math:120},scores:{total:550,math:120}},
 {name:'缺考',gradeRankScope:'school-physics',gradeRanks:{total:null,math:null},scores:{total:null,math:null}},
 {name:'易卷',gradeRankScope:'school-physics',gradeRanks:{total:150,math:80},scores:{total:650,math:140}},
]};
const total=M.series(student),math=M.series(student,'math');
assert.equal(total.length,3);
assert.equal(total[1].rank,null,'Missing exams retain their timeline slot');
assert.equal(M.comparison(total).improvement,-50,'Higher scores must not imply improved rank');
assert.equal(M.comparison(math).improvement,40);
assert.ok(M.rankScale(math).yRatio(80)<M.rankScale(math).yRatio(120),'Better ranks appear higher');
assert.equal(M.gradeRank({scope:'city',rank:8}),null,'City rank cannot fill a grade-rank gap');
assert.equal(M.gradeRank({scope:'school',subjectRanks:{math:3}},'math'),null,'Unscoped subject ranks stay unavailable');
assert.equal(M.comparison([{rank:10,scope:'city'},{rank:20,scope:'school'}]),null);
assert.equal(M.series({exams:[{gradeRankScope:'school-physics',gradeRanks:{math:200},scores:{math:0}}]},'math')[0].score,0);
assert.equal(M.rank(0),null);assert.equal(M.rank(''),null);assert.equal(M.rank(false),null);
assert.equal(M.rankScale([{rank:null}]),null);
assert.ok(M.rankScale([{rank:1}]).max>1);
console.log('Report checks passed: grade-only rank comparisons, inverse axes, missing slots, scoped comparisons, zero scores and single points.');
