/*:
 * @target MZ
 * @plugindesc Character Switch Equip Menu UI v1.6.0
 * @author Omni-Lex
 * @version 1.6.0
 * @description DOM scene layer for ItemSystemEquipment. Must be listed AFTER ItemSystemEquipment.js.
 * @url https://nocoldiz.itch.io/hypernet-explorer
 * @help ItemSystemEquipmentUI.js
 *
 * Reads window.EquipI18n and window.EquipParams exposed by ItemSystemEquipment.js.
 */

(() => {
    'use strict';

    const i18n           = window.EquipI18n;
    const enableSwitching = window.EquipParams.enableSwitching;
    const switchSound     = window.EquipParams.switchSound;

    // ── Shared character-switcher hint helper (idempotent across plugins) ──────
    // Shows controller bumper hints (L / R) around a .companion-tabs-row when a
    // gamepad is connected, or a single TAB hint otherwise. Also installs a Tab
    // keyboard shortcut that cycles characters only while no controller is
    // connected (the bumpers / pageup-pagedown handle it when one is).
    if (!window.CharSwitcher) {
        window.CharSwitcher = {
            isControllerConnected() {
                const pads = navigator.getGamepads ? navigator.getGamepads() : [];
                for (let i = 0; i < pads.length; i++) {
                    if (pads[i] && pads[i].connected) return true;
                }
                return false;
            },
            // Hint HTML for the left/right of the switcher, per current input device.
            parts(memberCount) {
                if (!memberCount || memberCount <= 1) return { left: '', right: '' };
                if (this.isControllerConnected()) {
                    return {
                        left: '<span class="char-switch-hint">L</span>',
                        right: '<span class="char-switch-hint">R</span>'
                    };
                }
                return { left: '', right: '<span class="char-switch-hint">TAB</span>' };
            },
            // Hints + tabs row, without an outer wrapper (caller supplies one).
            inner(tabsRowHTML, memberCount) {
                const p = this.parts(memberCount);
                return p.left + tabsRowHTML + p.right;
            },
            // Hints + tabs row wrapped in a .companion-switcher flex row.
            wrap(tabsRowHTML, memberCount) {
                return `<div class="companion-switcher">${this.inner(tabsRowHTML, memberCount)}</div>`;
            },
            // Cycle characters via Tab (next) / Shift+Tab (previous), keyboard only.
            installTabKey(scene, onCycle) {
                if (scene._charSwitchTabListener) return;
                scene._charSwitchTabListener = (e) => {
                    if (e.key !== 'Tab') return;
                    e.preventDefault();
                    if (this.isControllerConnected()) return;
                    onCycle(e.shiftKey ? -1 : 1);
                };
                window.addEventListener('keydown', scene._charSwitchTabListener);
            },
            removeTabKey(scene) {
                if (scene._charSwitchTabListener) {
                    window.removeEventListener('keydown', scene._charSwitchTabListener);
                    scene._charSwitchTabListener = null;
                }
            }
        };
    }

    // =============================================================================
    // Scene_Equip – lifecycle
    // =============================================================================

    const _Scene_Equip_create = Scene_Equip.prototype.create;
    Scene_Equip.prototype.create = function () {
        _Scene_Equip_create.call(this);

        // Hide standard RMMZ windows
        if (this._helpWindow)    { this._helpWindow.deactivate();    this._helpWindow.hide();    }
        if (this._statusWindow)  { this._statusWindow.deactivate();  this._statusWindow.hide();  }
        if (this._commandWindow) { this._commandWindow.deactivate(); this._commandWindow.hide(); }
        if (this._slotWindow)    { this._slotWindow.deactivate();    this._slotWindow.hide();    }
        if (this._itemWindow)    { this._itemWindow.deactivate();    this._itemWindow.hide();    }

        this._currentActorIndex = $gameParty.allMembers().indexOf(this._actor);
        this._activeArea        = 'commands'; // 'commands' | 'slots' | 'inventory'
        this._commandIndex      = 0;          // 0: Equip, 1: Optimize, 2: Random, 3: Clear
        this._slotIndex         = 0;
        this._inventoryIndex    = 0;

        // WASD state
        this._wasdInput      = { up: false, down: false, left: false, right: false };
        this._wasdHeld       = { up: false, down: false, left: false, right: false };
        this._wasdHoldFrames = { up: 0,     down: 0,     left: 0,     right: 0     };

        this._wasdListener = (event) => {
            if (event.repeat) return;
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdInput.up    = true; this._wasdHeld.up    = true; event.preventDefault(); }
            if (key === 's') { this._wasdInput.down  = true; this._wasdHeld.down  = true; event.preventDefault(); }
            if (key === 'a') { this._wasdInput.left  = true; this._wasdHeld.left  = true; event.preventDefault(); }
            if (key === 'd') { this._wasdInput.right = true; this._wasdHeld.right = true; event.preventDefault(); }
        };
        this._wasdUpListener = (event) => {
            const key = event.key.toLowerCase();
            if (key === 'w') { this._wasdHeld.up    = false; this._wasdHoldFrames.up    = 0; }
            if (key === 's') { this._wasdHeld.down  = false; this._wasdHoldFrames.down  = 0; }
            if (key === 'a') { this._wasdHeld.left  = false; this._wasdHoldFrames.left  = 0; }
            if (key === 'd') { this._wasdHeld.right = false; this._wasdHoldFrames.right = 0; }
        };
        window.addEventListener('keydown', this._wasdListener);
        window.addEventListener('keyup',   this._wasdUpListener);

        if (enableSwitching) {
            window.CharSwitcher.installTabKey(this, (dir) => {
                if (dir > 0) this.switchToNextCharacter();
                else this.switchToPreviousCharacter();
            });
        }

        this.initUIEquip();
        this._refreshDOM();
    };

    Scene_Equip.prototype.update = function () {
        this.updateUIEquipInput();
        Scene_MenuBase.prototype.update.call(this);
    };

    Scene_Equip.prototype.terminate = function () {
        if (this._wasdListener) {
            window.removeEventListener('keydown', this._wasdListener);
            window.removeEventListener('keyup',   this._wasdUpListener);
            this._wasdListener   = null;
            this._wasdUpListener = null;
        }
        window.CharSwitcher.removeTabKey(this);
        this.cleanup3DWeaponPreview();
        const container = document.getElementById('equip-container');
        if (container) container.remove();
        Scene_MenuBase.prototype.terminate.call(this);
    };

    // =============================================================================
    // 3D weapon preview
    // =============================================================================
    // The viewer itself is a shared service (window.Weapon3DPreview): one weapon,
    // one canvas, orbit / pan / zoom, with the model's own gears, ropes and runes
    // ticking exactly as they do in battle. Any other menu that wants to show a
    // weapon in 3D (the main menu's search page) mounts the same viewer rather
    // than growing a second copy of this loop.
    if (!window.Weapon3DPreview) {
        window.Weapon3DPreview = (() => {

            // Build one viewport on `canvas` for `item`. Returns a record the
            // caller keeps and later hands back to disposeAll(), or null when
            // three.js is missing or the canvas is not in the document.
            function mount(canvas, item) {
                if (typeof THREE === 'undefined' || !canvas || !item) return null;

                const rect   = canvas.getBoundingClientRect();
                const width  = rect.width  || 140;
                const height = rect.height || 380;

                const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
                renderer.setSize(width, height);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

                const scene = new THREE.Scene();
                scene.add(new THREE.AmbientLight(0xffffff, 0.95));
                const dl1 = new THREE.DirectionalLight(0xffffff, 0.7); dl1.position.set(3, 5, 4);   scene.add(dl1);
                const dl2 = new THREE.DirectionalLight(0xffffff, 0.4); dl2.position.set(-3, -5, -4); scene.add(dl2);

                const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 50);
                camera.position.set(0, 0, 2.7);

                let model = null;

                const setupModelPosition = (m) => {
                    const box    = new THREE.Box3().setFromObject(m);
                    const size   = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());
                    m.position.sub(center);
                    const scaleFactor = 1.85 / (Math.max(size.x, size.y, size.z) || 1);
                    m.scale.set(scaleFactor, scaleFactor, scaleFactor);
                    m.rotation.set(0.1, -0.4, 0.35);
                    if (window.PSXShader) window.PSXShader.applyToObject(m);
                    scene.add(m);
                    model = m;
                };

                if (item.model3d && THREE.GLTFLoader) {
                    new THREE.GLTFLoader().load(
                        `models/${item.model3d}`,
                        (gltf) => setupModelPosition(gltf.scene),
                        undefined,
                        (err) => console.error('[Weapon3DPreview] Failed to load model:', item.model3d, err)
                    );
                } else if (window.WeaponSystemProcedural) {
                    const pModel = WeaponSystemProcedural.createModel(item);
                    if (pModel) setupModelPosition(pModel);
                }

                let activeButton  = -1;
                let prevPosition  = { x: 0, y: 0 };
                let isDragging    = false;

                const onStart = (e) => {
                    if (e.button === 0 || e.button === 1) {
                        activeButton = e.button;
                        isDragging   = true;
                        prevPosition = { x: e.clientX, y: e.clientY };
                        if (e.button === 1) e.preventDefault();
                    }
                };
                const onMove = (e) => {
                    if (activeButton === -1) return;
                    const dx = e.clientX - prevPosition.x;
                    const dy = e.clientY - prevPosition.y;
                    if (activeButton === 0 && model) {
                        model.rotation.y += dx * 0.015;
                        model.rotation.x += dy * 0.015;
                    } else if (activeButton === 1) {
                        const panSpeed = 0.002 * camera.position.z;
                        camera.position.x -= dx * panSpeed;
                        camera.position.y += dy * panSpeed;
                    }
                    prevPosition = { x: e.clientX, y: e.clientY };
                };
                const onEnd = (e) => {
                    if (e.button === activeButton || e.type === 'mouseup') {
                        activeButton = -1;
                        isDragging   = false;
                    }
                };
                const onAuxClick = (e) => { if (e.button === 1) e.preventDefault(); };
                const onWheel    = (e) => {
                    e.preventDefault();
                    camera.position.z = Math.max(0.4, Math.min(5.0, camera.position.z + e.deltaY * 0.001));
                };

                const onTouchStart = (e) => {
                    if (e.touches.length === 1) {
                        isDragging   = true;
                        activeButton = 0;
                        prevPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    }
                };
                const onTouchMove = (e) => {
                    if (e.touches.length === 1 && model) {
                        const dx = e.touches[0].clientX - prevPosition.x;
                        const dy = e.touches[0].clientY - prevPosition.y;
                        model.rotation.y += dx * 0.015;
                        model.rotation.x += dy * 0.015;
                        prevPosition = { x: e.touches[0].clientX, y: e.touches[0].clientY };
                    }
                };
                const onTouchEnd = () => { isDragging = false; activeButton = -1; };

                canvas.addEventListener('mousedown',   onStart);
                canvas.addEventListener('mousemove',   onMove);
                window.addEventListener('mouseup',     onEnd);
                canvas.addEventListener('wheel',       onWheel, { passive: false });
                canvas.addEventListener('auxclick',    onAuxClick);
                canvas.addEventListener('contextmenu', (e) => e.preventDefault());
                canvas.addEventListener('touchstart',  onTouchStart);
                canvas.addEventListener('touchmove',   onTouchMove);
                window.addEventListener('touchend',    onTouchEnd);

                // One preview record per weapon; holds this loop's latest rAF id so
                // cleanup can cancel it (instead of pushing a new id every frame into
                // a shared, unbounded array).
                const previewEntry = {
                    renderer, canvas,
                    listeners: { mousedown: onStart, mousemove: onMove, mouseup: onEnd, wheel: onWheel,
                                 auxclick: onAuxClick, touchstart: onTouchStart, touchmove: onTouchMove, touchend: onTouchEnd },
                    rafId: 0
                };

                // Scratch objects reused every frame to avoid per-frame allocations.
                const _scratchDeltaRot = new THREE.Euler();
                const _scratchDeltaPos = new THREE.Vector3();

                let _previewLastTime = performance.now();
                const animate = () => {
                    previewEntry.rafId = requestAnimationFrame(animate);

                    const now     = performance.now();
                    const deltaMs = Math.min(now - _previewLastTime, 50);
                    _previewLastTime = now;

                    if (model) {
                        if (!model.userData._prevRot) {
                            model.userData._prevRot = model.rotation.clone();
                            model.userData._prevPos = model.position.clone();
                        }
                        const deltaRot = _scratchDeltaRot.set(
                            model.rotation.x - model.userData._prevRot.x,
                            model.rotation.y - model.userData._prevRot.y,
                            model.rotation.z - model.userData._prevRot.z
                        );
                        const deltaPos = _scratchDeltaPos.copy(model.position).sub(model.userData._prevPos);
                        model.userData._prevRot.copy(model.rotation);
                        model.userData._prevPos.copy(model.position);

                        if (window.WeaponSystemProcedural &&
                            (deltaRot.x !== 0 || deltaRot.y !== 0 || deltaRot.z !== 0 ||
                             deltaPos.x !== 0 || deltaPos.y !== 0 || deltaPos.z !== 0)) {
                            const ropes = [];
                            if (model.userData._verletRope)  ropes.push(model.userData._verletRope);
                            if (model.userData._verletRopes) model.userData._verletRopes.forEach(r => ropes.push(r));
                            if (ropes.length > 0) {
                                model.updateMatrixWorld(true);
                                const worldAnchor = new THREE.Vector3(0, 0, 0).applyMatrix4(model.matrixWorld);
                                for (const rope of ropes) {
                                    for (const p of rope.points) {
                                        if (p.pinned) continue;
                                        const oldPos = p.pos.clone();
                                        p.pos.add(deltaPos);
                                        p.prev.add(deltaPos);
                                        const rotateAround = (point, anchor, euler) => {
                                            const dir = point.clone().sub(anchor);
                                            dir.applyEuler(euler);
                                            point.copy(anchor).add(dir);
                                        };
                                        rotateAround(p.pos,  worldAnchor, deltaRot);
                                        rotateAround(p.prev, worldAnchor, deltaRot);
                                        const rigidDisp = p.pos.clone().sub(oldPos);
                                        const lag = 0.55 * (rope.points.indexOf(p) / rope.points.length);
                                        p.pos.sub(rigidDisp.multiplyScalar(lag));
                                    }
                                }
                            }
                        }
                    }

                    if (!isDragging && model) model.rotation.y += 0.007;

                    if (model && window.WeaponSystemProcedural) {
                        // Gears, drifting shards and pulsing runes declared by the
                        // model itself, same as in battle.
                        WeaponSystemProcedural.tickModelParts(model, deltaMs);
                        const ropes = [];
                        if (model.userData._verletRope)  ropes.push(model.userData._verletRope);
                        if (model.userData._verletRopes) model.userData._verletRopes.forEach(r => ropes.push(r));
                        if (ropes.length > 0) {
                            model.updateMatrixWorld(true);
                            const invWorld = model.matrixWorld.clone().invert();
                            const dtSec   = deltaMs / 1000;
                            const worldScale = model.scale.x || 1;
                            for (const rope of ropes) {
                                const worldAnchor = rope.anchorPos.clone().applyMatrix4(model.matrixWorld);
                                WeaponSystemProcedural.tickRope(rope, dtSec, worldAnchor, worldScale);
                                WeaponSystemProcedural.updateRopeMeshes(rope, invWorld);
                            }
                        }
                    }

                    if (window.PSXShader) {
                        window.PSXShader.render(renderer, scene, camera);
                    } else {
                        renderer.render(scene, camera);
                    }
                };
                animate();

                return previewEntry;
            }

            function disposeAll(entries) {
                if (!entries) return;
                entries.forEach(p => {
                    if (p.rafId) cancelAnimationFrame(p.rafId);
                    p.renderer.dispose();
                    p.canvas.removeEventListener('mousedown',  p.listeners.mousedown);
                    p.canvas.removeEventListener('mousemove',  p.listeners.mousemove);
                    window.removeEventListener('mouseup',      p.listeners.mouseup);
                    p.canvas.removeEventListener('wheel',      p.listeners.wheel);
                    p.canvas.removeEventListener('touchstart', p.listeners.touchstart);
                    p.canvas.removeEventListener('touchmove',  p.listeners.touchmove);
                    window.removeEventListener('touchend',     p.listeners.touchend);
                    // dispose() releases this scene's GPU resources but leaves the
                    // WebGL context itself alive. The browser caps how many contexts
                    // may live at once and force-loses the OLDEST once the cap is
                    // passed: that is the game's own canvas, after which PIXI
                    // silently stops rendering and the picture freezes for the rest
                    // of the session. Release it here, and swap in a clean canvas
                    // node for the next preview, since a lost context never comes
                    // back on the element it was taken from.
                    try { if (p.renderer.forceContextLoss) p.renderer.forceContextLoss(); } catch (e) {}
                    if (p.canvas && p.canvas.parentNode) {
                        p.canvas.parentNode.replaceChild(p.canvas.cloneNode(false), p.canvas);
                    }
                });
            }

            return { mount, disposeAll };
        })();
    }

    Scene_Equip.prototype.init3DWeaponPreview = function () {
        this.cleanup3DWeaponPreview();

        const equips  = this._hoverPreviewEquips || this._actor.equips();
        const weapons = [];
        const w0 = equips[0];
        if (w0 && DataManager.isWeapon(w0)) weapons.push({ item: w0, canvasId: 'weapon-preview-canvas-0' });
        const w1 = equips[1];
        if (w1 && DataManager.isWeapon(w1)) {
            weapons.push({ item: w1, canvasId: weapons.length === 0 ? 'weapon-preview-canvas-0' : 'weapon-preview-canvas-1' });
        }
        if (weapons.length === 0) return;

        this._previewRenderers = [];
        weapons.forEach(wData => {
            const entry = window.Weapon3DPreview.mount(document.getElementById(wData.canvasId), wData.item);
            if (entry) this._previewRenderers.push(entry);
        });
    };

    Scene_Equip.prototype.cleanup3DWeaponPreview = function () {
        window.Weapon3DPreview.disposeAll(this._previewRenderers);
        this._previewRenderers = [];
    };

    // =============================================================================
    // Actor switching
    // =============================================================================

    Scene_Equip.prototype.switchToPreviousCharacter = function () {
        const party = $gameParty.allMembers();
        if (party.length <= 1) return;
        this._currentActorIndex = (this._currentActorIndex - 1 + party.length) % party.length;
        this._actor = party[this._currentActorIndex];
        if (switchSound) SoundManager.playCursor();
        this._refreshDOM();
    };

    Scene_Equip.prototype.switchToNextCharacter = function () {
        const party = $gameParty.allMembers();
        if (party.length <= 1) return;
        this._currentActorIndex = (this._currentActorIndex + 1) % party.length;
        this._actor = party[this._currentActorIndex];
        if (switchSound) SoundManager.playCursor();
        this._refreshDOM();
    };

    // =============================================================================
    // Inventory helpers
    // =============================================================================

    Scene_Equip.prototype.getInventoryItemsForSlot = function () {
        const actor   = this._actor;
        const slotId  = this._slotIndex;
        if (slotId < 0) return [];

        const etypeId = actor.equipSlots()[slotId];
        const lang    = ConfigManager.language || 'en';
        const t       = i18n[lang] || i18n['en'];

        let items = [];
        if (etypeId === 1) {
            items = $gameParty.weapons().filter(w => actor.canEquip(w));
            // Every weapon is equippable now, so weapons this character has no
            // proficiency in are still listed - just pushed below the ones they
            // can actually use. Array#sort is stable, so each group keeps its
            // original order.
            const prof = window.WeaponProficiency;
            if (prof) {
                items.sort((a, b) => (prof.isUntrained(actor, a) ? 1 : 0) - (prof.isUntrained(actor, b) ? 1 : 0));
            }
        } else {
            items = $gameParty.armors().filter(a => a.etypeId === etypeId && actor.canEquip(a));
        }
        items.unshift({ name: t.noEquip, id: -1, isRemoveOption: true });
        return items;
    };

    // =============================================================================
    // DOM init (one-time container setup)
    // =============================================================================

    Scene_Equip.prototype.initUIEquip = function () {
        if (!document.getElementById('equip-container')) {
            const container = document.createElement('div');
            container.id    = 'equip-container';
            document.body.appendChild(container);
        }
    };

    // =============================================================================
    // Right-page HTML builder (extracted for selective updates)
    // =============================================================================

    Scene_Equip.prototype._buildRightPageHTML = function () {
        const actor = this._actor;
        const lang  = ConfigManager.language || 'en';
        const t     = i18n[lang] || i18n['en'];

        // Build tempActor for stat-delta preview when browsing inventory
        let tempActor = null;
        if (this._activeArea === 'inventory') {
            const itemList = this.getInventoryItemsForSlot();
            if (itemList.length > 0) {
                this._inventoryIndex = Math.max(0, Math.min(itemList.length - 1, this._inventoryIndex));
                const selectedItem   = itemList[this._inventoryIndex];
                tempActor = JsonEx.makeDeepCopy(actor);
                tempActor.forceChangeEquip(this._slotIndex, selectedItem.isRemoveOption ? null : selectedItem);
            }
        }

        // Expose to 3D preview init
        this._hoverPreviewEquips = tempActor ? tempActor.equips() : null;

        // Weapon scaling: which base stat(s) the equipped weapon(s) scale on.
        // Instead of a separate "Scaling: STR" line, the scaling stat's own
        // label in the grid below is picked out in gold.
        const weapon1 = tempActor ? tempActor.equips()[0] : actor.equips()[0];
        const weapon2 = tempActor ? tempActor.equips()[1] : actor.equips()[1];
        const s1 = actor.getWeaponScalingType(weapon1);
        const s2 = actor.getWeaponScalingType(weapon2);
        const scalingCodes = new Set([s1, s2].filter(c => c && c !== 'MIX'));
        if (scalingCodes.size === 0) scalingCodes.add('STR');

        // Base + alchemical stats, interleaved into one 3-column grid: the
        // custom stats (Arcane/Substance/Stealth/Intimidation) ride as plain
        // numbers in the third column rather than their own bars.
        const cBefore = actor.calculateCustomStats();
        const cAfter  = tempActor ? tempActor.calculateCustomStats() : cBefore;
        const gridStats = [
            { label: t.hp,  code: null,  percent: false, valBefore: actor.mhp, valAfter: tempActor ? tempActor.mhp : actor.mhp },
            { label: t.mp,  code: null,  percent: false, valBefore: actor.mmp, valAfter: tempActor ? tempActor.mmp : actor.mmp },
            { label: t.arcane, code: null, percent: true, valBefore: cBefore.arcane, valAfter: cAfter.arcane },

            { label: t.str, code: 'STR', percent: false, valBefore: actor.atk, valAfter: tempActor ? tempActor.atk : actor.atk },
            { label: t.con, code: 'CON', percent: false, valBefore: actor.def, valAfter: tempActor ? tempActor.def : actor.def },
            { label: t.substance, code: null, percent: true, valBefore: cBefore.substance, valAfter: cAfter.substance },

            { label: t.int, code: 'INT', percent: false, valBefore: actor.mat, valAfter: tempActor ? tempActor.mat : actor.mat },
            { label: t.wis, code: 'WIS', percent: false, valBefore: actor.mdf, valAfter: tempActor ? tempActor.mdf : actor.mdf },
            { label: t.stealth, code: null, percent: true, valBefore: cBefore.stealth, valAfter: cAfter.stealth },

            { label: t.dex, code: 'DEX', percent: false, valBefore: actor.agi, valAfter: tempActor ? tempActor.agi : actor.agi },
            { label: t.psi, code: 'PSI', percent: false, valBefore: actor.luk, valAfter: tempActor ? tempActor.luk : actor.luk },
            { label: t.intimidation, code: null, percent: true, valBefore: cBefore.intimidation, valAfter: cAfter.intimidation }
        ];

        let statsGridHTML = '';
        for (const stat of gridStats) {
            const unit = stat.percent ? '%' : '';
            const diff = stat.valAfter - stat.valBefore;
            const diffHtml = diff > 0 ? `<span class="stat-diff positive">+${diff}${unit}</span>`
                           : diff < 0 ? `<span class="stat-diff negative">${diff}${unit}</span>` : '';
            const labelCls = stat.code && scalingCodes.has(stat.code) ? 'stat-label stat-label--scaling' : 'stat-label';
            statsGridHTML += `
                <div class="stat-row">
                    <span class="${labelCls}">${stat.label}</span>
                    <span class="stat-val-container">
                        <span class="stat-val">${stat.valBefore}${unit}</span>
                        ${tempActor && diff !== 0 ? `➔ <span class="stat-val-new">${stat.valAfter}${unit}</span>` : ''}
                        ${diffHtml}
                    </span>
                </div>`;
        }

        // Weapon preview box
        const w0 = tempActor ? tempActor.equips()[0] : actor.equips()[0];
        const w1 = tempActor ? tempActor.equips()[1] : actor.equips()[1];
        const hasW0   = w0 && DataManager.isWeapon(w0);
        const hasW1   = w1 && DataManager.isWeapon(w1);
        const hasThree = typeof THREE !== 'undefined';

        let previewBoxHTML = '<div class="weapon-previews-container">';

        const cardClass = (hasW0 && hasW1) ? 'weapon-preview-card--half' : 'weapon-preview-card--single';

        // The preview is the weapon's real 3D model, the same one the battle
        // overlay holds. Without three.js there is nothing to draw it with, so
        // the card falls back to the item's icon on its rarity ring.
        const addCardHTML = (weapon, canvasId) => {
            if (hasThree) {
                return `<div class="weapon-preview-card ${cardClass}"><canvas id="weapon-preview-canvas-${canvasId}" width="140" height="380"></canvas></div>`;
            }
            const iconIdx    = weapon.iconIndex;
            const iconStyle  = `background:url('img/system/IconSet.png') -${(iconIdx%16)*32}px -${Math.floor(iconIdx/16)*32}px no-repeat;`;
            const rarity     = window.ItemSystemUtils ? window.ItemSystemUtils.getItemRarity(weapon) : { colorCode: '#bba16d' };
            const inner = `<div class="weapon-preview-icon-wrapper"><div class="weapon-preview-icon-circle" style="border:2.5px solid ${rarity.colorCode};"><div class="item-icon" style="${iconStyle}"></div></div></div>`;
            return `<div class="weapon-preview-card ${cardClass}">${inner}</div>`;
        };

        if (hasW0) previewBoxHTML += addCardHTML(w0, 0);
        if (hasW1) previewBoxHTML += addCardHTML(w1, 1);
        previewBoxHTML += '</div>';

        // Dynamic lore for the previewed/equipped item (resolves {nation}/{leader}/... tokens).
        let loreItem = null;
        if (this._activeArea === 'inventory') {
            const list = this.getInventoryItemsForSlot();
            const sel  = list[this._inventoryIndex];
            if (sel && !sel.isRemoveOption) loreItem = sel;
        } else if (this._slotIndex != null) {
            loreItem = actor.equips()[this._slotIndex];
        }
        // Short description (what it does) above the combinatorial lore.
        let loreHTML = '';
        if (loreItem && loreItem.description && String(loreItem.description).trim()) {
            let desc = String(loreItem.description).trim();
            if (window.translateText && typeof window.translateText === 'function') desc = window.translateText(desc);
            loreHTML += `<div class="equip-desc" style="margin-top:6px;font-family:'Lora',serif;line-height:1.35;">${desc.replace(/\n/g, '<br>')}</div>`;
        }
        if (loreItem && window.ItemSystemUtils && typeof window.ItemSystemUtils.loreFor === 'function') {
            const loreText = window.ItemSystemUtils.loreFor(loreItem);
            if (loreText) loreHTML += `<div class="equip-lore" style="font-style: normal;opacity:0.78;margin-top:6px;font-family:'Lora',serif;line-height:1.35;">${loreText}</div>`;
        }

        return `
            <div class="equip-right-content">
                ${previewBoxHTML}
                <div class="bottom-stats-block">
                    <div class="stats-grid stats-grid--3col">${statsGridHTML}</div>
                    ${loreHTML}
                </div>
            </div>`;
    };

    // =============================================================================
    // Full DOM rebuild
    // =============================================================================

    Scene_Equip.prototype._refreshDOM = function () {
        const container = document.getElementById('equip-container');
        if (!container) return;

        const actor       = this._actor;
        const lang        = ConfigManager.language || 'en';
        const t           = i18n[lang] || i18n['en'];
        const useItalian  = ConfigManager.language === 'it';

        // ── Left: command bar ──────────────────────────────────────────────────

        const commands      = ['equip', 'optimize', 'random', 'clear'];
        const commandLabels = [t.equip, t.optimize, t.random, t.clear];
        let commandsBtnsHTML = '';
        commands.forEach((cmd, idx) => {
            let cls = 'command-btn';
            if (idx === this._commandIndex && this._activeArea === 'commands') cls += ' active focused';  // i18n-ignore  css classes
            commandsBtnsHTML += `<div class="${cls}" data-cmd="${cmd}">${commandLabels[idx]}</div>`;
        });

        const allMembers = $gameParty.allMembers();
        let tabsHTML = '';
        allMembers.forEach((member, idx) => {
            const sel = member === actor ? 'selected' : '';
            tabsHTML += `<div class="companion-tab ${sel}" data-actor-idx="${idx}">${member.name()}</div>`;
        });

        const switcherHTML = enableSwitching
            ? window.CharSwitcher.inner(`<div class="companion-tabs-row">${tabsHTML}</div>`, allMembers.length)
            : `<div class="companion-tabs-row">${tabsHTML}</div>`;

        const commandBarHTML = `
            <div class="equip-command-bar">
                <div class="equip-commands">${commandsBtnsHTML}</div>
            </div>`;

        // ── Left: main content (slots or inventory) ────────────────────────────

        let mainContentHTML = '';
        const backBtnText   = T('Equip.back');

        if (this._activeArea === 'inventory') {
            const itemList  = this.getInventoryItemsForSlot();
            const slotName  = $dataSystem.equipTypes[actor.equipSlots()[this._slotIndex]] || t.emptySlot;

            mainContentHTML = `
                <div class="inventory-header">
                    <span>${t.inventory}: ${slotName}</span>
                    <span class="inventory-back-btn" id="inventory-back">◀ ${t.clear}</span>
                </div>`;

            if (itemList.length === 0) {
                mainContentHTML += `<div class="placeholder-message">${useItalian ? 'Nessun equipaggiamento disponibile...' : 'No matching equipment available...'}</div>`;
            } else {
                mainContentHTML += '<div class="inventory-grid">';
                const paramNames = [t.hp, t.mp, t.str, t.con, t.int, t.wis, t.dex, t.psi];
                const getParams  = a => [a.mhp, a.mmp, a.atk, a.def, a.mat, a.mdf, a.agi, a.luk];
                const beforeParams = getParams(actor);
                // Mutate _equips directly rather than through changeEquip/forceChangeEquip:
                // param() already reads traits (including PARAM-rate modifiers like the
                // percentage boosts/penalties some weapons carry) straight off the
                // battler's live equips, and going through the change hooks would also
                // fire saveCustomStatsToVariables for every row in the list.
                const diffActor = JsonEx.makeDeepCopy(actor);
                itemList.forEach((item, idx) => {
                    const focused = idx === this._inventoryIndex ? 'focused' : '';
                    if (item.isRemoveOption) {
                        mainContentHTML += `
                            <div class="inventory-item-row full-width ${focused}" data-idx="${idx}">
                                <div class="item-icon-empty">✖</div>
                                <div class="item-details" style="margin-left:8px;">
                                    <span class="item-name inventory-remove-name">${item.name}</span>
                                </div>
                            </div>`;
                    } else {
                        const iconIdx   = item.iconIndex;
                        const iconStyle = `background:url('img/system/IconSet.png') -${(iconIdx%16)*32}px -${Math.floor(iconIdx/16)*32}px no-repeat;`;
                        const rarity    = window.ItemSystemUtils.getItemRarity(item);
                        const gi = new Game_Item();
                        gi.setObject(item);
                        diffActor._equips[this._slotIndex] = gi;
                        const afterParams = getParams(diffActor);
                        const paramDesc  = [];
                        for (let p = 0; p < 8; p++) {
                            const delta = afterParams[p] - beforeParams[p];
                            if (delta !== 0) paramDesc.push(`${paramNames[p]} ${delta>0?'+':''}${delta}`);
                        }
                        // Weapons below Intermediate proficiency fight at reduced
                        // stats; flag the tier the character is actually at.
                        const prof = window.WeaponProficiency;
                        const untrained = prof && DataManager.isWeapon(item) && prof.isUntrained(actor, item);
                        const profTag = untrained
                            ? `<span class="item-proficiency-tag">${prof.levelNameFor(actor, item) || t.untrained}</span>`
                            : '';
                        mainContentHTML += `
                            <div class="inventory-item-row ${focused}" data-idx="${idx}">
                                <div class="item-rarity-bar" style="background:${rarity.colorCode};"></div>
                                <div class="item-icon" style="${iconStyle}"></div>
                                <div class="item-details" style="margin-left:8px;">
                                    <div class="item-name-row"><span class="item-name">${item.name}</span>${profTag}</div>
                                    <div class="item-meta-row">
                                        <span>${rarity.name}</span>
                                        <span>${paramDesc.join(', ')}</span>
                                    </div>
                                </div>
                            </div>`;
                    }
                });
                mainContentHTML += '</div>';
            }
        } else {
            const slots  = actor.equipSlots();
            const equips = actor.equips();
            slots.forEach((etypeId, idx) => {
                const slotTypeName  = $dataSystem.equipTypes[etypeId] || t.emptySlot;
                const equippedItem  = equips[idx];
                const focused       = (idx === this._slotIndex && this._activeArea === 'slots') ? 'focused' : '';

                let slotItemHTML = '';
                if (equippedItem) {
                    const iconIdx   = equippedItem.iconIndex;
                    const iconStyle = `background:url('img/system/IconSet.png') -${(iconIdx%16)*32}px -${Math.floor(iconIdx/16)*32}px no-repeat;`;
                    const rarity    = window.ItemSystemUtils.getItemRarity(equippedItem);
                    const prof      = window.WeaponProficiency;
                    const profTag   = (prof && DataManager.isWeapon(equippedItem) && prof.isUntrained(actor, equippedItem))
                        ? `<span class="item-proficiency-tag">${prof.levelNameFor(actor, equippedItem) || t.untrained}</span>`
                        : '';
                    slotItemHTML = `
                        <div class="item-rarity-bar" style="background:${rarity.colorCode};"></div>
                        <div class="item-icon" style="${iconStyle}"></div>
                        <span class="item-name">${equippedItem.name}</span>${profTag}`;
                } else {
                    slotItemHTML = `<div class="item-icon-empty">☐</div><span class="item-name-empty">${t.emptySlot}</span>`;
                }

                mainContentHTML += `
                    <div class="equip-slot-row ${focused}" data-idx="${idx}">
                        <div class="slot-label-col">${slotTypeName}</div>
                        <div class="slot-item-col">${slotItemHTML}</div>
                    </div>`;
            });
        }

        // ── Build / reuse DOM structure ────────────────────────────────────────

        let spread = container.querySelector('.book-spread');
        if (!spread) {
            container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        <div class="page-header-bar">
                            <div class="back-button focusable">${backBtnText}</div>
                            <h2 class="title">${t.equip}</h2>
                        </div>
                        <div class="left-commands-area"></div>
                        <div class="left-content-area equip-main-content"></div>
                    </div>
                    <div class="right-page" style="position:relative;">
                        <div class="companion-switcher" id="equip-companion-switcher" style="position:absolute; top:6px; left:0; right:0; z-index:5; justify-content:center; min-height:26px;"></div>
                        <div class="right-content-area"></div>
                    </div>
                </div>`;
            spread = container.querySelector('.book-spread');

            spread.querySelector('.back-button').addEventListener('click', (e) => {
                e.stopPropagation();
                SoundManager.playCancel();
                SceneManager._scene.popScene();
            });

            const leftCA = spread.querySelector('.left-content-area');
            if (leftCA) leftCA.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
        }

        // Selective area updates
        const switcherSlot = spread.querySelector('#equip-companion-switcher');
        if (switcherSlot) switcherSlot.innerHTML = switcherHTML;
        spread.querySelector('.left-commands-area').innerHTML = commandBarHTML;

        const leftContentArea = spread.querySelector('.left-content-area');
        const savedScroll     = leftContentArea.scrollTop;
        leftContentArea.innerHTML = mainContentHTML;
        leftContentArea.scrollTop = savedScroll;

        this.cleanup3DWeaponPreview();
        spread.querySelector('.right-content-area').innerHTML = this._buildRightPageHTML();
        this.init3DWeaponPreview();

        // ── Mouse / click bindings ─────────────────────────────────────────────

        container.querySelectorAll('.command-btn').forEach((btn, idx) => {
            btn.addEventListener('click', () => {
                this._commandIndex = idx;
                this._activeArea   = 'commands';
                this.executeCommandAction(btn.getAttribute('data-cmd'));
            });
        });

        container.querySelectorAll('.companion-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const idx    = parseInt(tab.getAttribute('data-actor-idx'));
                const target = $gameParty.allMembers()[idx];
                if (target && target !== this._actor) {
                    SoundManager.playOk();
                    this._actor             = target;
                    this._currentActorIndex = $gameParty.allMembers().indexOf(target);
                    this._refreshDOM();
                }
            });
        });

        if (this._activeArea !== 'inventory') {
            container.querySelectorAll('.equip-slot-row').forEach(row => {
                row.addEventListener('click', () => {
                    this._slotIndex  = parseInt(row.getAttribute('data-idx'));
                    this._activeArea = 'slots';
                    SoundManager.playOk();
                    this.openInventorySelection();
                });
            });
        } else {
            const backBtn = container.querySelector('#inventory-back');
            if (backBtn) {
                backBtn.addEventListener('click', () => {
                    this._activeArea = 'slots';
                    SoundManager.playCancel();
                    this._refreshDOM();
                });
            }
            container.querySelectorAll('.inventory-item-row').forEach(row => {
                row.addEventListener('mouseover', () => {
                    const idx = parseInt(row.getAttribute('data-idx'));
                    if (idx !== this._inventoryIndex) {
                        this._inventoryIndex = idx;
                        this._updateInventoryHighlight();
                    }
                });
                row.addEventListener('click', () => {
                    this._inventoryIndex = parseInt(row.getAttribute('data-idx'));
                    this.equipSelectedItem();
                });
            });
        }
    };

    // =============================================================================
    // Selective highlight updates (avoids full DOM rebuild on navigation)
    // =============================================================================

    Scene_Equip.prototype._updateSlotHighlight = function () {
        const container = document.getElementById('equip-container');
        if (!container) return;
        container.querySelectorAll('.equip-slot-row').forEach((row, idx) => {
            row.classList.toggle('focused', idx === this._slotIndex);
        });
        const focused = container.querySelector('.equip-slot-row.focused');
        if (focused) focused.scrollIntoView({ block: 'nearest' });
        SoundManager.playCursor();
    };

    Scene_Equip.prototype._updateInventoryHighlight = function () {
        const container = document.getElementById('equip-container');
        if (!container) return;
        container.querySelectorAll('.inventory-item-row').forEach((row, idx) => {
            row.classList.toggle('focused', idx === this._inventoryIndex);
        });
        const focused = container.querySelector('.inventory-item-row.focused');
        if (focused) focused.scrollIntoView({ block: 'nearest' });

        // Rebuild only the right page (stat deltas change per selected item)
        this.cleanup3DWeaponPreview();
        const rightArea = container.querySelector('.right-content-area');
        if (rightArea) rightArea.innerHTML = this._buildRightPageHTML();
        this.init3DWeaponPreview();
        SoundManager.playCursor();
    };

    // =============================================================================
    // Actions
    // =============================================================================

    Scene_Equip.prototype.openInventorySelection = function () {
        this._activeArea     = 'inventory';
        this._inventoryIndex = 0;
        this._refreshDOM();
    };

    Scene_Equip.prototype.equipSelectedItem = function () {
        const itemList = this.getInventoryItemsForSlot();
        if (itemList.length === 0) return;
        const selected = itemList[this._inventoryIndex];
        this._actor.changeEquip(this._slotIndex, selected.isRemoveOption ? null : selected);
        SoundManager.playEquip();
        this._activeArea = 'slots';
        this._refreshDOM();
    };

    Scene_Equip.prototype.executeCommandAction = function (cmd) {
        switch (cmd) {
            case 'equip':
                this._activeArea = 'slots';
                this._slotIndex  = 0;
                SoundManager.playOk();
                break;
            case 'optimize':
                this._actor.optimizeEquipments();
                SoundManager.playEquip();
                break;
            case 'random':
                this._actor.randomEquipments();
                SoundManager.playEquip();
                break;
            case 'clear':
                this._actor.clearEquipments();
                SoundManager.playEquip();
                break;
        }
        this._refreshDOM();
    };

    // =============================================================================
    // Keyboard & Gamepad input
    // =============================================================================

    Scene_Equip.prototype.updateUIEquipInput = function () {
        // WASD hold-repeat simulation
        for (const dir of ['up', 'down', 'left', 'right']) {
            if (this._wasdHeld[dir]) {
                this._wasdHoldFrames[dir]++;
                const t = this._wasdHoldFrames[dir];
                if (t > Input.keyRepeatWait && (t - Input.keyRepeatWait) % Input.keyRepeatInterval === 0) {
                    this._wasdInput[dir] = true;
                }
            } else {
                this._wasdHoldFrames[dir] = 0;
            }
        }

        const isDown  = Input.isTriggered('down')  || Input.isRepeated('down')  || this._wasdInput.down;
        const isUp    = Input.isTriggered('up')    || Input.isRepeated('up')    || this._wasdInput.up;
        const isRight = Input.isTriggered('right') || Input.isRepeated('right') || this._wasdInput.right;
        const isLeft  = Input.isTriggered('left')  || Input.isRepeated('left')  || this._wasdInput.left;
        this._wasdInput.up = this._wasdInput.down = this._wasdInput.left = this._wasdInput.right = false;

        // L1/R1, character switching from anywhere in the scene
        if (enableSwitching) {
            if (Input.isTriggered('pageup'))   { this.switchToPreviousCharacter(); return; }
            if (Input.isTriggered('pagedown')) { this.switchToNextCharacter();     return; }
        }

        const isOk       = Input.isTriggered('ok');
        const isCancel    = Input.isTriggered('escape') || Input.isTriggered('cancel') || TouchInput.isCancelled();

        // ── Commands area ──────────────────────────────────────────────────────
        if (this._activeArea === 'commands') {
            if (isRight) {
                this._commandIndex = (this._commandIndex + 1) % 4;
                SoundManager.playCursor();
                this._refreshDOM();
            } else if (isLeft) {
                this._commandIndex = (this._commandIndex - 1 + 4) % 4;
                SoundManager.playCursor();
                this._refreshDOM();
            } else if (isDown) {
                this._activeArea = 'slots';
                this._slotIndex  = 0;
                SoundManager.playCursor();
                this._refreshDOM();
            } else if (isOk) {
                const cmds = ['equip', 'optimize', 'random', 'clear'];
                this.executeCommandAction(cmds[this._commandIndex]);
            } else if (isCancel) {
                SoundManager.playCancel();
                this.popScene();
            }

        // ── Slots area ─────────────────────────────────────────────────────────
        } else if (this._activeArea === 'slots') {
            const maxSlots = this._actor.equipSlots().length;

            if (isDown) {
                if (this._slotIndex < maxSlots - 1) {
                    this._slotIndex++;
                    this._updateSlotHighlight();
                }
            } else if (isUp) {
                if (this._slotIndex === 0) {
                    this._activeArea = 'commands';
                    SoundManager.playCursor();
                    this._refreshDOM();
                } else {
                    this._slotIndex--;
                    this._updateSlotHighlight();
                }
            } else if (enableSwitching && isLeft) {
                this.switchToPreviousCharacter();
            } else if (enableSwitching && isRight) {
                this.switchToNextCharacter();
            } else if (isOk) {
                SoundManager.playOk();
                this.openInventorySelection();
            } else if (isCancel) {
                this._activeArea = 'commands';
                SoundManager.playCancel();
                this._refreshDOM();
            }

        // ── Inventory area, 2D grid navigation ────────────────────────────────
        } else if (this._activeArea === 'inventory') {
            const itemList = this.getInventoryItemsForSlot();
            const total    = itemList.length;
            const idx      = this._inventoryIndex;
            const COLS     = 2; // matches .inventory-grid grid-template-columns

            if (isOk) {
                this.equipSelectedItem();
            } else if (isCancel) {
                this._activeArea = 'slots';
                SoundManager.playCancel();
                this._refreshDOM();
            } else if (isDown) {
                if (idx === 0) {
                    // full-width remove row → first grid item
                    if (total > 1) { this._inventoryIndex = 1; this._updateInventoryHighlight(); }
                } else {
                    const gridIdx = idx - 1;
                    const next    = gridIdx + COLS;
                    if (next + 1 < total) { this._inventoryIndex = next + 1; this._updateInventoryHighlight(); }
                }
            } else if (isUp) {
                if (idx === 1 || idx === 2) {
                    // first grid row → remove option
                    this._inventoryIndex = 0; this._updateInventoryHighlight();
                } else if (idx > 2) {
                    const gridIdx = idx - 1;
                    this._inventoryIndex = (gridIdx - COLS) + 1; this._updateInventoryHighlight();
                }
                // idx === 0 → already at top, do nothing
            } else if (isRight) {
                if (idx > 0) {
                    const gridIdx = idx - 1;
                    if (gridIdx % COLS < COLS - 1 && idx + 1 < total) {
                        this._inventoryIndex = idx + 1; this._updateInventoryHighlight();
                    }
                }
            } else if (isLeft) {
                if (idx > 0) {
                    const gridIdx = idx - 1;
                    if (gridIdx % COLS > 0) { this._inventoryIndex = idx - 1; this._updateInventoryHighlight(); }
                }
            }
        }
    };
})();
