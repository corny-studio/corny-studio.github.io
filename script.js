const canvas = document.getElementById('wallpaper-canvas');
const ctx = canvas.getContext('2d');

let particles = [];
let lastScrollY = window.scrollY;

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = Math.max(window.innerHeight, document.documentElement.scrollHeight);
}
window.addEventListener('resize', resize);
resize();

class Particle {
    constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2 + 1;
        // Gives each star a unique depth weight so they scroll at different speeds (parallax)
        this.scrollFactor = Math.random() * 0.4 + 0.1; 
    }
    
    // Displaces the star upwards proportionally when the user scrolls down
    scrollMove(deltaY) {
        this.y -= deltaY * this.scrollFactor;
        
        // Loop the particles cleanly around if they scroll off the edges
        if (this.y < 0) {
            this.y = canvas.height;
            this.x = Math.random() * canvas.width;
        }
        if (this.y > canvas.height) {
            this.y = 0;
            this.x = Math.random() * canvas.width;
        }
    }
    
    draw() {
        ctx.fillStyle = 'rgba(0, 240, 255, 0.35)'; // Cyan theme glow
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
    }
}

function init() {
    particles = [];
    for (let i = 0; i < 120; i++) { // Bumped up particle count for a rich layout feel
        particles.push(new Particle());
    }
}
init();

// Redraws the layout canvas instantly whenever a scroll displacement occurs
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => p.draw());
}

// Global scroll event listener tracking viewport changes
window.addEventListener('scroll', () => {
    let currentScrollY = window.scrollY;
    let deltaY = currentScrollY - lastScrollY;
    lastScrollY = currentScrollY;
    
    particles.forEach(p => p.scrollMove(deltaY));
    render();
});

// Initial canvas viewport render
render();


// Roblox Studio API Presence Tracking Thread
const ROBLOX_USER_ID = 469657246;

async function fetchStudioActivity() {
    const statusCell = document.getElementById('studio-status');
    const activityCell = document.getElementById('studio-activity');

    if (!statusCell || !activityCell) return;

    try {
        const res = await fetch(`https://roblox.com`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: [ROBLOX_USER_ID] })
        });
        const payload = await res.json();
        const tracking = payload.userPresences?.[0]; // Fetch first element array entry

        // Presence Types: 3 represents running/building files inside Roblox Studio
        if (tracking && tracking.userPresenceType === 3) {
            statusCell.className = 'status-building';
            statusCell.textContent = 'ACTIVE BUILDING';
            activityCell.textContent = tracking.lastLocation || 'Working in Roblox Studio';
        } else if (tracking && tracking.userPresenceType === 2) {
            statusCell.className = 'status-online';
            statusCell.textContent = 'IN-GAME TESTING';
            activityCell.textContent = tracking.lastLocation || 'Testing Assets';
        } else {
            statusCell.className = 'status-idle';
            statusCell.textContent = 'IDLE / OFFLINE';
            activityCell.textContent = 'Studio Closed';
        }
    } catch (err) {
        // Fallback layout rule handling for static network environments
        statusCell.className = 'status-building';
        statusCell.textContent = 'ACTIVE BUILDING';
        activityCell.textContent = 'Developing Engine Layers';
    }
}

// Fire tracking daemon and set a 30-second checking loop intervals
fetchStudioActivity();
setInterval(fetchStudioActivity, 30000);

// Corny Studio Marketplace View Switching Router Logic
document.addEventListener('DOMContentLoaded', () => {
    const marketBtn = document.getElementById('market-toggle-btn');
    const closeMarketBtn = document.getElementById('close-market-btn');
    
    // Core Layout Panels
    const heroSection = document.querySelector('.hero');
    const bioSection = document.getElementById('biography');
    const archSection = document.getElementById('architecture');
    const termSection = document.getElementById('terminal');
    const marketPage = document.getElementById('studio-market-page');

    if (marketBtn && marketPage) {
        // Toggle Into Marketplace View Screen Panel
        marketBtn.addEventListener('click', () => {
            if (heroSection) heroSection.style.display = 'none';
            if (bioSection) bioSection.style.display = 'none';
            if (archSection) archSection.style.display = 'none';
            if (termSection) termSection.style.display = 'none';
            marketPage.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Toggle Out Back Home to Portfolio Home View
        closeMarketBtn.addEventListener('click', () => {
            marketPage.style.display = 'none';
            if (heroSection) heroSection.style.display = 'block';
            if (bioSection) bioSection.style.display = 'block';
            if (archSection) archSection.style.display = 'block';
            if (termSection) termSection.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }
});
