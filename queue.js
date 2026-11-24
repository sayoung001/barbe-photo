/*
 * 바흐브 현장사진 — 폰 보관함 + 보내기 (화면과 서비스워커가 같이 쓴다)
 *
 * 사진 하나의 일생:
 *   찍음 → [폰에만] IndexedDB 에 원본 바이트 + sha256 를 먼저 적는다 (이게 끝나야 '찍었다' 로 본다)
 *        → [보내는 중] 창구로 보냄
 *        → [보관 확인] 창구가 드라이브에 쓴 뒤 다시 잰 sha256·크기가 폰 것과 같을 때만
 *        → 보관 확인 + keepDays 일이 지나면 폰에서 원본만 비운다 (기록은 남김)
 *   보관 확인이 아닌 사진은 어떤 경우에도 폰에서 자동으로 지우지 않는다.
 */
(function (root) {
  "use strict";

  const DB_NAME = "barbe-photo-v2";
  const DB_VER = 1;
  const STALE_SENDING_MS = 3 * 60 * 1000;   // '보내는 중' 이 이보다 오래면 끊긴 것으로 보고 다시 보낸다
  const KEEP_META_DAYS = 60;                // 원본을 비운 뒤에도 기록은 이만큼 남긴다

  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains("photos")) {
          const s = d.createObjectStore("photos", { keyPath: "id" });
          s.createIndex("created", "created");
        }
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then((d) => new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("abort"));
    }));
  }
  const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const Q = {};
  Q.put = (rec) => tx("photos", "readwrite", (s) => req(s.put(rec)));
  Q.get = (id) => tx("photos", "readonly", (s) => req(s.get(id)));
  Q.all = () => tx("photos", "readonly", (s) => req(s.getAll()));
  Q.del = (id) => tx("photos", "readwrite", (s) => req(s.delete(id)));
  Q.kvGet = (k) => tx("kv", "readonly", (s) => req(s.get(k)));
  Q.kvSet = (k, v) => tx("kv", "readwrite", (s) => req(s.put(v, k)));
  Q.settings = async () => (await Q.kvGet("settings")) || {};
  Q.saveSettings = (o) => Q.kvSet("settings", o);

  // 고칠 때는 읽고-고치고-쓰기를 한 트랜잭션에서 (화면·서비스워커가 동시에 만져도 안 깨지게)
  Q.update = (id, fn) => tx("photos", "readwrite", async (s) => {
    const cur = await req(s.get(id));
    if (!cur) return null;
    const next = fn(cur);
    if (next) await req(s.put(next));
    return next;
  });

  Q.sha256 = async (buf) => {
    const h = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  function b64(buf) {
    const u = new Uint8Array(buf);
    let s = "";
    const CH = 0x8000;
    for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
    return btoa(s);
  }

  /** 상태 판정 — 화면 글자·색은 이 값 하나로 */
  Q.state = (r, now = Date.now()) => {
    if (r.status === "stored") return "stored";
    if (r.status === "sending" && now - (r.sendingAt || 0) < STALE_SENDING_MS) return "sending";
    if (r.status === "error") return "error";
    return "local";
  };
  Q.isPending = (r) => r.status !== "stored";

  /** 다음 자동 재시도까지 기다릴 시간 */
  function backoff(tries) { return Math.min(5 * 60 * 1000, 5000 * Math.pow(2, Math.max(0, tries - 1))); }

  /** 한 장 보내기. 성공·실패 모두 레코드에 적고 결과를 돌려준다 */
  Q.sendOne = async (id, settings) => {
    // 집기: 다른 곳(서비스워커)이 이미 보내는 중이면 손대지 않는다
    const now = Date.now();
    const claimed = await Q.update(id, (r) => {
      if (!r || !r.data || Q.state(r, now) === "stored" || Q.state(r, now) === "sending") return null;
      return Object.assign({}, r, { status: "sending", sendingAt: now, tries: (r.tries || 0) + 1 });
    });
    if (!claimed) return { skipped: true };

    let res, err = "";
    try {
      const body = JSON.stringify({
        key: settings.key, id: claimed.id, name: claimed.name, folder: claimed.folder, cat: claimed.catLabel,
        mime: claimed.type, who: claimed.who, takenAt: claimed.takenAt, sha256: claimed.sha, size: claimed.size,
        data: b64(claimed.data),
      });
      const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 120000) : null;
      const r = await fetch(settings.url, {
        method: "POST", body, redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },   // 사전확인(OPTIONS) 안 생기게
        signal: ctl ? ctl.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      const text = await r.text();
      try { res = JSON.parse(text); } catch { err = "응답이 이상함 (" + r.status + ")"; }
    } catch (e) {
      err = (e && e.name === "AbortError") ? "시간 초과" : "연결 안 됨";
    }

    // 보관 확인: 창구가 드라이브에서 다시 잰 값이 폰 것과 같아야 한다
    let ok = false;
    if (res && res.ok) {
      if (res.sha256 === claimed.sha && Number(res.size) === claimed.size) ok = true;
      else err = "드라이브 사본이 폰 원본과 다름";
    } else if (res && !err) {
      err = ({ key: "비밀번호 틀림", busy: "창구가 바쁨", "hash-mismatch": "가는 길에 깨짐", "too-big": "사진이 너무 큼" })[res.error] || ("창구 거절: " + res.error);
    }

    const after = await Q.update(id, (r) => {
      if (ok) return Object.assign({}, r, {
        status: "stored", storedAt: Date.now(), fileId: res.fileId || "", path: res.path || "", dup: !!res.dup, lastError: "",
      });
      return Object.assign({}, r, {
        status: "error", lastError: err, nextTry: Date.now() + backoff(r.tries || 1),
        fatal: res && res.error === "key",
      });
    });
    return { ok, err, rec: after, fatal: !!(res && res.error === "key") };
  };

  let draining = false;
  /** 보낼 것 전부 (자동이면 기다릴 시간이 남은 것은 건너뜀). 한 장씩 차례로 — 폰 메모리·창구 잠금 때문 */
  Q.drain = async (opts = {}) => {
    if (draining) return { busy: true };
    draining = true;
    const out = { sent: 0, failed: 0 };
    try {
      const settings = await Q.settings();
      if (!settings.url || !settings.key) return { noSettings: true };
      const list = (await Q.all()).filter(Q.isPending).sort((a, b) => a.created - b.created);
      for (const r of list) {
        // force = 사람이 누름(전부) · soon = 신호가 돌아옴/앱을 다시 엶(기다림 무시, 비밀번호 틀림은 그대로) · 그 밖 = 기다림 지킴
        if (r.status === "error" && !opts.force) {
          if (r.fatal) continue;
          if (!opts.soon && (r.nextTry || 0) > Date.now()) continue;
        }
        const x = await Q.sendOne(r.id, settings);
        if (x.skipped) continue;
        if (x.ok) out.sent++; else out.failed++;
        if (opts.onProgress) opts.onProgress(x);
        if (x.fatal) break;                         // 비밀번호가 틀리면 나머지도 다 틀린다
        if (!x.ok && x.err === "연결 안 됨") break;   // 신호 없음 — 다음 기회에
      }
    } finally {
      draining = false;
    }
    return out;
  };

  /** 보관 확인된 지 keepDays 가 지난 원본만 비운다. 기록은 KEEP_META_DAYS 까지 */
  Q.cleanup = async (keepDays) => {
    const now = Date.now();
    const day = 86400000;
    const keep = Math.max(1, Number(keepDays) || 7);
    let freed = 0, dropped = 0;
    for (const r of await Q.all()) {
      if (r.status !== "stored") continue;            // ★ 확인 안 된 것은 절대 손대지 않음
      if (r.data && now - r.storedAt > keep * day) {
        await Q.update(r.id, (x) => (x.status === "stored" ? Object.assign({}, x, { data: null, purgedAt: now }) : null));
        freed++;
      } else if (!r.data && now - r.storedAt > KEEP_META_DAYS * day) {
        await Q.del(r.id);
        dropped++;
      }
    }
    return { freed, dropped };
  };

  /** 대조: 창구 수신기록에 없는 '보관 확인' 사진은 다시 보낼 것으로 돌린다 */
  Q.reconcile = async (dateYmd) => {
    const s = await Q.settings();
    const u = s.url + (s.url.includes("?") ? "&" : "?") + "list=1&key=" + encodeURIComponent(s.key) +
      "&who=" + encodeURIComponent(s.name || "") + "&date=" + dateYmd;
    const r = await fetch(u, { redirect: "follow" });
    const j = JSON.parse(await r.text());
    if (!j.ok) throw new Error(j.error || "대조 실패");
    const onServer = new Set(j.ids || []);
    const mine = (await Q.all()).filter((x) => x.name && x.name.startsWith(dateYmd + "_") && x.who === (s.name || ""));
    let missing = 0, lost = 0;
    for (const x of mine) {
      if (x.status === "stored" && !onServer.has(x.id)) {
        if (x.data) {
          await Q.update(x.id, (y) => Object.assign({}, y, { status: "local", lastError: "대조: 드라이브 기록에 없음 → 다시 보냄", tries: 0 }));
          missing++;
        } else lost++;
      }
    }
    return { server: onServer.size, phone: mine.length, missing, lost };
  };

  root.BarbeQ = Q;
})(typeof self !== "undefined" ? self : window);
