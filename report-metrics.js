"use strict";
(function(root) {
  const numeric = value => value == null || value === '' || typeof value === 'boolean' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
  const rank = value => Number.isInteger(numeric(value)) && Number(value) > 0 ? Number(value) : null;
  function gradeRank(exam, key = 'total') {
    if (exam?.gradeRankScope === 'school-physics') return rank(exam.gradeRanks?.[key]);
    if (key === 'total') return rank(exam?.schoolRank) ?? (exam?.scope === 'school' ? rank(exam.rank) : null);
    return exam?.subjectRankScope === 'school' ? rank(exam.subjectRanks?.[key]) : null;
  }
  function series(student, key = 'total') {
    return (student.exams || []).map((exam,index) => ({
      index, label:exam.name, rank:gradeRank(exam,key), score:numeric(exam.scores?.[key] ?? (key === 'total' ? exam.total : null)),
      count:rank(exam.gradeCounts?.[key]), scope:exam.gradeRankScope || 'school',
    }));
  }
  function comparison(entries, index = entries.length - 1) {
    const current=entries[index];
    if (!current || current.rank == null) return null;
    const previous=entries.slice(0,index).reverse().find(e=>e.rank!=null && e.scope===current.scope);
    return previous ? {previous,current,improvement:previous.rank-current.rank} : null;
  }
  function rankScale(entries) {
    const values=entries.map(e=>e.rank).filter(v=>v!=null);
    if(!values.length)return null;
    const low=Math.min(...values),high=Math.max(...values),room=Math.max(2,(high-low)*.18);
    const min=Math.max(1,Math.floor(low-room)),max=Math.ceil(high+room);
    return {min,max,yRatio:value=>(value-min)/(max-min)};
  }
  root.GradeReportMetrics={numeric,rank,gradeRank,series,comparison,rankScale};
})(typeof window !== 'undefined' ? window : globalThis);
