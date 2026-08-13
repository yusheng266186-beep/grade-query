import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";

class StubElement {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.hidden = false;
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.files = [];
    this.className = "";
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  addEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  focus() {}
  click() {}
  scrollIntoView() {}
  querySelector(selector) { return selector === "tbody" ? new StubElement("tbody") : new StubElement(); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { width: 800, height: 260, left: 0, top: 0 }; }
}

function makeDom() {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new StubElement(id));
    return elements.get(id);
  };
  const document = {
    title: "",
    body: { contains() { return true; } },
    getElementById: get,
    createElement: (tag) => new StubElement(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { document, elements, get };
}

function baseSandbox(document, fetchImpl = async () => ({ ok: false, text: async () => "", json: async () => null })) {
  const sandbox = {
    AbortController,
    Blob,
    TextDecoder,
    TextEncoder,
    URL,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    btoa: (value) => Buffer.from(value, "binary").toString("base64"),
    clearTimeout,
    console,
    crypto: webcrypto,
    document,
    fetch: fetchImpl,
    isSecureContext: true,
    requestAnimationFrame: (callback) => callback(Date.now()),
    setTimeout,
    structuredClone,
  };
  sandbox.window = sandbox;
  sandbox.scrollTo = () => {};
  return sandbox;
}

const publisherDom = makeDom();
const publisherSandbox = baseSandbox(publisherDom.document);
vm.createContext(publisherSandbox);
const publisherSource = fs.readFileSync(new URL("../publisher.js", import.meta.url), "utf8");
vm.runInContext(`${publisherSource}\n;globalThis.__publisher = {
  normalizeExam, validateExam, projectFromExam, mergeExamIntoProject, getMergePreview,
  renderReview, currentProject, buildEncryptedBundle, sha256Hex, uploadRelease,
  get state() { return state; }
};`, publisherSandbox);
const publisher = publisherSandbox.__publisher;

const template = JSON.parse(fs.readFileSync(new URL("../templates/exam-template.json", import.meta.url), "utf8"));
const sampleExam = publisher.normalizeExam(template);
assert.match(publisher.validateExam(sampleExam).errors.join("\n"), /模板示例学生/);

const cleanInput = structuredClone(template);
cleanInput.exam = { ...cleanInput.exam, examId: "2026-first", examName: "第一次月考", note: "" };
cleanInput.students[0] = { ...cleanInput.students[0], studentId: "S24001", name: "学生甲" };
cleanInput.students[1] = { ...cleanInput.students[1], studentId: "S24002", name: "学生乙" };
cleanInput.knowledge[0].studentId = "S24001";
const firstExam = publisher.normalizeExam(cleanInput);
assert.equal(publisher.validateExam(firstExam).errors.length, 0);

publisher.state.exam = firstExam;
publisher.state.project = null;
const firstProject = publisher.currentProject();
assert.equal(firstProject.exams.length, 1, "首次项目不应重复合并同一场考试");
assert.equal(firstProject.students.length, 2);

const nextInput = structuredClone(cleanInput);
nextInput.exam = { ...nextInput.exam, examId: "2026-mid", examName: "期中测试", examDate: "2026-08-12" };
nextInput.students = [{ ...nextInput.students[0], name: "学生甲（更正）", totalScore: 470 }];
nextInput.knowledge = [];
const nextExam = publisher.normalizeExam(nextInput);
publisher.state.project = firstProject;
publisher.state.exam = nextExam;
publisher.state.projectWarnings = [];
const mergePreview = publisher.getMergePreview(nextExam);
assert.equal(mergePreview.examCount, 2);
assert.equal(mergePreview.missingStudentCount, 1);
publisher.renderReview();
assert.match(publisherDom.get("messageStack").innerHTML, /历史学生/);
assert.match(publisherDom.get("messageStack").innerHTML, /姓名不同/);

const mergedProject = publisher.currentProject();
assert.equal(mergedProject.exams.length, 2);
assert.equal(mergedProject.students.length, 2);
assert.equal(mergedProject.students.find((student) => student.studentId === "S24002").exams.length, 1);

const release = await publisher.buildEncryptedBundle(mergedProject);
assert.equal(release.bundle.recordCount, 2);
assert.equal(release.bundle.studentCount, 2);
assert.equal(release.version.bundleSha256, await publisher.sha256Hex(JSON.stringify(release.bundle)));

publisher.state.generated = { project: mergedProject, ...release };
publisherDom.get("githubRepo").value = "example/grade-query";
publisherDom.get("githubBranch").value = "main";
publisherDom.get("githubToken").value = "github_pat_test_only";
let blobIndex = 0;
publisherSandbox.fetch = async (url, options = {}) => {
  const method = options.method || "GET";
  let body;
  if (url.includes("/git/ref/heads/")) body = { object: { sha: "head-sha" } };
  else if (url.endsWith("/git/commits/head-sha")) body = { tree: { sha: "base-tree" } };
  else if (url.endsWith("/git/blobs") && method === "POST") body = { sha: `blob-${++blobIndex}` };
  else if (url.endsWith("/git/trees") && method === "POST") body = { sha: "release-tree" };
  else if (url.endsWith("/git/commits") && method === "POST") body = { sha: "release-commit", html_url: "https://github.com/example/grade-query/commit/release-commit" };
  else if (url.includes("/git/refs/heads/") && method === "PATCH") body = {};
  else if (url.includes("/contents/data/version.json")) body = { content: Buffer.from(JSON.stringify(release.version)).toString("base64") };
  else if (url.endsWith("/pages")) body = { html_url: "https://example.github.io/grade-query/" };
  else return { ok: false, status: 404, text: async () => JSON.stringify({ message: "unhandled mock route" }) };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};
await publisher.uploadRelease();
assert.equal(blobIndex, 2);
assert.match(publisherDom.get("uploadStatus").textContent, /上传成功/);
assert.equal(publisherDom.get("githubToken").value, "");
assert.equal(publisherDom.get("pagesLink").href, "https://example.github.io/grade-query/");

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const querySource = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(querySource, "index.html 内联脚本应存在");

function makeQueryHarness(version) {
  const queryDom = makeDom();
  const fetchImpl = async (url) => {
    const path = String(url);
    if (path.includes("version.json")) return { ok: true, json: async () => version, text: async () => JSON.stringify(version) };
    if (path.includes("grade-data.v2.json")) return { ok: true, json: async () => release.bundle, text: async () => JSON.stringify(release.bundle) };
    return { ok: false, json: async () => null, text: async () => "" };
  };
  const sandbox = baseSandbox(queryDom.document, fetchImpl);
  vm.createContext(sandbox);
  vm.runInContext(`${querySource}\n;globalThis.__query = {
    loadVersionInfo, loadDataBundle, loadStudent, createInsights, rankTimeline,
    get activeDataMeta() { return activeDataMeta; }
  };`, sandbox);
  return { query: sandbox.__query, dom: queryDom };
}

const goodVersion = structuredClone(release.version);
const goodHarness = makeQueryHarness(goodVersion);
await goodHarness.query.loadVersionInfo();
assert.equal(goodHarness.dom.get("queryTitle").textContent, "期中测试成绩报告");
assert.match(goodHarness.dom.document.title, /期中测试成绩报告/);
const decrypted = await goodHarness.query.loadStudent("学生甲（更正）", "s24001");
assert.equal(decrypted.currentExamId, "2026-mid");
assert.equal(decrypted.exams.length, 2);
assert.doesNotMatch(goodHarness.query.createInsights(decrypted).map((item) => item.text).join("\n"), /零诊|六次/);
assert.match(goodHarness.query.rankTimeline(decrypted), /第一次月考/);

const badVersion = structuredClone(release.version);
badVersion.bundleSha256 = "0".repeat(64);
const badHarness = makeQueryHarness(badVersion);
await assert.rejects(() => badHarness.query.loadDataBundle(), (error) => error?.code === "DATA_UPDATING");
badVersion.bundleSha256 = release.version.bundleSha256;
assert.equal((await badHarness.query.loadDataBundle()).recordCount, 2, "版本同步后应允许重试");

console.log("Regression checks passed: template guard, merge, encryption, GitHub upload, dynamic metadata, decryption, integrity retry.");
