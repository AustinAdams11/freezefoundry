// The Town scene: "Frostpeak Ore & Foundry Co." by the Freeze Foundry owner, kept exactly as designed.
// The app only mounts it and lays name tags and speech bubbles over it in HTML; nothing here changes the picture.
function FrostpeakScene(canvasEl) {

      // Logical pixel dimensions & 3x hardware scale factor
      const GW = 320;
      const GH = 180;
      const SCALE = 3;

      let canvas, ctx;
      let bgCanvas, bgCtx;
      let snowMode = 2; // 0: Off, 1: Light, 2: Heavy
      let oreSmelted = 1420;
      let frameCount = 0;

      // Deterministic pseudo-random helper for rich, repeatable crags & textures
      let seed = 421337;
      function sRand() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
      }

      // Low-level scaled pixel drawing helper
      function px(targetCtx, x, y, w, h, color) {
        targetCtx.fillStyle = color;
        targetCtx.fillRect(
          Math.floor(x) * SCALE,
          Math.floor(y) * SCALE,
          Math.ceil(w) * SCALE,
          Math.ceil(h) * SCALE
        );
      }

      // 6 Sporadic Mines across the rugged mountains
      const mines = [
        { id: 1, x: 32,  y: 112, label: 'West Lower' },
        { id: 2, x: 68,  y: 66,  label: 'West Upper' },
        { id: 3, x: 126, y: 54,  label: 'North West Peak' },
        { id: 4, x: 204, y: 69,  label: 'North East Peak' },
        { id: 5, x: 274, y: 71,  label: 'East Upper' },
        { id: 6, x: 288, y: 119, label: 'East Lower' }
      ];

      // Railway track polylines connecting all 6 mines to the central foundry loop
      const trackSegments = [
        // Main lower collection loop into the foundry
        [{x: 86, y: 110}, {x: 56, y: 138}, {x: 84, y: 168}, {x: 236, y: 168}, {x: 262, y: 140}, {x: 232, y: 108}],
        // Mine 1 (Bottom-Left) branch
        [{x: 32, y: 112}, {x: 58, y: 112}, {x: 86, y: 110}],
        // Mine 2 (Mid-Left) branch
        [{x: 68, y: 66}, {x: 96, y: 80}, {x: 118, y: 92}, {x: 86, y: 110}],
        // Mine 3 (Top-Center-Left) branch
        [{x: 126, y: 54}, {x: 148, y: 68}, {x: 158, y: 78}, {x: 118, y: 92}],
        // Mine 4 (Top-Center-Right) branch
        [{x: 204, y: 69}, {x: 186, y: 82}, {x: 210, y: 96}, {x: 232, y: 108}],
        // Mine 5 (Mid-Right) branch
        [{x: 274, y: 71}, {x: 254, y: 88}, {x: 232, y: 108}],
        // Mine 6 (Bottom-Right) branch
        [{x: 288, y: 119}, {x: 252, y: 119}, {x: 232, y: 108}]
      ];

      // Complete continuous routes from each of the 6 mines right to the foundry doors
      const fullRoutes = [
        [{x: 32, y: 112}, {x: 58, y: 112}, {x: 86, y: 110}, {x: 56, y: 138}, {x: 84, y: 168}, {x: 132, y: 168}],
        [{x: 68, y: 66}, {x: 96, y: 80}, {x: 118, y: 92}, {x: 86, y: 110}, {x: 56, y: 138}, {x: 84, y: 168}, {x: 145, y: 168}],
        [{x: 126, y: 54}, {x: 148, y: 68}, {x: 158, y: 78}, {x: 118, y: 92}, {x: 86, y: 110}, {x: 56, y: 138}, {x: 84, y: 168}, {x: 155, y: 168}],
        [{x: 204, y: 69}, {x: 186, y: 82}, {x: 210, y: 96}, {x: 232, y: 108}, {x: 262, y: 140}, {x: 236, y: 168}, {x: 168, y: 168}],
        [{x: 274, y: 71}, {x: 254, y: 88}, {x: 232, y: 108}, {x: 262, y: 140}, {x: 236, y: 168}, {x: 178, y: 168}],
        [{x: 288, y: 119}, {x: 252, y: 119}, {x: 232, y: 108}, {x: 262, y: 140}, {x: 236, y: 168}, {x: 190, y: 168}]
      ];

      // Active Minecarts
      const carts = [];
      function createCart(routeIndex, startProgress) {
        const oreColors = ['#ff9d2e', '#ff6b1a', '#ffd147', '#38bdf8'];
        carts.push({
          route: fullRoutes[routeIndex % fullRoutes.length],
          seg: 0,
          t: startProgress || 0,
          dir: 1, // 1 = heading to foundry (loaded), -1 = returning to mine (empty)
          speed: 0.35 + Math.random() * 0.18,
          oreColor: oreColors[routeIndex % oreColors.length],
          pauseTimer: 0
        });
      }

      // Initialize 6 minecarts (one on each mine's route)
      for (let i = 0; i < 6; i++) {
        createCart(i, (i * 0.23) % 0.9);
      }

      // Rising Smoke Particles from Foundry Stacks
      const smokeParticles = [];
      const chimneys = [
        { x: 128, y: 109, size: 2 },
        { x: 152, y: 92,  size: 4 },
        { x: 176, y: 103, size: 3 },
        { x: 196, y: 114, size: 2 }
      ];

      for (let i = 0; i < 48; i++) {
        const ch = chimneys[i % chimneys.length];
        smokeParticles.push({
          originX: ch.x,
          originY: ch.y,
          x: ch.x + (Math.random() - 0.5) * 4,
          y: ch.y - Math.random() * 45,
          r: ch.size + Math.random() * 3,
          vy: 0.14 + Math.random() * 0.15,
          drift: Math.random() * 6.28
        });
      }

      // Falling Snowflakes
      const snowflakes = [];
      for (let i = 0; i < 160; i++) {
        snowflakes.push({
          x: Math.random() * GW,
          y: Math.random() * GH,
          vy: 0.25 + Math.random() * 0.45,
          vx: (Math.random() - 0.5) * 0.2,
          layer: Math.random() > 0.3 ? 1 : 0
        });
      }

      // Draw a rugged procedural pixel mountain with crags, crevices, and snow ridges
      function drawRuggedPeak(tCtx, peakX, peakY, baseWidth, palette) {
        const baseY = GH;
        const height = baseY - peakY;
        let ridgeOffset = 0;

        for (let y = peakY; y < baseY; y++) {
          const prog = (y - peakY) / height;
          // Jagged silhouette edge modulation
          const jagLeft = Math.sin(y * 0.37 + peakX) * 3 + Math.cos(y * 0.85) * 1.5;
          const jagRight = Math.cos(y * 0.33 + peakX * 0.5) * 3 + Math.sin(y * 0.9) * 1.5;

          const leftW = Math.max(1, Math.floor(prog * (baseWidth * 0.52) + jagLeft));
          const rightW = Math.max(1, Math.floor(prog * (baseWidth * 0.52) + jagRight));

          const startX = peakX - leftW;
          const endX = peakX + rightW;

          // wandering center ridge line
          ridgeOffset += Math.sin(y * 0.45 + peakX) * 0.45;
          const ridgeX = Math.floor(peakX + ridgeOffset);

          for (let x = startX; x <= endX; x++) {
            const distFromEdgeL = x - startX;
            const distFromEdgeR = endX - x;
            const noise = Math.sin(x * 0.55 + y * 0.7) + Math.cos(x * 0.25 - y * 0.4);

            let col = palette.darkRock;

            if (x < ridgeX) {
              // Left side: sunlit snow slopes broken by steep rocky crags
              if (distFromEdgeL <= 2 || prog < 0.28 + noise * 0.08) {
                col = palette.pureSnow;
              } else if (noise > 0.15 - (1 - prog) * 0.45) {
                col = palette.pureSnow;
              } else if (noise > -0.45) {
                col = palette.shadeSnow;
              } else {
                col = palette.midRock;
              }
            } else {
              // Right side: dramatic shadowed slate rock with snow ledges
              if (distFromEdgeR <= 1 && prog < 0.6) {
                col = palette.shadeSnow;
              } else if (x - ridgeX <= 2 && prog < 0.75) {
                col = palette.pureSnow;
              } else if (noise > 0.65 - (1 - prog) * 0.35) {
                col = palette.shadeSnow;
              } else if (noise > -0.25) {
                col = palette.midRock;
              } else if (noise > -0.95) {
                col = palette.darkRock;
              } else {
                col = palette.deepShadow;
              }
            }
            px(tCtx, x, y, 1, 1, col);
          }
        }
      }

      // Draw snow-dusted alpine pine tree
      function drawAlpinePine(tCtx, x, y, scaleH) {
        const layers = scaleH || 4;
        // Trunk
        px(tCtx, x, y - 2, 2, 3, '#362217');
        for (let i = 0; i < layers; i++) {
          const ly = y - 4 - i * 3;
          const lw = (layers - i) * 2 + 2;
          const lx = x - Math.floor(lw / 2) + 1;
          // Dark pine needles
          px(tCtx, lx, ly, lw, 3, '#1a3329');
          px(tCtx, lx + 1, ly, lw - 2, 2, '#274739');
          // Crisp snow cap on branches
          px(tCtx, lx, ly - 1, lw - 1, 1, '#e6f0f8');
          px(tCtx, lx + 1, ly - 1, Math.max(1, lw - 3), 1, '#ffffff');
        }
      }

      // Draw a railway segment with snow embankment, sleepers, and steel double rails
      function drawRailwayPolyline(tCtx, pts) {
        for (let s = 0; s < pts.length - 1; s++) {
          const p0 = pts[s];
          const p1 = pts[s + 1];
          const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
          const steps = Math.max(1, Math.ceil(dist * 1.5));

          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const rx = Math.round(p0.x + (p1.x - p0.x) * t);
            const ry = Math.round(p0.y + (p1.y - p0.y) * t);
            // Cut rock & snow roadbed
            px(tCtx, rx - 3, ry + 2, 7, 2, '#232d3d');
            px(tCtx, rx - 3, ry + 1, 7, 1, '#cddce8');
          }

          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const rx = Math.round(p0.x + (p1.x - p0.x) * t);
            const ry = Math.round(p0.y + (p1.y - p0.y) * t);

            // Wooden crossties (sleepers) every few pixels
            if (i % 4 === 0) {
              px(tCtx, rx - 2, ry, 5, 2, '#4d3222');
              px(tCtx, rx - 2, ry, 4, 1, '#69452f');
            }
            // Parallel steel rails
            px(tCtx, rx - 1, ry - 1, 1, 1, '#9fb1c4');
            px(tCtx, rx + 2, ry - 1, 1, 1, '#758699');
          }
        }
      }

      // Draw a sturdy timbered mine entrance built into the rock face
      function drawMineEntrance(tCtx, mx, my) {
        // Excavated dark cliff alcove behind mine
        px(tCtx, mx - 10, my - 12, 20, 13, '#171e29');
        px(tCtx, mx - 9, my - 13, 18, 2, '#253142');
        // Snow drift on top of rock overhang
        px(tCtx, mx - 9, my - 14, 18, 2, '#e3eef7');
        px(tCtx, mx - 7, my - 15, 14, 1, '#ffffff');

        // Deep pitch-black tunnel shaft
        px(tCtx, mx - 6, my - 10, 12, 11, '#090c12');
        px(tCtx, mx - 5, my - 9, 10, 10, '#05070a');

        // Heavy wooden support timbers
        px(tCtx, mx - 7, my - 11, 2, 12, '#5c3c26'); // Left post
        px(tCtx, mx - 6, my - 11, 1, 12, '#785035'); // Left highlight
        px(tCtx, mx + 5, my - 11, 2, 12, '#5c3c26'); // Right post
        px(tCtx, mx + 5, my - 11, 1, 12, '#785035'); // Right highlight

        // Crossbeam lintel & diagonal braces
        px(tCtx, mx - 8, my - 12, 16, 2, '#785035');
        px(tCtx, mx - 8, my - 11, 16, 1, '#4f321e');
        px(tCtx, mx - 5, my - 10, 2, 2, '#4f321e');
        px(tCtx, mx + 3, my - 10, 2, 2, '#4f321e');

        // Fresh snow cap on wooden lintel
        px(tCtx, mx - 8, my - 13, 16, 1, '#ffffff');
      }

      // Draw the static structures of the central Industrial Foundry
      function drawFoundryBase(tCtx) {
        const fx = 106;
        const fy = 114;

        // Carved dark rock amphitheater behind foundry with hanging icicles
        px(tCtx, 92, 96, 136, 70, '#131924');
        for (let ix = 94; ix < 226; ix += 4) {
          const ih = 3 + ((ix * 7) % 8);
          px(tCtx, ix, 95, 3, 2, '#e3eef7');
          px(tCtx, ix + 1, 97, 1, ih, '#9ab5cc');
        }

        // Snowy foundry courtyard pad
        px(tCtx, 88, 161, 144, 14, '#cddce8');
        px(tCtx, 94, 160, 132, 3, '#e8f2fa');

        // Tall Brick & Iron Smokestacks
        // Stack 1 (Left)
        px(tCtx, 125, 109, 6, 26, '#3b2b28');
        px(tCtx, 126, 109, 2, 26, '#523b36');
        px(tCtx, 124, 108, 8, 2, '#241a18');
        // Stack 2 (Main Tall Center Stack)
        px(tCtx, 148, 92, 8, 38, '#3b2b28');
        px(tCtx, 149, 92, 3, 38, '#573e38');
        px(tCtx, 147, 91, 10, 2, '#211816');
        px(tCtx, 147, 102, 10, 1, '#677485'); // Iron band
        // Stack 3 (Right-Center)
        px(tCtx, 173, 103, 6, 26, '#362724');
        px(tCtx, 174, 103, 2, 26, '#4d3732');
        px(tCtx, 172, 102, 8, 2, '#211816');
        // Stack 4 (Far Right)
        px(tCtx, 193, 114, 5, 22, '#332421');
        px(tCtx, 192, 113, 7, 2, '#1f1614');

        // Exterior Iron Piping & Ductwork
        px(tCtx, 131, 118, 17, 2, '#525e6e');
        px(tCtx, 164, 108, 10, 2, '#525e6e');
        px(tCtx, 182, 112, 12, 2, '#434d5c');
        px(tCtx, 206, 144, 8, 17, '#3d4654');

        // Central High Smelting Tower
        px(tCtx, 138, 118, 42, 44, '#47312b');
        px(tCtx, 140, 120, 38, 42, '#593d35');
        // Brick texture courses
        for (let by = 122; by < 160; by += 4) {
          for (let bx = 140; bx < 176; bx += 6) {
            px(tCtx, bx + (by % 8 === 0 ? 2 : 0), by, 3, 1, '#3b2722');
          }
        }

        // Left Ore Receiving Hall
        px(tCtx, 108, 134, 32, 28, '#422e29');
        px(tCtx, 110, 136, 28, 26, '#523932');

        // Right Boiler & Casting Wing
        px(tCtx, 178, 128, 34, 34, '#3d2a25');
        px(tCtx, 180, 130, 30, 32, '#4a332d');

        // Corrugated Snow-Capped Roofs
        // Left Hall Roof
        px(tCtx, 106, 131, 35, 4, '#2a3340');
        px(tCtx, 106, 130, 34, 2, '#e3eef7');
        px(tCtx, 107, 129, 30, 1, '#ffffff');
        // Central Tower Roof & Icicles
        px(tCtx, 136, 116, 46, 3, '#2a3340');
        px(tCtx, 136, 115, 45, 2, '#ffffff');
        // Right Wing Roof
        px(tCtx, 177, 126, 36, 3, '#2a3340');
        px(tCtx, 177, 125, 35, 2, '#e3eef7');

        // Heavy Iron Buttresses & Vertical Pillars
        const pillars = [110, 137, 140, 158, 177, 194, 209];
        pillars.forEach(pxPos => {
          px(tCtx, pxPos, 130, 2, 32, '#262d38');
        });

        // Blast Furnace Arched Housing (Center)
        px(tCtx, 150, 145, 16, 17, '#242a33');
        px(tCtx, 152, 147, 12, 15, '#14171c');

        // Ore Unloading Hoppers & Coal Piles on Sides
        px(tCtx, 98, 154, 10, 8, '#28303b');
        px(tCtx, 212, 155, 10, 7, '#28303b');
      }

      // Build the rich static background once into offscreen canvas
      function buildStaticScene() {
        bgCanvas = document.createElement('canvas');
        bgCanvas.width = GW * SCALE;
        bgCanvas.height = GH * SCALE;
        bgCtx = bgCanvas.getContext('2d');
        bgCtx.imageSmoothingEnabled = false;

        // 1. Dithered Winter Twilight Sky Gradient
        const skyBands = [
          { y: 0,  h: 28, c1: '#536882', c2: '#5f7591' },
          { y: 28, h: 32, c1: '#5f7591', c2: '#738aa6' },
          { y: 60, h: 40, c1: '#738aa6', c2: '#8ba2bd' },
          { y: 100, h: 80, c1: '#8ba2bd', c2: '#a8bed6' }
        ];
        skyBands.forEach(b => {
          px(bgCtx, 0, b.y, GW, b.h, b.c1);
          // Pixel dithering between sky bands
          for (let y = b.y + b.h - 6; y < b.y + b.h; y++) {
            for (let x = 0; x < GW; x++) {
              if ((x + y) % 2 === 0) px(bgCtx, x, y, 1, 1, b.c2);
            }
          }
        });

        // 2. Distant Hazy Mountain Silhouettes
        const distPalette = {
          pureSnow: '#c5d6e8',
          shadeSnow: '#9ab0c7',
          midRock: '#677c96',
          darkRock: '#536680',
          deepShadow: '#475870'
        };
        drawRuggedPeak(bgCtx, 48, 36, 95, distPalette);
        drawRuggedPeak(bgCtx, 168, 28, 110, distPalette);
        drawRuggedPeak(bgCtx, 265, 34, 105, distPalette);

        // 3. Main Rugged Snow-Capped Mountains
        const mainPalette = {
          pureSnow: '#f2f7fc',
          shadeSnow: '#bfd2e6',
          midRock: '#485a73',
          darkRock: '#293547',
          deepShadow: '#192230'
        };

        // Twin towering central peaks
        drawRuggedPeak(bgCtx, 124, 6, 165, mainPalette);
        drawRuggedPeak(bgCtx, 212, 13, 160, mainPalette);

        // Flanking rugged mountain ridges
        drawRuggedPeak(bgCtx, 6, 22, 130, mainPalette);
        drawRuggedPeak(bgCtx, 314, 18, 135, mainPalette);
        drawRuggedPeak(bgCtx, 68, 42, 125, mainPalette);
        drawRuggedPeak(bgCtx, 268, 44, 125, mainPalette);
        drawRuggedPeak(bgCtx, 32, 74, 110, mainPalette);
        drawRuggedPeak(bgCtx, 290, 78, 110, mainPalette);

        // Foreground bottom corner snow cliffs framing the railway loop
        drawRuggedPeak(bgCtx, -10, 110, 120, mainPalette);
        drawRuggedPeak(bgCtx, 330, 112, 120, mainPalette);

        // 4. Snow-Dusted Pine Trees clustered along mountain ridges
        const treeLocations = [
          [10, 76, 4], [18, 82, 3], [6, 90, 4], [22, 94, 3],
          [88, 60, 3], [94, 65, 4], [52, 86, 3], [58, 91, 4],
          [14, 126, 4], [20, 134, 3], [224, 76, 3], [230, 82, 4],
          [258, 66, 3], [302, 68, 4], [310, 75, 4], [296, 82, 3],
          [306, 128, 4], [314, 136, 3]
        ];
        treeLocations.forEach(t => drawAlpinePine(bgCtx, t[0], t[1], t[2]));

        // 5. Central Foundry Complex Base
        drawFoundryBase(bgCtx);

        // 6. All Railway Tracks converging from the 6 mines to the foundry
        trackSegments.forEach(seg => drawRailwayPolyline(bgCtx, seg));

        // 7. All 6 Sporadic Mountain Mine Entrances
        mines.forEach(m => drawMineEntrance(bgCtx, m.x, m.y));
      }

      // Render dynamic animated elements each frame
      function renderFrame() {
        frameCount++;

        // Draw cached static winter mountain & foundry scene
        ctx.drawImage(bgCanvas, 0, 0);

        // 1. Animate Rising Foundry Smoke
        smokeParticles.forEach(p => {
          p.y -= p.vy;
          p.x += Math.sin(frameCount * 0.03 + p.drift) * 0.14;
          if (p.y < 38) {
            p.y = p.originY;
            p.x = p.originX + (Math.random() - 0.5) * 3;
          }
          const age = (p.originY - p.y) / 55;
          const col = age > 0.6 ? '#c8d7e6' : (age > 0.3 ? '#dce7f2' : '#eef5fc');
          px(ctx, p.x, p.y, p.r, p.r, col);
        });

        // 2. Animate Flickering Mine Lanterns at all 6 Mines
        mines.forEach((m, idx) => {
          const flick = Math.sin(frameCount * 0.15 + idx * 1.7) > -0.2;
          const lx = m.x + 8;
          const ly = m.y - 7;
          // Soft lantern halo
          px(ctx, lx - 1, ly - 1, 4, 4, flick ? '#b85d19' : '#8f4410');
          // Bright lantern core
          px(ctx, lx, ly, 2, 2, flick ? '#ffe066' : '#ffae33');
        });

        // 3. Animate Central Foundry Blast Furnaces & Windows
        const furnacePulse = Math.sin(frameCount * 0.12);
        const fireOuter = furnacePulse > 0 ? '#ff6a14' : '#e64800';
        const fireInner = furnacePulse > -0.3 ? '#ffd644' : '#ff9e22';

        // Main Blast Furnace Glow
        px(ctx, 153, 150, 10, 11, fireOuter);
        px(ctx, 155, 152, 6, 8, fireInner);
        px(ctx, 156, 154, 4, 5, '#ffffff');
        // Warm light spill on snow in front of furnace
        px(ctx, 151, 162, 14, 2, furnacePulse > 0 ? '#d98a4e' : '#c27840');

        // Left Hall Smelting Doorway
        px(ctx, 123, 151, 7, 11, '#ff771c');
        px(ctx, 124, 152, 5, 9, fireInner);

        // Factory Windows
        const winColor = '#ffbb33';
        px(ctx, 145, 125, 4, 6, winColor);
        px(ctx, 167, 125, 4, 6, winColor);
        px(ctx, 186, 138, 4, 6, winColor);
        px(ctx, 194, 138, 4, 6, winColor);
        px(ctx, 202, 138, 4, 6, winColor);
        px(ctx, 114, 142, 4, 5, winColor);

        // Rooftop Stack Flame licks
        if (furnacePulse > 0.2) {
          px(ctx, 160, 105, 3, 3, '#ff771c');
          px(ctx, 161, 106, 2, 2, '#ffd644');
        }

        // 4. Update & Draw Minecarts traveling between the 6 Mines and Foundry
        carts.forEach(c => {
          if (c.pauseTimer > 0) {
            c.pauseTimer--;
          } else {
            const p0 = c.route[c.seg];
            const p1 = c.route[c.seg + 1];
            const segDist = Math.max(1, Math.hypot(p1.x - p0.x, p1.y - p0.y));
            c.t += (c.speed / segDist) * c.dir;

            if (c.t >= 1) {
              c.t = 0;
              c.seg++;
              if (c.seg >= c.route.length - 1) {
                c.seg = c.route.length - 2;
                c.t = 1;
                c.dir = -1; // Unloaded at foundry, head back up to mine
                c.pauseTimer = 35;
                oreSmelted += 5;
                const el = document.getElementById('statsReadout');
                if (el) el.textContent = 'Ore Smelted: ' + oreSmelted.toLocaleString() + ' Tons';
              }
            } else if (c.t <= 0) {
              c.t = 1;
              c.seg--;
              if (c.seg < 0) {
                c.seg = 0;
                c.t = 0;
                c.dir = 1; // Loaded fresh ore at mine, head to foundry
                c.pauseTimer = 35;
              }
            }
          }

          const pt0 = c.route[c.seg];
          const pt1 = c.route[c.seg + 1];
          const cx = Math.round(pt0.x + (pt1.x - pt0.x) * c.t);
          const cy = Math.round(pt0.y + (pt1.y - pt0.y) * c.t);

          // Draw Glowing Ore Mound when heading toward the foundry (dir === 1)
          if (c.dir === 1) {
            px(ctx, cx - 2, cy - 5, 5, 2, c.oreColor);
            px(ctx, cx - 1, cy - 6, 3, 1, '#fff3b0');
          }

          // Iron Minecart Body & Wheels
          px(ctx, cx - 3, cy - 4, 7, 3, '#394352');
          px(ctx, cx - 3, cy - 4, 7, 1, '#58667a'); // Rim highlight
          px(ctx, cx - 2, cy - 1, 2, 1, '#14181f'); // Left wheel
          px(ctx, cx + 1, cy - 1, 2, 1, '#14181f'); // Right wheel
        });

        // 5. Falling Snowflakes across the Winter Wonderland
        if (snowMode > 0) {
          const activeCount = snowMode === 2 ? snowflakes.length : Math.floor(snowflakes.length * 0.45);
          for (let i = 0; i < activeCount; i++) {
            const s = snowflakes[i];
            s.y += s.vy;
            s.x += s.vx + Math.sin(frameCount * 0.02 + i) * 0.1;

            if (s.y >= GH) {
              s.y = 0;
              s.x = Math.random() * GW;
            }
            if (s.x < 0) s.x = GW - 1;
            if (s.x >= GW) s.x = 0;

            px(ctx, s.x, s.y, 1, 1, s.layer === 1 ? '#ffffff' : '#cfe0f0');
          }
        }

        if (running) requestAnimationFrame(renderFrame);
      }


      let running = false;
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      buildStaticScene();
      return {
        GW, GH, mines,
        start() { if (!running) { running = true; renderFrame(); } },
        stop() { running = false; },
        cycleSnow() { snowMode = (snowMode + 1) % 3; return ['Snow: Off', 'Snow: Light', 'Snow: Heavy'][snowMode]; },
        dispatchCart() { if (carts.length < 18) createCart(carts.length % 6, 0); },
        png() { return canvas.toDataURL('image/png'); }
      };
}

