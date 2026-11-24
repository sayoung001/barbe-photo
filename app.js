/*
 * 바흐브 현장사진 v2.0 — 웹앱 안에서 찍고, 드라이브에 보관될 때까지 폰이 들고 있는다.
 * 저장·보내기·지우기 규칙은 queue.js 에 있다. 여기는 화면만.
 */
(() => {
  "use strict";
  const VERSION = "2.3.1";
  const Q = window.BarbeQ;
  const RD = window.BarbeRead;
  const READ_CFG = window.BARBE_READ || { maxEdge: 1600 };
  const CATS = window.BARBE_CATEGORIES || [];
  const OLD_PENDING_MS = 2 * 60 * 60 * 1000;   // 폰에만 2시간 넘게 있으면 빨간 띠

  const $ = (id) => document.getElementById(id);
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const hms = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, "").replace(/\.\.+/g, ".").trim();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}${Math.random()}`).replace(/[^a-f0-9]/gi, "").slice(0, 16);
  const fmtTime = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

  let settings = {};
  let sel = { cat: null, sub: null, ask: "" };
  let recs = [];
  const thumbs = new Map();   // id → objectURL
  let viewing = null;

  let toastT = null;
  function toast(msg, ms = 2800) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---------- 설정 링크: …#s=base64url({u,k}) ----------
  const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const b64d = (s) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0))); };
  async function readSetupHash(text) {
    const m = String(text || location.hash).match(/[#&]s=([A-Za-z0-9_-]+)/);
    if (!m) return false;
    try {
      const o = JSON.parse(b64d(m[1]));
      if (o.u) settings.url = o.u;
      if (o.k) settings.key = o.k;
      await Q.saveSettings(settings);
      if (!text) history.replaceState(null, "", location.pathname + location.search);
      return true;
    } catch { return false; }
  }
  const setupLink = () => `${location.href.split("#")[0]}#s=${b64e(JSON.stringify({ u: settings.url || "", k: settings.key || "" }))}`;
  const configured = () => !!(settings.url && settings.key && settings.name);

  // ---------- 종류 고르기 ----------
  const curCat = () => CATS.find((c) => c.id === sel.cat) || null;
  function folderFor(cat, date) {
    const sub = (cat.subs || []).find((s) => s.label === sel.sub);
    return cat.folder
      .replace(/\{sub\}/g, sub ? sub.folder : "")          // 세부 폴더에도 {MMDD} 를 쓸 수 있게 먼저 (BSCW/{MMDD}/7일)
      .replace(/\{MMDD\}/g, ymd(date).slice(4))
      .replace(/\{YYYYMMDD\}/g, ymd(date))
      .replace(/\{ask\}/g, safe(sel.ask));
  }
  function whyBlocked() {
    if (!configured()) return "설정 먼저";
    const c = curCat();
    if (!c) return "종류를 먼저 고르세요";
    if (c.subs && !sel.sub) return "세부를 고르세요";
    if (c.ask && !safe(sel.ask)) return `${c.ask.label}을 적으세요`;
    return "";
  }
  function renderCats() {
    $("cats").innerHTML = "";
    for (const c of CATS) {
      const b = document.createElement("button");
      b.className = "cat" + (sel.cat === c.id ? " on" : "");
      b.innerHTML = `<span class="i">${c.icon || "📷"}</span>${c.label}`;
      b.onclick = () => { if (sel.cat !== c.id) { sel = { cat: c.id, sub: null, ask: "" }; $("askInput").value = ""; } persistSel(); renderPick(); };
      $("cats").appendChild(b);
    }
  }
  function renderPick() {
    renderCats();
    const c = curCat();
    $("subs").innerHTML = "";
    if (c && c.subs) for (const s of c.subs) {
      const b = document.createElement("button");
      b.className = "sub" + (sel.sub === s.label ? " on" : "");
      b.textContent = s.label;
      b.onclick = () => { sel.sub = s.label; persistSel(); renderPick(); };
      $("subs").appendChild(b);
    }
    $("askBox").classList.toggle("hidden", !(c && c.ask));
    if (c && c.ask) { $("askInput").placeholder = `${c.ask.label} — ${c.ask.placeholder || ""}`; $("askInput").value = sel.ask || ""; }
    $("hint").textContent = c && c.hint ? c.hint : "";
    const why = whyBlocked();
    $("dest").textContent = c && !why ? `→ ${folderFor(c, new Date())}` : "";
    $("btnCam").disabled = !!why;
    $("btnCam").textContent = why ? why : "📷 촬영";
  }
  function persistSel() { settings.lastSel = sel; Q.saveSettings(settings); }

  // ---------- 사진 넣기 (★ 폰 저장이 끝나야 '찍었다') ----------
  async function addFiles(fileList, fromCamera) {
    const files = Array.from(fileList || []).filter((f) => f && (/^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name)));
    if (!files.length) return;
    const c = curCat();
    if (!c || whyBlocked()) { toast("종류를 먼저 고르세요"); return; }
    let saved = 0;
    for (const f of files) {
      try {
        const data = await f.arrayBuffer();
        if (!data.byteLength) throw new Error("빈 사진");
        // 찍은 시각: 앱 안 카메라는 셔터 누른 순간(파일 시각), 기본 카메라는 지금. 앨범에서 고른 것은 파일 시각(10년 이내일 때)
        const now = Date.now();
        const t = fromCamera === "app" && f.lastModified ? f.lastModified
          : fromCamera || !f.lastModified || Math.abs(now - f.lastModified) > 3650 * 86400000 ? now : f.lastModified;
        const d = new Date(t);
        const id = uid();
        const ext = (f.name.match(/\.([A-Za-z0-9]+)$/) || [, f.type === "image/png" ? "png" : "jpg"])[1].toLowerCase();
        const rec = {
          id, data, size: data.byteLength, type: f.type || "image/jpeg", sha: await Q.sha256(data),
          name: `${ymd(d)}_${hms(d)}_${safe(settings.name) || "폰"}_${id.slice(0, 6)}.${ext}`,
          folder: folderFor(c, d), catLabel: c.label + (sel.sub ? " " + sel.sub : ""),
          who: settings.name || "", takenAt: d.toISOString(), camera: !!fromCamera,
          created: now, status: "local", tries: 0,
          read: c.read && RD.board(c.read) ? { status: "wait", board: c.read, tries: 0 } : null,
        };
        await Q.put(rec);
        // 읽어서 확인: 쓴 바이트가 그대로 있는지
        const back = await Q.get(id);
        if (!back || !back.data || back.data.byteLength !== rec.size) throw new Error("폰 저장 확인 실패");
        saved++;
      } catch (e) {
        toast(`⚠ 폰에 저장 못 함: ${e.message || e} — 다시 찍어 주세요`, 6000);
      }
    }
    if (saved) {
      toast(`✓ ${saved}장 폰에 저장 · 보내는 중…`);
      askPersist();
    }
    await refresh();
    kick();
    return saved;
  }

  // ---------- 저장소 지키기 ----------
  async function askPersist() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    try {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    } catch { return false; }
  }
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

  async function renderBanners() {
    $("bnSetup").classList.toggle("hidden", configured());
    $("bnInstall").classList.toggle("hidden", !(isIOS && !standalone()));
    // 저장 공간
    const bs = $("bnStorage");
    bs.classList.add("hidden");
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        const left = (e.quota || 0) - (e.usage || 0);
        if (e.quota && left < 300 * 1024 * 1024) {
          bs.textContent = `폰 저장 공간이 ${Math.max(0, Math.round(left / 1048576))}MB 남았어요. 신호 있는 곳에서 [지금 보내기]를 눌러 주세요.`;
          bs.classList.remove("hidden");
        }
      } catch {}
    }
    // 오래 못 보낸 사진
    const old = recs.filter((r) => Q.isPending(r) && Date.now() - r.created > OLD_PENDING_MS);
    const bo = $("bnOld");
    bo.classList.toggle("hidden", !old.length);
    if (old.length) {
      const errs = [...new Set(old.map((r) => r.lastError).filter(Boolean))].join(" · ");
      bo.innerHTML = `<b>${old.length}장이 2시간 넘게 폰에만 있어요.</b> ${errs ? "(" + errs + ")" : ""}<br>` +
        `신호 있는 곳에서 [지금 보내기]. 계속 안 되면 설정 → <b>못 보낸 사진 폰에 꺼내기</b>로 앨범에도 남겨 두세요.`;
    }
  }

  // ---------- 목록 ----------
  async function refresh() {
    recs = (await Q.all()).sort((a, b) => b.created - a.created);
    const now = Date.now();
    const st = { local: 0, sending: 0, stored: 0, error: 0 };
    for (const r of recs) st[Q.state(r, now)]++;
    const phone = st.local + st.sending;
    $("stPhone").querySelector("b").textContent = phone + st.error;
    $("stPhone").classList.toggle("zero", phone + st.error === 0);
    const today = ymd(new Date());
    $("stStored").querySelector("b").textContent = recs.filter((r) => r.status === "stored" && r.name.startsWith(today)).length;
    $("stStored").querySelector("span").textContent = "오늘 보관 확인";
    $("stErr").querySelector("b").textContent = st.error;
    $("stErr").classList.toggle("zero", st.error === 0);

    // 보이는 것: 안 끝난 것 전부 + 오늘 것 + 최근 40장
    const shown = recs.filter((r, i) => Q.isPending(r) || r.name.startsWith(today) || i < 40).slice(0, 120);
    const list = $("list");
    list.innerHTML = "";
    const live = new Set();
    for (const r of shown) {
      const s = Q.state(r, now);
      const b = document.createElement("button");
      b.className = "ph";
      b.dataset.id = r.id;
      let url = thumbs.get(r.id);
      if (!url && r.data) { url = URL.createObjectURL(new Blob([r.data], { type: r.type })); thumbs.set(r.id, url); }
      if (url) live.add(r.id);
      const label = { local: "폰에만", sending: "보내는 중", stored: "보관 ✓", error: "실패" }[s];
      let avg = "";
      if (r.read && r.read.status === "done") {
        const a = RD.averages(r.read.board, RD.shown(r.read));
        if (a && a.overall != null) avg = `<span class="avg">${RD.fmt(a.overall, a.dec)}</span>`;
      } else if (r.read && (r.read.status === "wait" || r.read.status === "reading")) avg = `<span class="avg">🔎</span>`;
      b.innerHTML = (url ? `<img src="${url}" alt="" loading="lazy">` : `<div class="noimg">${r.catLabel}<br>${fmtTime(r.created)}</div>`) +
        `<span class="badge b-${s}">${label}</span>` + avg;
      b.onclick = () => openView(r.id);
      list.appendChild(b);
    }
    for (const [id, url] of thumbs) if (!live.has(id)) { URL.revokeObjectURL(url); thumbs.delete(id); }
    $("empty").classList.toggle("hidden", shown.length > 0);
    $("listInfo").textContent = shown.length ? `(${shown.length})` : "";
    renderReadBox();
    await renderBanners();
    syncTag();
  }

  // ---------- 보기 ----------
  async function openView(id) {
    const r = await Q.get(id);
    if (!r) return;
    viewing = id;
    const s = Q.state(r);
    $("vImg").src = thumbs.get(id) || "";
    $("vImg").classList.toggle("hidden", !r.data);
    const stText = { local: "폰에만 있음 (아직 드라이브에 없음)", sending: "보내는 중", stored: "드라이브 보관 확인", error: "보내기 실패" }[s];
    $("vMeta").innerHTML =
      `<b>${stText}</b>${r.lastError ? " — " + r.lastError : ""}<br>` +
      `${r.catLabel} · ${fmtTime(Date.parse(r.takenAt))} · ${(r.size / 1048576).toFixed(1)}MB<br>` +
      `드라이브: 바흐브_폰사진/${r.folder}/${r.name}` +
      (r.status === "stored" ? `<br>확인 ${fmtTime(r.storedAt)}${r.dup ? " (이미 있던 사본)" : ""}${r.data ? "" : " · 폰 원본은 비움"}` : "") +
      `<br><small class="mono">sha256 ${r.sha.slice(0, 16)}…</small>`;
    $("vRead").dataset.rid = r.id;
    $("vRead").innerHTML = r.read ? RD.card(r.read.board, r.read) : "";
    $("vReread").classList.toggle("hidden", !(r.read && r.data && r.read.status !== "reading"));
    $("vDel").classList.toggle("hidden", r.status === "stored");
    $("vSend").classList.toggle("hidden", r.status === "stored" || s === "sending");
    $("dlgView").showModal();
  }
  $("vClose").onclick = () => $("dlgView").close();
  $("vReread").onclick = async () => {
    await Q.update(viewing, (r) => Object.assign({}, r, { read: Object.assign({}, r.read, { status: "wait", fatal: false, err: "" }) }));
    toast("다시 읽어요"); kick(true);
    setTimeout(() => { if ($("dlgView").open) openView(viewing); }, 300);
  };
  $("vSend").onclick = async () => {
    await Q.update(viewing, (r) => Object.assign({}, r, { status: "local", nextTry: 0, fatal: false }));
    $("dlgView").close(); await refresh(); kick(true);
  };
  $("vDel").onclick = async () => {
    const r = await Q.get(viewing);
    if (!r || r.status === "stored") return;
    if (!confirm("이 사진은 아직 드라이브에 없어요.\n지우면 되살릴 수 없어요. 지울까요?")) return;
    await Q.del(viewing);
    $("dlgView").close(); toast("지웠어요"); await refresh();
  };

  // ---------- 보내기 ----------
  let kicking = false;
  async function kick(force, soon) {
    if (kicking || !configured()) return;
    kicking = true;
    try {
      await runReads(force, soon);      // 숫자는 작은 사본으로 먼저 — 원본 보관은 그 뒤
      const out = await Q.drain({ force, soon, onProgress: () => refresh() });
      await sendFixes();
      if (out.sent) toast(`✓ ${out.sent}장 드라이브 보관 확인`);
      else if (force && out.failed) toast("보내지 못했어요 — 신호를 확인하고 다시 눌러 주세요", 4000);
      await Q.cleanup(settings.keepDays || 7);
    } catch (e) {
      console.warn(e);
    } finally {
      kicking = false;
      await refresh();
    }
  }
  $("btnRetry").onclick = async () => {
    for (const r of recs) if (r.status === "error") await Q.update(r.id, (x) => Object.assign({}, x, { nextTry: 0, fatal: false }));
    kick(true);
  };
  // 안드로이드 크롬: 앱을 닫아도 신호가 잡히면 서비스워커가 이어서 보낸다
  async function syncTag() {
    try {
      if (!recs.some(Q.isPending)) return;
      const reg = await navigator.serviceWorker?.ready;
      if (reg && reg.sync) await reg.sync.register("barbe-send");
    } catch {}
  }

  // ---------- 칠판 읽기 ----------
  const READ_STALE_MS = 3 * 60 * 1000;
  function readDue(r, force, soon) {
    const x = r.read;
    if (!x || !r.data) return false;
    if (x.status === "wait") return true;
    if (x.status === "reading") return Date.now() - (x.at || 0) > READ_STALE_MS;
    if (x.status === "error") return force || (!x.fatal && (soon || (x.nextTry || 0) <= Date.now()));
    return false;
  }
  async function postJson(obj) {
    const r = await fetch(settings.url, { method: "POST", redirect: "follow", body: JSON.stringify(obj),
      headers: { "Content-Type": "text/plain;charset=utf-8" } });
    return JSON.parse(await r.text());
  }
  async function readOne(id) {
    const claimed = await Q.update(id, (r) => (r.read && readDue(r, true, true)
      ? Object.assign({}, r, { read: Object.assign({}, r.read, { status: "reading", at: Date.now(), tries: (r.read.tries || 0) + 1 }) }) : null));
    if (!claimed) return null;
    await refresh();
    let res = null, err = "", fatal = false;
    try {
      const image = await RD.shrink(claimed.data, claimed.type, READ_CFG.maxEdge || 1600);
      res = await postJson({ action: "read", key: settings.key, id, board: claimed.read.board, image,
        who: settings.name || "", year: new Date(Date.parse(claimed.takenAt)).getFullYear() });
    } catch (e) { err = "연결 안 됨"; }
    let merged = null;
    if (res && res.ok) merged = RD.merge(claimed.read.board, res.results);
    if (res && !merged) {
      err = ({ "no-api-key": "창구에 판독 키가 없음 (설치안내 5)", key: "비밀번호 틀림", "no-board": "창구의 Boards.gs 가 옛것",
               "read-failed": "두 모델 모두 못 읽음" })[res.error] || ("판독 실패: " + (res.error || "?"));
      fatal = res.error === "no-api-key" || res.error === "key" || res.error === "no-board";
    }
    const after = await Q.update(id, (r) => Object.assign({}, r, { read: Object.assign({}, r.read, merged
      ? { status: "done", merged, err: merged.failed.length ? "한 모델 실패: " + merged.failed.join(", ") : "", doneAt: Date.now() }
      : { status: "error", err, fatal, nextTry: Date.now() + Math.min(300000, 10000 * Math.pow(2, (r.read.tries || 1) - 1)) }) }));
    await refresh();
    if (merged && after) {
      const ck = RD.checks(after.read.board, after.read);
      toast(`🔎 ${RD.summary(after.read.board, after.read) || "칠판 숫자 없음"}${ck.length ? " · ⚠ 확인 " + ck.length + "건" : ""}`, 6000);
    }
    return after;
  }
  let reading = false;
  async function runReads(force, soon) {
    if (reading) return;
    reading = true;
    try {
      const list = (await Q.all()).filter((r) => readDue(r, force, soon)).sort((a, b) => a.created - b.created);
      for (const r of list) {
        const x = await readOne(r.id);
        if (x && x.read && x.read.status === "error" && (x.read.fatal || x.read.err === "연결 안 됨")) break;
      }
    } finally { reading = false; }
  }
  async function sendFixes() {
    for (const r of await Q.all()) {
      if (!r.read || !r.read.fixPending) continue;
      try {
        const j = await postJson({ action: "fix", key: settings.key, id: r.id, board: r.read.board, who: settings.name || "",
          values: r.read.fixed, note: RD.summary(r.read.board, r.read) });
        if (j.ok) await Q.update(r.id, (x) => Object.assign({}, x, { read: Object.assign({}, x.read, { fixPending: false }) }));
      } catch { break; }
    }
  }
  /** 숫자 칸 눌러 고치기 */
  async function editCell(id, key) {
    const r = await Q.get(id);
    if (!r || !r.read) return;
    const b = RD.board(r.read.board);
    const f = b && b.fields.find((x) => x.key === key);
    if (!f) return;
    const cur = RD.shown(r.read)[key];
    const dis = (r.read.merged && r.read.merged.disagree[key]) || [];
    const hint = dis.length ? `\n(다른 모델: ${dis.map((d) => (d.value == null ? "빈칸" : d.value)).join(", ")})` : "";
    const ans = prompt(`${f.label} — 사진의 칠판과 맞춰 고치세요. 비우면 빈칸${hint}`, cur == null ? "" : String(cur));
    if (ans === null) return;
    let val = null;
    if (ans.trim() !== "") {
      val = f.type === "number" ? RD.num(ans) : ans.trim();
      if (f.type === "number" && val === null) { toast("숫자로 적어 주세요"); return; }
    }
    await Q.update(id, (x) => Object.assign({}, x, { read: Object.assign({}, x.read, {
      fixed: Object.assign({}, x.read.fixed || {}, { [key]: val }), fixPending: true }) }));
    await refresh();
    if (viewing === id) openView(id);
    kick();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".cv");
    if (!b) return;
    const host = b.closest("[data-rid]");
    if (host) editCell(host.dataset.rid, b.dataset.k);
  });
  function renderReadBox() {
    const box = $("readBox");
    const today = ymd(new Date());
    const r = recs.find((x) => x.read && x.name.startsWith(today));
    if (!r) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden");
    box.dataset.rid = r.id;
    box.innerHTML = `<div class="rh">🔎 방금 칠판 <small>${fmtTime(r.created)} · ${r.catLabel}</small></div>` + RD.card(r.read.board, r.read);
  }

  // ---------- 촬영 ----------
  // v2.3 (2026-11-24): 앱 안 카메라 — 폰 기본 카메라의 '다시 찍기 / 사진 사용' 확인 없이 셔터를 누르면 바로 폰 보관함에.
  // 저장은 기본 카메라와 같은 addFiles 한 길. 앱 카메라가 안 되면(없음·권한 거부) 예전 기본 카메라(#inCam).
  // ⚙︎ '앱 카메라로 바로 저장' 을 끄면 예전 방식 그대로 (되돌리기).
  const cam = { open: false, gen: 0, stream: null, track: null, shots: [], chain: Promise.resolve(),
                saved: 0, failed: 0, pending: 0, torch: false, lastUrl: "" };
  const camOK = () => !settings.nativeCam && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  function camMsg(t, bad) { $("camMsg").textContent = t; $("camMsg").classList.toggle("bad", !!bad); }
  function camStatus() {
    $("camCount").textContent = cam.shots.length ? `이번에 ${cam.shots.length}장` : "";
    if (cam.pending) camMsg(`폰에 저장하는 중… ${cam.pending}`);
    else if (cam.failed) camMsg(`⚠ ${cam.failed}장 폰 저장 실패 — 다시 찍어 주세요 · ✓ ${cam.saved}장 저장`, true);
    else camMsg(cam.saved ? `✓ 폰에 저장 ${cam.saved}장 — 신호 있으면 드라이브로 보내요` : "셔터를 누르면 바로 저장돼요");
  }
  function camStop() {
    if (cam.stream) cam.stream.getTracks().forEach((t) => t.stop());
    cam.stream = null; cam.track = null; cam.torch = false;
    $("camVideo").srcObject = null;
    $("camShot").disabled = true;
  }
  async function camStart() {
    camStop();
    const my = ++cam.gen;
    $("camErr").classList.add("hidden");
    $("camTorch").classList.add("hidden");
    camMsg("카메라 켜는 중…");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
      if (my !== cam.gen || !cam.open) { s.getTracks().forEach((t) => t.stop()); return; }   // 그새 닫았거나 다시 켬
      cam.stream = s; cam.track = s.getVideoTracks()[0];
      const v = $("camVideo");
      v.srcObject = s;
      await v.play().catch(() => {});
      try {
        const caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
        if ((caps.focusMode || []).includes("continuous")) cam.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
        $("camTorch").classList.toggle("hidden", !caps.torch);
      } catch {}
      $("camShot").disabled = false;
      camStatus();
    } catch (e) {
      if (my !== cam.gen || !cam.open) return;
      camStop();
      $("camErrMsg").textContent = e && e.name === "NotAllowedError"
        ? "카메라 권한이 꺼져 있어요. 폰 설정에서 사파리/크롬의 카메라를 허용하거나, 아래 단추로 기본 카메라를 쓰세요."
        : `카메라를 켜지 못했어요 (${(e && e.name) || e}). 아래 단추로 기본 카메라를 쓰세요.`;
      $("camErr").classList.remove("hidden");
      camMsg("");
    }
  }
  function camOpen() {
    const c = curCat();
    cam.open = true; cam.shots = []; cam.saved = 0; cam.failed = 0;
    $("camDest").textContent = `${c.label}${sel.sub ? " " + sel.sub : ""} → ${folderFor(c, new Date())}`;
    $("camAlbum").checked = !!settings.toAlbum;
    $("camLast").classList.add("hidden");
    $("camView").classList.remove("hidden");
    document.body.classList.add("camOn");
    try { history.pushState({ barbeCam: 1 }, ""); } catch {}
    camStatus();
    camStart();
  }
  /** 닫기 — 사진첩 저장은 누른 손길 안에서 바로 (기다리면 아이폰이 공유창을 막는다) */
  function camClose(fromPop) {
    if (!cam.open) return;
    if ($("camAlbum").checked && cam.shots.length) {
      const ready = cam.shots.filter((s) => s.file).map((s) => s.file);
      const late = cam.shots.filter((s) => !s.file);
      if (ready.length) toAlbum(ready);
      // 닫기 직전에 찍어 아직 JPEG 가 덜 된 것 — 다 되면 띠로 한 번 더 누르게 (손길 없이는 공유창이 막힌다)
      if (late.length) Promise.all(late.map((s) => s.ready)).then((fs) => { fs = fs.filter(Boolean); if (fs.length) offerAlbum(fs); });
    }
    cam.open = false; cam.gen++;
    camStop();
    $("camView").classList.add("hidden");
    document.body.classList.remove("camOn");
    if (cam.lastUrl) { URL.revokeObjectURL(cam.lastUrl); cam.lastUrl = ""; }
    if (!fromPop && history.state && history.state.barbeCam) history.back();
    cam.shots = [];
  }
  async function camShoot() {
    const v = $("camVideo");
    const w = v.videoWidth, h = v.videoHeight;
    if (!cam.stream || !w || !h) return;
    const at = new Date();
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    cv.getContext("2d").drawImage(v, 0, 0, w, h);
    const fl = $("camFlash");
    fl.classList.add("on"); setTimeout(() => fl.classList.remove("on"), 90);
    try { if (navigator.vibrate) navigator.vibrate(30); } catch {}
    // 자리는 누른 순간 잡는다 — JPEG 만들기가 빨리 끝난 것이 먼저 저장되면 순서가 바뀐다
    const shot = { file: null };
    shot.ready = new Promise((res) => cv.toBlob(res, "image/jpeg", 0.92)).then((blob) => {
      if (!blob) return null;
      shot.file = new File([blob], `${ymd(at)}_${hms(at)}_바흐브.jpg`, { type: "image/jpeg", lastModified: at.getTime() });
      if (cam.open && cam.shots[cam.shots.length - 1] === shot) {
        if (cam.lastUrl) URL.revokeObjectURL(cam.lastUrl);
        cam.lastUrl = URL.createObjectURL(blob);
        $("camLast").src = cam.lastUrl; $("camLast").classList.remove("hidden");
      }
      return shot.file;
    });
    cam.shots.push(shot);
    cam.pending++; camStatus();
    // 저장은 찍은 순서대로 줄 세운다 — 셔터는 막지 않는다
    cam.chain = cam.chain.then(async () => {
      const f = await shot.ready;
      const n = f ? await addFiles([f], "app").catch(() => 0) : 0;
      cam.pending--;
      if (n) cam.saved += n; else cam.failed++;
      if (cam.open) camStatus();
    });
  }
  // 사진첩(아이폰 '사진' · 갤럭시 '갤러리')에도 — 아이폰은 공유창 '이미지 N개 저장', 그 밖은 내려받기(Download 앨범)
  function toAlbum(files) {
    const done = () => toast(`📥 사진첩으로 ${files.length}장 — 앱·드라이브 보관은 그대로예요`, 4000);
    if (isIOS && navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files })) {
          navigator.share({ files }).then(done).catch((e) => {
            if (e && e.name === "AbortError") toast("사진첩 저장을 취소했어요 — 앱·드라이브엔 그대로 있어요", 4000);
            else offerAlbum(files);
          });
          return;
        }
      } catch { offerAlbum(files); return; }
    }
    for (const f of files) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(f); a.download = f.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
    done();
  }
  let albumLater = [];
  function offerAlbum(files) {   // 공유창을 못 열었을 때 — 한 번 더 누르면 (그 손길로) 연다
    albumLater = files;
    $("bnAlbumMsg").textContent = `방금 찍은 ${files.length}장을 사진첩에 아직 못 넣었어요.`;
    $("bnAlbum").classList.remove("hidden");
  }
  $("btnAlbum").onclick = () => { const f = albumLater; albumLater = []; $("bnAlbum").classList.add("hidden"); if (f.length) toAlbum(f); };
  $("camShot").onclick = () => camShoot();
  $("camClose").onclick = () => camClose(false);
  $("camNative").onclick = () => { camClose(false); $("inCam").click(); };
  $("camAlbum").onchange = (e) => { settings.toAlbum = e.target.checked; Q.saveSettings(settings); };
  $("camTorch").onclick = () => {
    if (!cam.track) return;
    const on = !cam.torch;
    cam.track.applyConstraints({ advanced: [{ torch: on }] }).then(() => { cam.torch = on; $("camTorch").classList.toggle("on", on); }).catch(() => {});
  };
  window.addEventListener("popstate", () => { if (cam.open) camClose(true); });   // 안드로이드 [뒤로] = 카메라만 닫기
  document.addEventListener("visibilitychange", () => {
    if (!cam.open) return;
    if (document.visibilityState === "hidden") { cam.gen++; camStop(); } else camStart();
  });
  $("btnCam").onclick = () => {
    if (whyBlocked()) return;
    if (camOK()) camOpen(); else $("inCam").click();
  };
  $("inCam").onchange = async (e) => { const fl = e.target.files; await addFiles(fl, true); e.target.value = ""; };
  $("inAlbum").onchange = async (e) => { const fl = e.target.files; await addFiles(fl, false); e.target.value = ""; };
  $("lblAlbum").onclick = (e) => { if (whyBlocked()) { e.preventDefault(); toast(whyBlocked()); } };
  $("askInput").oninput = (e) => { sel.ask = e.target.value; persistSel(); renderPick(); };

  // ---------- 설정 ----------
  function openSettings() {
    $("sName").value = settings.name || "";
    $("sUrl").value = settings.url || "";
    $("sKey").value = settings.key || "";
    $("sKeep").value = settings.keepDays || 7;
    $("sAppCam").checked = !settings.nativeCam;
    $("setMsg").textContent = "";
    $("ver").textContent = `v${VERSION}`;
    storeInfo();
    $("dlgSettings").showModal();
  }
  async function storeInfo() {
    let t = "";
    try {
      const p = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const e = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {};
      t = `폰 보관함: ${((e.usage || 0) / 1048576).toFixed(0)}MB 사용` +
        (e.quota ? ` / ${(e.quota / 1048576 / 1024).toFixed(1)}GB` : "") +
        ` · 지워지지 않게 고정: ${p ? "됨 ✓" : "안 됨"}` + (isIOS ? ` · 홈 화면 앱: ${standalone() ? "예 ✓" : "아니오 ⚠"}` : "");
    } catch {}
    $("storeMsg").textContent = t;
  }
  function readForm() {
    return Object.assign({}, settings, {
      name: safe($("sName").value), url: $("sUrl").value.trim(), key: $("sKey").value.trim(),
      keepDays: Math.min(60, Math.max(1, parseInt($("sKeep").value, 10) || 7)),
      nativeCam: !$("sAppCam").checked,
    });
  }
  $("btnSettings").onclick = openSettings;
  $("btnSetClose").onclick = () => $("dlgSettings").close();
  $("btnSetSave").onclick = async () => {
    const pasted = $("sUrl").value.includes("#s=");
    if (pasted) { await readSetupHash($("sUrl").value); $("sUrl").value = settings.url || ""; $("sKey").value = settings.key || ""; }
    settings = readForm();
    await Q.saveSettings(settings);
    $("dlgSettings").close();
    renderAll(); kick(true);
  };
  $("btnPing").onclick = async () => {
    const s = readForm();
    $("setMsg").textContent = "확인 중…";
    try {
      const r = await fetch(s.url + (s.url.includes("?") ? "&" : "?") + "ping=1&key=" + encodeURIComponent(s.key), { redirect: "follow" });
      const j = JSON.parse(await r.text());
      $("setMsg").textContent = j.ok ? `✓ 연결됨 — 드라이브 '${j.folder}' 폴더 (창구 v${j.version || "?"}) · 칠판 읽기 ${j.read ? "켜짐 ✓" : "꺼짐 (판독 키·Boards.gs 없음)"}` : (j.error === "key" ? "✗ 비밀번호가 틀려요" : "✗ " + j.error);
    } catch { $("setMsg").textContent = "✗ 연결 안 됨 — 주소를 확인하세요"; }
  };
  $("btnLink").onclick = async () => {
    settings = readForm();
    const l = setupLink();
    try { await navigator.clipboard.writeText(l); $("setMsg").textContent = "✓ 설정 링크를 복사했어요. 팀원에게 카톡으로 보내세요 (비밀번호가 들어 있어요)."; }
    catch { prompt("이 링크를 복사하세요", l); }
  };
  $("btnReconcile").onclick = async () => {
    $("setMsg").textContent = "대조 중…";
    try {
      const x = await Q.reconcile(ymd(new Date()));
      $("setMsg").textContent = `오늘 내 사진 — 폰 기록 ${x.phone}장 · 드라이브 기록 ${x.server}장` +
        (x.missing ? ` · ⚠ ${x.missing}장 드라이브에 없어서 다시 보내요` : " · 빠진 것 없음 ✓") +
        (x.lost ? ` · ✗ ${x.lost}장은 폰 원본도 비워져 있어요 (드라이브 휴지통 확인)` : "");
      if (x.missing) kick(true);
    } catch (e) { $("setMsg").textContent = "✗ 대조 실패 — " + (e.message || "연결 안 됨"); }
  };
  // 비상구: 못 보낸 사진을 폰 앨범·파일로 꺼낸다 (공유창 → '이미지 저장' / '파일에 저장')
  $("btnExport").onclick = async () => {
    const pend = (await Q.all()).filter((r) => Q.isPending(r) && r.data);
    if (!pend.length) { $("setMsg").textContent = "못 보낸 사진이 없어요 ✓"; return; }
    const files = pend.map((r) => new File([r.data], r.name, { type: r.type, lastModified: Date.parse(r.takenAt) }));
    try {
      if (navigator.canShare && navigator.canShare({ files })) { await navigator.share({ files }); }
      else {
        for (const f of files) {
          const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        }
      }
      $("setMsg").textContent = `${files.length}장을 꺼냈어요. 폰 보관함에도 그대로 남아 있고, 신호가 잡히면 계속 보냅니다.`;
    } catch (e) {
      if (!e || e.name !== "AbortError") $("setMsg").textContent = "꺼내기 실패 — " + (e && e.message);
    }
  };

  // ---------- 시작 ----------
  function renderAll() {
    $("who").textContent = settings.name || "";
    renderPick();
    refresh();
  }
  window.addEventListener("beforeunload", (e) => {
    if (recs.some(Q.isPending)) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("online", () => kick(false, true));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { refresh(); kick(false, true); } });
  setInterval(() => { if (recs.some(Q.isPending)) kick(); }, 30000);
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "sent") refresh(); });
  }

  (async () => {
    settings = await Q.settings();
    // v1 설정(localStorage)을 이어받는다
    if (!settings.url) {
      try {
        const old = JSON.parse(localStorage.getItem("barbe.settings") || "{}");
        if (old.url) { settings = Object.assign({}, old, settings); await Q.saveSettings(settings); }
      } catch {}
    }
    if (await readSetupHash()) toast("설정 링크로 주소·비밀번호를 넣었어요. 이름을 적어 주세요");
    if (settings.lastSel) sel = Object.assign({ cat: null, sub: null, ask: "" }, settings.lastSel);
    renderAll();
    if (!configured()) openSettings();
    kick(false, true);
    window.__barbe = { refresh, kick, Q };   // 시험용
  })();
})();
