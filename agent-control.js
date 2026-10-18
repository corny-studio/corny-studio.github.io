// Runtime configuration
let currentUserRole = "GUEST";
const activePipelines = { trade: false, code: false };
let consoleLogsInterval = null;
let chartsDrawn = false;

// Set your own private key here. This file is public, so the gate is cosmetic only.
const ADMIN_CORE_SECRET = "CHANGE_ME";

function processLoginSequence() {
    const inputField = document.getElementById("pass-input");
    const inputVal = inputField.value.trim();
    const badge = document.getElementById("role-badge");
    const status = document.getElementById("status-indicator");

    if (inputVal.toLowerCase() === "guest") {
        currentUserRole = "GUEST";
        badge.innerText = "ROLE: DEFAULT_GUEST";
        badge.style.color = "#85929E";
        status.innerText = "● GUEST SANDBOX ACTIVE";
        status.style.color = "#f59e0b";
        document.getElementById("code-btn").classList.add("btn-disabled");
        document.getElementById("code-widget-desc").innerText = "• Requires higher workspace clearance.";
        initializeDashboardLayout();
        logToTerminal("sys", "Handshake authorized under guest profile. Advanced administrative logic is masked.");
    } else if (ADMIN_CORE_SECRET !== "CHANGE_ME" && inputVal === ADMIN_CORE_SECRET) {
        currentUserRole = "ADMIN";
        badge.innerText = "ROLE: MASTER_ADMIN";
        badge.style.color = "#c5a5c5";
        status.innerText = "● LOCAL EMULATOR SAFE";
        status.style.color = "#66fcf1";
        initializeDashboardLayout();
        logToTerminal("sys", "Secure admin key signature verified. Full core authorization unlocked.");
    } else {
        alert("ACCESS REDIRECT: Invalid credential string pattern.");
        inputField.value = "";
    }
}

function initializeDashboardLayout() {
    document.getElementById("auth-gate").style.display = "none";
    document.getElementById("dashboard-core").style.display = "grid";
    renderTradingViewCharts();
}

function renderTradingViewCharts() {
    if (chartsDrawn) return;
    try {
        if (typeof TradingView === "undefined") {
            logToTerminal("sys", "TradingView library not loaded (blocked or offline). Charts skipped.");
            return;
        }
        const base = { autosize: true, interval: "D", timezone: "Etc/UTC", theme: "dark", style: "1", locale: "en", toolbar_bg: "#0f1319", enable_publishing: false, hide_top_toolbar: false, save_image: false };
        new TradingView.widget(Object.assign({ container_id: "tradingview_btc", symbol: "BINANCE:BTCUSDT" }, base));
        new TradingView.widget(Object.assign({ container_id: "tradingview_mgc", symbol: "COMEX:MGC1!" }, base));
        chartsDrawn = true;
    } catch (e) {
        console.log("Chart rendering deferred safely:", e);
    }
}

function togglePipeline(id, name) {
    if (currentUserRole === "GUEST" && id === "code") {
        logToTerminal("sys", "ACCESS EXCEPTION: Guest profile is unauthorized to run this pipeline.");
        return;
    }
    const btn = document.getElementById(id + "-btn");
    activePipelines[id] = !activePipelines[id];

    if (activePipelines[id]) {
        btn.innerText = "■ Terminate " + name;
        btn.classList.add("active");
        logToTerminal("sys", "Spinning up processing matrix for: " + name + "...");
        if (id === "trade") triggerTelemetryStream(true);
        if (id === "code") logToTerminal("code", "Auditor online. Scanning repository files (simulated).");
    } else {
        btn.innerText = "▶ Launch " + name;
        btn.classList.remove("active");
        logToTerminal("sys", "Pipeline thread stopped: " + name);
        if (id === "trade") triggerTelemetryStream(false);
    }
}

function triggerTelemetryStream(start) {
    if (!start) {
        clearInterval(consoleLogsInterval);
        logToTerminal("trade", "Telemetry stream detached.");
        return;
    }
    const guestPhrases = [
        "[SANDBOX] Simulating market ticker capture... values read-only.",
        "[SANDBOX] Parsing mock volatility matrix... no real accounts linked.",
        "[SANDBOX] Heartbeat stable. Chart telemetry running."
    ];
    const adminPhrases = [
        "[SIM_CORE] Telemetry check: BINANCE:BTCUSDT stream nominal.",
        "[SIM_CORE] Telemetry check: COMEX:MGC1! stream nominal.",
        "[SIM_CORE] Port evaluation clear. Mock order engine idle."
    ];
    const pool = currentUserRole === "ADMIN" ? adminPhrases : guestPhrases;
    clearInterval(consoleLogsInterval);
    consoleLogsInterval = setInterval(function () {
        if (activePipelines.trade) logToTerminal("trade", pool[Math.floor(Math.random() * pool.length)]);
    }, 5000);
}

function logToTerminal(type, text) {
    const stream = document.getElementById("console-stream");
    if (!stream) return;
    const line = document.createElement("div");
    const stamp = document.createElement("span");
    stamp.className = "stamp";
    stamp.textContent = "[" + new Date().toTimeString().split(" ")[0] + "]";
    line.className = "terminal-line " + type;
    line.appendChild(stamp);
    line.appendChild(document.createTextNode(type.toUpperCase() + ": " + text));
    stream.appendChild(line);
    stream.scrollTop = stream.scrollHeight;
}

function clearConsoleLog() {
    document.getElementById("console-stream").innerHTML = "";
    logToTerminal("sys", "Terminal view cleared.");
}

function handleCommand(e) {
    if (e.key !== "Enter") return;
    const input = document.getElementById("console-cmd");
    const val = input.value.trim();
    if (!val) return;
    if (currentUserRole === "GUEST") {
        logToTerminal("sys", "GUEST INTERCEPT: command ignored. Guests are read-only.");
    } else {
        logToTerminal("sys", 'Admin command logged: "' + val + '"');
    }
    input.value = "";
}

document.addEventListener("DOMContentLoaded", function () {
    const b = document.getElementById("auth-btn");
    const i = document.getElementById("pass-input");
    console.log("agent-control loaded", !!b, !!i);
    if (b) b.addEventListener("click", processLoginSequence);
    if (i) i.addEventListener("keydown", function (e) { if (e.key === "Enter") processLoginSequence(); });
});
