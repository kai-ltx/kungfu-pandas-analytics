// ==========================================
// PANDAMETRICS V4.1 - DASHBOARD UI
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

  // Which global filters each section uses, shown under the filters.
  const FILTER_NOTES = {
    overview: "Club cards and recent matches follow the filters. Weekly winners use the last complete week for the selected club.",
    rankings: "",
    evolution: "Form (last 5 vs previous 5) ignores the period filter.",
    lab: "Form ignores the period filter.",
    squad: "Form and the build advisor use every match for the selected club and position.",
    awards: "Awards follow the club filter only: Weekly Bamboo is the last complete week, All-time is everything recorded."
  };

  const state = Object.assign({}, I.DEFAULT_STATE, {
    view: "overview",
    category: "passing",
    player: null,
    evoMode: window.matchMedia && window.matchMedia("(max-width: 700px)").matches ? "mini" : "squad",
    awardsScope: "week",
    scrollTo: null
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
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
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

  function empty(text, hint, icon) {
    return `<div class="panel empty"><div class="empty-icon">${icon || "🎋"}</div><b>${esc(text)}</b>${hint ? `<div class="muted small">${esc(hint)}</div>` : ""}</div>`;
  }

  // ▲ / ▼ / ● with colour from whether the change is good, not its sign.
  function trendChip(t, change, digits, unit) {
    if (!t || t.direction === "unknown") return '<span class="trend none">–</span>';
    const icon = t.direction === "up" ? "▲" : t.direction === "down" ? "▼" : "●";
    const cls = t.direction === "steady" ? "steady" : t.good === false ? "bad" : t.good === true ? "good" : "neutral";
    return `<span class="trend ${cls}">${icon} ${esc(signed(change, digits === undefined ? 1 : digits, unit))}</span>`;
  }

  function badgeChips(badges) {
    return (badges || []).map(b => `<span class="chip persona" title="${esc(num(b.index, 1))}× typical for their positions${b.winner ? " · award winner" : ""}">${esc(b.title)}</span>`).join("");
  }

  function scoreButton(id, score, cls) {
    return `<button class="score-link ${cls || ""}" data-explain="${esc(id)}" title="Explain this Panda Score">${num(score, 0)}</button>`;
  }

  function recentDots(recent) {
    if (!recent || !recent.length) return '<span class="muted small">No scored matches yet</span>';
    return `<span class="recent">${recent.map(r => `<span class="dot ${r.score >= 60 ? "hi" : r.score < 40 ? "lo" : "mid"}" title="${esc(dateLabel(r.when))} · ${esc(r.group)} · ${num(r.score, 0)}${r.result ? " · " + esc(r.result) : ""}">${num(r.score, 0)}</span>`).join("")}</span>`;
  }

  function formUnit(metricKey) {
    if (metricKey === "pandaScore") return "";
    const m = S.getMetric(metricKey);
    return m.type === "ratio" ? " pp" : m.display === "total" ? " /match" : "";
  }

  // -------------------------------------------------------------- charts

  const PALETTE = ["#baff83", "#62d69e", "#ffd76a", "#7cc8ff", "#ff9685", "#c79bff", "#ffb35c", "#9be7e0", "#f0f8f1", "#a7bcae"];

  function finiteValues(seriesList) {
    return seriesList.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null && Number.isFinite(v));
  }

  function lineChart(seriesList, keys, complete, opts) {
    const o = Object.assign({ width: 640, height: 220, pad: 36, min: null, max: null }, opts);
    const values = finiteValues(seriesList);
    if (!values.length || keys.length < 1) return '<div class="muted small">Not enough data for a chart yet.</div>';
    const lo = o.min !== null ? o.min : 0;
    const hi = o.max !== null ? o.max : Math.max(...values, lo + 1);
    const span = hi - lo || 1;
    const left = o.axis === false ? o.pad : 42;
    const right = 28;
    const bottom = o.axis === false ? o.pad : 32;
    const x = i => left + (keys.length === 1 ? (o.width - left - right) / 2 : i * (o.width - left - right) / (keys.length - 1));
    const y = v => o.height - bottom - (v - lo) / span * (o.height - bottom - 16);
    const mid = lo + span / 2;

    const lines = seriesList.map((s, si) => {
      const color = s.color || PALETTE[si % PALETTE.length];
      let solid = "";
      let dashed = "";
      let previous = null;
      let solidOpen = false;
      const dots = [];
      s.points.forEach((p, i) => {
        if (p.value === null || !Number.isFinite(p.value)) return;
        const here = x(i).toFixed(1) + "," + y(p.value).toFixed(1);
        if (previous !== null && i === previous + 1) {
          solid += (solidOpen ? "L" : "M") + here;
          solidOpen = true;
        } else {
          if (previous !== null) {
            dashed += "M" + x(previous).toFixed(1) + "," + y(s.points[previous].value).toFixed(1) + "L" + here;
          }
          solid += "M" + here;
          solidOpen = true;
        }
        previous = i;
        const hollow = complete && complete[i] === false;
        dots.push(`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${o.dot || 3.5}" fill="${hollow ? "#14251d" : color}" stroke="${color}" stroke-width="1.5"><title>${esc(s.name)} · ${esc(keys[i])}: ${num(p.value)}${p.sample !== undefined ? " (" + p.sample + " matches)" : ""}${hollow ? " · in progress" : ""}</title></circle>`);
      });
      const stroke = `fill="none" stroke="${color}" stroke-width="${o.stroke || 2.5}" stroke-linecap="round" stroke-linejoin="round"`;
      return `<path d="${solid}" ${stroke}/>${dashed ? `<path d="${dashed}" ${stroke} stroke-dasharray="4 4" opacity="0.45"/>` : ""}${dots.join("")}`;
    }).join("");

    const grid = [hi, mid, lo].map(v =>
      `<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${o.width - right}" y2="${y(v).toFixed(1)}" stroke="rgba(240,248,241,0.12)"/>`
    ).join("");
    const reference = o.reference !== undefined && o.reference > lo && o.reference < hi
      ? `<line x1="${left}" y1="${y(o.reference).toFixed(1)}" x2="${o.width - right}" y2="${y(o.reference).toFixed(1)}" stroke="rgba(255,215,106,0.35)" stroke-dasharray="2 4"/>`
      : "";
    const labelStep = Math.max(1, Math.ceil(keys.length / 6));
    const axis = o.axis === false ? reference : `
      ${grid}${reference}
      <text x="4" y="${y(hi) + 4}" class="axis">${num(hi, hi >= 10 ? 0 : 1)}</text>
      <text x="4" y="${y(lo) + 4}" class="axis">${num(lo, 0)}</text>
      ${keys.map((k, i) => {
        if (i % labelStep !== 0 && i !== keys.length - 1) return "";
        const anchor = i === 0 ? "start" : i === keys.length - 1 ? "end" : "middle";
        return `<text x="${x(i)}" y="${o.height - 8}" class="axis" text-anchor="${anchor}">${esc(k.slice(5))}</text>`;
      }).join("")}`;

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
    const changed = state.club !== "all" || state.period !== "all" || state.group !== "all";
    const note = FILTER_NOTES[state.view];
    $("filters").innerHTML = `
      <div class="filters">
        <label>Club<select data-filter="club">${opt("all", "All clubs", state.club)}${clubs.map(([id, name]) => opt(id, name, state.club)).join("")}</select></label>
        <label>Period<select data-filter="period">${I.PERIODS.map(p => opt(p.key, p.label, state.period)).join("")}</select></label>
        <label>Position<select data-filter="group">${opt("all", "All positions", state.group)}${S.GROUPS.filter(g => g !== "GK").map(g => opt(g, S.GROUP_LABELS[g] + "s", state.group)).join("")}</select></label>
        <label class="reset-wrap">&nbsp;<button id="resetFilters" ${changed ? "" : "disabled"}>↺ Reset</button></label>
      </div>
      ${note ? `<div class="filter-note">${esc(note)}</div>` : ""}`;
    document.querySelectorAll("[data-filter]").forEach(el => {
      el.onchange = () => {
        state[el.dataset.filter] = el.value;
        render();
      };
    });
    $("resetFilters").onclick = () => {
      Object.assign(state, { club: "all", period: "all", group: "all" });
      render();
    };
  }

  function renderNav() {
    $("nav").innerHTML = VIEWS.map(([key, label]) =>
      `<button data-view="${key}" class="${state.view === key ? "active" : ""}" aria-current="${state.view === key ? "page" : "false"}">${esc(label)}</button>`).join("");
    document.querySelectorAll("[data-view]").forEach(b => {
      b.onclick = () => {
        state.view = b.dataset.view;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    });
    const active = document.querySelector("#nav button.active");
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest", inline: "center" });
  }

  // ---------------------------------------------------------- award cards

  function statLines(stats) {
    if (!stats || !stats.length) return "";
    return `<ul class="award-stats">${stats.map(s => `<li>${esc(s.text)}${s.experimental ? ' <span class="badge exp">Experimental</span>' : ""}</li>`).join("")}</ul>`;
  }

  function awardCard(a) {
    const cls = a.kind === "personality" ? "persona" : a.shame ? "shame" : "";
    const why = a.winner ? statLines(a.stats) : `<div class="muted small">${a.kind === "personality" ? "Nobody stood out enough (needs 1.25× typical for their positions)." : "No eligible winner yet."}</div>`;
    const footer = [
      a.shame && a.advice && a.winner ? "Redemption plan: " + esc(a.advice) : "",
      a.note ? esc(a.note) : "",
      a.sample ? `<span class="muted">${esc(a.sample)}</span>` : ""
    ].filter(Boolean).join("<br>");
    return `<div class="award ${cls}">
      <div class="award-title">${esc(a.title)} ${a.experimental ? '<span class="badge exp" title="Uses an unverified community event mapping">🧪 Experimental data</span>' : ""}</div>
      <div class="award-player">${a.winner ? `<button class="name-link" data-player="${esc(a.winner.id)}">${esc(a.winner.name)}</button>` : "—"}</div>
      <div class="award-number">${a.value ? esc(a.value) : ""}</div>
      <div class="award-description">${esc(a.description)}</div>
      ${why}
      ${footer ? `<div class="award-footer">${footer}</div>` : ""}
    </div>`;
  }

  function miniAward(a) {
    return `<button class="mini-award ${a.kind === "personality" ? "persona" : a.shame ? "shame" : ""}" data-goto="awards">
      <div class="muted small">${esc(a.title)}${a.experimental ? " 🧪" : ""}</div>
      <div class="name">${a.winner ? esc(a.winner.name) : "—"}</div>
      <div class="muted small">${a.value ? esc(a.value) : "No eligible player"}</div>
    </button>`;
  }

  // ------------------------------------------------------------- overview

  function formRow(p, metricKey) {
    return `<div class="form-row">
      <button class="name-link" data-player="${esc(p.id)}">${esc(p.name)}</button>
      <span class="muted small">${num(p.previous.value, 0)} → ${num(p.last.value, 0)}</span>
      ${trendChip(p.trend, p.change, 1, formUnit(metricKey))}
    </div>`;
  }

  function renderOverview() {
    const o = model.overview;
    const cov = o.coverage;
    const sync = o.sync || {};
    const bamboo = o.bamboo;
    const ch = o.clubhouse;

    const clubCards = Object.values(o.clubs).filter(c => c.played).map(c => `
      <div class="panel club">
        <h3>${esc(c.name)}</h3>
        <div class="record"><b>${c.wins}</b>W <b>${c.draws}</b>D <b>${c.losses}</b>L</div>
        <div class="muted">${c.goalsFor}–${c.goalsAgainst} goals · ${c.played} matches${c.playoffs ? " · " + c.playoffs + " playoff" : ""}</div>
        <div class="forms">${formChips(c.form)}</div>
      </div>`).join("") || empty("No official matches in this filter.", "Try All clubs or All recorded.", "🏟️");

    const pick = key => bamboo.week ? bamboo.awards.hall.concat(bamboo.awards.shame).find(a => a.key === key) : null;
    const headline = ["pandaOfWeek", "shotgunTarget"].map(pick).filter(Boolean).concat(ch.funny);

    const recent = o.recent.map(m => `
      <div class="match-row">
        <span class="form ${esc(m.result)}">${esc((m.result || "?")[0].toUpperCase())}</span>
        <span class="grow">${esc(prepared.clubs[m.clubId] || m.clubId)} <span class="muted">vs</span> ${esc(m.opponentName)}</span>
        <b>${m.goals}–${m.goalsAgainst}</b>
        <span class="muted small">${dateLabel(m.timestampUnix * 1000)}${m.matchType === "playoffMatch" ? " · Playoff" : ""}</span>
      </div>`).join("");

    $("overview").innerHTML = `
      <div class="panel bamboo clubhouse">
        <div class="eyebrow">🏟️ THE CLUBHOUSE NOTICEBOARD</div>
        ${bamboo.week ? `
          <h2>Week of ${dateLabel(bamboo.start)} – ${dateLabel(bamboo.end)}</h2>
          <p>${bamboo.matches} official matches · <b>${bamboo.record.wins}W ${bamboo.record.draws}D ${bamboo.record.losses}L</b> · weekly winners need ${bamboo.minMatches}+ matches that week</p>
          <div class="mini-awards">${headline.map(miniAward).join("")}</div>
          <button class="link" data-goto="awards">Every weekly award and personality →</button>
        ` : "<p>No complete week with official matches yet. Weekly winners appear after the first full Monday–Sunday week.</p>"}
      </div>

      <div class="grid two">
        <div class="panel"><h3>🔥 In form</h3><p class="small">Average Panda Score, last 5 matches vs the 5 before.</p>${ch.hot.map(p => formRow(p, "pandaScore")).join("") || '<div class="muted small">Nobody is on a clear upswing (needs +3 over 3+ matches in both windows).</div>'}</div>
        <div class="panel"><h3>🥶 Cold streak</h3><p class="small">Same comparison, biggest drops.</p>${ch.cold.map(p => formRow(p, "pandaScore")).join("") || '<div class="muted small">No clear slumps. Lovely.</div>'}</div>
      </div>

      <h2>Clubs</h2>
      <div class="grid">${clubCards}</div>

      <div class="panel">
        <h3>Recent matches</h3>
        ${recent || '<div class="muted">No matches in this filter.</div>'}
      </div>

      <div class="grid stats">
        <div class="panel"><div class="stat">${o.matches}</div><div class="muted">Official matches</div></div>
        <div class="panel"><div class="stat">${cov.appearances}</div><div class="muted">Player appearances</div></div>
        <div class="panel"><div class="stat">${num(cov.eventCoveragePct, 0)}%</div><div class="muted">Detailed event coverage</div></div>
        <div class="panel"><div class="stat small-stat">${dateLabel(sync.lastSync, true)}</div><div class="muted">Last successful sync</div></div>
      </div>

      <details class="panel">
        <summary><b>Data coverage and quality</b></summary>
        <p class="small">${cov.withEvents} of ${cov.appearances} appearances have complete event data. ${cov.eventsUnavailable} use EA's named totals only (goals, passes, tackles)${cov.incomplete ? `, including ${cov.incomplete} where EA cut the event log short` : ""}; event-based stats skip those matches rather than counting zero. ${cov.didNotPlay} zero-minute entries are excluded from every participation count.${o.duplicatesDropped ? " " + o.duplicatesDropped + " duplicate rows ignored." : ""} Stats marked <span class="badge exp">Experimental</span> use community event mappings and never feed the Panda Score or performance awards.</p>
        <div class="chips">${Object.entries(cov.groups).map(([g, n]) => `<span class="chip grp ${esc(g)}">${esc(S.GROUP_LABELS[g] || g)} · ${n}</span>`).join("")}</div>
      </details>`;
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
        <div class="value">${scoreButton(t.id, t.score)}</div>
      </div>`;
  }

  function metricValue(entry, rk) {
    const a = entry.aggregate;
    if (rk.unit === "%") return { main: num(entry.value) + "%", detail: `${a.numerator}/${a.denominator}` };
    if (rk.unit === "total") return { main: a.total === null ? "—" : String(Math.round(a.total)), detail: `${a.matchesWithData} matches` };
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
        <div class="grow"><button class="name-link rank-name" data-player="${esc(e.id)}">${esc(e.name)}</button> ${coverageChip(e.aggregate.matchesWithData, e.aggregate.appearances)}</div>
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
        ${rows || '<div class="muted small">No qualified players yet. Players need 3 matches with this stat.</div>'}
        ${prov}
      </div>`;
  }

  function scoreExplainer() {
    const rows = Object.entries(S.ROLE_WEIGHTS).map(([g, w]) =>
      `<tr><th>${esc(S.GROUP_LABELS[g])}</th><td>${Object.entries(w).map(([k, v]) => esc(S.getMetric(k).label) + " ×" + v).join(", ")}</td></tr>`).join("");
    return `<details class="panel"><summary><b>How the Panda Score works</b></summary>
      <p class="small">Every match is scored against other appearances in the same position group (attacker, midfielder or defender as reported by EA for that match). Each component becomes a percentile (50 = typical), then a weighted average. A player's score is the average of their match scores, so switching positions never counts against them. EA match rating is not used. Tap any score to see its breakdown.</p>
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
      <p>Position-adjusted overall performance.${esc(groupNote)} A player needs ${state.minMatches} scored matches before they are ranked. Tap a score to see why.</p>
      ${scoreExplainer()}
      <div class="panel">${scored || `<div class="muted">No player has ${state.minMatches} scored matches in this filter yet. Try a longer period.</div>`}</div>
      ${provisional ? `<details class="panel"><summary>${rk.scores.provisional.length} provisional players</summary>${provisional}</details>` : ""}
      <h2>Category leaderboards</h2>
      <div class="buttons scroll">${catButtons}</div>
      ${rk.categoryRankings(state.category).map(metricPanel).join("")}`;
  }

  // ------------------------------------------------------------ evolution

  function metricSelect(id, current) {
    const opt = (v, l) => `<option value="${esc(v)}" ${v === current ? "selected" : ""}>${esc(l)}</option>`;
    const groups = I.DISPLAY_CATEGORIES.map(c => `<optgroup label="${esc(c.label)}">${c.metrics.map(k => opt(k, S.getMetric(k).label)).join("")}</optgroup>`).join("");
    return `<select id="${id}"><optgroup label="Overall">${opt("pandaScore", "Panda Score")}</optgroup>${groups}</select>`;
  }

  function renderEvolution() {
    const e = model.evolution;
    const opt = (v, l, c) => `<option value="${esc(v)}" ${v === c ? "selected" : ""}>${esc(l)}</option>`;
    const metric = e.metric === "pandaScore" ? null : S.getMetric(e.metric);
    const unit = metric && metric.type === "ratio" ? " pp" : "";
    const shared = e.series.concat([{ points: e.squad }]);
    const peak = Math.max(0, ...finiteValues(shared));
    const scale = !metric || metric.type === "ratio" ? { min: 0, max: 100 } : { min: 0, max: Math.max(1, Math.ceil(peak)) };
    if (!metric) scale.reference = 50;
    const periodWord = e.period === "week" ? "Week-on-week" : "Month-on-month";
    const directionNote = e.direction === false ? " Lower is better for this stat, so a drop shows green." : e.direction === null ? " Context only: neither direction is good or bad." : "";

    const movers = (list, title) => `<div class="panel"><h3>${esc(title)}</h3>${list.length ? list.map(m =>
      `<div class="mover"><b>${esc(m.name)}</b>${trendChip(m.trend, m.change, 1, m.unit)}<span class="muted small">${esc(m.from.slice(5))} → ${esc(m.to.slice(5))} (${m.samples[0]} → ${m.samples[1]} matches)</span></div>`).join("")
      : `<div class="muted small">Needs two consecutive completed ${e.period}s with 3+ matches each.</div>`}</div>`;

    const formLookup = {};
    e.form.ready.concat(e.form.waiting).forEach(p => { formLookup[p.id] = p; });
    const active = e.series.filter(s => s.points.some(p => p.value !== null));
    const charts = state.evoMode === "squad"
      ? `<div class="panel">${lineChart(active, e.keys, e.complete, Object.assign({ label: e.metricLabel + " by player" }, scale))}${legend(active)}</div>`
      : `<div class="grid minis">${active.map(s => {
          const last = s.points.filter(p => p.value !== null).slice(-1)[0];
          const f = formLookup[s.id];
          return `<div class="panel mini"><div class="mini-head"><button class="name-link" data-player="${esc(s.id)}">${esc(s.name)}</button><span>${num(last ? last.value : null)} ${f && f.ready ? trendChip(f.trend, f.change, 1, formUnit(e.metric)) : ""}</span></div>
            ${lineChart([s], e.keys, e.complete, Object.assign({ width: 300, height: 90, pad: 10, axis: false, dot: 3, label: s.name }, scale))}
            <div class="muted small">${s.points.reduce((a, p) => a + (p.sample || 0), 0)} matches${f && !f.ready ? " · form: " + esc(f.needs) : ""}</div></div>`;
        }).join("")}</div>`;

    const formRows = e.form.ready.map(p => formRow(p, e.metric)).join("");

    $("evolution").innerHTML = `
      <h2>📈 Panda Evolution</h2>
      <p>Is everyone getting better? ${e.period === "week" ? "Monday–Sunday weeks" : "Calendar months"} in UK time. Hollow points are periods still in progress; dashed lines bridge periods without matches.${esc(directionNote)}</p>
      <div class="filters inline">
        <label>Stat${metricSelect("evoMetric", state.evolutionMetric)}</label>
        <label>Period<select id="evoPeriod">${opt("week", "Weekly", state.evolutionPeriod)}${opt("month", "Monthly", state.evolutionPeriod)}</select></label>
        <label>Chart<select id="evoMode">${opt("mini", "One chart per player", state.evoMode)}${opt("squad", "Squad comparison", state.evoMode)}</select></label>
      </div>
      <div class="panel"><h3>🔥 Form: last 5 vs previous 5 · ${esc(e.metricLabel)}</h3>
        <p class="small">Each player's last five matches with this stat against the five before.${e.unit === "total" ? " Counts are compared per match so different window sizes stay fair." : ""}</p>
        ${formRows || '<div class="muted small">Nobody has 3+ matches in both windows yet.</div>'}
        ${e.form.waiting.length ? `<details><summary>${e.form.waiting.length} players without enough matches</summary>${e.form.waiting.map(p => `<div class="prov"><b>${esc(p.name)}</b> <span class="muted">${esc(p.needs || "Not enough data")}</span></div>`).join("")}</details>` : ""}
      </div>
      <div class="grid two">${movers(e.improvers, "📈 " + periodWord + " improvers")}${movers(e.decliners, "📉 " + periodWord + " declines")}</div>
      <div class="panel"><h3>Squad ${esc(e.metricLabel)}</h3>
        ${lineChart([{ name: "Squad", points: e.squad, color: "#ffd76a" }], e.keys, e.complete, Object.assign({ label: "Squad trend" }, scale))}
        <div class="muted small">${!metric ? "Dotted line = 50, a typical performance. " : ""}${e.squad.map(p => esc(p.period.slice(5)) + ": " + (p.sample || 0)).join(" · ")} matches</div>
      </div>
      ${active.length ? charts : empty("No matches in this filter.", "Pick a longer period or another club.", "📉")}`;

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
    } else if (m.confidence === "experimental" && !m.coverage.withData) {
      main = "—";
      detail = "No event log on these matches, so this count was not recorded.";
    } else if (m.display === "total") {
      main = m.total === null ? "—" : String(Math.round(m.total));
      detail = "Total recorded in this filter.";
    } else {
      main = m.per90 !== null ? num(m.per90, 2) : num(m.perMatch, 2);
      detail = `${m.total === null ? "—" : m.total} total · ${num(m.perMatch, 2)}/match${m.per90 !== null ? " · per 90 shown" : ""}`;
    }
    const peer = m.display === "total" || m.peer === null ? "" : `<div class="peer">Typical for your positions: ${m.type === "ratio" ? num(m.peer) + "%" : num(m.peer, 2)}</div>`;
    return `<div class="metric-card ${m.status === "provisional" ? "provisional" : ""}">
      <div class="metric-label">${esc(m.label)} ${badge(m.confidence)}</div>
      <div class="metric-value">${esc(main)}</div>
      <div class="metric-detail">${esc(m.description)}</div>
      <div class="metric-detail">${esc(detail)}</div>
      ${peer}
      <div class="metric-detail">${coverageChip(m.coverage.withData, m.coverage.appearances)}${m.status === "provisional" ? ' <span class="chip">Provisional</span>' : ""}</div>
    </div>`;
  }

  function periodLine(label, c) {
    if (!c || !c.ready) return `<div class="form-row"><span>${esc(label)}</span><span class="muted small">${esc((c && c.needs) || "Not enough data")}</span></div>`;
    return `<div class="form-row"><span>${esc(label)}</span>
      <span class="muted small">${num(c.previous.value, 0)} (${c.previous.sample}) → ${num(c.current.value, 0)} (${c.current.sample})${c.current.inProgress ? " · in progress" : ""}</span>
      ${trendChip(c.trend, c.change, 1)}</div>`;
  }

  function formPanel(f) {
    const l5 = f.lastFive;
    return `<div class="panel"><h3>🔥 Form</h3>
      <div class="muted small">Last five match scores (oldest → newest)</div>
      ${recentDots(f.recent)}
      <div class="form-list">
        ${l5.ready ? `<div class="form-row"><span>Last 5 vs previous 5</span><span class="muted small">${num(l5.previous.value, 0)} → ${num(l5.last.value, 0)}</span>${trendChip(l5.trend, l5.change, 1)}</div>`
          : `<div class="form-row"><span>Last 5 vs previous 5</span><span class="muted small">${esc(l5.needs)}</span></div>`}
        ${periodLine("Week on week", f.week)}
        ${periodLine("Month on month", f.month)}
      </div>
      <p class="small">Average Panda Score per window; matches counted in brackets. ▲/▼ needs a change of 3+ points.</p>
    </div>`;
  }

  function componentRow(c) {
    const w = Math.min(50, Math.abs(c.impact) * 5);
    const value = c.mine === null || c.mine === undefined ? "—" : c.unit === "%" ? num(c.mine) + "%" : num(c.mine, 2) + " " + c.unit;
    const typical = c.typical === null || c.typical === undefined ? "—" : c.unit === "%" ? num(c.typical) + "%" : num(c.typical, 2) + " " + c.unit;
    return `<div class="component-row">
      <div class="component-label"><b>${esc(c.label)}</b><span class="muted small">weight ${esc(Object.entries(c.weights).map(([g, v]) => g + " ×" + v).join(", "))} · ${Math.round(c.percentile)}th pct · ${c.matches} matches</span></div>
      <div class="impact"><div class="impact-bar ${c.impact >= 0 ? "pos" : "neg"}" style="width:${w.toFixed(1)}%;${c.impact >= 0 ? "left:50%" : "right:50%"}"></div></div>
      <div class="component-value"><b>${signed(c.impact, 1)}</b><span class="muted small">you ${esc(value)} · typical ${esc(typical)}</span></div>
    </div>`;
  }

  function neighbourLine(n, me) {
    if (!n) return "";
    const ahead = n.gap >= 0;
    const reasons = n.reasons.map(r => esc(r.label) + " (" + signed(r.diff, 1) + ")").join(", ");
    return `<div class="note">${ahead ? "Ahead of" : "Behind"} <b>${esc(n.name)}</b> (${num(n.score, 1)}) by ${num(Math.abs(n.gap), 1)} points${reasons ? `, mostly from ${reasons}` : ""}.${n.relation === "above" ? " " + esc(me) + " is ranked just below them." : ""}</div>`;
  }

  function explainPanel(ex) {
    if (!ex) return `<div class="panel" id="explain"><h3>🧮 Explain my Panda Score</h3><div class="muted small">No scored matches in this filter.</div></div>`;
    const top = ex.strongest.map(c => esc(c.label)).join(", ") || "none";
    const low = ex.weakest.map(c => esc(c.label)).join(", ") || "none";
    return `<div class="panel" id="explain"><h3>🧮 Explain my Panda Score</h3>
      <p class="small">Start at 50 (a typical match for your position). Each component adds or removes points depending on how you compared with ${esc(S.GROUP_LABELS[ex.mainGroup].toLowerCase())}s and similar roles in the same matches. The points below add up exactly to <b>${num(ex.score, 1)}</b>. Values are for your ${esc(S.GROUP_LABELS[ex.mainGroup].toLowerCase())} matches.</p>
      <div class="explain-summary">
        <span class="chip good">💪 Lifting it: ${top}</span>
        <span class="chip bad">🛠️ Holding it back: ${low}</span>
        ${ex.rank ? `<span class="chip">#${ex.rank} of ${ex.of} ranked</span>` : '<span class="chip">Not ranked yet</span>'}
        ${ex.groupRank ? `<span class="chip">#${ex.groupRank} of ${ex.groupOf} mainly ${esc(S.GROUP_LABELS[ex.mainGroup].toLowerCase())}s</span>` : ""}
      </div>
      <div class="components">${ex.components.map(componentRow).join("")}</div>
      ${neighbourLine(ex.above, ex.name)}${neighbourLine(ex.below, ex.name)}
      ${ex.components.some(c => c.fallback) ? '<p class="small">Some components compare with every appearance because fewer than 10 matches exist for that position.</p>' : ""}
    </div>`;
  }

  function renderLab() {
    const l = model.lab;
    if (!l) {
      $("lab").innerHTML = empty("No player data for these filters.", "Pick All clubs or a longer period.", "🔬");
      return;
    }
    state.player = l.id;
    const sc = l.score;
    const options = l.players.map(p => `<option value="${esc(p.id)}" ${p.id === l.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const list = (items, cls) => items.length ? items.map(x => `<span class="chip ${cls}">${esc(x.label)} · ${num(x.percentile, 0)}th pct</span>`).join("") : '<span class="muted">Not enough data</span>';
    const p = l.passing;
    const dna = p.directions.map(d => `
      <div class="direction-row">
        <div class="direction-label"><b>${esc(d.direction)}</b><span>${d.attempts} recorded attempts · ~${d.accuracy === null ? "—" : num(d.accuracy) + "% completed"} <span class="muted">(recorded ${d.recordedAccuracy === null ? "—" : num(d.recordedAccuracy) + "%"})</span> · ${num(d.share, 0)}% of passes</span></div>
        ${bar(d.share)}
      </div>`).join("");
    const tips = l.tips.length ? l.tips.map(t => `<div class="note"><b>${esc(t.title)}</b><br>${esc(t.tip)}<div class="muted small">${esc(t.evidence)}</div></div>`).join("")
      : '<div class="note">No clear weaknesses against positional peers in this filter. Keep it up.</div>';

    $("lab").innerHTML = `
      <h2>🔬 Panda Lab</h2>
      <div class="panel"><label>Player<select id="labPlayer">${options}</select></label></div>
      <div class="profile">
        <div class="profile-top">
          <div>${scoreButton(l.id, sc.score, "profile-rating")}<div class="muted">Panda Score${sc.status === "provisional" ? " · provisional" : ""} · tap to explain</div></div>
          <div class="right"><div class="muted">EA rating (reference)</div><b>${num(l.rating.mean, 2)}</b></div>
        </div>
        <h2>🐼 ${esc(l.name)}</h2>
        <div class="chips">${groupChips(sc.byGroup)}</div>
        ${l.badges.length ? `<div class="chips">${badgeChips(l.badges)}</div>` : ""}
        <p class="small">${l.coverage.appearances} appearances · ${l.coverage.withEvents} with full event data${l.coverage.incomplete ? " · " + l.coverage.incomplete + " with a cut-short event log" : ""}${l.coverage.didNotPlay ? " · " + l.coverage.didNotPlay + " zero-minute entries excluded" : ""}</p>
      </div>
      <div class="grid two">
        <div class="panel"><h3>💪 Strengths vs positional peers</h3><div class="chips">${list(sc.strengths, "good")}</div></div>
        <div class="panel"><h3>🛠️ To work on</h3><div class="chips">${list(sc.weaknesses, "bad")}</div></div>
      </div>
      ${formPanel(l.form)}
      ${explainPanel(l.explanation)}
      <div class="panel"><h3>🎓 Personal coaching</h3>${tips}</div>
      <div class="panel"><h3>🧬 Passing DNA <span class="badge med">Estimate</span></h3><p class="small">Share and estimated completion by direction over ${p.matches} matches with full event data. EA records the direction of almost every completed pass but not of every failed one, so ${num(p.unrecordedFailed, 0)} failed passes without a direction are shared across directions in proportion to the recorded failures. The raw recorded rate, which reads high, is in brackets.</p>${p.matches ? dna : '<div class="muted small">No matches with full event data.</div>'}</div>
      ${l.categories.map(c => `<div class="panel"><h3>${esc(c.label)}</h3>${c.note ? `<p class="small">${esc(c.note)}</p>` : ""}<div class="metric-grid">${c.metrics.map(labMetric).join("")}</div></div>`).join("")}`;

    $("labPlayer").onchange = ev => { state.player = ev.target.value; render(); };
  }

  // ---------------------------------------------------------------- squad

  function keyStat(c, good) {
    const value = c.mine === null || c.mine === undefined ? "—" : c.unit === "%" ? num(c.mine) + "%" : num(c.mine, 2) + c.unit;
    return `<div class="key-stat ${good ? "good" : "bad"}">${good ? "▲" : "▼"} ${esc(c.label)} <span class="muted">${esc(value)} · ${Math.round(c.percentile)}th pct</span></div>`;
  }

  function archetypeLabel(a) {
    if (!a) return "—";
    return a.name ? `${esc(a.name)} <span class="muted">(#${esc(a.id)})</span>` : `#${esc(a.id)}`;
  }

  function advisorPanel(adv) {
    const usage = adv.usage.length ? `<table class="weights arch"><tr><th>Archetype</th><th>Apps</th><th>Avg score</th></tr>${adv.usage.map(u =>
      `<tr><td>${archetypeLabel(u)}${u.proven ? ' <span class="chip good">Proven</span>' : ""}</td><td>${u.appearances}</td><td>${u.scoredMatches ? num(u.averageScore, 0) + ` <span class="muted small">(${u.scoredMatches})</span>` : "—"}</td></tr>`).join("")}</table>`
      : '<div class="muted small">No archetype recorded yet.</div>';
    const change = adv.change ? (adv.change.ready
      ? `<div class="note">Switched ${archetypeLabel(adv.change.from)} → ${archetypeLabel(adv.change.to)} on ${esc(dateLabel(adv.change.when))}: ${num(adv.change.before.average, 0)} avg over ${adv.change.before.matches} matches before, ${num(adv.change.after.average, 0)} over ${adv.change.after.matches} after (${signed(adv.change.change, 1)}).</div>`
      : `<div class="muted small">Last switch ${archetypeLabel(adv.change.from)} → ${archetypeLabel(adv.change.to)}: ${esc(adv.change.needs)}.</div>`) : "";
    const recs = adv.status === "ok"
      ? adv.recommendations.map(r => `<div class="rec">
          <div class="rec-head"><span class="muted small">${esc(r.role)}</span><span class="chip ${r.basis === "Proven" ? "good" : ""}">${esc(r.basis)}</span></div>
          <div class="rec-name">${archetypeLabel(r)} <span class="muted small">· ${esc(S.GROUP_LABELS[r.group])} · ${esc(r.focus)}</span></div>
          <div class="small">${esc(r.why)}</div>
          ${r.evidence.length ? `<ul class="award-stats">${r.evidence.map(e => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
        </div>`).join("")
      : `<div class="muted small">${esc(adv.message)} (has ${adv.have}).</div>`;
    return `<details class="advisor"><summary>🧭 Archetype & Build Advisor${adv.status === "ok" ? ` · ${esc(adv.confidence)} confidence` : ""}</summary>
      ${adv.status === "ok" ? `<p class="small">Based on ${adv.scoredInMain} scored ${esc(S.GROUP_LABELS[adv.mainGroup].toLowerCase())} matches, compared with other ${esc(S.GROUP_LABELS[adv.mainGroup].toLowerCase())}s. Confidence: Low under ${I.ADVISOR.medium}, Medium ${I.ADVISOR.medium}–${I.ADVISOR.high - 1}, High ${I.ADVISOR.high}+. "Proven" means ${I.ADVISOR.proven}+ scored matches with that archetype; "Predicted" is a style match from your stats.</p>` : ""}
      ${recs}
      <div class="muted small">Archetypes used</div>${usage}
      ${change}
      <p class="small muted">${esc(adv.note)}</p>
    </details>`;
  }

  function renderSquad() {
    const cards = model.squad.map(p => `
      <div class="card">
        <div class="card-top">${scoreButton(p.id, p.score, "card-score")}<div class="card-pos" title="Strongest position group">${p.bestGroup ? esc(p.bestGroup.group) : "—"}</div></div>
        <button class="name-link card-name" data-player="${esc(p.id)}">${esc(p.name)}</button>
        ${p.badges.length ? `<div class="chips">${badgeChips(p.badges)}</div>` : ""}
        <div class="card-stats">
          <span><b>${p.appearances}</b>Apps</span><span><b>${p.goals === null ? "—" : p.goals}</b>Goals</span>
          <span><b>${p.assists === null ? "—" : p.assists}</b>Assists</span><span><b>${num(p.rating, 1)}</b>EA avg</span>
        </div>
        <div class="card-form"><span class="muted small">Recent form</span>${recentDots(p.recent)}${p.form.ready ? trendChip(p.form.trend, p.form.change, 1) : ""}</div>
        <div class="finder">
          <div class="muted small">Position groups${p.bestGroup ? " · strongest: " + esc(p.bestGroup.label) : ""}</div>
          ${p.groups.map(g => `<div class="finder-row"><span>${esc(g.label)}</span>${bar(g.score)}<b>${num(g.score, 0)}</b><span class="muted small">${g.appearances} apps${g.tentative ? " · tentative" : ""}</span></div>`).join("") || '<div class="muted small">No scored matches</div>'}
        </div>
        ${p.positives.length || p.negatives.length ? `<div class="key-stats">${p.positives.map(c => keyStat(c, true)).join("")}${p.negatives.map(c => keyStat(c, false)).join("")}</div>` : ""}
        ${advisorPanel(p.advisor)}
      </div>`).join("");
    $("squad").innerHTML = `
      <h2>🃏 Squad & Builds</h2>
      <p>Cards use match performance. EA reports only the position group (attacker, midfielder, defender) for each match, so comparisons are by group, not exact position. Fewer than 5 matches in a group is tentative. Build attributes, PlayStyles and portraits aren't available from EA.</p>
      <div class="grid cards">${cards || empty("No players for these filters.", "Pick All clubs or a longer period.", "🃏")}</div>`;
  }

  // --------------------------------------------------------------- awards

  function renderAwards() {
    const week = model.overview.bamboo;
    const useWeek = state.awardsScope === "week" && week.week;
    const set = useWeek ? week.awards : model.awards;
    const persona = useWeek ? week.personalities : model.awards.personalities;
    const scopeLabel = useWeek
      ? `Weekly Bamboo: ${dateLabel(week.start)} – ${dateLabel(week.end)} · ${week.minMatches}+ matches that week to qualify`
      : `All-time · ${state.minMatches}+ scored matches to qualify`;
    $("awards").innerHTML = `
      <h2>🌟 Awards</h2>
      <div class="buttons">
        <button data-scope="week" class="${state.awardsScope === "week" ? "active" : ""}" ${week.week ? "" : "disabled"}>🎋 Weekly Bamboo</button>
        <button data-scope="alltime" class="${state.awardsScope !== "week" ? "active" : ""}">🏛️ All-time</button>
      </div>
      <p>${esc(scopeLabel)} · ${set.eligible} eligible players. Awards compare players with others in the same positions where it matters.${useWeek ? "" : " Most Improved and Biggest Decline are weekly only."}</p>
      <h3>🏛️ Hall of Pandas</h3>
      <div class="award-grid">${set.hall.map(awardCard).join("")}</div>
      <h3>💀 Wall of Shame</h3>
      <div class="award-grid">${set.shame.map(awardCard).join("")}</div>
      <h3>🎭 Panda Personalities</h3>
      <p class="small">Just for fun, but measured: each one compares a player's rate with what a typical player produces in the same positions (1.0× = typical), needs ${persona.minMatches}+ matches and a clear margin. Players keep up to three badges on their profile.</p>
      <div class="award-grid">${persona.awards.map(awardCard).join("")}</div>`;
    document.querySelectorAll("[data-scope]").forEach(b => {
      b.onclick = () => { state.awardsScope = b.dataset.scope; render(); };
    });
  }

  // ----------------------------------------------------------------- main

  function render() {
    model = I.build(prepared, state, new Date(), state.player);
    if (state.awardsScope === "week" && !model.overview.bamboo.week) state.awardsScope = "alltime";
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
      b.onclick = () => { state.player = b.dataset.player; state.view = "lab"; render(); window.scrollTo({ top: 0 }); };
    });
    document.querySelectorAll("[data-explain]").forEach(b => {
      b.onclick = () => { state.player = b.dataset.explain; state.view = "lab"; state.scrollTo = "explain"; render(); };
    });
    document.querySelectorAll("[data-goto]").forEach(b => {
      b.onclick = () => { state.view = b.dataset.goto; render(); window.scrollTo({ top: 0 }); };
    });
    $("updated").textContent = loadedAt ? "Data loaded " + dateLabel(loadedAt, true) : "";
    if (state.scrollTo && $(state.scrollTo)) {
      $(state.scrollTo).scrollIntoView({ behavior: "smooth", block: "start" });
    }
    state.scrollTo = null;
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
