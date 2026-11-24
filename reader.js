/*
 * 바흐브 현장사진 — 칠판 숫자 읽기 · 평균 (v2.1)
 *
 * 읽기는 창구(Apps Script)가 바흐브와 같은 질문(boards.js·Boards.gs = templates/칠판)으로 두 모델에 묻는다.
 * 평균은 여기서 '보이는 값'(사람이 고친 값 > 첫 모델 값)으로 매번 다시 계산한다 — 모델이 적은 평균은 쓰지 않는다.
 * 두 모델이 다르게 읽은 칸, 범위 밖 값, 칠판 평균과 계산 평균이 다른 것은 '확인' 으로 띄운다.
 */
(function (root) {
  "use strict";
  const BOARDS = root.BARBE_BOARDS || {};
  const R = {};

  /** 바흐브 board_ocr._num 과 같은 뜻: '25.3', '25,3', '25.3MPa' → 25.3 · 못 읽으면 null */
  R.num = (v) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    const m = String(v).replace(/,(?=\d{3}\b)/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };
  R.board = (name) => BOARDS[name] || null;
  const numFields = (b) => b.fields.filter((f) => f.type === "number");

  /** 창구 결과 → {values, others, disagree, models, note, conf} */
  R.merge = (boardName, results) => {
    const b = R.board(boardName);
    const ok = (results || []).filter((r) => r && r.values);
    if (!b || !ok.length) return null;
    const norm = (obj) => {
      const out = {};
      for (const f of b.fields) out[f.key] = f.type === "number" ? R.num(obj[f.key]) : (obj[f.key] == null || obj[f.key] === "" ? null : String(obj[f.key]).trim());
      return out;
    };
    const first = norm(ok[0].values);
    const others = ok.slice(1).map((r) => ({ model: r.model, values: norm(r.values) }));
    const disagree = {};
    for (const f of b.fields) {
      if (f.type !== "number" && f.type !== "enum") continue;
      for (const o of others) {
        const a = first[f.key], c = o.values[f.key];
        if (a === c) continue;
        if (f.type === "number" && a !== null && c !== null && Math.abs(a - c) < 1e-9) continue;
        (disagree[f.key] = disagree[f.key] || []).push({ model: o.model, value: c });
      }
    }
    return {
      values: first, others, disagree, models: ok.map((r) => r.model),
      conf: ok[0].values["확신"] || "", note: ok[0].values["비고"] || "",
      failed: (results || []).filter((r) => r && !r.values).map((r) => `${r.model}: ${r.error}`),
    };
  };

  /** 보이는 값: 사람이 고친 값이 먼저 */
  R.shown = (read) => Object.assign({}, (read && read.merged && read.merged.values) || {}, (read && read.fixed) || {});

  function roundTo(x, d) { const p = Math.pow(10, d); return Math.round((x + Math.sign(x) * 1e-9) * p) / p; }
  R.fmt = (x, d) => (x === null || x === undefined ? "—" : roundTo(x, d).toFixed(d));

  /** 묶음(그룹)별 평균 + 전체 평균. 값이 하나도 없는 묶음은 뺀다 */
  R.averages = (boardName, values) => {
    const b = R.board(boardName);
    if (!b) return null;
    const groups = [];
    const order = [];
    for (const f of numFields(b)) {
      if (!f.group) continue;
      let g = groups.find((x) => x.name === f.group);
      if (!g) { g = { name: f.group, fields: [], vals: [], dec: 0, unit: f.unit || "" }; groups.push(g); order.push(f.group); }
      g.fields.push(f);
      g.dec = Math.max(g.dec, f.dec || 0);
      const v = values[f.key];
      if (v !== null && v !== undefined) g.vals.push(v);
    }
    const live = groups.filter((g) => g.vals.length);
    for (const g of live) g.avg = g.vals.reduce((a, c) => a + c, 0) / g.vals.length;
    const all = live.flatMap((g) => g.vals);
    const dec = live.reduce((m, g) => Math.max(m, g.dec), 0);
    return {
      groups: live, dec, unit: live[0] ? live[0].unit : "",
      overall: all.length ? all.reduce((a, c) => a + c, 0) / all.length : null, count: all.length,
      expected: groups.reduce((n, g) => n + g.fields.length, 0),
    };
  };

  /** 물성 칠판 판정 — 바흐브 core.concrete_book.judge_prop 과 같은 규칙·같은 기준(BARBE_STD, 칠판틀_내보내기.py).
   *  기준 슬럼프는 칠판 규격 끝 숫자(25-24-150 → 150). 단위수량은 배합표가 있어야 해서 PC(바흐브)에서만.
   *  온도는 표준·서중 범위로 보고, 한중이면 범위를 같이 적는다(폰은 배합 구분을 모른다). 물성 칠판이 아니면 null. */
  R.propJudge = (v) => {
    if (!v || !(v["종류"] === "물성" || v["슬럼프"] != null || v["공기량"] != null)) return null;
    if (v["종류"] === "압축강도") return null;
    const S = Object.assign({ 슬럼프25: 10, 슬럼프50: 15, 슬럼프80: 25, 공기량기준: 4.5, 공기량허용: 1.5, 염화물상한: 0.3,
      온도하한: 10, 온도상한: 35, 한중하한: 5, 한중상한: 20 }, root.BARBE_STD || {});
    const out = [];
    const m = String(v["규격"] || "").match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
    const s0 = m ? Number(m[3]) : null;
    const sl = R.num(v["슬럼프"]);
    if (sl != null && s0 != null) {
      const tol = s0 >= 80 ? S.슬럼프80 : s0 >= 50 ? S.슬럼프50 : S.슬럼프25;
      out.push({ k: "슬럼프", ok: Math.abs(sl - s0) <= tol, txt: `슬럼프 ${sl} (${s0}±${tol})` });
    }
    const air = R.num(v["공기량"]);
    if (air != null) out.push({ k: "공기량", ok: Math.abs(air - S.공기량기준) <= S.공기량허용 + 1e-9, txt: `공기량 ${air} (${S.공기량기준}±${S.공기량허용})` });
    const cl = [R.num(v["염화물1"]), R.num(v["염화물2"])].filter((x) => x != null);
    if (cl.length) out.push({ k: "염화물", ok: Math.max(...cl) <= S.염화물상한 + 1e-9, txt: `염화물 ${Math.max(...cl)} (${S.염화물상한} 이하)` });
    const t = R.num(v["콘크리트온도"]);
    if (t != null) out.push({ k: "온도", ok: S.온도하한 <= t && t <= S.온도상한, txt: `콘크리트 ${t}℃ (${S.온도하한}~${S.온도상한}, 한중이면 ${S.한중하한}~${S.한중상한})`, soft: true });
    const hard = out.filter((x) => !x.soft);
    return { items: out, ok: hard.length ? hard.every((x) => x.ok) : null, noSlumpSpec: sl != null && s0 == null };
  };

  /** 확인할 것 목록 (글) */
  R.checks = (boardName, read) => {
    const b = R.board(boardName);
    const out = [];
    if (!b || !read || !read.merged) return out;
    const v = R.shown(read);
    const fixed = read.fixed || {};
    for (const [k, list] of Object.entries(read.merged.disagree || {})) {
      if (k in fixed) continue;
      const f = b.fields.find((x) => x.key === k);
      out.push(`${f ? f.label : k}: 두 모델이 다르게 읽음 (${[v[k], ...list.map((x) => x.value)].map((x) => (x == null ? "빈칸" : x)).join(" / ")}) — 눌러서 확인`);
    }
    for (const f of numFields(b)) {
      const x = v[f.key];
      if (x !== null && x !== undefined && f.range && (x < f.range[0] || x > f.range[1])) out.push(`${f.label} ${x} 이 보통 범위(${f.range[0]}~${f.range[1]}) 밖`);
    }
    const a = R.averages(boardName, v);
    if (a && a.groups.length) {
      for (const g of a.groups) if (g.vals.length < g.fields.length && a.groups.length > 1) out.push(`${g.name}: ${g.fields.length}개 중 ${g.vals.length}개만 읽음`);
      const boardAvg = v["평균"];
      if (boardAvg != null && a.overall != null) {
        // 칠판 평균은 전체 평균 또는 마지막 조 평균일 수 있다 — 둘 다 아니면 알린다
        const cands = [a.overall, ...a.groups.map((g) => g.avg)].map((x) => roundTo(x, 1));
        if (!cands.some((c) => Math.abs(c - boardAvg) <= 0.1 + 1e-9)) out.push(`칠판에 적힌 평균 ${boardAvg} 와 계산 평균 ${R.fmt(a.overall, 1)} 이 다름`);
      }
    }
    const pj = R.propJudge(v);
    if (pj) {
      for (const x of pj.items) if (!x.ok) out.push(`${x.txt} — ${x.soft ? "범위 밖 (한중 배합이면 괜찮을 수 있어요)" : "불합격"}`);
      if (pj.noSlumpSpec) out.push("규격을 못 읽어 슬럼프 판정을 못 했어요 — 규격 칸을 눌러 고치세요");
    }
    if (read.merged.conf === "낮음") out.push("모델이 '확신 낮음' — 칠판을 가까이 다시 찍어 보세요");
    return out;
  };

  /** 한 줄 요약 (알림·목록용) */
  R.summary = (boardName, read) => {
    const v = R.shown(read);
    const a = R.averages(boardName, v);
    if (!a || !a.groups.length) {
      const b = R.board(boardName);
      const got = b ? numFields(b).filter((f) => v[f.key] != null) : [];
      const pj = R.propJudge(v);
      const head = pj && pj.ok != null ? (pj.ok ? "물성 합격 · " : "물성 불합격 · ") : "";
      return got.length ? head + got.slice(0, 4).map((f) => `${f.label} ${v[f.key]}`).join(" · ") : "";
    }
    const head = a.groups.length > 1 ? a.groups.map((g) => `${g.name} ${R.fmt(g.avg, g.dec)}`).join(" · ") + " · " : "";
    return `${head}평균 ${R.fmt(a.overall, a.dec)} ${a.unit}`.trim() + (a.count < a.expected && a.groups.length > 1 ? ` (${a.count}개)` : "");
  };

  /** 줄인 사본 (긴 변 maxEdge, JPEG) → base64. 원본은 그대로 둔다 */
  R.shrink = async (buf, type, maxEdge) => {
    const blob = new Blob([buf], { type: type || "image/jpeg" });
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const k = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const out = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    const u = new Uint8Array(await out.arrayBuffer());
    let s = "";
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /** 판독 카드 HTML. 숫자 칸은 data-k 로 눌러 고친다 */
  R.card = (boardName, read) => {
    const b = R.board(boardName);
    if (!b) return "";
    if (!read || read.status === "wait" || (read.status === "error" && !read.merged && read.err === "연결 안 됨")) return `<div class="rc wait">🔎 칠판 읽기 대기 — 신호가 잡히면 읽어요</div>`;
    if (read.status === "reading") return `<div class="rc wait">🔎 칠판 읽는 중…</div>`;
    if (read.status === "error" && !read.merged) return `<div class="rc bad">칠판을 못 읽었어요 — ${esc(read.err)}</div>`;
    const v = R.shown(read);
    const fixed = read.fixed || {};
    const dis = (read.merged && read.merged.disagree) || {};
    const cell = (f) => {
      const x = v[f.key];
      const cls = (f.key in fixed) ? "fx" : (dis[f.key] ? "dz" : "");
      return `<button class="cv ${cls}" data-k="${esc(f.key)}">${x == null ? "—" : esc(f.type === "number" && f.dec != null ? R.fmt(x, f.dec) : x)}${dis[f.key] && !(f.key in fixed) ? "?" : ""}</button>`;
    };
    const a = R.averages(boardName, v);
    let html = `<div class="rc">`;
    const info = ["종류", "규격", "타설위치", "공시체", "단계", "제작일", "타설일자", "시험일자", "일자", "품명", "납품사", "업체"]
      .filter((k) => v[k] != null && b.fields.some((f) => f.key === k))
      .map((k) => `${esc(b.fields.find((f) => f.key === k).label)} <b>${esc(v[k])}</b>`).join(" · ");
    if (info) html += `<div class="ri">${info}</div>`;
    if (a && a.groups.length) {
      const std = v["품질기준"];
      html += `<table class="rt">`;
      for (const g of a.groups) {
        const low = std != null && g.avg < std - 1e-9;
        html += `<tr><th>${esc(g.name)}</th><td>${g.fields.map(cell).join("")}</td><td class="ga${low ? " low" : ""}">${R.fmt(g.avg, g.dec)}</td></tr>`;
      }
      html += `</table><div class="ravg">평균 <b>${R.fmt(a.overall, a.dec)}</b> ${esc(a.unit)}` +
        `<span>${a.count}개${std != null ? ` · 품질기준 ${std}` : ""}${v["평균"] != null ? ` · 칠판 평균 ${v["평균"]}` : ""}</span></div>`;
    } else {
      const got = numFields(b).filter((f) => v[f.key] != null);
      if (!got.length) html += `<div class="ri">칠판 숫자를 못 찾았어요 (칠판 사진이 아니면 괜찮아요)</div>`;
      else html += `<div class="rl">${got.map((f) => `<span>${esc(f.label)} ${cell(f)}${f.unit ? " " + esc(f.unit) : ""}</span>`).join("")}</div>`;
      const pj = R.propJudge(v);
      if (pj && pj.items.length) {
        html += `<div class="rj${pj.ok === false ? " low" : ""}">${pj.ok == null ? "판정" : pj.ok ? "물성 합격" : "물성 불합격"}` +
          `<span>${pj.items.map((x) => `${x.ok ? "○" : "✕"} ${esc(x.txt)}`).join(" · ")}</span></div>`;
      }
    }
    const ck = R.checks(boardName, read);
    if (ck.length) html += `<ul class="rk">${ck.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
    if (Object.keys(fixed).length) html += `<div class="rn">초록 칸 = 사람이 고친 값</div>`;
    html += `</div>`;
    return html;
  };

  root.BarbeRead = R;
})(typeof self !== "undefined" ? self : window);
