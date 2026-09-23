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
function renderDay(day) {
  currentDay = day.date;
  const tl = $("#timeline");
  $("#snapCount").textContent = `· ${day.snapshots.length} 个版本`;
  if (!day.snapshots.length) {
    tl.innerHTML = `<div class="empty">当日暂无策略方案</div>`;
  } else {
    tl.innerHTML = day.snapshots.map((s) => {
      const m = s.market || {};
      const rows = (s.scenarios || []).map((c) => `
        <tr>
          <td><span class="badge ${c.enabled ? "on" : "off"}">${c.enabled ? "启用" : "禁用"}</span></td>
          <td>${esc(c.name || c.pattern)}<br><span class="dim">${esc(c.regime || "")}</span></td>
          <td><b>${c.trigger_level ?? "-"}</b><br><span class="dim">${esc(c.trigger_rule || "")}</span></td>
          <td class="legs">${esc(c.structure || "")}<br>${c.legs ? `买${c.legs.long} / 卖${c.legs.short}` : ""}</td>
          <td>${c.target ?? "-"}<br><span class="dim">${c.target_zone ? "区间 " + c.target_zone.join("–") : ""}</span></td>
          <td>${c.invalid_level ?? "-"}</td>
        </tr>`).join("");
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
        ${s.note ? `<div class="snap-note">${esc(s.note)}</div>` : ""}
        <table class="scen"><thead><tr>
          <th>状态</th><th>形态</th><th>触发</th><th>结构 / 行权价</th><th>目标</th><th>失效</th>
        </tr></thead><tbody>${rows}</tbody></table>
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
        return `<div class="rt">
          <span class="pat">形态 ${esc(r.pattern)}</span>
          <span>开仓 ${fmtTs(r.open_ts)} @ <b>${opPx ?? "-"}</b>（成本 $${op.cost ?? "-"}）</span>
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
        <td class="dim">${esc(e.note || e.ladder || e.attempt && "第" + e.attempt + "次" || "")}</td>
      </tr>`).join("")
    : `<tr><td colspan="7" class="empty">无委托事件</td></tr>`;
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

async function boot() {
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
