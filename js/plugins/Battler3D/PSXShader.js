/*:
 * @target MZ
 * @plugindesc PSX-style retro shader for 3D weapons and 3D enemies
 * @author AntiGravity
 * @help
 * Shared helper that gives procedural three.js models a PlayStation-1 look:
 *   - Vertex snapping (the signature "wobble" from low-precision vertex math)
 *   - Color-depth reduction with ordered (Bayer) dithering
 *   - Low-resolution rendering upscaled with nearest-neighbor sampling
 *   - Nearest texture filtering (no smoothing / mipmaps)
 *
 * Every three.js viewport opts in: the 3D weapon overlay (WeaponSprites.js /
 * WeaponSystemProcedural.js), the 3D enemy battlers (3DBattlerSystem.js and the
 * Battler3D_* family plugins), the GalaxySim planet/star renderer and live
 * cosmos scene (GalaxySim_Renderer3D.js / GalaxySim_Scene3D.js), the camper
 * driving scene (CamperDrivingSystem.js), the title-screen enemy mesh
 * (Titlescreen.js), and the model previews in the status, bestiary, equipment,
 * and creature-creation screens. Models call applyToObject() once after they are
 * built; each animation loop renders through PSXShader.render() so the low-res
 * downsample pass is applied uniformly.
 *
 * Public API (window.PSXShader):
 *   applyToMaterial(material)  Patch a single THREE material in place.
 *   applyToObject(root)        Walk an Object3D tree and patch every material.
 *   render(renderer, scene, camera)  Drop-in for renderer.render() that adds the
 *                              low-res downsample pass.
 *   withScale(factors, fn)     Run fn with the tunables scaled by
 *                              { vertexSnap, colorLevels, dither, downscale },
 *                              then restored. For scenes that want a softer or
 *                              harsher look than the player's global settings.
 *
 * Tunables live on window.PSXShader. The defaults are deliberately LIGHT: the
 * look is a period flavour over readable 3D, not a full emulation, so the wobble
 * is small, the banding shallow and the downsample gentle.
 *   enabled      master toggle (default true)
 *   vertexSnap   NDC grid cells across the screen; lower = chunkier (default 420)
 *   colorLevels  shades per channel; ~16 == 4-bit color (default 48)
 *   dither       ordered-dither strength 0..1 (default 0.18)
 *   downscale    internal render scale 0..1; 1 disables the low-res pass (0.88)
 *   nearestTex   force nearest texture filtering on patched maps (default true)
 *
 * NOTE: vertexSnap, colorLevels and dither are BAKED into the GLSL as literals
 * the first time each material is patched, so changing them at runtime only
 * affects materials patched afterward; already-patched materials keep their
 * original values (there is no live re-patch path). downscale, enabled and
 * nearestTex are read live per render / per patch.
 *
 * ---------------------------------------------------------------------------
 * window.PSXHud - the 2D half of the same look
 * ---------------------------------------------------------------------------
 * A PlayStation game's HUD was drawn in the framebuffer, at the framebuffer's
 * own resolution: 320x240-ish, an 8px bitmap font, hard 1px drop shadows and
 * boxes with a single-pixel keyline. PSXHud draws that. Everything is authored
 * in VIRTUAL PIXELS on a low-res bitmap which is then upscaled with nearest
 * filtering, so text and panels come out chunky and aliased no matter what
 * resolution the game is running at.
 *
 * Panels are OPAQUE by default. The 2x2 checker that used to stand in for
 * translucency let a lit 3D scene show through every other pixel of a panel,
 * which at 240 lines is the difference between reading a line of 8px type and
 * guessing at it. Pass { dither: true } for the old translucent look.
 *
 *   PSXHud.layer(baseWidth)            low-res overlay { sprite, bitmap, w, h, ss }
 *                                      (w/h are virtual pixels; the bitmap is
 *                                      supersampled and transformed to match)
 *   PSXHud.text(bmp, s, x, y, w, ...)  pixel text with a hard 1px shadow
 *   PSXHud.panel(bmp, x, y, w, h, o)   keylined box
 *   PSXHud.dither(bmp, x, y, w, h, c)  2x2 checker fill (PSX "transparency")
 *   PSXHud.bar / PSXHud.vbar           segmented gauges
 *   PSXHud.reticle(bmp, x, y, r, c)    chunky targeting sight
 *   PSXHud.domPanel(spriteOrLayer)     crisp HTML type over a widget
 *   PSXHud.PAL                         the fixed 16-colour HUD palette
 *
 * There is no CRT pass. Scanlines and a vignette are a filter over the picture,
 * not part of how a PlayStation drew: they cost contrast, they beat on 8px type
 * and they read as a photo of a television rather than a game. The look here is
 * the geometry (vertex snap, banding, nearest sampling, block gauges, one pixel
 * keylines) with nothing smeared on top, and the type is real HTML so it is as
 * sharp as the display allows.
 *
 * ---------------------------------------------------------------------------
 * The art deco theme
 * ---------------------------------------------------------------------------
 * The 3D minigames (the tarot table, the bowling alley, the basketball court)
 * share one HUD language: gold on black, the way a 1920s lobby directory or a
 * theatre programme was set. Solid black fields, a gold keyline, a broken inner
 * hairline, stepped corners, lozenge rules and gold header bands with the type
 * knocked out in black. It costs the same fillRects the bevelled boxes did and
 * it reads far better over a candlelit table.
 *
 *   PSXHud.DECO                        the gold/black palette
 *   PSXHud.decoPanel(bmp,x,y,w,h,o)    black field, gold keyline, stepped corners
 *                                      ({ title, titleRight } adds a header band)
 *   PSXHud.decoHeader(bmp,x,y,w,s,o)   gold band with knocked-out lettering
 *   PSXHud.decoRule(bmp,x,y,w,c,o)     hairline broken by a centre lozenge
 *   PSXHud.decoSelect(bmp,x,y,w,h,c)   selected-row plate with a gold spine
 *   PSXHud.decoBar(bmp,x,y,w,h,v,o)    segmented gauge in deco colours
 *   PSXHud.decoVBar(bmp,x,y,w,h,v,o)   the vertical one
 *   PSXHud.decoSunburst(bmp,x,y,r,c,o) corner fan, the one piece of ornament
 *   PSXHud.decoChevrons(bmp,x,y,n,c,o) marching triangles, for empty margins
 *
 * This plugin defines no plugin commands and must load before the weapon and
 * battler plugins that consume it.
 */

