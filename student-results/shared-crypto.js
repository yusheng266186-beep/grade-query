"use strict";
// grade-query 双端共享的加密与凭据归一化原语。
// 查询页(index.html)与发布工作台(publisher.js)必须使用完全相同的参数，
// 本模块是唯一事实来源；任何一端都不要再私有一份实现。
// 回归测试 tools/regression.mjs 会在两端沙盒中分别加载本模块并做加密→解密往返校验。
(function (root) {
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  // PBKDF2 迭代次数：v3 寻址与密钥同源于同一次派生，猜测一组凭据必须付满全部迭代。
  const PBKDF2_ITERATIONS = 240000;

  const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const bytesToBase64 = (bytes) => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary);
  };
  const base64ToBytes = (value) => Uint8Array.from(root.atob(value), (char) => char.charCodeAt(0));

  async function sha256Hex(value) {
    const digest = await root.crypto.subtle.digest("SHA-256", textEncoder.encode(value));
    return bytesToHex(new Uint8Array(digest));
  }

  function canonicalStudentName(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
  }

  function canonicalStudentId(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").trim().toUpperCase();
  }

  function buildStudentSecret(name, id) {
    return `${canonicalStudentName(name)}|${canonicalStudentId(id)}`;
  }

  // v3：记录地址(fileId)与加密密钥同源于同一次 PBKDF2 派生。
  // 地址不再是裸 SHA-256(姓名|识别码)，离线枚举的验证成本与解密成本相同。
  // 盐由凭据确定性派生（无需服务端存储），仅用于阻断彩虹表。
  async function deriveV3Keyring(secret) {
    const salt = new Uint8Array(await root.crypto.subtle.digest("SHA-256", textEncoder.encode(`grade-query-v3-salt|${secret}`)));
    const material = await root.crypto.subtle.importKey("raw", textEncoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await root.crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      material,
      512,
    ));
    return { fileId: bytesToHex(bits.slice(0, 32)), encBits: bits.slice(32, 64), saltB64: bytesToBase64(salt) };
  }

  const importV3Key = (encBits, usages) => root.crypto.subtle.importKey("raw", encBits, "AES-GCM", false, usages);

  // 发布端：v3 加密一条学生记录，返回 [fileId, {v:3, salt, iv, data}]
  async function encryptV3Record(student) {
    const secret = buildStudentSecret(student.name, student.studentId);
    const keyring = await deriveV3Keyring(secret);
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const data = await root.crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await importV3Key(keyring.encBits, ["encrypt"]),
      textEncoder.encode(JSON.stringify(student)),
    );
    return [keyring.fileId, { v: 3, salt: keyring.saltB64, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) }];
  }

  // 查询端：用 keyring 解密 v3 记录
  async function decryptV3Record(keyring, encrypted) {
    const plaintext = await root.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) },
      await importV3Key(keyring.encBits, ["decrypt"]),
      base64ToBytes(encrypted.data),
    );
    return JSON.parse(textDecoder.decode(plaintext));
  }

  // 查询端：解密历史 v1/v2 记录（{v:1|2, salt, iv, data}，密钥由 secret + 记录内盐派生）
  async function decryptLegacyRecord(secret, encrypted) {
    const material = await root.crypto.subtle.importKey("raw", textEncoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
    const key = await root.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: base64ToBytes(encrypted.salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plaintext = await root.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) },
      key,
      base64ToBytes(encrypted.data),
    );
    return JSON.parse(textDecoder.decode(plaintext));
  }

  root.GradeQueryCrypto = {
    PBKDF2_ITERATIONS,
    sha256Hex,
    canonicalStudentName,
    canonicalStudentId,
    canonicalQueryId: canonicalStudentId,
    buildStudentSecret,
    deriveV3Keyring,
    encryptV3Record,
    decryptV3Record,
    decryptLegacyRecord,
  };
})(typeof window !== "undefined" ? window : globalThis);
