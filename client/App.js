// ==========================================
// PANDAMETRICS V4 - DASHBOARD UI
// ==========================================
//
// Rendering only: all numbers come from PandaInsights / PandaStats.
// Every interpolated string goes through esc().

(function () {
  "use strict";

  const S = PandaStats;
  const I = PandaInsights;

  const VIEWS = [
    ["overview", "🐼 Panda Den"],
    ["rankings", "🏆 Rankings"],
    ["evolution", "📈 Evolution"],
    ["lab", "🔬 Panda Lab"],
    ["squad", "🃏 Squad & Builds"],
    ["awards", "🌟 Awards"]
  ];

  const EVOLUTION_METRICS = [
    "pandaScore", "passAccuracy", "forwardPassesCompleted", "goals", "assists",
    "shotAccuracy", "interceptions", "tackleSuccess", "possessionLost", "goodDecisionShare"
  ];

  const state = Object.assign({}, I.DEFAULT_STATE, {
    view: "overview",
    category: "passing",
    player: null,
    evoMode: window.matchMedia && window.matchMedia("(max-width: 700px)").matches ? "mini" : "squad",
    awardsScope: "week"
  });

  let prepared = null;
  let model = null;
  let loadedAt = null;

  const $ = id => document.getElementById(id);

  // ------------------------------------------------------------- helpers

  function esc(value) {
    return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function num(v, d) {
    return v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d === undefined ? 1 : d);
  }

  function signed(v, d, unit) {
    if (v === null || !Number.isFinite(v)) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(d) + (unit || "");
  }

  function dateLabel(value, withTime) {
    if (!value) return "—";
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return "—";
    const opts = { timeZone: "Europe/London", day: "numeric", month: "short" };
    if (withTime) Object.assign(opts, { hour: "2-digit", minute: "2-digit" });
    return d.toLocaleString("en-GB", opts);
  }

  function badge(confidence) {
    if (confidence === "experimental") return '<span class="badge exp" title="Unverified mapping; not used in scores">Experimental</span>';
    if (confidence === "medium") return '<span class="badge med" title="Derived or caveated metric">Caveat</span>';
    return "";
  }

  function coverageChip(withData, appearances) {
    if (!appearances) return "";
    const pct = withData / appearances * 100;
    const cls = pct >= 95 ? "ok" : pct >= 75 ? "warn" : "bad";
    return `<span class="chip cov ${cls}" title="Matches with this data / appearances">${withData}/${appearances} matches</span>`;
  }

  function groupChips(byGroup) {
    return Object.entries(byGroup || {})
      .sort((a, b) => b[1].appearances - a[1].appearances)
      .map(([g, v]) => `<span class="chip grp ${esc(g)}">${esc(g)} ${num(v.score, 0)} <small>(${v.appearances})</small></span>`)
      .join("");
  }

  function formChips(form) {
    return form.map(r => `<span class="form ${esc(r)}">${esc((r || "?")[0].toUpperCase())}</span>`).join("");
  }

  function bar(pct) {
    const w = Math.max(0, Math.min(100, pct || 0));
    return `<div class="bar"><div class="fill" style="width:${w.toFixed(1)}%"></div></div>`;
  }

  function empty(text) {
    return `<div class="panel empty">${esc(text)}</div>`;
  }

  // -------------------------------------------------------------- charts

  const PALETTE = ["#baff83", "#62d69e", "#ffd76a", "#7cc8ff", "#ff9685", "#c79bff", "#ffb35c", "#9be7e0", "#f0f8f1", "#a7bcae"];

  function lineChart(seriesList, keys, complete, opts) {
    const o = Object.assign({ width: 640, height: 220, pad: 28, min: null, max: null }, opts);
    const values = seriesList.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null && Number.isFinite(v));
    if (!values.length || keys.length < 1) return '<div class="muted">Not enough data for a chart yet.</div>';
    const lo = o.min !== null ? o.min : Math.min(...values);
    const hi = o.max !== null ? o.max : Math.max(...values);
    const span = hi - lo || 1;
    const x = i => o.pad + (keys.length === 1 ? (o.width - 2 * o.pad) / 2 : i * (o.width - 2 * o.pad) / (keys.length - 1));
    const y = v => o.height - o.pad - (v - lo) / span * (o.height - 2 * o.pad);

    const lines = seriesList.map((s, si) => {
      const color = s.color || PALETTE[si % PALETTE.length];
      let path = "";
      let open = false;
      const dots = [];
      s.points.forEach((p, i) => {
        if (p.value === null || !Number.isFinite(p.value)) {
          open = false;
          return;
        }
        path += (open ? "L" : "M") + x(i).toFixed(1) + "," + y(p.value).toFixed(1);
        open = true;
        const hollow = complete && complete[i] === false;
        dots.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${o.dot || 3.5}" fill="${hollow ? "none" : color}" stroke="${color}" stroke-width="1.5"><title>${esc(s.name)} · ${esc(keys[i])}: ${num(p.value)}${p.sample !== undefined ? " (" + p.sample + " matches)" : ""}${hollow ? " · in progress" : ""}</title></circle>`);
      });
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${o.stroke || 2}" stroke-linejoin="round"/>${dots.join("")}`;
    }).join("");

    const axis = o.axis === false ? "" : `
      <text x="4" y="${y(hi) + 4}" class="axis">${num(hi, 0)}</text>
      <text x="4" y="${y(lo) + 4}" class="axis">${num(lo, 0)}</text>
      ${keys.map((k, i) => (keys.length <= 8 || i % Math.ceil(keys.length / 8) === 0)
        ? `<text x="${x(i)}" y="${o.height - 6}" class="axis" text-anchor="middle">${esc(k.slice(5))}</text>` : "").join("")}`;

    return `<svg viewBox="0 0 ${o.width} ${o.height}" class="chart" role="img" aria-label="${esc(o.label || "trend chart")}">${axis}${lines}</svg>`;
  }

  function legend(seriesList) {
    return `<div class="legend">${seriesList.map((s, i) =>
      `<span><i style="background:${s.color || PALETTE[i % PALETTE.length]}"></i>${esc(s.name)}</span>`).join("")}</div>`;
  }

  // ------------------------------------------------------------- filters

  function renderFilters() {
    const clubs = Object.entries(prepared.clubs);
    const opt = (value, label, current) => `<option value="${esc(value)}" ${String(value) === String(current) ? "selected" : ""}>${esc(label)}</option>`;
    $("filters").innerHTML = `
      <label>Club<select data-filter="club">${opt("all", "All clubs", state.club)}${clubs.map(([id, name]) => opt(id, name, state.club)).join("")}</select></label>
      <label>Period<select data-filter="period">${I.PERIODS.map(p => opt(p.key, p.label, state.period)).join("")}</select></label>
      <label>Matches<select data-filter="matchType">${I.MATCH_TYPES.map(t => opt(t.key, t.label, state.matchType)).join("")}</select></label>
      <label>Position<select data-filter="group">${opt("all", "All positions", state.group)}${S.GROUPS.filter(g => g !== "GK").map(g => opt(g, S.GROUP_LABELS[g] + "s", state.group)).join("")}</select></label>
      <label>Min. matches<select data-filter="minMatches">${[1, 3, 5, 10].map(n => opt(n, n + (n === 1 ? " match" : " matches"), state.minMatches)).join("")}</select></label>`;
    document.querySelectorAll("[data-filter]").forEach(el => {
      el.onchange = () => {
        const key = el.dataset.filter;
        state[key] = key === "minMatches" ? Number(el.value) : el.value;
        render();
      };
    });
  }

  function renderNav() {
    $("nav").innerHTML = VIEWS.map(([key, label]) =>
      `<button data-view="${key}" class="${state.view === key ? "active" : ""}">${esc(label)}</button>`).join("");
    document.querySelectorAll("[data-view]").forEach(b => {
      b.onclick = () => {
        state.view = b.dataset.view;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    });
  }

  // ------------------------------------------------------------- overview

  function renderOverview() {
    const o = model.overview;
    const cov = o.coverage;
    const sync = o.sync || {};
    const bamboo = o.bamboo;

    const clubCards = Object.values(o.clubs).filter(c => c.played).map(c => `
      <div class="panel club">
        <h3>${esc(c.name)}</h3>
        <div class="record"><b>${c.wins}</b>W <b>${c.draws}</b>D <b>${c.losses}</b>L</div>
        <div class="muted">${c.goalsFor}–${c.goalsAgainst} goals · ${c.played} matches${c.playoffs ? " · " + c.playoffs + " playoff" : ""}</div>
        <div class="forms">${formChips(c.form)}</div>
      </div>`).join("") || empty("No official matches in this filter.");

    const highlight = key => {
      if (!bamboo.week) return null;
      return bamboo.awards.hall.concat(bamboo.awards.shame).find(a => a.key === key);
    };
    const hl = ["pandaOfWeek", "goldenBoot", "shotgunTarget"].map(highlight).filter(Boolean).map(a => `
      <div class="mini-award ${a.shame ? "shame" : ""}">
        <div class="muted">${esc(a.title)}</div>
        <div class="name">${a.winner ? esc(a.winner.name) : "—"}</div>
        <div class="muted">${a.value ? esc(a.value) : "No eligible player"}</div>
      </div>`).join("");

    const recent = o.recent.map(m => `
      <div class="match-row">
        <span class="form ${esc(m.result)}">${esc((m.result || "?")[0].toUpperCase())}</span>
        <span class="grow">${esc(prepared.clubs[m.clubId] || m.clubId)} <span class="muted">vs</span> ${esc(m.opponentName)}</span>
        <b>${m.goals}–${m.goalsAgainst}</b>
        <span class="muted small">${dateLabel(m.timestampUnix * 1000)}${m.matchType === "playoffMatch" ? " · Playoff" : ""}</span>
      </div>`).join("");

    $("overview").innerHTML = `
      <div class="grid stats">
        <div class="panel"><div class="stat">${o.matches}</div><div class="muted">Official matches</div></div>
        <div class="panel"><div class="stat">${cov.appearances}</div><div class="muted">Player appearances</div></div>
        <div class="panel"><div class="stat">${num(cov.eventCoveragePct, 0)}%</div><div class="muted">Detailed event coverage</div></div>
        <div class="panel"><div class="stat small-stat">${dateLabel(sync.lastSync, true)}</div><div class="muted">Last successful sync</div></div>
      </div>

      <div class="panel bamboo">
        <div class="eyebrow">🎋 WEEKLY BAMBOO</div>
        ${bamboo.week ? `
          <h2>Week of ${dateLabel(bamboo.start)} – ${dateLabel(bamboo.end)}</h2>
          <p>${bamboo.matches} official matches · ${bamboo.record.wins}W ${bamboo.record.draws}D ${bamboo.record.losses}L · awards need ${bamboo.minMatches}+ matches that week</p>
          <div class="mini-awards">${hl}</div>
          <button class="link" data-goto="awards">See every weekly award →</button>
        ` : "<p>No complete week with official matches yet.</p>"}
      </div>

      <h2>Clubs</h2>
      <div class="grid">${clubCards}</div>

      <div class="panel">
        <h3>Data coverage</h3>
        <p class="small">${cov.withEvents} of ${cov.appearances} appearances have complete event data. ${cov.eventsUnavailable} use EA's named totals only (goals, passes, tackles) because their event data was missing or cut short; event-based stats skip those matches rather than counting zero. ${cov.didNotPlay} zero-minute entries are excluded from every participation count.${o.duplicatesDropped ? " " + o.duplicatesDropped + " duplicate rows ignored." : ""}</p>
        <div class="chips">${Object.entries(cov.groups).map(([g, n]) => `<span class="chip grp ${esc(g)}">${esc(S.GROUP_LABELS[g] || g)} · ${n}</span>`).join("")}</div>
      </div>

      <div class="panel">
        <h3>Recent matches</h3>
        ${recent || '<div class="muted">No matches.</div>'}
      </div>`;
  }

  // ------------------------------------------------------------- rankings

  function scoreRow(t, rank) {
    return `
      <div class="rank-row">
        <div class="rank-number">${rank === null ? "–" : rank}</div>
        <div class="grow">
          <button class="name-link" data-player="${esc(t.id)}">${esc(t.name)}</button>
          <div class="chips">${groupChips(t.byGroup)}</div>
        </div>
        <div class="score-col">${bar(t.score)}<div class="muted small">${t.scoredAppearances} scored / ${t.appearances} played</div></div>
        <div class="value">${num(t.score, 0)}</div>
      </div>`;
  }

  function metricValue(entry, rk) {
    const a = entry.aggregate;
    if (rk.unit === "%") return { main: num(entry.value) + "%", detail: `${a.numerator}/${a.denominator}` };
    if (rk.unit === "per 90") return { main: num(entry.value, 2), detail: `${a.total} total · ${num(a.perMatch, 2)}/match` };
    return { main: num(entry.value, 2), detail: `${a.total} total` };
  }

  function metricPanel(rk) {
    const r = rk.ranking;
    const all = r.ranked.concat(r.provisional);
    const max = Math.max(0.0001, ...all.map(e => Math.abs(e.value || 0)));
    const rows = r.ranked.map(e => {
      const v = metricValue(e, rk);
      return `<div class="rank-row compact">
        <div class="rank-number">${r.contextOnly ? "·" : e.rank}</div>
        <div class="grow"><span class="rank-name">${esc(e.name)}</span> ${coverageChip(e.aggregate.matchesWithData, e.aggregate.appearances)}</div>
        <div class="score-col">${bar(Math.abs(e.value) / max * 100)}<div class="muted small">${esc(v.detail)}</div></div>
        <div class="value">${esc(v.main)}</div>
      </div>`;
    }).join("");
    const prov = r.provisional.length ? `
      <details><summary>${r.provisional.length} provisional (not ranked)</summary>
        ${r.provisional.map(e => `<div class="prov"><b>${esc(e.name)}</b> ${esc(metricValue(e, rk).main)} · <span class="muted">${esc(e.reasons.join(", "))}</span></div>`).join("")}
      </details>` : "";
    const direction = rk.direction === "context"
      ? "Context only: not better or worse on its own. Compare with positional peers."
      : rk.direction === "higher" ? "Higher is better." : "Lower is better.";
    return `
      <div class="panel">
        <h3>${esc(rk.label)} ${badge(rk.confidence)} <span class="unit">${esc(rk.unit)}</span></h3>
        <p class="small">${esc(rk.description)} ${esc(direction)}${rk.minAttempts ? " Needs " + rk.minAttempts + "+ attempts." : ""}</p>
        <details class="formula"><summary>Formula</summary><code>${esc(rk.formula)}</code></details>
        ${rows || '<div class="muted">No qualified players yet.</div>'}
        ${prov}
      </div>`;
  }

  function scoreExplainer() {
    const rows = Object.entries(S.ROLE_WEIGHTS).map(([g, w]) =>
      `<tr><th>${esc(S.GROUP_LABELS[g])}</th><td>${Object.entries(w).map(([k, v]) => esc(S.getMetric(k).label) + " ×" + v).join(", ")}</td></tr>`).join("");
    return `<details class="panel"><summary><b>How the Panda Score works</b></summary>
      <p class="small">Every match is scored against other appearances in the same position group (attacker, midfielder or defender as reported by EA for that match). Each component becomes a percentile (50 = typical), then a weighted average. A player's score is the average of their match scores, so switching positions never counts against them. EA match rating is not used.</p>
      <table class="weights">${rows}</table></details>`;
  }

  function renderRankings() {
    const rk = model.rankings;
    const groupNote = state.group === "all" ? "" : ` Showing ${S.GROUP_LABELS[state.group].toLowerCase()} appearances only.`;
    const scored = rk.scores.qualified.map(t => scoreRow(t, t.rank)).join("");
    const provisional = rk.scores.provisional.map(t => scoreRow(t, null)).join("");
    const catButtons = rk.categories.map(c =>
      `<button data-category="${esc(c.key)}" class="${state.category === c.key ? "active" : ""}">${esc(c.label)}</button>`).join("");

    $("rankings").innerHTML = `
      <h2>🏆 Panda Score standings</h2>
      <p>Position-adjusted overall performance.${esc(groupNote)} Qualified players have ${state.minMatches}+ scored matches.</p>
      ${scoreExplainer()}
      <div class="panel">${scored || '<div class="muted">No qualified players. Lower the minimum matches.</div>'}</div>
      ${provisional ? `<details class="panel"><summary>${rk.scores.provisional.length} provisional players</summary>${provisional}</details>` : ""}
      <h2>Category leaderboards</h2>
      <div class="buttons scroll">${catButtons}</div>
      ${rk.categoryRankings(state.category).map(metricPanel).join("")}`;
  }

  // ------------------------------------------------------------ evolution

  function renderEvolution() {
    const e = model.evolution;
    const opt = (v, l, c) => `<option value="${esc(v)}" ${v === c ? "selected" : ""}>${esc(l)}</option>`;
    const metricOptions = EVOLUTION_METRICS.map(k => opt(k, k === "pandaScore" ? "Panda Score" : S.getMetric(k).label, state.evolutionMetric)).join("");
    const unit = e.metric !== "pandaScore" && S.getMetric(e.metric).type === "ratio" ? " pp" : "";
    const scale = e.metric === "pandaScore" ? { min: 0, max: 100 } : {};

    const movers = (list, title) => `<div class="panel"><h3>${esc(title)}</h3>${list.length ? list.map(m =>
      `<div class="mover"><b>${esc(m.name)}</b><span class="${m.change > 0 ? "up" : "down"}">${signed(m.change, 1, unit)}</span><span class="muted small">${esc(m.from)} → ${esc(m.to)} (${m.samples[0]} → ${m.samples[1]} matches)</span></div>`).join("")
      : '<div class="muted">Needs two completed periods with 3+ matches each.</div>'}</div>`;

    const active = e.series.filter(s => s.points.some(p => p.value !== null));
    const charts = state.evoMode === "squad"
      ? `<div class="panel">${lineChart(active, e.keys, e.complete, Object.assign({ label: e.metricLabel + " by player" }, scale))}${legend(active)}</div>`
      : `<div class="grid minis">${active.map(s => {
          const last = s.points.filter(p => p.value !== null).slice(-1)[0];
          return `<div class="panel mini"><div class="mini-head"><b>${esc(s.name)}</b><span>${num(last ? last.value : null)}</span></div>
            ${lineChart([s], e.keys, e.complete, Object.assign({ width: 300, height: 90, pad: 10, axis: false, dot: 3, label: s.name }, scale))}
            <div class="muted small">${s.points.reduce((a, p) => a + (p.sample || 0), 0)} matches</div></div>`;
        }).join("")}</div>`;

    $("evolution").innerHTML = `
      <h2>📈 Panda Evolution</h2>
      <p>How performance changes over ${e.period === "week" ? "Monday–Sunday weeks" : "calendar months"} (Europe/London). Hollow points are periods still in progress. Accuracy changes are in percentage points.</p>
      <div class="filters inline">
        <label>Period<select id="evoPeriod">${opt("week", "Weekly", state.evolutionPeriod)}${opt("month", "Monthly", state.evolutionPeriod)}</select></label>
        <label>Metric<select id="evoMetric">${metricOptions}</select></label>
        <label>View<select id="evoMode">${opt("mini", "One chart per player", state.evoMode)}${opt("squad", "Squad comparison", state.evoMode)}</select></label>
      </div>
      <div class="panel"><h3>Squad ${esc(e.metricLabel)}</h3>
        ${lineChart([{ name: "Squad", points: e.squad, color: "#ffd76a" }], e.keys, e.complete, Object.assign({ label: "Squad trend" }, scale))}
        <div class="muted small">${e.squad.map(p => esc(p.period.slice(5)) + ": " + (p.sample || 0)).join(" · ")} matches</div>
      </div>
      <div class="grid two">${movers(e.improvers, "📈 Improving")}${movers(e.decliners, "📉 Declining")}</div>
      ${charts}`;

    $("evoPeriod").onchange = ev => { state.evolutionPeriod = ev.target.value; render(); };
    $("evoMetric").onchange = ev => { state.evolutionMetric = ev.target.value; render(); };
    $("evoMode").onchange = ev => { state.evoMode = ev.target.value; render(); };
  }

  // ------------------------------------------------------------------ lab

  function labMetric(m) {
    let main;
    let detail;
    if (m.type === "ratio") {
      main = m.rate === null ? "—" : num(m.rate) + "%";
      detail = m.denominator ? `${m.numerator} of ${m.denominator}` : "No attempts";
    } else {
      main = m.per90 !== null ? num(m.per90, 2) : num(m.perMatch, 2);
      detail = `${m.total === null ? "—" : m.total} total · ${num(m.perMatch, 2)}/match${m.per90 !== null ? " · per 90 shown" : ""}`;
    }
    const peer = m.peer === null ? "" : `<div class="peer">Typical for your positions: ${m.type === "ratio" ? num(m.peer) + "%" : num(m.peer, 2)}</div>`;
    return `<div class="metric-card ${m.status === "provisional" ? "provisional" : ""}">
      <div class="metric-label">${esc(m.label)} ${badge(m.confidence)}</div>
      <div class="metric-value">${esc(main)}</div>
      <div class="metric-detail">${esc(detail)}</div>
      ${peer}
      <div class="metric-detail">${coverageChip(m.coverage.withData, m.coverage.appearances)}${m.status === "provisional" ? ' <span class="chip">Provisional</span>' : ""}</div>
    </div>`;
  }

  function renderLab() {
    const l = model.lab;
    if (!l) {
      $("lab").innerHTML = empty("No player data for these filters.");
      return;
    }
    state.player = l.id;
    const sc = l.score;
    const options = l.players.map(p => `<option value="${esc(p.id)}" ${p.id === l.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const list = (items, cls) => items.length ? items.map(x => `<span class="chip ${cls}">${esc(x.label)} · ${num(x.percentile, 0)}th pct</span>`).join("") : '<span class="muted">Not enough data</span>';
    const dna = l.passingDna.map(d => `
      <div class="direction-row">
        <div class="direction-label"><b>${esc(d.direction)}</b><span>${d.attempts} attempts · ${d.accuracy === null ? "—" : num(d.accuracy) + "% completed"} · ${num(d.share, 0)}% of passes</span></div>
        ${bar(d.share)}
      </div>`).join("");
    const tips = l.tips.length ? l.tips.map(t => `<div class="note"><b>${esc(t.title)}</b><br>${esc(t.tip)}<div class="muted small">${esc(t.evidence)}</div></div>`).join("")
      : '<div class="note">No clear weaknesses against positional peers in this filter. Keep it up.</div>';

    $("lab").innerHTML = `
      <h2>🔬 Panda Lab</h2>
      <div class="panel"><label>Player<select id="labPlayer">${options}</select></label></div>
      <div class="profile">
        <div class="profile-top">
          <div><div class="profile-rating">${num(sc.score, 0)}</div><div class="muted">Panda Score${sc.status === "provisional" ? " · provisional" : ""}</div></div>
          <div class="right"><div class="muted">EA rating (reference)</div><b>${num(l.rating.mean, 2)}</b></div>
        </div>
        <h2>🐼 ${esc(l.name)}</h2>
        <div class="chips">${groupChips(sc.byGroup)}</div>
        <p class="small">${l.coverage.appearances} appearances · ${l.coverage.withEvents} with full event data${l.coverage.didNotPlay ? " · " + l.coverage.didNotPlay + " zero-minute entries excluded" : ""}</p>
      </div>
      <div class="grid two">
        <div class="panel"><h3>💪 Strengths vs positional peers</h3><div class="chips">${list(sc.strengths, "good")}</div></div>
        <div class="panel"><h3>🛠️ To work on</h3><div class="chips">${list(sc.weaknesses, "bad")}</div></div>
      </div>
      <div class="panel"><h3>🎓 Personal coaching</h3>${tips}</div>
      <div class="panel"><h3>🧬 Passing DNA</h3><p class="small">Share and completion of passes with a recorded direction. Failed-pass directions are under-recorded by EA, so completion here reads slightly high.</p>${dna}</div>
      ${l.categories.map(c => `<div class="panel"><h3>${esc(c.label)}</h3><div class="metric-grid">${c.metrics.map(labMetric).join("")}</div></div>`).join("")}`;

    $("labPlayer").onchange = ev => { state.player = ev.target.value; render(); };
  }

  // ---------------------------------------------------------------- squad

  function renderSquad() {
    const cards = model.squad.map(p => `
      <div class="card">
        <div class="card-top"><div class="card-score">${num(p.score, 0)}</div><div class="card-pos">${p.bestGroup ? esc(p.bestGroup.group) : "—"}</div></div>
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-stats">
          <span><b>${p.appearances}</b>Apps</span><span><b>${p.goals === null ? "—" : p.goals}</b>Goals</span>
          <span><b>${p.assists === null ? "—" : p.assists}</b>Assists</span><span><b>${num(p.rating, 1)}</b>EA avg</span>
        </div>
        <div class="finder">
          <div class="muted small">Best Position Finder</div>
          ${p.groups.map(g => `<div class="finder-row"><span>${esc(g.label)}</span>${bar(g.score)}<b>${num(g.score, 0)}</b><span class="muted small">${g.appearances} apps${g.tentative ? " · tentative" : ""}</span></div>`).join("") || '<div class="muted small">No scored matches</div>'}
        </div>
        <div class="muted small">${p.archetype ? "Most used archetype: #" + esc(p.archetype.id) + " (" + p.archetype.appearances + " apps) — EA doesn't publish archetype names" : "Archetype unknown"}</div>
      </div>`).join("");
    $("squad").innerHTML = `
      <h2>🃏 Squad & Builds</h2>
      <p>Cards use match performance. EA's API reports only the position group (attacker, midfielder, defender) for each match, so the Best Position Finder compares groups, not exact positions. Fewer than 5 matches in a group is tentative. Build attributes, PlayStyles and portraits aren't available from EA.</p>
      <div class="grid cards">${cards || empty("No players for these filters.")}</div>`;
  }

  // --------------------------------------------------------------- awards

  function awardCard(a) {
    return `<div class="award ${a.shame ? "shame" : ""}">
      <div class="award-title">${esc(a.title)}</div>
      <div class="award-player">${a.winner ? esc(a.winner.name) : "No eligible winner"}</div>
      <div class="award-number">${a.value ? esc(a.value) : "—"}</div>
      <div class="award-description">${esc(a.description)}</div>
      <div class="award-footer">${a.shame && a.advice ? "Redemption plan: " + esc(a.advice) : ""}${a.sample ? `<br><span class="muted">${esc(a.sample)}</span>` : ""}</div>
    </div>`;
  }

  function renderAwards() {
    const week = model.overview.bamboo;
    const useWeek = state.awardsScope === "week" && week.week;
    const set = useWeek ? week.awards : model.awards;
    const scopeLabel = useWeek
      ? `Weekly Bamboo: ${dateLabel(week.start)} – ${dateLabel(week.end)} (${week.minMatches}+ matches to qualify)`
      : `Current filters (${state.minMatches}+ scored matches to qualify)`;
    $("awards").innerHTML = `
      <h2>🌟 Awards</h2>
      <div class="buttons">
        <button data-scope="week" class="${state.awardsScope === "week" ? "active" : ""}">🎋 Weekly Bamboo</button>
        <button data-scope="filters" class="${state.awardsScope === "filters" ? "active" : ""}">🔎 Current filters</button>
      </div>
      <p>${esc(scopeLabel)} · ${set.eligible} eligible players. Awards compare players with others in the same positions where it matters.</p>
      <h3>🏛️ Hall of Pandas</h3>
      <div class="award-grid">${set.hall.map(awardCard).join("")}</div>
      <h3>💀 Wall of Shame</h3>
      <div class="award-grid">${set.shame.map(awardCard).join("")}</div>`;
    document.querySelectorAll("[data-scope]").forEach(b => {
      b.onclick = () => { state.awardsScope = b.dataset.scope; render(); };
    });
  }

  // ----------------------------------------------------------------- main

  function render() {
    model = I.build(prepared, state, new Date(), state.player);
    renderNav();
    renderFilters();
    const renderers = { overview: renderOverview, rankings: renderRankings, evolution: renderEvolution,
                        lab: renderLab, squad: renderSquad, awards: renderAwards };
    VIEWS.forEach(([key]) => $(key).classList.toggle("hidden", key !== state.view));
    renderers[state.view]();

    document.querySelectorAll("[data-category]").forEach(b => {
      b.onclick = () => { state.category = b.dataset.category; render(); };
    });
    document.querySelectorAll("[data-player]").forEach(b => {
      b.onclick = () => { state.player = b.dataset.player; state.view = "lab"; render(); };
    });
    document.querySelectorAll("[data-goto]").forEach(b => {
      b.onclick = () => { state.view = b.dataset.goto; render(); };
    });
    $("updated").textContent = loadedAt ? "Data loaded " + dateLabel(loadedAt, true) : "";
  }

  function load() {
    $("refresh").disabled = true;
    $("loading").classList.remove("hidden");
    google.script.run
      .withSuccessHandler(data => {
        $("refresh").disabled = false;
        if (!data || !data.ok) {
          $("loading").textContent = (data && data.message) || "No data returned.";
          return;
        }
        prepared = I.prepare(data);
        loadedAt = new Date();
        $("loading").classList.add("hidden");
        $("app").classList.remove("hidden");
        render();
      })
      .withFailureHandler(() => {
        $("refresh").disabled = false;
        $("loading").textContent = "Unable to load PandaMetrics right now. Please try again.";
      })
      .getDashboardData();
  }

  $("refresh").onclick = load;
  load();
})();
