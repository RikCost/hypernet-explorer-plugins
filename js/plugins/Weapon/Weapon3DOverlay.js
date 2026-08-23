//=============================================================================
// Weapon3DOverlay.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc v2.0.0 The shared three.js overlay every weapon is drawn in
 * @author Assistant
 * @url https://nocoldiz.itch.io/hypernet-explorer
 *
 * @help Weapon3DOverlay.js
 *
 * The first-person weapon layer. Every weapon in the game is a 3D model:
 * either a GLB named by a <3DModel:> note tag, or (for all 532 of them) a
 * procedural model built by WeaponSystemProcedural.js and its Weapon3D_*
 * families. There is no 2D weapon path any more, and no picture folder
 * behind one.
 *
 * Contents:
 * - WeaponThreeScene  the one three.js renderer/scene/camera the overlay
 *   shares, drawn once a frame by Spriteset_Battle (WeaponSystem.js)
 * - disposeWeaponObject3D  frees a model's GPU buffers on swap or teardown
 * - Sprite_3DWeapon  one held weapon: builds or loads its model, poses it
 *   from js/db/Sprites/MovementKeyFrame3d.json, and animates it
 *
 * A weapon is never cut into or out of frame: it slides in from off the left
 * edge when it is first raised, and fades out when the battle ends
 * (Sprite_3DWeapon#beginExit, driven by Spriteset_Battle.fadeOutWeaponModels).
 *
 * Must be loaded BEFORE WeaponSystem.js.
 *
 * ============================================================================
 * Terms of Use
 * ============================================================================
 *
 * Free for commercial and non-commercial use.
 */

(() => {
  "use strict";

  // Where the overlay puts a weapon on screen, in game pixels. One world unit
  // in the overlay is one game pixel, so these are the same numbers the 2D
  // layer used to place its sprites at.
  const getResolutionScale = () => {
    if ($gameSystem && $gameSystem.getCurrentResolution) {
      const resolution = $gameSystem.getCurrentResolution();
      return resolution === "16:9" ? { x: 1.568, y: 1.154 } : { x: 1, y: 1 };
    }
    return { x: 1, y: 1 };
  };

  const getScaledWeaponX = (isLeftHand = false) => {
    const scale = getResolutionScale();
    if (isLeftHand) {
      return Math.round(200 * scale.x);
    }
    const weaponSpriteX = 650;
    // Shift left so the weapon clears the battle command menu on the right edge.
    return Math.round(weaponSpriteX * scale.x) - 120;
  };

  const getScaledWeaponY = () => {
    const scale = getResolutionScale();
    const weaponSpriteY = 450;
    return Math.round(weaponSpriteY * scale.y);
  };

  // How a held weapon comes into frame and how it leaves it. A weapon is
  // raised into view from off the left edge rather than appearing on the spot,
  // and when the battle ends it fades out instead of being cut mid-frame.
  const ENTRY_DURATION_MS = 340;
  const EXIT_DURATION_MS = 320;
  // How far past the left edge of the screen the entry starts, in game pixels,
  // so even a long weapon is fully out of frame before it slides in.
  const ENTRY_MARGIN_PX = 320;
  // Fraction of the entry slide the weapon drifts back over while fading out.
  const EXIT_DRIFT = 0.18;
  //=============================================================================
  // WeaponThreeScene - Shared Three.js overlay for 3D weapon rendering
  //=============================================================================
  const WeaponThreeScene = {
    renderer: null,
    scene: null,
    camera: null,
    canvas: null,
    _refCount: 0,
    _bufW: 0,
    _bufH: 0,
    _rectKey: '',
    _alignCountdown: 0,
    // Alive but not presenting: no weapon is held, the context is kept anyway.
    _idle: false,

    // The overlay draws at the game's internal resolution and is then
    // CSS-stretched over the game canvas. That keeps the cost fixed no matter
    // how large the window is (a maximized 4K window used to cost ~13x a
    // 816x624 one) and makes one world unit exactly one game pixel, which is
    // the space _worldX/_worldY and every weapon offset are expressed in.
    _gameSize() {
      const w = (typeof Graphics !== 'undefined' && Graphics.width) ? Graphics.width : 816;
      const h = (typeof Graphics !== 'undefined' && Graphics.height) ? Graphics.height : 624;
      return { w, h };
    },

    init() {
      if (this.renderer) return;
      this._idle = false;
      const { w, h } = this._gameSize();

      this.canvas = document.createElement('canvas');
      this.canvas.id = 'weapon3DOverlay';
      this.canvas.width  = w;
      this.canvas.height = h;
      this.canvas.style.position      = 'absolute';
      this.canvas.style.pointerEvents = 'none';
      this.canvas.style.zIndex        = '10';
      this.canvas.style.left          = '0px';
      this.canvas.style.top           = '0px';
      document.body.appendChild(this.canvas);

      // No MSAA: the models are rendered through the PSX nearest-filter pass
      // anyway, so antialiasing only paid for samples that get quantised away.
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: false,
        stencil: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0);
      this._bufW = w;
      this._bufH = h;

      this.camera = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 1, 4000);
      this.camera.position.set(0, 0, 2000);

      this.scene = new THREE.Scene();
      this._buildLights();

      this._alignCanvas();
      this._resizeObserver = new ResizeObserver(() => this._alignCanvas());
      this._resizeObserver.observe(document.body);
    },

    // The weapon in your hands is standing in the same weather as everything
    // else on screen, so it borrows the battle scene's day/night rig rather
    // than keeping its own fixed white lights: a blade at dusk catches the
    // orange low sun, and at night reflects a cold sky instead of a studio.
    // Shadows are off here (nothing for a first person weapon to cast onto)
    // but the sky reflection is very much on, since a reflection is most of
    // what makes a metal weapon read as metal.
    //
    // The overlay works in game pixels, so the light is parked far enough out
    // to behave as directional at that scale. Falls back to the old fixed
    // lights if the day/night rig is switched off or has not loaded.
    _buildLights() {
      const B = window.Battler3D;
      if (B && B.DayNightRig && B.dayNightEnabled && B.dayNightEnabled()) {
        try {
          this.lighting = new B.DayNightRig(this.scene, this.renderer, {
            shadows: false,
            env: true,
            dirDistance: 800,
          });
          return;
        } catch (e) {
          this.lighting = null;
        }
      }
      this.lighting = null;
      this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));
      const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
      dirLight.position.set(1, 2, 2);
      this.scene.add(dirLight);
      const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.35);
      dirLight2.position.set(-2, -1, 1);
      this.scene.add(dirLight2);
    },

    // Keeps the drawing buffer at game resolution and the element parked on top
    // of the game canvas. Both halves are no-ops when nothing changed, so this
    // is safe to call from the resize observer and periodically from render().
    _alignCanvas() {
      if (!this.canvas) return;
      const { w, h } = this._gameSize();

      if (w !== this._bufW || h !== this._bufH) {
        this._bufW = w;
        this._bufH = h;
        this.canvas.width  = w;
        this.canvas.height = h;
        if (this.renderer) this.renderer.setSize(w, h, false);
        if (this.camera) {
          this.camera.left   = -w / 2;
          this.camera.right  = w / 2;
          this.camera.top    = h / 2;
          this.camera.bottom = -h / 2;
          this.camera.updateProjectionMatrix();
        }
      }

      const game = document.getElementById('gameCanvas');
      const r = game ? game.getBoundingClientRect() : null;
      const left   = r ? r.left   : 0;
      const top    = r ? r.top    : 0;
      const width  = r ? r.width  : window.innerWidth;
      const height = r ? r.height : window.innerHeight;
      const key = left + '|' + top + '|' + width + '|' + height;
      if (key === this._rectKey) return;
      this._rectKey = key;

      const s = this.canvas.style;
      s.left   = left + 'px';
      s.top    = top + 'px';
      s.width  = width + 'px';
      s.height = height + 'px';
    },

    ref() {
      if (!this.renderer) this.init();
      else if (this._idle) this._wake();
      this._refCount++;
    },

    // Letting go of the last weapon puts the overlay to sleep, it does NOT
    // hand the context back. Swapping the weapon in your hands terminates one
    // sprite and builds the next, and while the count sits at zero in between
    // a teardown here meant a whole WebGL context destroyed and rebuilt mid
    // battle: a fresh context, a fresh compile of every shader and a fresh
    // environment map for the day/night rig, plus one frame with the layer
    // gone from the compositor. That is the flicker every weapon switch used
    // to show. One context for the session, the same as the battler renderer.
    deref() {
      this._refCount--;
      if (this._refCount <= 0) {
        this._refCount = 0;
        this.idle();
      }
    },

    // Nothing is held: stop presenting the layer. The canvas keeps whatever
    // was last drawn into it, so the frame is cleared before it is hidden or
    // the last weapon would stay painted over the screen.
    idle() {
      if (!this.renderer || this._idle) return;
      this._idle = true;
      try {
        // The PSX pass can leave a render target bound; clear the canvas.
        this.renderer.setRenderTarget(null);
        this.renderer.clear();
      } catch (e) { /* context already gone */ }
      if (this.canvas) this.canvas.style.display = 'none';
    },

    _wake() {
      this._idle = false;
      if (this.canvas) this.canvas.style.display = 'block';
      // The element was out of the compositor while idle: re-place it.
      this._rectKey = '';
      this._alignCanvas();
    },

    render() {
      if (!this.renderer || !this.scene || !this.camera) return;
      // Asleep: nothing is held, and idle() already cleared the frame.
      if (this._idle) return;
      // Re-check the placement a few times a second rather than every frame:
      // getBoundingClientRect() forces a synchronous layout.
      if (--this._alignCountdown <= 0) {
        this._alignCountdown = 20;
        this._alignCanvas();
      }
      if (this.lighting) this.lighting.update();
      if (window.PSXShader) {
        window.PSXShader.render(this.renderer, this.scene, this.camera);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    },

    // A true teardown, kept for a caller that really wants the context gone
    // (nothing does today: deref() sleeps instead, see above).
    cleanup() {
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
      // Before the renderer goes: the rig owns a render target on this context.
      if (this.lighting) { this.lighting.dispose(); this.lighting = null; }
      if (this.canvas && this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
      if (this.renderer) {
        // Frees the PSX downsample render target hung on this renderer.
        if (window.PSXShader && window.PSXShader.disposeContext) {
          window.PSXShader.disposeContext(this.renderer);
        }
        // dispose() leaves the WebGL context itself alive. The browser caps how
        // many contexts may live at once and force-loses the OLDEST past the
        // cap, which is the game's own canvas: PIXI then silently stops
        // rendering and the picture freezes until the game is restarted.
        this.renderer.dispose();
        try {
          if (this.renderer.forceContextLoss) this.renderer.forceContextLoss();
        } catch (e) { /* context already gone */ }
      }
      this.renderer = null;
      this.scene = null;
      this.camera = null;
      this.canvas = null;
      this._refCount = 0;
      this._bufW = 0;
      this._bufH = 0;
      this._rectKey = '';
      this._idle = false;
    }
  };

  //=============================================================================
  // disposeWeaponObject3D - free GPU resources of a removed 3D weapon model
  //=============================================================================
  // Traverses a THREE object and disposes its geometries and materials so a
  // weapon regeneration/swap/terminate does not leak GPU buffers. Textures
  // flagged with _weaponSharedCache belong to the procedural texture cache and
  // are reused by other models, so they are left untouched; only textures the
  // model itself owns (e.g. GLB-loaded maps) are disposed.
  function disposeWeaponObject3D(root) {
    if (!root || typeof root.traverse !== 'function') return;

    const disposeMaterial = (mat) => {
      if (!mat) return;
      for (const key in mat) {
        const val = mat[key];
        if (val && val.isTexture && !val._weaponSharedCache && typeof val.dispose === 'function') {
          val.dispose();
        }
      }
      if (typeof mat.dispose === 'function') mat.dispose();
    };

    root.traverse((obj) => {
      if (obj.geometry && typeof obj.geometry.dispose === 'function') {
        obj.geometry.dispose();
      }
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach(disposeMaterial);
        } else {
          disposeMaterial(obj.material);
        }
      }
    });
  }

  //=============================================================================
  // Sprite_3DWeapon - 3D GLB model weapon renderer
  //=============================================================================
  class Sprite_3DWeapon {
    constructor(weapon, screenX, screenY) {
      this._weapon = weapon;
      this._model = null;
      this._mixer = null;
      this._animData = null;
      this._animElapsed = 0;
      this._baseRotation = weapon.model3dRotation || { x: 0, y: 0, z: 0 };
      this._screenX = screenX !== undefined ? screenX : getScaledWeaponX();
      this._screenY = screenY !== undefined ? screenY : getScaledWeaponY();
      this._lastTime = performance.now();
      this._visible = false;
      this._pendingAnimation = null;
      // Entry slide / exit fade state. The weapon starts fully off the left
      // edge, so the very first pose it is built at is already out of frame.
      this._entryElapsed = 0;
      this._entryDone = false;
      this._exiting = false;
      this._exitElapsed = 0;
      this._transitionDX = this._entrySlideX();
      this._fadeActive = false;
      WeaponThreeScene.ref();
      this._loadModel();
      this._ensureKeyframes();
    }

    // Every pose the weapon takes (idle sway, attack keyframes, the loaded
    // rest pose) is placed through _worldX, so folding the transition offset in
    // here moves the weapon without any of them having to know about it.
    _worldX(sx) {
      return sx - (Graphics.width || 816) / 2 + (this._transitionDX || 0);
    }

    _worldY(sy) {
      return -( sy - (Graphics.height || 624) / 2 );
    }

    _loadModel() {
      if (!window.THREE || !THREE.GLTFLoader) return;
      const loader = new THREE.GLTFLoader();
      loader.load(
        `models/${this._weapon.model3d}`,
        (gltf) => {
          this._model = gltf.scene;
          const s = this._weapon.model3dScale || 1.0;
          this._model.scale.set(s, s, s);
          const r = this._baseRotation;
          this._model.rotation.set(
            THREE.MathUtils.degToRad(r.x),
            THREE.MathUtils.degToRad(r.y),
            THREE.MathUtils.degToRad(r.z)
          );
          this._model.position.set(this._worldX(this._screenX), this._worldY(this._screenY), 0);
          this._model.visible = false;
          WeaponThreeScene.scene.add(this._model);

          if (gltf.animations && gltf.animations.length > 0) {
            this._mixer = new THREE.AnimationMixer(this._model);
            this._clips = {};
            gltf.animations.forEach(clip => {
              this._clips[clip.name] = this._mixer.clipAction(clip);
            });
          }

          if (this._pendingAnimation != null) {
            const pending = this._pendingAnimation;
            this._pendingAnimation = null;
            this.playAnimation(pending);
          }
        },
        undefined,
        (err) => console.error('[Sprite_3DWeapon] Failed to load model:', this._weapon.model3d, err)
      );
    }

    _ensureKeyframes() {
      if (!window._weaponKeyframes3d) {
        fetch('js/db/Sprites/MovementKeyFrame3d.json')
          .then(r => r.json())
          .then(data => {
            window._weaponKeyframes3d = data;
            if (this._pendingAnimation != null && this._model) {
              this.playAnimation(this._pendingAnimation);
              this._pendingAnimation = null;
            }
          })
          .catch(e => console.error('[Sprite_3DWeapon] Failed to load MovementKeyFrame3d.json', e));
      }
    }

    setPosition(sx, sy) {
      this._screenX = sx;
      this._screenY = sy;
      if (this._model) {
        this._model.position.set(this._worldX(sx), this._worldY(sy), 0);
      }
    }

    playClip(clipName) {
      if (!this._mixer || !this._clips) return;
      this._mixer.stopAllAction();
      const action = this._clips[clipName];
      if (action) {
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
        this._model.visible = true;
        this._visible = true;
      }
    }

    playReload() {
      if (!this._model) return;
      this.playClip('Reload');
    }

    playAnimation(name) {
      this._animElapsed = 0;
      this._animData = null;

      if (!this._model) {
        // '' rather than null: no name means "this weapon's own motion",
        // which is a real request and must survive the wait for the model.
        this._pendingAnimation = name || '';
        return;
      }

      this._model.visible = true;
      this._visible = true;

      if ([7, 9].includes(this._weapon.wtypeId) && this._clips && this._clips['Shoot']) {
        this.playClip('Shoot');
        return;
      }

      const kf = window._weaponKeyframes3d;
      if (kf && kf[name]) {
        this._animData = kf[name];
        return;
      }

      if (kf) {
        this._animData = kf[name] || kf['Swing'] || null;
      } else {
        // '' rather than null: no name means "this weapon's own motion",
        // which is a real request and must survive the wait for the model.
        this._pendingAnimation = name || '';
      }
    }

    /** How far left of its anchor the weapon sits at the start of its entry. */
    _entrySlideX() {
      return -(this._screenX + ENTRY_MARGIN_PX);
    }

    /** Fade the weapon out of frame rather than cutting it (battle over). */
    beginExit() {
      if (this._exiting) return;
      this._exiting = true;
      this._exitElapsed = 0;
      this._entryDone = true;
    }

    /**
     * Advances the entry slide or the exit fade. Only writes _transitionDX and
     * the material opacity, so it must run BEFORE the frame's pose is applied.
     */
    _updateTransition(deltaMs) {
      if (!this._model) return;

      if (this._exiting) {
        this._exitElapsed += deltaMs;
        const t = Math.min(this._exitElapsed / EXIT_DURATION_MS, 1);
        // Drifts back the way it came as it goes, accelerating out of frame.
        this._transitionDX = this._entrySlideX() * EXIT_DRIFT * t * t;
        this._applyFade(1 - t);
        if (t >= 1) {
          this._model.visible = false;
          this._visible = false;
        }
        return;
      }

      if (this._entryDone) {
        this._transitionDX = 0;
        this._applyFade(1);
        return;
      }

      this._entryElapsed += deltaMs;
      const t = Math.min(this._entryElapsed / ENTRY_DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      this._transitionDX = this._entrySlideX() * (1 - eased);
      // Opacity leads the slide so the weapon is solid well before it settles.
      this._applyFade(Math.min(t * 2, 1));
      if (t >= 1) this._entryDone = true;
    }

    /**
     * Uniform opacity over the whole model. Each material's rest state is saved
     * the first time it is touched and put back the moment the fade is over, so
     * an opaque weapon never stays in the transparent pass.
     */
    _applyFade(alpha) {
      if (alpha >= 1) {
        if (!this._fadeActive) return;
        this._fadeRest.forEach((rest, mat) => {
          mat.opacity = rest.opacity;
          mat.transparent = rest.transparent;
        });
        this._fadeActive = false;
        return;
      }
      if (!this._fadeActive) {
        this._fadeRest = new Map();
        this._model.traverse((o) => {
          if (!o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!this._fadeRest.has(m)) {
              this._fadeRest.set(m, { opacity: m.opacity, transparent: m.transparent });
            }
          }
        });
        this._fadeActive = true;
      }
      this._fadeRest.forEach((rest, mat) => {
        mat.transparent = true;
        mat.opacity = rest.opacity * alpha;
      });
    }

    update() {
      const now = performance.now();
      const deltaMs = now - this._lastTime;
      this._lastTime = now;

      if (!this._model) return;

      this._updateTransition(deltaMs);
      if (this._mixer) this._mixer.update(deltaMs / 1000);
      if (this._animData) this._applyKeyframe(deltaMs);
      this._updateShimmer();

      // Scene render is batched once per frame by the Spriteset_Battle
      // iterator (WeaponSystem.js) rather than once per weapon instance.
    }

    /**
     * The elemental tint an actor's <weaponShimmer> state puts on the weapon
     * they are holding. Materials are per-instance (WeaponSystemProcedural
     * clones them), so writing emissive here cannot leak into the cached
     * prototype or into another actor's copy of the same weapon.
     */
    _updateShimmer() {
      let color = null;
      if (this._visible) {
        const scene = SceneManager._scene;
        const set = scene && scene._spriteset;
        if (set && set.getCurrentBattleActor) {
          const actor = set.getCurrentBattleActor(false);
          if (actor && actor.getLatestWeaponShimmerColor) {
            color = actor.getLatestWeaponShimmerColor();
          }
        }
      }
      if (color == null) {
        if (this._shimmerActive) {
          this._forEachMaterial((m, saved) => {
            if (m.emissive && saved) {
              m.emissive.setHex(saved.hex);
              m.emissiveIntensity = saved.intensity;
            }
          });
          this._shimmerActive = false;
        }
        return;
      }
      if (!this._shimmerActive) {
        // Remember what each material looked like before the state landed.
        this._shimmerRest = new Map();
        this._model.traverse((o) => {
          if (o.material && o.material.emissive) {
            this._shimmerRest.set(o.material, {
              hex: o.material.emissive.getHex(),
              intensity: o.material.emissiveIntensity
            });
          }
        });
        this._shimmerActive = true;
      }
      // Gentle pulse so the tint reads as a shimmer rather than a flat wash.
      const pulse = (Math.sin(Date.now() / 180) + 1) / 2;
      const intensity = 0.35 + pulse * 0.45;
      this._forEachMaterial((m) => {
        if (!m.emissive) return;
        m.emissive.setHex(color);
        m.emissiveIntensity = intensity;
      });
    }

    _forEachMaterial(fn) {
      if (!this._shimmerRest) return;
      this._shimmerRest.forEach((saved, mat) => fn(mat, saved));
    }

    _applyKeyframe(deltaMs) {
      this._animElapsed += deltaMs;
      const dur = this._animData.duration || 500;
      const t = Math.min(this._animElapsed / dur, 1.0);
      const frames = this._animData.frames;
      if (!frames || frames.length === 0) return;

      let prev = frames[0];
      let next = frames[frames.length - 1];
      for (let i = 0; i < frames.length - 1; i++) {
        if (t >= frames[i].t && t <= frames[i + 1].t) {
          prev = frames[i];
          next = frames[i + 1];
          break;
        }
      }

      const span = next.t - prev.t;
      const lt = span > 0 ? (t - prev.t) / span : 0;
      const lerp = (a, b, f) => a + (b - a) * f;

      const px = lerp(prev.x || 0, next.x || 0, lt);
      const py = lerp(prev.y || 0, next.y || 0, lt);
      const pz = lerp(prev.z || 0, next.z || 0, lt);
      const rx = lerp(prev.rx || 0, next.rx || 0, lt);
      const ry = lerp(prev.ry || 0, next.ry || 0, lt);
      const rz = lerp(prev.rz || 0, next.rz || 0, lt);
      const sc = lerp(
        prev.scale !== undefined ? prev.scale : 1,
        next.scale !== undefined ? next.scale : 1,
        lt
      );

      this._model.position.set(
        this._worldX(this._screenX) + px,
        this._worldY(this._screenY) + py,
        pz
      );
      const r = this._baseRotation;
      this._model.rotation.set(
        THREE.MathUtils.degToRad(r.x + rx),
        THREE.MathUtils.degToRad(r.y + ry),
        THREE.MathUtils.degToRad(r.z + rz)
      );
      const s = (this._weapon.model3dScale || 1.0) * sc;
      this._model.scale.set(s, s, s);

      if (t >= 1.0) {
        this._animData = null;
        this._model.visible = false;
        this._visible = false;
      }
    }

    terminate() {
      if (this._model) {
        // A model built from a cached prototype can still be sharing a material
        // array with it, so a half-finished fade must be handed back opaque or
        // the next weapon off that prototype is born transparent.
        this._applyFade(1);
        if (WeaponThreeScene.scene) {
          WeaponThreeScene.scene.remove(this._model);
        }
        // Free geometries/materials (and model-owned textures) to avoid a GPU
        // leak on every weapon regeneration/swap.
        disposeWeaponObject3D(this._model);
      }
      if (this._mixer && typeof this._mixer.stopAllAction === 'function') {
        this._mixer.stopAllAction();
      }
      this._model = null;
      this._mixer = null;
      this._clips = null;
      WeaponThreeScene.deref();
    }
  }

  window.Sprite_3DWeapon = Sprite_3DWeapon;
  window.WeaponThreeScene = WeaponThreeScene;
})();
