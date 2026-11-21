(() => {
  "use strict";
  const API = (window.APP_CONFIG.API_BASE_URL || "").replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const YESNO = [[1, "Yes"], [0, "No"]];
  const FIELDS = [
    { name: "age", label: "Age", hint: "years", min: 1, max: 120, step: 1 },
    { name: "sex", label: "Sex", options: [[1, "Male"], [0, "Female"]] },
    { name: "cp", label: "Chest pain type", options: [[1, "Typical angina"], [2, "Atypical angina"], [3, "Non-anginal pain"], [4, "No symptoms (asymptomatic)"]] },
    { name: "trestbps", label: "Resting blood pressure", hint: "mm Hg", min: 60, max: 260, step: 1 },
    { name: "chol", label: "Cholesterol", hint: "mg/dl", min: 80, max: 700, step: 1 },
    { name: "fbs", label: "Fasting blood sugar above 120 mg/dl", options: YESNO },
    { name: "restecg", label: "Resting ECG result", options: [[0, "Normal"], [1, "ST-T wave abnormality"], [2, "Left ventricular hypertrophy"]] },
    { name: "thalach", label: "Highest heart rate reached", hint: "beats per minute", min: 50, max: 250, step: 1 },
    { name: "exang", label: "Chest pain during exercise", options: YESNO },
    { name: "oldpeak", label: "ST depression after exercise", hint: "0 to 10", min: 0, max: 10, step: 0.1 },
    { name: "slope", label: "Slope of the ST segment at peak exercise", options: [[1, "Upsloping"], [2, "Flat"], [3, "Downsloping"]] },
    { name: "ca", label: "Major vessels colored by fluoroscopy", options: [[0, "0"], [1, "1"], [2, "2"], [3, "3"]] },
    { name: "thal", label: "Thallium stress test", options: [[3, "Normal"], [6, "Fixed defect"], [7, "Reversible defect"]] },
  ];
  const MODEL_NAMES = { logistic_regression: "Logistic Regression", svm: "Support Vector Machine" };

  async function api(path, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90000);   // free Render backend can take ~50 s to wake
    try {
      const res = await fetch(API + path, { ...opts, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("The server took too long to answer. Try again in a minute.");
      if (err instanceof TypeError) throw new Error("Cannot reach the server. If it was idle, wait a minute and try again.");
      throw err;
    } finally { clearTimeout(timer); }
  }

  // ---------- form ----------
  const form = $("check-form");
  form.innerHTML = FIELDS.map((f) => `
    <div class="field">
      <label for="${f.name}">${esc(f.label)}${f.hint ? ` <span class="hint">(${esc(f.hint)})</span>` : ""}</label>
      ${f.options
        ? `<select id="${f.name}" name="${f.name}" required><option value="" disabled selected>Choose…</option>${f.options.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select>`
        : `<input id="${f.name}" name="${f.name}" type="number" inputmode="decimal" min="${f.min}" max="${f.max}" step="${f.step}" required>`}
    </div>`).join("") + `
    <label class="check"><input type="checkbox" id="save" checked> Save this result to history (no name is stored)</label>
    <button class="btn" type="submit" id="submit-btn">Check risk</button>
    <p class="hint" id="wait" hidden>Working… if the server was idle this can take up to a minute.</p>`;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("form-error"); err.hidden = true;
    if (!form.reportValidity()) return;
    const payload = { save: $("save").checked };
    FIELDS.forEach((f) => { payload[f.name] = form.elements[f.name].value; });
    $("submit-btn").disabled = true; $("wait").hidden = false;
    try {
      const data = await api("/api/predict", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      showResult(data);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { $("submit-btn").disabled = false; $("wait").hidden = true; }
  });

  function showResult(r) {
    const flagged = r.flagged;
    const cards = Object.entries(r.models).map(([key, m]) => `
      <article class="card">
        <h2>${esc(MODEL_NAMES[key] || key)}</h2>
        <p class="big">${m.probability}%</p>
        <div class="bar" aria-hidden="true"><span class="fill ${m.flagged ? "over" : ""}" style="width:${m.probability}%"></span><span class="mark" style="left:${m.threshold}%"></span></div>
        <p class="hint">Chance of heart disease. The line marks the safety limit (${m.threshold}%). ${m.flagged ? "Above the limit." : "Below the limit."}</p>
      </article>`).join("");
    const values = FIELDS.map((f) => {
      const v = r.inputs[f.name];
      const shown = f.options ? (f.options.find(([val]) => val === v) || [v, v])[1] : v;
      return `<dt>${esc(f.label)}</dt><dd>${esc(shown)}</dd>`;
    }).join("");
    const saveNote = r.save_error ? `<p class="notice error">${esc(r.save_error)}</p>` : r.saved ? `<p class="hint">Saved to history (record #${r.record_id}).</p>` : "";
    $("result").innerHTML = `
      <section class="verdict ${flagged ? "high" : "low"}" role="status">
        ${flagged
          ? "<h1>Higher risk. Please see a doctor.</h1><p>At least one model estimates a chance of heart disease above its safety limit.</p>"
          : "<h1>Lower risk in this screening</h1><p>Both models are below their safety limits. This does not rule out heart disease. If you have symptoms, see a doctor anyway.</p>"}
      </section>
      <div class="cards">${cards}</div>
      ${saveNote}
      <h2>Values you entered</h2><dl class="values">${values}</dl>
      <button class="btn secondary" id="again" type="button">Check another patient</button>`;
    $("again").addEventListener("click", () => { $("result").innerHTML = ""; form.reset(); window.scrollTo({ top: 0, behavior: "smooth" }); });
    $("result").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- history ----------
  let page = 1;
  async function loadHistory() {
    const err = $("history-error"); err.hidden = true;
    try {
      const data = await api(`/api/history?page=${page}&limit=10`);
      const stats = await api("/api/stats");
      $("totals").textContent = `${stats.total} saved checks, ${stats.flagged} flagged as higher risk.`;
      $("history-body").innerHTML = data.items.length ? data.items.map((r) => `
        <tr>
          <td>${esc(r.created_at.slice(0, 16).replace("T", " "))}</td><td>${r.age}</td><td>${r.sex === 1 ? "M" : "F"}</td>
          <td>${r.trestbps}</td><td>${r.chol}</td><td>${r.thalach}</td>
          <td>${Number(r.prob_logreg).toFixed(1)}%</td><td>${Number(r.prob_svm).toFixed(1)}%</td>
          <td><span class="badge ${r.flagged ? "high" : "low"}">${r.flagged ? "Higher risk" : "Lower risk"}</span></td>
          <td><button class="btn danger" data-del="${r.id}" aria-label="Delete record ${r.id}">Delete</button></td>
        </tr>`).join("") : '<tr><td colspan="10" class="empty">Nothing saved yet.</td></tr>';
      const pages = Math.max(1, Math.ceil(data.total / 10));
      $("page-info").textContent = `Page ${page} of ${pages}`;
      $("prev").disabled = page <= 1; $("next").disabled = page >= pages;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }
  $("history-body").addEventListener("click", async (e) => {
    const id = e.target.dataset.del;
    if (!id) return;
    try { await api(`/api/history/${id}`, { method: "DELETE" }); loadHistory(); }
    catch (ex) { $("history-error").textContent = ex.message; $("history-error").hidden = false; }
  });
  $("prev").addEventListener("click", () => { if (page > 1) { page--; loadHistory(); } });
  $("next").addEventListener("click", () => { page++; loadHistory(); });

  // ---------- how it works ----------
  async function loadHow() {
    const err = $("how-error"); err.hidden = true;
    try {
      const info = await api("/api/model-info");
      const pct = Math.round((info.target_recall || 0.95) * 100);
      $("how-lead").innerHTML = `Telling a sick patient they are healthy (a false negative) is the worst mistake here. So each model has a safety limit set to catch at least ${pct}% of sick patients in cross-validation. The cost is more false alarms. A patient is flagged if <strong>either</strong> model reaches its limit.`;
      if (!info.metrics) return;
      $("how-note").textContent = `Trained on ${info.rows} patient records. Results below come from ${info.metrics.test_rows} records the models never saw while training. The test set is small, so treat the numbers as a guide, not a guarantee.`;
      const names = { logistic_regression: "Logistic Regression", svm: "SVM", combined_either_model: "Either model (used by the app)" };
      $("how-body").innerHTML = Object.entries(info.metrics.results).map(([k, r]) => {
        const t = r.test_at_threshold;
        return `<tr><td>${esc(names[k] || k)}</td><td>${((t.recall_sensitivity || 0) * 100).toFixed(1)}%</td><td>${t.false_negatives}</td><td>${t.false_positives}</td><td>${((t.specificity || 0) * 100).toFixed(1)}%</td><td>${r.test_roc_auc ?? "-"}</td></tr>`;
      }).join("");
      $("how-table").hidden = false;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  }

  // ---------- views (plain #hash only) ----------
  const VIEWS = ["check", "history", "how"];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "check";
    VIEWS.forEach((n) => { $("view-" + n).hidden = n !== v; });
    document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === v));
    if (v === "history") loadHistory();
    if (v === "how") loadHow();
  }
  window.addEventListener("hashchange", route);

  // ---------- server status (also wakes the free Render backend) ----------
  (async () => {
    const el = $("status");
    try {
      const h = await api("/api/health");
      if (!h.model_loaded) { el.textContent = "Server is up, but the model file is missing."; el.className = "status warn"; }
      else if (!h.db_connected) { el.textContent = "Ready. History is off because the database is not connected."; el.className = "status warn"; }
      else { el.textContent = "Ready."; el.className = "status ok"; }
    } catch (ex) { el.textContent = ex.message; el.className = "status warn"; }
  })();
  route();
})();