// Crew overlay: which crew member works in which mine (labels only), the foundry is the Studio.
class TownMap {
  constructor(canvas, overlay, onPick) {
    this.scene = FrostpeakScene(canvas);
    this.overlay = overlay; this.onPick = onPick; this.busy = {};
    this.W = this.scene.GW; this.H = this.scene.GH;
    const ids = ['scout', 'writer', 'checker', 'publisher', 'analyst', 'bank'];
    this.houses = Object.fromEntries(this.scene.mines.map((m, i) => [ids[i], { id: ids[i], x: m.x, y: m.y }]));
    this.houses.studio = { id: 'studio', x: 160, y: 150, foundry: true };
    canvas.addEventListener('click', e => {
      const r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) * this.W / r.width, y = (e.clientY - r.top) * this.H / r.height;
      const hit = Object.values(this.houses).find(h => h.foundry ? Math.abs(h.x - x) < 52 && y > 92 && y < 166 : Math.abs(h.x - x) < 11 && y > h.y - 16 && y < h.y + 3);
      if (hit && this.onPick) this.onPick(hit.id);
    });
  }
  tagSpot(id) { const h = this.houses[id]; return { x: h.x, y: h.foundry ? 168 : h.y + 2 }; }
  send(from, to, text) { this.say(to, text); }
  say(id, text) {
    const h = this.houses[id];
    if (!h || !text) return;
    const el = document.createElement('div');
    el.className = 'town-bubble';
    el.textContent = text;
    el.style.left = (h.x / this.W * 100) + '%';
    el.style.top = ((h.foundry ? 96 : h.y - 16) / this.H * 100) + '%';
    this.overlay.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }
  start() { this.scene.start(); }
  stop() { this.scene.stop(); }
}
