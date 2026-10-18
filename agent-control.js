// Runtime configuration settings
let currentUserRole = "GUEST";
const activePipelines = { trade: false, code: false };
let consoleLogsInterval = null;

// CHANGE THIS STRING TO WHATEVER PRIVATE PASSWORD YOU WANT TO USE FOR YOURSELF:
const ADMIN_CORE_SECRET = "CrUt7810-Max,070810"; 

/**
 * 🔒 Gatekeeper Router Session Handler
 */
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
        
        // Visual indicator that advanced options are grayed out for public users
        document.getElementById("code-btn").classList.add("btn-disabled");
        document.getElementById("code-widget-desc").innerText = "• Requires higher workspace clearance.";
        
        initializeDashboardLayout();
        logToTerminal("sys", "Handshake authorized under guest profile. Advanced administrative automated logic is masked.");
        
    } else if (inputVal === ADMIN_CORE_SECRET) {
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
}

/**
 * 🎛️ Pipeline Switch Router
 */
function togglePipeline(id, name) {
    // Intercept action if a guest tries to fire up administrative coding systems
    if (currentUserRole === "GUEST" && id === "code") {
        logToTerminal("sys", "ACCESS EXCEPTION: Guest profile is unauthorized to call external language model loops.");
        return;
    }
    
    const btn = document.getElementById(`${id}-btn`);
    activePipelines[id] = !activePipelines[id];
    
    if (activePipelines[id]) {
        btn.innerText = `■ Terminate ${name}`;
        btn.classList.add("active");
        logToTerminal("sys", `Spinning up processing matrix for: ${name}...`);
        
        if (id === "trade") triggerTelemetryStream(true);
        if (id === "code") logToTerminal("code", "Claude Engine online. Crawling local staging directories for security verification checks...");
    } else {
        btn.innerText = `▶ Launch ${name}`;
        btn.classList.remove("active");
        logToTerminal("sys", `Pipeline thread forced down to rest: ${name}`);
        
        if (id === "trade") triggerTelemetryStream(false);
    }
}

/**
 * 📊 Dynamic Role-Based Data Streamer
 */
function triggerTelemetryStream(start) {
    if (!start) {
        clearInterval(consoleLogsInterval);
        logToTerminal("trade", "Quantitative dashboard stream detached.");
        return;
    }
    
    // Choose streaming strings based on user permission level
    const guestPhrases = [
        "[SANDBOX] Simulating market ticker data capture... Values read-only.",
        "[SANDBOX] Parsing fake market volatility matrix... No real accounts linked.",
        "[SANDBOX] Heartbeat stable. Chart telemetry running smoothly."
    ];
    
    const adminPhrases = [
        "[LIVE_CORE] Telemetry check: BINANCE:BTCUSDT data streams fully active.",
        "[LIVE_CORE] Telemetry check: COMEX:MGC1! futures connection operating normally.",
        "[LIVE_CORE] Port evaluation clear. Ready for programmatic overrides."
    ];
    
    const logPool = (currentUserRole === "ADMIN") ? adminPhrases : guestPhrases;
    
    consoleLogsInterval = setInterval(() => {
        if (activePipelines.trade) {
            const randomMsg = logPool[Math.floor(Math.random() * logPool.length)];
            logToTerminal("trade", randomMsg);
        }
    }, 5000);
}

/**
 * Terminal UI Stream Logger Utilities
 */
function logToTerminal(type, text) {
    const stream = document.getElementById("console-stream");
    if (!stream) return;
    
    const line = document.createElement("div");
    const time = new Date().toTimeString().split(' ');
    
    line.className = `terminal-line ${type}`;
    line.innerHTML = `<span class="stamp">[${time}]</span>${type.toUpperCase()}: ${text}`;
    stream.appendChild(line);
    stream.scrollTop = stream.scrollHeight;
}

function clearConsoleLog() {
    document.getElementById("console-stream").innerHTML = "";
    logToTerminal("sys", "Terminal view cache wiped clean.");
}

function handleCommand(e) {
    if (e.key === "Enter") {
        const input = document.getElementById("console-cmd");
        const val = input.value.trim();
        if (!val) return;
        
        if (currentUserRole === "GUEST") {
            logToTerminal("sys", `GUEST INTERCEPT: Command payload ignored. Guests lack manual pipeline execution rights.`);
        } else {
            logToTerminal("sys", `Admin execution command pushed to stream: "${val}"`);
        }
        input.value = "";
    }
}
