const COMMON_NUMBERS = ["123", "1", "1234", "12", "12345", "777", "2026"];
const COMMON_SPECIALS = ["!", "@", "#", "$", "*", "?"];
const LEET_MAP = { 'a': '4', 'e': '3', 'i': '1', 'o': '0', 's': '5', 't': '7' };

const CRITICAL_COMMON_BASES = [
    "password", "123456", "123456789", "qwerty", "iloveyou", 
    "princess", "admin", "welcome", "letmein", "charlie"
];

function logTerminal(text, className) {
    const screen = document.getElementById('terminalScreen');
    if (!screen) return;
    let div = document.createElement('div');
    div.className = `output-line ${className}`;
    div.innerHTML = text;
    screen.appendChild(div);
    screen.scrollTop = screen.scrollHeight;
}

function scorePasswordProbability(pwd, originalBases, years) {
    let score = 0;
    let pwdLower = pwd.toLowerCase();

    CRITICAL_COMMON_BASES.forEach(common => {
        if (pwdLower === common || pwdLower.startsWith(common)) score += 500;
    });

    if (/^[A-Z][a-z0-9]+$/.test(pwd) || /^[A-Z][a-z0-9]+[^A-Za-z0-9]+$/.test(pwd)) score += 45;
    else if (/^[a-z0-9]+$/.test(pwd)) score += 25;
    else if (/^[A-Z0-9]+$/.test(pwd)) score += 10;

    years.forEach(year => {
        if (pwd.includes(year)) score += year.length === 4 ? 35 : 25;
    });

    COMMON_NUMBERS.forEach(num => {
        if (pwd.endsWith(num) || pwd.includes(num + "!")) score += 20;
    });

    if (pwd.endsWith("!") || pwd.endsWith("!@#")) score += 30;
    if (pwd.endsWith("@")) score += 15;
    if (pwd.length > 16) score -= (pwd.length - 16) * 4;

    return score;
}

function mutateCase(word) {
    const lower = word.toLowerCase();
    const upper = word.toUpperCase();
    const cap = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    const swap = word.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('');
    return [...new Set([lower, upper, cap, swap])];
}

function applyLeet(word, aggressive) {
    let variants = [word.toLowerCase()];
    if (!aggressive) {
        let light = word.toLowerCase();
        for (let [char, sub] of Object.entries(LEET_MAP)) {
            light = light.replaceAll(char, sub);
        }
        variants.push(light);
    } else {
        let arr = word.toLowerCase().split('');
        for (let i = 0; i < arr.length; i++) {
            if (LEET_MAP[arr[i]]) {
                let len = variants.length;
                for (let j = 0; j < len; j++) {
                    let v = variants[j].split('');
                    v[i] = LEET_MAP[arr[i]];
                    variants.push(v.join(''));
                }
            }
        }
    }
    let finalSet = new Set();
    variants.forEach(v => mutateCase(v).forEach(c => finalSet.add(c)));
    return Array.from(finalSet);
}

function executeHUDPipeline() {
    const fields = ['firstName', 'middleName', 'lastName', 'nickname', 'partnerName', 'petName', 'birthYear', 'sportsTeam', 'hobby'];
    let baseWords = [];
    let originalCleanBases = [];
    let years = [];

    fields.forEach(id => {
        let el = document.getElementById(id);
        if (el) {
            let val = el.value.trim();
            if (val) {
                if (/^\d{4}$/.test(val)) {
                    years.push(val);
                    years.push(val.substring(2));
                } else if (val.length >= 2) {
                    baseWords.push(val);
                    originalCleanBases.push(val.toLowerCase());
                }
            }
        }
    });

    if (originalCleanBases.length === 0) {
        logTerminal("[-] Core Engine Abort: Discovery profile fields are empty. Input data to start compilation.", "error");
        return;
    }

    logTerminal("\n[*] Initializing programmatic matrix permutation loop...", "system");
    
    let processingPool = [...baseWords];
    CRITICAL_COMMON_BASES.forEach(b => processingPool.push(b));

    const aggressiveEl = document.getElementById('aggressiveLeet');
    const aggressive = aggressiveEl ? aggressiveEl.checked : false;
    let mutatedBases = new Set();
    processingPool.forEach(word => {
        applyLeet(word, aggressive).forEach(b => mutatedBases.add(b));
    });
    
    let mutatedBasesArr = Array.from(mutatedBases);
    let targetNumbers = [...new Set([...years, ...COMMON_NUMBERS])];
    let seen = new Set();
    let rawResults = [];

    function processCandidate(pwd) {
        if (pwd.length >= 6 && pwd.length <= 32 && !seen.has(pwd)) {
            seen.add(pwd);
            let weight = scorePasswordProbability(pwd, originalCleanBases, years);
            rawResults.push({ password: pwd, weight: weight });
        }
    }

    mutatedBasesArr.forEach(base => {
        processCandidate(base);
        targetNumbers.forEach(n => processCandidate(`${base}${n}`));
        COMMON_SPECIALS.forEach(s => processCandidate(`${base}${s}`));
        targetNumbers.forEach(n => {
            COMMON_SPECIALS.forEach(s => {
                processCandidate(`${base}${n}${s}`);
                processCandidate(`${base}${s}${n}`);
                processCandidate(`${s}${base}${n}`);
            });
        });
    });

    for (let i = 0; i < mutatedBasesArr.length; i++) {
        for (let j = 0; j < mutatedBasesArr.length; j++) {
            if (i !== j && (mutatedBasesArr[i].length + mutatedBasesArr[j].length <= 16)) {
                let combo = `${mutatedBasesArr[i]}${mutatedBasesArr[j]}`;
                processCandidate(combo);
                targetNumbers.forEach(n => processCandidate覆(`${combo}${n}`));
                COMMON_SPECIALS.forEach(s => processCandidate(`${combo}${s}`));
            }
        }
    }

    rawResults.sort((a, b) => b.weight - a.weight);
    
    logTerminal(`[+] Compile complete. Streaming top predictive matches (Highest risk first):\n` + "-".repeat(50), "success");
    
    let displayLimit = Math.min(rawResults.length, 35);
    for(let i=0; i<displayLimit; i++) {
        let label = `[RANK #${(i+1).toString().padEnd(2)}]`;
        if (rawResults[i].weight >= 500) {
            label = `<span class="critical">[CRITICAL]</span>`;
        }
        logTerminal(`${label}  ${rawResults[i].password}`, "");
    }
    
    if (rawResults.length > displayLimit) {
        logTerminal(`... [Truncated ${rawResults.length - displayLimit} lower risk variations] ...`, "success");
    }
    
    let clipPayload = rawResults.map(i => i.password).join('\n');
    navigator.clipboard.writeText(clipPayload).then(() => {
        logTerminal(`\n[+] SYSTEM NOTICE: Entire array auto-copied to system clipboard memory.`, "success");
    }).catch(() => {});
}

// Global invocation hook
document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("runSimulationBtn");
    if (btn) {
        btn.addEventListener("click", executeHUDPipeline);
    }
});
