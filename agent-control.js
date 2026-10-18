/* agent-control.js — CORNY//STUDIO panel engine.
   Login is handled by auth.js (set your master key there). Needs config.js and auth.js loaded first.
   The panel only shows mock data; keep real keys and real actions out of this file. */

let currentUserRole = "GUEST";
const activePipelines = { trade: false, code: false };
let telemetryTimer = null;
let chartsDrawn = false;

const $ = (id) => document.getElementById(id);

const ROLES = {
    GUEST: { label: "ROLE: DEFAULT_GUEST", labelColor: "#85929E", status: "● GUEST SANDBOX ACTIVE", statusColor: "#f59e0b" },
    ADMIN: { label: "ROLE: MASTER_ADMIN",  labelColor: "#c5a5c5", status: "● LOCAL EMULATOR SAFE",  statusColor: "#66fcf1" }
};

/* ---------- Login / roles ---------- */

function applyRole(role) {
    const r = ROLES[role];
    currentUserRole = role;
    $("role-badge").innerText = r.label;
    $("role-badge").style.color = r.labelColor;
    $("status-indicator").innerText = r.status;
    $("status-indicator").style.color = r.statusColor;

    const guest = role === "GUEST";
    $("code-btn").classList.toggle("btn-disabled", guest);
    $("code-widget-desc").innerText = guest
        ? "• Requires higher workspace clearance."
        : "• Repository security verification loop.";
}

function enterDashboard(role, message) {
    applyRole(role);
    $("gate-error").innerText = "";
    $("auth-gate").style.display = "none";
    $("dashboard-core").style.display = "grid";
    renderTradingViewCharts();
    logToTerminal("sys", message);
}

async function processLoginSequence() {
    const input = $("pass-input"), btn = $("auth-btn");
    btn.disabled = true;
    const result = await Auth.login(input.value);
    btn.disabled = false;

    if (result === "guest") enterDashboard("GUEST", "Guest profile active. Administrative logic is masked.");
    else if (result === "admin") enterDashboard("ADMIN", "Admin key verified. Full panel access unlocked.");
    else {
        $("gate-error").innerText = "Invalid access key.";
        input.value = "";
        input.focus();
    }
}

function logoutToGate() {
    clearInterval(telemetryTimer);
    activePipelines.trade = false;
    activePipelines.code = false;

    const t = $("trade-btn"), c = $("code-btn");
    t.innerText = "▶ Launch Telemetry"; t.classList.remove("active");
    c.innerText = "▶ Launch Auditor";  c.classList.remove("active", "btn-disabled");
    $("code-widget-desc").innerText = "• Repository security verification loop.";
    $("console-stream").innerHTML = "";

    Auth.logout();
    currentUserRole = "GUEST";
    $("dashboard-core").style.display = "none";
    $("auth-gate").style.display = "block";
    $("pass-input").value = "";
    $("pass-input").focus();
}

/* ---------- Charts ---------- */

function renderTradingViewCharts() {
    if (chartsDrawn) return;
    if (typeof TradingView === "undefined") {
        logToTerminal("sys", "TradingView library not loaded (blocked or offline). Charts skipped.");
        return;
    }
    try {
        const base = { autosize: true, interval: "D", timezone: "Etc/UTC", theme: "dark", style: "1", locale: "en", toolbar_bg: "#0f1319", enable_publishing: false, save_image: false };
        new TradingView.widget(Object.assign({ container_id: "tradingview_btc", symbol: "BINANCE:BTCUSDT" }, base));
        new TradingView.widget(Object.assign({ container_id: "tradingview_mgc", symbol: "COMEX:MGC1!" }, base));
        chartsDrawn = true;
    } catch (e) {
        console.log("Chart rendering failed:", e);
    }
}

/* ---------- Pipelines ---------- */

function togglePipeline(id, name) {
    if (currentUserRole === "GUEST" && id === "code") {
        logToTerminal("sys", "Access denied: guest profile cannot run this pipeline.");
        return;
    }

    const btn = $(id + "-btn");
    activePipelines[id] = !activePipelines[id];

    if (activePipelines[id]) {
        btn.innerText = "■ Terminate " + name;
        btn.classList.add("active");
        logToTerminal("sys", "Starting: " + name);
        if (id === "trade") startTelemetry(true);
        if (id === "code") logToTerminal("code", "Auditor online. Scanning repository files (simulated).");
    } else {
        btn.innerText = "▶ Launch " + name;
        btn.classList.remove("active");
        logToTerminal("sys", "Stopped: " + name);
        if (id === "trade") startTelemetry(false);
    }
}

function startTelemetry(on) {
    clearInterval(telemetryTimer);
    if (!on) { logToTerminal("trade", "Telemetry stream detached."); return; }

    const guestLines = [
        "[SANDBOX] Simulating market ticker capture... values read-only.",
        "[SANDBOX] Parsing mock volatility matrix... no real accounts linked.",
        "[SANDBOX] Heartbeat stable. Chart telemetry running."
    ];
    const adminLines = [
        "[SIM_CORE] Telemetry check: BINANCE:BTCUSDT stream nominal.",
        "[SIM_CORE] Telemetry check: COMEX:MGC1! stream nominal.",
        "[SIM_CORE] Port evaluation clear. Mock order engine idle."
    ];
    const pool = currentUserRole === "ADMIN" ? adminLines : guestLines;
    telemetryTimer = setInterval(function () {
        logToTerminal("trade", pool[Math.floor(Math.random() * pool.length)]);
    }, 5000);
}

/* ---------- Console ---------- */

function logToTerminal(type, text) {
    const stream = $("console-stream");
    if (!stream) return;

    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = "[" + new Date().toTimeString().split(" ")[0] + "]";

    const line = document.createElement("div");
    line.className = "terminal-line " + type;
    line.appendChild(stamp);
    line.appendChild(document.createTextNode(type.toUpperCase() + ": " + text));

    stream.appendChild(line);
    stream.scrollTop = stream.scrollHeight;
}

function clearConsoleLog() {
    $("console-stream").innerHTML = "";
    logToTerminal("sys", "Console cleared.");
}

function handleCommand(e) {
    if (e.key !== "Enter") return;
    const input = $("console-cmd");
    const value = input.value.trim();
    if (!value) return;

    if (currentUserRole === "GUEST") logToTerminal("sys", "Guests are read-only. Command ignored.");
    else logToTerminal("sys", 'Admin command logged: "' + value + '"');
    input.value = "";
}

/* ---------- Startup ---------- */

document.addEventListener("DOMContentLoaded", function () {
    const btn = $("auth-btn"), input = $("pass-input");
    if (btn) btn.addEventListener("click", processLoginSequence);
    if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") processLoginSequence(); });

    // Coming back from the Hub keeps your role for this tab
    const saved = (Auth.role() || "").toUpperCase();
    if (ROLES[saved]) enterDashboard(saved, "Session restored as " + saved + ".");
});
