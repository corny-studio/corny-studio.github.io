(function () {
    "use strict";

    let scene, camera, renderer, starField;
    let planets = [];

    const celestialRoute = [
        { name: 'Sun',     zPos: 120, xOffset: -15, size: 14, color: 0xffaa00 },
        { name: 'Mercury', zPos: 80,  xOffset: 5,   size: 2.2, color: 0x888888 },
        { name: 'Venus',   zPos: 50,  xOffset: -6,  size: 4.8, color: 0xe3bb76 },
        { name: 'Earth',   zPos: 20,  xOffset: 0,   size: 5.0, color: 0x1d5ca3 },
        { name: 'Moon',    zPos: 15,  xOffset: 8,   size: 1.2, color: 0xaaaaaa },
        { name: 'Mars',    zPos: -20, xOffset: -4,  size: 3.2, color: 0xc1440e }
    ];

    function init() {
        // Automatically finds your canvas regardless of which ID you used
        const targetCanvas = document.getElementById('wallpaper-canvas') || document.getElementById('moving-background');
        if (!targetCanvas) return;

        scene = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 0, 20);

        // Alpha: true ensures your HTML background color shines through instead of pitch black
        renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        scene.add(new THREE.AmbientLight(0x222233));
        const sunLight = new THREE.PointLight(0xffffff, 2, 300);
        sunLight.position.set(-15, 0, 120);
        scene.add(sunLight);

        celestialRoute.forEach(body => {
            const geo = new THREE.SphereGeometry(body.size, 32, 32);
            const mat = new THREE.MeshStandardMaterial({ color: body.color, roughness: 0.7, metalness: 0.1 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(body.xOffset, body.name === 'Moon' ? body.size * 1.5 : 0, body.zPos);
            scene.add(mesh);
            planets.push({ mesh, config: body });
        });

        const starsGeo = new THREE.BufferGeometry();
        const starPositions = new Float32Array(2000 * 3);
        for (let i = 0; i < 2000 * 3; i++) { starPositions[i] = (Math.random() - 0.5) * 600; }
        starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
        starField = new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0x00f0ff, size: 0.6 }));
        scene.add(starField);

        animate();
    }

    window.addEventListener('scroll', () => {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        const scrollPercent = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        
        const targetZ = 20 - (scrollPercent * 140);
        camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.1);
        camera.position.x = Math.sin(scrollPercent * Math.PI) * 4;
    });

    function animate() {
        requestAnimationFrame(animate);
        planets.forEach(p => { p.mesh.rotation.y += 0.005; });
        if (starField) starField.rotation.y += 0.0001;
        renderer.render(scene, camera);
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    init();
})();
