/* QQQ 0DTE 盯盘看板 · 数据来自 docs/data/*.json（dashboard_export.py 每 5 分钟生成并推送） */
const $ = (s) => document.querySelector(s);
const DATA = "data/";

let currentDay = null;

async function fetchJSON(url) {
  // 加时间戳穿透 GitHub Pages CDN 缓存，保证拿到最新推送的数据
  const sep = url.includes("?") ? "&" : "?";
  const r = await fetch(`${url}${sep}_=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

const fmtTs = (ts) => {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour12: false, timeZone: "America/New_York" }) + " ET";
};
const fmtAge = (s) => {
  if (s == null) return "-";
  if (s < 90) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  return `${(s / 3600).toFixed(1)} 小时前`;
};
const fmt$ = (v) => (v == null ? "-" : (v > 0 ? "+" : "") + "$" + Number(v).toFixed(2));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------- 状态条 ---------- */
function renderStatus(st) {
  const w = st.watcher || {}, g = st.gateway || {};
  const wDot = w.alive ? "on" : "off";
  const wTxt = w.alive
    ? `运行中 <span class="dim">(${esc(w.uptime || "")})</span>`
    : "<span class='err'>离线</span>";
  const lastAge = w.last_event_age_s;
  const evDot = !w.alive ? "off" : (lastAge != null && lastAge < 300) ? "on" : "warn";
  const gDot = g.online ? "on" : "off";
  const gTxt = g.online
    ? `在线 <span class="dim">${esc(g.host)}:${g.port}${g.pid ? " · pid " + esc(g.pid) : ""}</span>`
    : "<span class='err'>离线</span>";
  $("#statusStrip").innerHTML = `
    <div class="stat"><div class="k">Watcher</div><div class="v"><span class="dot ${wDot}"></span>${wTxt}</div></div>
    <div class="stat"><div class="k">Gateway (IBC)</div><div class="v"><span class="dot ${gDot}"></span>${gTxt}</div></div>
    <div class="stat"><div class="k">最后事件</div><div class="v"><span class="dot ${evDot}"></span>${fmtAge(lastAge)}</div></div>
    <div class="stat"><div class="k">现价 / 模式</div><div class="v">${st.last_spot ?? "-"} <span class="dim">${esc(st.mode || "")}</span></div></div>`;
  $("#updated").textContent = `数据更新于 ${st.generated_at_bj}（北京）`;
}

/* ---------- 策略时间线 ---------- */
/* 2026-10-09 看板可读性优化 ✓
   实测：盘前档 name 6~10 字 ✓，而**盘中档 208~328 字** ✗（AI 把整段推理塞进 name ✓）
   ⇒ 渲染层必须自己拆：**只显示短标签，依据折叠** ✓（数据侧同时定规矩，见 SPEC §3.1 ✓） */
function splitName(name) {
  const s = String(name || "");
  const i = s.search(/[（(]/);
  let label = i > 0 ? s.slice(0, i) : s;
  let why = i > 0 ? s.slice(i) : "";
  if (!why && label.length > 26) {
    const m = label.match(/^(\S+\s+[\d.]+)\s+(.*)$/);
    if (m) { label = m[1]; why = m[2]; }
  }
  if (label.length > 30) { why = label.slice(30) + (why ? " " + why : ""); label = label.slice(0, 30) + "…"; }
  return { label: label.trim(), why: why.trim() };
}

/* 方案说明（note）常含 ==== / ---- 分隔线（AI 的排版习惯 ✗）⇒ 清掉并折叠 ✓ */
function cleanNote(note) {
  return String(note || "")
    .replace(/^[=\-—─·.\s]{4,}$/gm, "")   // 实测 AI 常用 4~5 个 = / - 当分隔线 ✓
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function renderDay(day) {
  currentDay = day.date;
  const tl = $("#timeline");
  $("#snapCount").textContent = `· ${day.snapshots.length} 个版本`;
  if (!day.snapshots.length) {
    tl.innerHTML = `<div class="empty">当日暂无策略方案</div>`;
  } else {
    tl.innerHTML = day.snapshots.map((s) => {
      const m = s.market || {};
      const rows = (s.scenarios || []).map((c) => {
        const nm = splitName(c.name || c.pattern);
        const why = c.rationale || nm.why;          // 优先用结构化字段（新口径 ✓），回退到拆名字 ✓
        const legs = c.legs ? (c.legs.short == null
            ? `买 ${c.legs.long}${c.structure === "single_put" ? "P" : "C"}（单腿）`
            : `买 ${c.legs.long} / 卖 ${c.legs.short}`) : "";
        return `
        <tr>
          <td><span class="badge ${c.enabled ? "on" : "off"}">${c.enabled ? "启用" : "禁用"}</span></td>
          <td class="nm"><b>${esc(nm.label)}</b>
            <span class="chip reg">${esc(c.regime || "-")}</span>
            ${why ? `<details class="why"><summary>依据</summary><div>${esc(why)}</div></details>` : ""}</td>
          <td><b>${c.trigger_level ?? "-"}</b><br><span class="dim">${esc(c.trigger_rule || "")}</span></td>
          <td class="legs">${esc(c.structure || "")}<br>${esc(legs)}</td>
          <td>${c.target ?? "-"}<br><span class="dim">${c.target_zone ? "区间 " + c.target_zone.join("–") : ""}</span></td>
          <td>${c.invalid_level ?? "-"}</td>
        </tr>`;
      }).join("");
      const err = s.error ? `<div class="err">⚠ ${esc(s.error)}</div>` : "";
      return `
      <div class="snap">
        <div class="snap-header">
          <span class="snap-title">${esc(s.label)}</span>
          <span class="chip ${s.kind === "pm" ? "pm" : "pre"}">${s.kind === "pm" ? "盘中" : "盘前"}</span>
          <span class="chip src">${esc(s.data_source || "")}</span>
          <span class="dim">启用 ${s.enabled_count}/${(s.scenarios || []).length}</span>
        </div>
        <div class="snap-meta">
          ${esc(s.generated_at || "")}
          ${m.spot_premarket ? `· 盘前价 ${m.spot_premarket}` : ""}
          ${m.daily_iv_pct ? `· IV ${(m.daily_iv_pct * 100).toFixed(1)}%` : ""}
          ${m.expected_low ? `· 预期区间 ${m.expected_low}–${m.expected_high}` : ""}
        </div>
        ${err}
        ${cleanNote(s.note) ? `<details class="snap-note-wrap"><summary>方案说明 / 数据来源</summary><div class="snap-note">${esc(cleanNote(s.note))}</div></details>` : ""}
        <table class="scen">
          <colgroup><col class="c-st"><col class="c-nm"><col class="c-tg"><col class="c-lg"><col class="c-tgt"><col class="c-inv"></colgroup>
          <thead><tr><th>状态</th><th>形态</th><th>触发</th><th>结构 / 行权价</th><th>目标</th><th>失效</th></tr></thead>
          <tbody>${rows}</tbody></table>
      </div>`;
    }).join("");
  }

  /* ---------- 委托记录 ---------- */
  const pnl = day.realized_pnl;
  const badge = $("#pnlBadge");
  if (day.roundtrips.length) {
    badge.textContent = `当日已实现 ${fmt$(pnl)}`;
    badge.className = "pnl-badge " + (pnl > 0 ? "pos" : pnl < 0 ? "neg" : "zero");
  } else {
    badge.textContent = day.order_events.length ? "有委托未成 roundtrip" : "当日无委托";
    badge.className = "pnl-badge zero";
  }
  $("#orders").innerHTML = day.roundtrips.length
    ? day.roundtrips.map((r) => {
        const pnlCls = r.pnl > 0 ? "pos" : r.pnl < 0 ? "neg" : "";
        const op = r.open || {}, cl = r.close || {};
        const clPx = cl.price ?? (cl.proceeds != null ? (cl.proceeds / 100).toFixed(2) : null);
        const opPx = op.price ?? (op.cost != null ? (op.cost / 100).toFixed(2) : null);
        // 2026-10-05：显示「开仓点位」（触发位）+ 腿构成 + 追价%，以及移动止盈「武装」事件
        // ⚠️ 本文件是看板前端的**源头**：launchd 的 sync_public() 每 2 分钟把它覆盖到看板仓库，
        //    所以改前端必须改这里，改镜像仓库会被立刻冲掉 ✗
        const lgs = op.legs ? `${op.legs.long}/${op.legs.short}${op.legs.right}` : "";
        const lvl = (r.level != null || lgs)
          ? `<span>开仓点位 <b>${r.level ?? "-"}</b>${lgs ? `（${lgs}）` : ""}` +
            `${r.chase_pct != null ? ` · 追价 ${(r.chase_pct * 100).toFixed(2)}%` : ""}</span>`
          : "";
        const arm = r.armed
          ? `<span class="arm">移动止盈武装 <b>+${r.armed.peak_pct}%</b>` +
            ` → 回吐线 <b>+${r.armed.line_pct}%</b>（≈$${r.armed.floor_value}）` +
            `${r.armed.hold_min != null ? ` · 开仓 ${r.armed.hold_min} 分钟后武装` : ""}</span>`
          : "";
        return `<div class="rt">
          <span class="pat">形态 ${esc(r.pattern)}</span>
          <span>开仓 ${fmtTs(r.open_ts)} @ <b>${opPx ?? "-"}</b>（成本 $${op.cost ?? "-"}）</span>
          ${lvl}
          ${arm}
          <span>平仓 ${fmtTs(r.close_ts)} @ <b>${clPx ?? "-"}</b>（回收 $${cl.proceeds ?? "-"}）</span>
          <span class="big ${pnlCls}">${fmt$(r.pnl)}</span>
        </div>`;
      }).join("")
    : `<div class="empty">当日无成交 roundtrip</div>`;

  const tbody = $("#eventTable tbody");
  tbody.innerHTML = day.order_events.length
    ? day.order_events.map((e) => `<tr>
        <td>${fmtTs(e.ts)}</td><td>${esc(e.event)}</td><td>${esc(e.state || "")}</td>
        <td>${esc(e.side || "")}</td><td>${esc(e.pattern || e.tag || "")}</td>
        <td>${e.price ?? e.limit ?? "-"}</td>
          <td><b>${e.level ?? e.entry_ref ?? "-"}</b>${e.remaining_pct != null ? `<span class="dim"> · 剩${e.remaining_pct}%</span>` : ""}</td>
        <td class="dim">${esc(e.note || e.ladder || e.attempt && "第" + e.attempt + "次" || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="8" class="empty">无委托事件</td></tr>`;
}

/* ---------- 加载 ---------- */
async function loadDayPicker() {
  const idx = await fetchJSON(DATA + "index.json");
  const sel = $("#daySelect");
  sel.innerHTML = idx.days.slice().reverse().map((d) =>
    `<option value="${d.date}">${d.date}${d.orders ? " 📋" : ""}${d.realized_pnl ? ` (${d.realized_pnl > 0 ? "+" : ""}${d.realized_pnl})` : ""}</option>`
  ).join("");
  if (![...sel.options].some((o) => o.value === currentDay)) {
    currentDay = sel.value = idx.days[idx.days.length - 1]?.date;
  } else sel.value = currentDay;
}

async function refresh() {
  try {
    const [st, day] = await Promise.all([
      fetchJSON(DATA + "status.json"),
      fetchJSON(DATA + `${currentDay || new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })}.json`),
    ]);
    renderStatus(st);
    renderDay(day);
    $("#foot").innerHTML = `git ${esc(st.git_head || "-")} · entry window ${(st.entry_window || []).join("–")} ET · 数据由 dashboard_export.py 每 5 分钟推送`;
  } catch (e) {
    $("#foot").innerHTML = `<span class="err">加载失败: ${esc(e.message)}（数据可能尚未推送或网络问题）</span>`;
  }
}


/* ---------- 待优化 Tab（2026-10-05 用户要求） ---------- */
const ST_CLS = { open: "neg", reopened: "neg", done: "pos", superseded: "zero", blocked: "neg" };
function renderTodos(d) {
  const items = (d && d.items) || [];
  const alive = items.filter((x) => x.status !== "done" && x.status !== "superseded");
  $("#todoCount").textContent = `· ${alive.length}`;
  if (!items.length) { $("#todos").innerHTML = '<div class="empty">backlog.md 暂无条目</div>'; return; }
  const g = {};
  items.forEach((x) => { (g[x.priority] = g[x.priority] || []).push(x); });
  $("#todos").innerHTML = Object.keys(g).sort().map((k) =>
    `<div class="tgroup"><h3>${esc(k)}</h3>` + g[k].map((x) => {
      const c = ST_CLS[x.status] || "zero";
      return `<div class="todo ${c}"><span class="tid">${esc(x.id)}</span>` +
             `<span class="ttitle">${esc(x.title)}</span>` +
             `<span class="tst ${c}">${esc(x.status)}</span>` +
             (x.note ? `<span class="tnote">${esc(x.note)}</span>` : "") + `</div>`;
    }).join("") + `</div>`).join("");
}
function bindTabs() {
  const a = $("#tabTrade"), b = $("#tabTodo");
  if (!a || !b) return;
  const go = (todo) => {
    a.classList.toggle("active", !todo);
    b.classList.toggle("active", todo);
    // 用 class 而不是 hidden —— main 的 display 会压过 [hidden] ✗
    const vt = $("#viewTrade"), vd = $("#viewTodo");
    vt.classList.toggle("view-off", todo);
    vd.classList.toggle("view-off", !todo);
    // 🔴 必须同时改 hidden 属性本身：HTML 里 <main id="viewTodo" hidden>，
    // 而 CSS 有 [hidden]{display:none!important} —— 只切 class 会被它压住 ✗
    vt.hidden = !!todo;
    vd.hidden = !todo;
  };
  a.onclick = () => go(false);
  b.onclick = () => go(true);
  go(false);
}
async function loadTodos() {
  try { renderTodos(await fetchJSON(DATA + "todos.json")); }
  catch (e) { $("#todos").innerHTML = '<div class="empty">待优化数据未就绪</div>'; }
}
async function boot() {
  bindTabs(); loadTodos(); setInterval(loadTodos, 60000);
  const param = new URLSearchParams(location.search).get("day");
  if (param) currentDay = param;
  try {
    await loadDayPicker();
  } catch (e) {
    $("#foot").innerHTML = `<span class="err">index.json 加载失败: ${esc(e.message)}</span>`;
  }
  await refresh();
  $("#daySelect").addEventListener("change", (e) => {
    currentDay = e.target.value;
    history.replaceState(null, "", "?day=" + currentDay);
    refresh();
  });
}

boot();
setInterval(() => { if ($("#autoRefresh").checked) boot(); }, 60000);