(function() {
    'use strict';

    // Idempotent: never clobber an already-installed helper.
    if (window.PSXShader) return;

    const PSXShader = {
        enabled: true,
        vertexSnap: 420.0,
        colorLevels: 48,
        dither: 0.18,
        downscale: 0.88,
        nearestTex: true,

        // ---------------------------------------------------------------
        // Material patching
        // ---------------------------------------------------------------

        // Build the GLSL injected into a material, baking the current config in
        // as literals so no per-frame uniform plumbing is needed.
        _buildChunks() {
            const snap = this.vertexSnap.toFixed(1);
            const levels = Math.max(2, this.colorLevels).toFixed(1);
            const dither = Math.min(1, Math.max(0, this.dither)).toFixed(4);

            const vertex =
                '\n#include <project_vertex>\n' +
                '// PSX vertex snapping\n' +
                '{\n' +
                '  vec4 psx_clip = gl_Position;\n' +
                '  if (abs(psx_clip.w) > 0.00001) {\n' +
                '    vec3 psx_ndc = psx_clip.xyz / psx_clip.w;\n' +
                '    psx_ndc.xy = floor(psx_ndc.xy * ' + snap + ') / ' + snap + ';\n' +
                '    gl_Position = vec4(psx_ndc * psx_clip.w, psx_clip.w);\n' +
                '  }\n' +
                '}\n';

            const fragHelpers =
                'float psx_bayer2(vec2 a){ a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }\n' +
                'float psx_bayer4(vec2 a){ return psx_bayer2(0.5 * a) * 0.25 + psx_bayer2(a); }\n' +
                'void main() {';

            const fragQuant =
                '// PSX color quantization + ordered dithering\n' +
                '{\n' +
                '  float psx_levels = ' + levels + ';\n' +
                '  float psx_off = mix(0.5, psx_bayer4(gl_FragCoord.xy), ' + dither + ');\n' +
                '  gl_FragColor.rgb = floor(gl_FragColor.rgb * psx_levels + psx_off) / psx_levels;\n' +
                '}\n' +
                '#include <dithering_fragment>';

            return { vertex, fragHelpers, fragQuant };
        },

        applyToMaterial(material) {
            if (!material || !this.enabled) return;
            if (material.userData && material.userData._psx) return; // already patched

            material.userData = material.userData || {};
            material.userData._psx = true;

            const chunks = this._buildChunks();
            const cacheKey = 'psx_' + this.vertexSnap + '_' + this.colorLevels + '_' + this.dither;

            const prev = material.onBeforeCompile;
            material.onBeforeCompile = function(shader, renderer) {
                if (typeof prev === 'function') prev.call(this, shader, renderer);

                if (shader.vertexShader.indexOf('#include <project_vertex>') !== -1) {
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <project_vertex>', chunks.vertex
                    );
                }
                if (shader.fragmentShader.indexOf('void main() {') !== -1) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        'void main() {', chunks.fragHelpers
                    );
                }
                if (shader.fragmentShader.indexOf('#include <dithering_fragment>') !== -1) {
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <dithering_fragment>', chunks.fragQuant
                    );
                }
            };
            // Allow programs with identical PSX settings to be shared.
            material.customProgramCacheKey = function() { return cacheKey; };

            if (this.nearestTex && material.map) {
                const tex = material.map;
                tex.magFilter = THREE.NearestFilter;
                tex.minFilter = THREE.NearestFilter;
                tex.generateMipmaps = false;
                tex.needsUpdate = true;
            }

            material.needsUpdate = true;
        },

        applyToObject(root) {
            if (!root || !this.enabled || typeof THREE === 'undefined') return;
            root.traverse((obj) => {
                if (!obj.material) return;
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => this.applyToMaterial(m));
                } else {
                    this.applyToMaterial(obj.material);
                }
            });
        },

        // Run fn with the tunables temporarily multiplied by the given factors
        // ({ vertexSnap, colorLevels, dither, downscale }, 1 or missing means
        // unchanged). Lets a single scene dial the retro look up or down without
        // overriding what the player picked in the options: wrap both the model
        // building (the baked tunables) and the render call (downscale) in it.
        withScale(factors, fn) {
            if (!this.enabled || !factors) return fn();
            const saved = {
                vertexSnap: this.vertexSnap,
                colorLevels: this.colorLevels,
                dither: this.dither,
                downscale: this.downscale
            };
            this.vertexSnap = saved.vertexSnap * (factors.vertexSnap || 1);
            this.colorLevels = Math.min(64, saved.colorLevels * (factors.colorLevels || 1));
            this.dither = Math.min(1, saved.dither * (factors.dither || 1));
            this.downscale = Math.min(1, saved.downscale * (factors.downscale || 1));
            try {
                return fn();
            } finally {
                Object.assign(this, saved);
            }
        },

        // ---------------------------------------------------------------
        // Low-resolution downsample render pass
        // ---------------------------------------------------------------

        _ctx(renderer) {
            if (renderer.__psxCtx) return renderer.__psxCtx;
            const quadMat = new THREE.MeshBasicMaterial({
                map: null,
                depthTest: false,
                depthWrite: false,
                transparent: false
            });
            quadMat.blending = THREE.NoBlending;
            const quadScene = new THREE.Scene();
            const quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), quadMat);
            quadScene.add(quadMesh);
            const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
            quadCam.position.z = 1;
            const ctx = { target: null, quadMat, quadScene, quadCam };
            renderer.__psxCtx = ctx;

            // On GPU context loss the cached WebGLRenderTarget (and its texture)
            // become invalid but are only rebuilt on size change, so a restore
            // would blit from a dead target. Drop the whole cache on restore so
            // _ctx rebuilds it, and release the target on loss.
            const canvas = renderer.domElement;
            if (canvas && !canvas.__psxCtxLossHook) {
                canvas.__psxCtxLossHook = true;
                canvas.addEventListener('webglcontextlost', () => {
                    if (renderer.__psxCtx) renderer.__psxCtx.target = null;
                });
                canvas.addEventListener('webglcontextrestored', () => {
                    renderer.__psxCtx = null;
                });
            }
            return ctx;
        },

        // Release the cached downsample resources (render target, quad geometry
        // and material) hung on the renderer. Call before renderer.dispose() on
        // teardown so each battle does not leak a WebGLRenderTarget.
        disposeContext(renderer) {
            if (!renderer || !renderer.__psxCtx) return;
            const ctx = renderer.__psxCtx;
            if (ctx.target && ctx.target.dispose) ctx.target.dispose(); // also frees its texture
            if (ctx.quadMat && ctx.quadMat.dispose) ctx.quadMat.dispose();
            if (ctx.quadScene && ctx.quadScene.traverse) {
                ctx.quadScene.traverse((obj) => {
                    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
                });
            }
            renderer.__psxCtx = null;
        },

        render(renderer, scene, camera) {
            if (!this.enabled || this.downscale >= 0.999 || typeof THREE === 'undefined') {
                renderer.render(scene, camera);
                return;
            }

            const fullW = renderer.domElement.width;
            const fullH = renderer.domElement.height;
            const lowW = Math.max(1, Math.floor(fullW * this.downscale));
            const lowH = Math.max(1, Math.floor(fullH * this.downscale));

            const ctx = this._ctx(renderer);
            let rt = ctx.target;
            if (!rt || rt.width !== lowW || rt.height !== lowH) {
                if (rt) rt.dispose();
                rt = new THREE.WebGLRenderTarget(lowW, lowH, {
                    minFilter: THREE.NearestFilter,
                    magFilter: THREE.NearestFilter,
                    format: THREE.RGBAFormat,
                    depthBuffer: true,
                    stencilBuffer: false
                });
                ctx.target = rt;
                ctx.quadMat.map = rt.texture;
                ctx.quadMat.needsUpdate = true;
            }

            const prevTarget = renderer.getRenderTarget();

            // Pass 1: render the scene into the low-res target.
            renderer.setRenderTarget(rt);
            renderer.clear();
            renderer.render(scene, camera);

            // Pass 2: blit the low-res target onto the canvas, upscaled with
            // nearest filtering. NoBlending copies RGBA verbatim so the canvas
            // ends up identical to a direct render, just pixelated (no alpha
            // fringing for the transparent weapon overlay).
            renderer.setRenderTarget(prevTarget);
            renderer.render(ctx.quadScene, ctx.quadCam);
        }
    };

    window.PSXShader = PSXShader;

    //=====================================================================
    // PSXHud - low-resolution 2D overlay toolkit
    //=====================================================================
    const PSXHud = {
        // Virtual framebuffer height. 240 is the PS1's own scanline count and it
        // is the fixed side: the console kept 240 lines and widened the frame for
        // 16:9, so deriving the width from the aspect keeps a HUD the same
        // apparent size on a 4:3 window and an ultrawide one. Every HUD
        // coordinate in the minigames is expressed in these units.
        BASE_H: 240,

        baseWidth() {
            const h = Graphics.height || 240;
            return Math.max(64, Math.round(this.BASE_H * (Graphics.width || 320) / h));
        },

        // Virtual pixel -> screen pixel factor.
        scale() {
            return (Graphics.height || 240) / this.BASE_H;
        },

        // Registered through FontManager on first use. PixelOperator8 is an
        // 8px bitmap face, so at 8 / 16 virtual pixels it lands exactly on the
        // pixel grid before the layer is upscaled.
        FONT: 'psxhud',
        FONT_FILE: 'PixelOperator8-Bold.ttf',
        _fontLoaded: false,

        // A deliberately small, fixed palette. PSX HUDs did not have gradients
        // or soft shadows; they had six or seven colours and a dither pattern.
        PAL: {
            ink:      '#e8f0f8',
            dim:      '#93a3b8',
            shadow:   '#080a12',
            panel:    '#101a2c',
            panelLo:  '#060a14',
            edgeHi:   '#5f82b4',
            edgeLo:   '#0a1220',
            cyan:     '#3ad7ef',
            amber:    '#ffc02e',
            red:      '#e8442e',
            green:    '#4fe07a',
            magenta:  '#e061c8',
            blue:     '#3a6df0',
            bone:     '#e8dfc0'
        },

        font() {
            if (!this._fontLoaded) {
                this._fontLoaded = true;
                try {
                    if (window.FontManager && FontManager.load) FontManager.load(this.FONT, this.FONT_FILE);
                } catch (e) {
                    this.FONT = 'monospace';
                }
            }
            return this.FONT;
        },

        // The pixel font arrives asynchronously, so anything that paints once
        // (a scoreboard, a result card) has to repaint when it lands or it is
        // stuck with the fallback face for the rest of the scene.
        onFontReady(cb) {
            this.font();
            const poll = () => {
                let ready = true;
                try {
                    ready = !window.FontManager || !FontManager.isReady || FontManager.isReady();
                } catch (e) {
                    ready = true;   // a failed font is not worth blocking a HUD over
                }
                if (ready) cb();
                else setTimeout(poll, 120);
            };
            poll();
        },

        // Device pixels painted per virtual pixel. A 240 line buffer stretched
        // four times across a modern window magnifies every rasterising artefact
        // by four as well: the grey fringe canvas puts on an 8px glyph becomes a
        // 4px grey band, and the type reads as a smear. Painting into a whole
        // multiple of the virtual size and letting the sprite make up the
        // fraction keeps the glyphs on an exact pixel grid (an 8px bitmap face
        // at 16 or 24px is the same shape, cut finer) and shrinks the fringe to
        // one buffer pixel. Capped at 3: the HUD is repainted every frame and
        // past that the texture upload costs more than the sharpness is worth.
        superSample() {
            const s = Math.floor((Graphics.height || 240) / this.BASE_H);
            return Math.max(1, Math.min(3, s));
        },

        // A crisp low-resolution overlay covering the screen. The caller adds
        // `sprite` to its scene and draws into `bitmap` using virtual pixels.
        // `w`/`h` stay in those virtual units whatever the supersample factor,
        // so a caller's coordinates never have to know about it.
        layer(baseWidth) {
            const bw = Math.max(64, Math.round(baseWidth || this.baseWidth()));
            const bh = Math.max(1, Math.round(bw * Graphics.height / Graphics.width));
            const ss = this.superSample();
            const bmp = new Bitmap(bw * ss, bh * ss);
            bmp.smooth = false;               // nearest on the way up: no blur
            bmp.fontFace = this.font();
            bmp.fontSize = 8;
            bmp.outlineWidth = 0;             // shadows are drawn by hand, 1px hard
            if (ss > 1) {
                // The context does the multiplication, so every draw call stays
                // in virtual pixels. Bitmap#clear works from the canvas size and
                // so clears a superset of the field under this transform, which
                // is harmless; blts are kept nearest to match the type.
                const ctx = bmp.context;
                ctx.setTransform(ss, 0, 0, ss, 0, 0);
                ctx.imageSmoothingEnabled = false;
            }
            const sprite = new Sprite(bmp);
            sprite.scale.set(Graphics.width / (bw * ss), Graphics.height / (bh * ss));
            return { sprite: sprite, bitmap: bmp, w: bw, h: bh, ss: ss };
        },

        //-----------------------------------------------------------------
        // Primitives
        //-----------------------------------------------------------------
        _flush(bmp) {
            if (bmp._baseTexture && bmp._baseTexture.update) bmp._baseTexture.update();
        },

        // 2x2 checkerboard fill. Cached as a canvas pattern per colour, because
        // a per-pixel loop over a HUD panel every frame is not affordable.
        _pattern(color) {
            this._patterns = this._patterns || {};
            if (this._patterns[color]) return this._patterns[color];
            const cv = document.createElement('canvas');
            cv.width = cv.height = 2;
            const c = cv.getContext('2d');
            c.fillStyle = color;
            c.fillRect(0, 0, 1, 1);
            c.fillRect(1, 1, 1, 1);
            this._patterns[color] = cv;
            return cv;
        },

        dither(bmp, x, y, w, h, color) {
            const ctx = bmp.context;
            const pat = ctx.createPattern(this._pattern(color || this.PAL.panelLo), 'repeat');
            if (!pat) return;
            ctx.save();
            ctx.fillStyle = pat;
            ctx.fillRect(x, y, w, h);
            ctx.restore();
            this._flush(bmp);
        },

        // Bevelled box: one bright pixel top/left, one dark pixel bottom/right.
        // Opaque unless the caller asks for the checker back: see the note in
        // the header about 8px type over a lit 3D scene.
        panel(bmp, x, y, w, h, opts) {
            const o = opts || {};
            bmp.fillRect(x, y, w, h, o.fill || this.PAL.panel);
            if (o.dither === true) this.dither(bmp, x, y, w, h, o.ditherColor || this.PAL.panelLo);
            const hi = o.hi || this.PAL.edgeHi;
            const lo = o.lo || this.PAL.edgeLo;
            bmp.fillRect(x, y, w, 1, hi);
            bmp.fillRect(x, y, 1, h, hi);
            bmp.fillRect(x, y + h - 1, w, 1, lo);
            bmp.fillRect(x + w - 1, y, 1, h, lo);
            if (o.accent) bmp.fillRect(x, y + h - 1, w, 1, o.accent);
        },

        // Pixel text. `size` is a virtual-pixel height; 8 and 16 stay on grid.
        text(bmp, str, x, y, w, align, color, size, opts) {
            const o = opts || {};
            const fs = size || 8;
            bmp.fontFace = this.FONT;
            bmp.fontSize = fs;
            bmp.outlineWidth = 0;
            const lh = o.lineHeight || Math.round(fs * 1.5);
            const s = o.raw ? String(str) : String(str).toUpperCase();
            // drawText hands centring and right alignment to the canvas, which
            // places glyphs at subpixel precision and antialiases the lot. A
            // bitmap face has no business being sampled off the grid, so the
            // alignment is resolved here on whole pixels and the string is
            // always drawn left aligned. The width left of the box is passed on
            // as the clamp, so anything genuinely too long still condenses the
            // way it used to instead of running out of its panel.
            const a = align || 'left';
            const span = w || 0;
            let tx = x;
            if (a !== 'left' && span > 0) {
                const tw = bmp.measureTextWidth(s);
                tx = x + Math.round(a === 'center' ? (span - tw) / 2 : span - tw);
                if (tx < x) tx = x;
            }
            const avail = span > 0 ? Math.max(1, span - (tx - x)) : 0xffffffff;
            if (o.shadow !== false) {
                bmp.textColor = o.shadowColor || this.PAL.shadow;
                bmp.drawText(s, tx + 1, y + 1, avail, lh, 'left');
            }
            bmp.textColor = color || this.PAL.ink;
            bmp.drawText(s, tx, y, avail, lh, 'left');
        },

        // Segmented horizontal gauge. PSX bars were blocks, not smooth fills.
        bar(bmp, x, y, w, h, value, opts) {
            const o = opts || {};
            const seg = o.seg || 3, gap = o.gap || 1;
            const n = Math.max(1, Math.floor((w - 2) / (seg + gap)));
            const v = Math.max(0, Math.min(1, value));
            const filled = Math.round(v * n);
            bmp.fillRect(x, y, w, h, o.back || '#050a12');
            for (let i = 0; i < n; i++) {
                const t = n > 1 ? i / (n - 1) : 0;
                const on = i < filled;
                const col = on
                    ? (o.colorAt ? o.colorAt(t) : (o.color || this.PAL.cyan))
                    : (o.empty || '#16223a');
                bmp.fillRect(x + 1 + i * (seg + gap), y + 1, seg, h - 2, col);
            }
            if (o.zone) {
                // Marks the working band on top of the segments.
                const zx = x + 1 + Math.round((w - 2) * o.zone[0]);
                const zw = Math.max(1, Math.round((w - 2) * (o.zone[1] - o.zone[0])));
                bmp.fillRect(zx, y, zw, 1, o.zoneColor || this.PAL.green);
                bmp.fillRect(zx, y + h - 1, zw, 1, o.zoneColor || this.PAL.green);
            }
            bmp.fillRect(x, y, w, 1, this.PAL.edgeLo);
            bmp.fillRect(x, y + h - 1, w, 1, this.PAL.edgeLo);
            if (o.needle != null) {
                const nx = x + 1 + Math.round((w - 3) * Math.max(0, Math.min(1, o.needle)));
                bmp.fillRect(nx, y - 1, 1, h + 2, o.needleColor || this.PAL.ink);
            }
        },

        // Segmented vertical gauge, filled from the bottom. `center` fills out
        // from the middle instead, for signed values like spin or hook.
        vbar(bmp, x, y, w, h, value, opts) {
            const o = opts || {};
            const seg = o.seg || 3, gap = o.gap || 1;
            const n = Math.max(1, Math.floor((h - 2) / (seg + gap)));
            bmp.fillRect(x, y, w, h, o.back || '#050a12');
            const mid = Math.floor(n / 2);
            for (let i = 0; i < n; i++) {
                const idxFromBottom = n - 1 - i;
                const t = n > 1 ? idxFromBottom / (n - 1) : 0;
                let on;
                if (o.center) {
                    const v = Math.max(-1, Math.min(1, value));
                    const reach = Math.round(Math.abs(v) * mid);
                    on = v >= 0
                        ? (idxFromBottom > mid && idxFromBottom <= mid + reach)
                        : (idxFromBottom < mid && idxFromBottom >= mid - reach);
                    if (idxFromBottom === mid) on = true;
                } else {
                    on = idxFromBottom < Math.round(Math.max(0, Math.min(1, value)) * n);
                }
                const col = on
                    ? (o.colorAt ? o.colorAt(t) : (o.color || this.PAL.amber))
                    : (o.empty || '#16223a');
                bmp.fillRect(x + 1, y + 1 + i * (seg + gap), w - 2, seg, col);
            }
            if (o.mark != null) {
                const my = y + 1 + Math.round((h - 2) * (1 - Math.max(0, Math.min(1, o.mark))));
                bmp.fillRect(x - 1, my, w + 2, 1, o.markColor || this.PAL.green);
            }
            bmp.fillRect(x, y, 1, h, this.PAL.edgeLo);
            bmp.fillRect(x + w - 1, y, 1, h, this.PAL.edgeLo);
        },

        // Chunky targeting sight: four ticks around a hole, no curves.
        reticle(bmp, x, y, r, color, opts) {
            const o = opts || {};
            const c = color || this.PAL.ink;
            const t = o.thick || 1;
            const len = o.len || Math.max(2, Math.round(r * 0.7));
            bmp.fillRect(x - t, y - r - len, t * 2, len, c);
            bmp.fillRect(x - t, y + r, t * 2, len, c);
            bmp.fillRect(x - r - len, y - t, len, t * 2, c);
            bmp.fillRect(x + r, y - t, len, t * 2, c);
            if (o.dot) bmp.fillRect(x - t, y - t, t * 2, t * 2, o.dotColor || c);
        },

        //-----------------------------------------------------------------
        // Art deco theme: gold on black. See the header note.
        //-----------------------------------------------------------------
        DECO: {
            black:  '#08070b',   // the field a panel is lacquered with
            grain:  '#12101a',   // stippled over the field, barely there
            ink:    '#f6e8c4',   // body type
            dim:    '#c0a468',   // secondary type
            faint:  '#7d6836',   // disabled type
            gold:   '#e6c273',   // keylines, headers, accents
            goldHi: '#fff2c6',
            goldLo: '#8d6f2c',
            sel:    '#2a2010',   // selected-row plate
            selHi:  '#43331a',
            shadow: '#000000',
            red:    '#d9533d',
            green:  '#93d86e',
            jade:   '#5fc9a8',
            violet: '#c6a3ea'
        },

        // Solid black field, gold keyline, a broken inner hairline and stepped
        // corners. `title` turns the top strip into a gold header band.
        decoPanel(bmp, x, y, w, h, opts) {
            const o = opts || {};
            const D = this.DECO;
            const gold = o.accent || D.gold;
            const lo = o.accentLo || D.goldLo;
            bmp.fillRect(x, y, w, h, o.fill || D.black);
            if (o.grain !== false) this.dither(bmp, x, y, w, h, o.grainColor || D.grain);

            bmp.fillRect(x, y, w, 1, gold);
            bmp.fillRect(x, y + h - 1, w, 1, gold);
            bmp.fillRect(x, y, 1, h, gold);
            bmp.fillRect(x + w - 1, y, 1, h, gold);

            // Inner hairline, cut short of the corners so the steps read.
            const g = o.inset == null ? 3 : o.inset;
            if (o.hairline !== false && w > g * 2 + 14 && h > g * 2 + 14) {
                const bx = x + g, by = y + g, bw = w - g * 2, bh = h - g * 2;
                const cut = 5;
                bmp.fillRect(bx + cut, by, bw - cut * 2, 1, lo);
                bmp.fillRect(bx + cut, by + bh - 1, bw - cut * 2, 1, lo);
                bmp.fillRect(bx, by + cut, 1, bh - cut * 2, lo);
                bmp.fillRect(bx + bw - 1, by + cut, 1, bh - cut * 2, lo);
            }
            if (o.corners !== false) this.decoCorners(bmp, x, y, w, h, gold, o.step);
            if (o.title) this.decoHeader(bmp, x, y, w, o.title, o);
        },

        // Nested Ls stepping in from each corner: the deco ziggurat, at the one
        // scale a 240 line framebuffer can carry it.
        decoCorners(bmp, x, y, w, h, color, tiers) {
            const c = color || this.DECO.gold;
            const n = Math.max(1, tiers || 2);
            const corner = (cx, cy, sx, sy) => {
                for (let i = 0; i < n; i++) {
                    const d = 2 + i * 2;
                    const len = (n - i) * 3;
                    const hx = sx > 0 ? cx + d : cx - d - len + 1;
                    const hy = sy > 0 ? cy + d : cy - d;
                    const vx = sx > 0 ? cx + d : cx - d;
                    const vy = sy > 0 ? cy + d : cy - d - len + 1;
                    bmp.fillRect(hx, hy, len, 1, c);
                    bmp.fillRect(vx, vy, 1, len, c);
                }
            };
            corner(x, y, 1, 1);
            corner(x + w - 1, y, -1, 1);
            corner(x, y + h - 1, 1, -1);
            corner(x + w - 1, y + h - 1, -1, -1);
        },

        // A gold band with the lettering knocked out in black. This is the
        // single strongest readability move in the whole theme: a title never
        // competes with whatever is behind the panel.
        decoHeader(bmp, x, y, w, title, opts) {
            const o = opts || {};
            const D = this.DECO;
            const bh = o.headerH || 11;
            const gold = o.accent || D.gold;
            bmp.fillRect(x + 1, y + 1, w - 2, bh, gold);
            bmp.fillRect(x + 1, y + 1, w - 2, 1, o.headerHi || D.goldHi);
            bmp.fillRect(x + 1, y + bh, w - 2, 1, D.goldLo);
            const tc = o.titleColor || D.black;
            // drawText centres inside a 12px line box, so the top of the box
            // sits at y for the glyphs to land in the middle of an 11px band.
            // `dom` routes the knocked-out lettering to the HTML layer, the same
            // way a caller routes its own labels: a header is type too.
            const band = (str, align) => {
                if (o.dom) o.dom.text(str, x + 6, y, w - 12, align, tc, 8, { shadow: false });
                else this.text(bmp, str, x + 6, y, w - 12, align, tc, 8, { shadow: false });
            };
            band(title, o.titleAlign || 'left');
            if (o.titleRight) band(o.titleRight, 'right');
        },

        // Hairline broken by a centre lozenge.
        decoRule(bmp, x, y, w, color, opts) {
            const o = opts || {};
            const D = this.DECO;
            const c = color || D.goldLo;
            const mid = x + Math.floor(w / 2);
            const gap = o.gap == null ? 4 : o.gap;
            bmp.fillRect(x, y, Math.max(0, mid - x - gap), 1, c);
            bmp.fillRect(mid + gap, y, Math.max(0, x + w - mid - gap), 1, c);
            const d = o.diamond || D.gold;
            bmp.fillRect(mid - 1, y, 3, 1, d);
            bmp.fillRect(mid, y - 1, 1, 3, d);
        },

        // Selected row: a lit plate with a gold spine down its left edge.
        decoSelect(bmp, x, y, w, h, color) {
            const D = this.DECO;
            const c = color || D.gold;
            bmp.fillRect(x, y, w, h, D.sel);
            bmp.fillRect(x, y, w, 1, D.selHi);
            bmp.fillRect(x, y + h - 1, w, 1, D.selHi);
            bmp.fillRect(x, y, 2, h, c);
        },

        // The gauges, in deco colours: gold blocks in a black race.
        decoBar(bmp, x, y, w, h, value, opts) {
            const D = this.DECO;
            const o = Object.assign({
                color: D.gold, empty: '#1b160c', back: D.black, seg: 3, gap: 1
            }, opts || {});
            this.bar(bmp, x, y, w, h, value, o);
            bmp.fillRect(x, y, w, 1, D.goldLo);
            bmp.fillRect(x, y + h - 1, w, 1, D.goldLo);
        },

        decoVBar(bmp, x, y, w, h, value, opts) {
            const D = this.DECO;
            const o = Object.assign({
                color: D.gold, empty: '#1b160c', back: D.black, seg: 3, gap: 1
            }, opts || {});
            this.vbar(bmp, x, y, w, h, value, o);
        },

        // Corner fan. Straight rays out of a quarter circle, the motif every
        // deco lobby put over a doorway.
        decoSunburst(bmp, cx, cy, r, color, opts) {
            const o = opts || {};
            const c = color || this.DECO.goldLo;
            const rays = o.rays || 7;
            const from = o.from == null ? Math.PI : o.from;
            const span = o.span == null ? Math.PI / 2 : o.span;
            const inner = o.inner == null ? Math.round(r * 0.35) : o.inner;
            for (let i = 0; i < rays; i++) {
                const a = from + span * (i / (rays - 1 || 1));
                const dx = Math.cos(a), dy = Math.sin(a);
                for (let d = inner; d <= r; d++) {
                    if ((d + i) % 2 === 0 && o.dashed !== false) continue;
                    bmp.fillRect(Math.round(cx + dx * d), Math.round(cy + dy * d), 1, 1, c);
                }
            }
        },

        // Marching triangles for a dead margin: cheap deco filler.
        decoChevrons(bmp, x, y, count, color, opts) {
            const o = opts || {};
            const c = color || this.DECO.goldLo;
            const pitch = o.pitch || 6;
            const size = o.size || 3;
            for (let i = 0; i < count; i++) {
                const cx = x + i * pitch;
                for (let r = 0; r < size; r++) {
                    bmp.fillRect(cx + r, y + r, (size - r) * 2 - 1, 1, c);
                }
            }
        },

        //-----------------------------------------------------------------
        // Crisp HTML type
        //
        // Panels, keylines and gauges are the half of the look a 240 line
        // framebuffer does well: a one pixel keyline is exactly right there.
        // Type is the half it cannot do. An 8px face blown up three or four
        // times is a staircase, and at a fractional factor it is a smear, so
        // every label is a real DOM node over the canvas instead. It is laid
        // out in the SAME virtual pixels as the widget that owns it and
        // rasterised by the browser at the display's own resolution.
        //
        //   const board = PSXHud.domPanel(spriteOrLayer);
        //   board.begin();                                    // per repaint
        //   board.text('SCORE', x, y, w, 'left', col, 8);     // virtual units
        //   board.end();                                      // park the rest
        //   board.destroy();                                  // on terminate
        //
        // Positions come from the widget's worldTransform, so a handle follows
        // its sprite: move it, scale it or hide it and the type goes with it.
        //-----------------------------------------------------------------
        DOM_ID: 'psxhud-dom',

        _domRoot() {
            let root = document.getElementById(this.DOM_ID);
            if (!root) {
                root = document.createElement('div');
                root.id = this.DOM_ID;
                document.body.appendChild(root);
            }
            this._syncDomRoot(root);
            return root;
        },

        // Park the overlay exactly on top of the game canvas and let a CSS
        // transform carry the letterboxing, so children can be positioned in
        // plain game pixels (what worldTransform already speaks).
        _syncDomRoot(root) {
            const canvas = Graphics._canvas || document.getElementById('gameCanvas');
            if (!canvas || !canvas.getBoundingClientRect) return;
            const r = canvas.getBoundingClientRect();
            const s = r.width / (Graphics.width || 1);
            const geom = `${r.left}|${r.top}|${s}`;
            if (root.dataset.geom === geom) return;
            root.dataset.geom = geom;
            root.style.left = r.left + 'px';
            root.style.top = r.top + 'px';
            root.style.width = (Graphics.width || 1) + 'px';
            root.style.height = (Graphics.height || 1) + 'px';
            root.style.transform = 'scale(' + s + ')';
        },

        // `target` is either a Sprite or a layer() result; a layer's draw calls
        // are in virtual units under a supersample transform, so its factor is
        // folded in here and callers never have to know about it.
        domPanel(target, opts) {
            const o = opts || {};
            const hud = this;
            const root = this._domRoot();
            const box = document.createElement('div');
            box.className = 'psxhud-box';
            root.appendChild(box);
            return {
                sprite: (target && target.sprite) ? target.sprite : target,
                unit: (target && target.ss) || o.unit || 1,
                box: box,
                _nodes: [],
                _i: 0,
                _ox: 0, _oy: 0, _sx: 1, _sy: 1,

                begin() {
                    hud._syncDomRoot(root);
                    const sp = this.sprite;
                    const wt = sp && sp.worldTransform;
                    const shown = !!(sp && sp.worldVisible !== false && wt);
                    this.box.style.display = shown ? 'block' : 'none';
                    if (shown) {
                        this._ox = wt.tx;
                        this._oy = wt.ty;
                        this._sx = wt.a * this.unit;
                        this._sy = wt.d * this.unit;
                    }
                    this._i = 0;
                    return shown;
                },

                // A widget usually repaints on a change, not every frame, so it
                // can be painted before it is parented (worldTransform still
                // identity) or move afterwards. sync() re-reads the transform
                // and, only when it actually moved, lays the existing labels out
                // again from the virtual coordinates they were given.
                sync() {
                    const sp = this.sprite;
                    const wt = sp && sp.worldTransform;
                    if (!wt) return;
                    const shown = sp.worldVisible !== false;
                    this.box.style.display = shown ? 'block' : 'none';
                    if (!shown) return;
                    const sx = wt.a * this.unit, sy = wt.d * this.unit;
                    if (wt.tx === this._ox && wt.ty === this._oy &&
                        sx === this._sx && sy === this._sy) return;
                    hud._syncDomRoot(root);
                    this._ox = wt.tx;
                    this._oy = wt.ty;
                    this._sx = sx;
                    this._sy = sy;
                    for (const node of this._nodes) {
                        const g = node._psxGeom;
                        if (!g || node.style.display === 'none') continue;
                        node.style.left = (this._ox + g.x * sx) + 'px';
                        node.style.top = (this._oy + g.y * sy) + 'px';
                        node.style.width = (g.w > 0 ? g.w * sx : 0) + 'px';
                        node.style.fontSize = (g.fs * sy).toFixed(2) + 'px';
                        node.style.lineHeight = (g.lh * sy).toFixed(2) + 'px';
                        node.style.textShadow = g.shadow === false ? 'none'
                            : (() => {
                                const d = Math.max(1, Math.round(sx));
                                return d + 'px ' + d + 'px 0 ' + (g.shadowColor || hud.PAL.shadow);
                            })();
                    }
                },

                // Same argument order as PSXHud.text so a widget can be moved
                // over one call at a time.
                text(str, x, y, w, align, color, size, opts) {
                    const p = opts || {};
                    const fs = size || 8;
                    const lh = p.lineHeight || Math.round(fs * 1.5);
                    let node = this._nodes[this._i];
                    if (!node) {
                        node = document.createElement('div');
                        node.className = 'psxhud-text';
                        this.box.appendChild(node);
                        this._nodes[this._i] = node;
                    }
                    this._i++;
                    const s = String(str);
                    const shown = p.raw ? s : s.toUpperCase();
                    if (node._psxText !== shown) {
                        node._psxText = shown;
                        node.textContent = shown;
                    }
                    node._psxGeom = {
                        x: x, y: y, w: w, fs: fs, lh: lh,
                        shadow: p.shadow, shadowColor: p.shadowColor
                    };
                    const st = node.style;
                    st.display = 'block';
                    st.left = (this._ox + x * this._sx) + 'px';
                    st.top = (this._oy + y * this._sy) + 'px';
                    st.width = (w > 0 ? w * this._sx : 0) + 'px';
                    st.whiteSpace = 'nowrap';
                    st.overflow = 'hidden';
                    st.fontFamily = "'" + hud.font() + "', monospace";
                    st.fontSize = (fs * this._sy).toFixed(2) + 'px';
                    st.lineHeight = (lh * this._sy).toFixed(2) + 'px';
                    st.textAlign = align || 'left';
                    st.color = color || hud.PAL.ink;
                    st.letterSpacing = p.letterSpacing || '';
                    // The hard one pixel drop shadow of a framebuffer HUD, in
                    // whatever a virtual pixel currently measures.
                    const d = Math.max(1, Math.round(this._sx));
                    st.textShadow = p.shadow === false ? 'none'
                        : d + 'px ' + d + 'px 0 ' + (p.shadowColor || hud.PAL.shadow);
                    return node;
                },

                // Everything the repaint did not claim goes away.
                end() {
                    for (let i = this._i; i < this._nodes.length; i++) {
                        this._nodes[i].style.display = 'none';
                    }
                },

                clear() {
                    this._i = 0;
                    this.end();
                },

                destroy() {
                    if (this.box && this.box.parentNode) this.box.parentNode.removeChild(this.box);
                    this._nodes = [];
                    this.box = null;
                }
            };
        }
    };

    window.PSXHud = PSXHud;
})();
