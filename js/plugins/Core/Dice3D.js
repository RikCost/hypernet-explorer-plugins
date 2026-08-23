/*:
 * @target MZ
 * @plugindesc v1.5.0 High-Legibility Compact 3D d20 Dice System with Perfectly Upright Faces & Unified Premium Result Window.
 * @author Omni-Lex
 *
 * @help Dice3D.js
 *
 * Provides a sleek, compact, hardware-accelerated 3D d20 dice throw across the screen
 * for battles, trials, negotiations, rites, and social actions.
 *
 * Features:
 * - 100% mathematically level, upright face-to-camera alignment for all 20 facets
 * - Slower, graceful tumbling physics (860ms) with gentle settle
 * - Scaled, high-contrast bold numerals with zero distortion
 * - Single unified glassmorphic result window with dynamic calculation summing
 * - Audio-synced CC0 dice rolls and outcome chimes
 * - Exposes window.Dice3D
 */

(() => {
    'use strict';

    class Dice3DManager {
        constructor() {
            this._active = false;
            this._canvas = null;
            this._renderer = null;
            this._scene = null;
            this._camera = null;
            this._diceMesh = null;
            this._faceNormals = [];
            this._faceUpVectors = [];
            this._faceRightVectors = [];
            this._animFrameId = null;
            this._initStyles();
        }

        _shouldShow3D(options = {}) {
            if (options.forceToast === true) return false;
            if (options.force3D === true) return true;
            if (typeof $gameParty !== 'undefined' && $gameParty.inBattle && $gameParty.inBattle()) return true;

            const act = String(options.actionName || '').toLowerCase();
            if (act.includes('eris') || act.includes('onu') || act.includes('court') ||
                act.includes('romance') || act.includes('propose') || act.includes('proposal') ||
                act.includes('empathize') || act.includes('steal') || act.includes('shoplift') || act.includes('pickpocket') ||
                act.includes('summon') || act.includes('fusion') || act.includes('spell') ||
                act.includes('recruit') || act.includes('tame') || act.includes('talk') || act.includes('bash') ||
                act.includes('cook') || act.includes('culinary')) {
                return true;
            }
            return false;
        }

        _initStyles() {
            if (typeof document === 'undefined') return;
            if (document.getElementById('dice3d-styles')) return;
            const style = document.createElement('style');
            style.id = 'dice3d-styles';
            style.textContent = `
                #dice3d-container {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    z-index: 999999;
                    pointer-events: none;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    opacity: 1;
                    transition: opacity 0.45s ease;
                }
                #dice3d-container.fade-out {
                    opacity: 0;
                }
                #dice3d-canvas {
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                }
                #dice3d-banner {
                    position: absolute;
                    bottom: 15%;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 6px;
                    padding: 12px 28px;
                    background: linear-gradient(145deg, rgba(22, 19, 15, 0.96), rgba(10, 9, 8, 0.98));
                    border: 1.5px solid #d4af37;
                    border-radius: 8px;
                    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.85), 0 0 22px rgba(212, 175, 55, 0.35);
                    font-family: 'Cinzel', 'Lora', serif, 'GameFont';
                    color: #fff;
                    opacity: 0;
                    transform: translateY(18px) scale(0.94);
                    transition: all 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                    pointer-events: none;
                    backdrop-filter: blur(6px);
                    min-width: 280px;
                }
                #dice3d-banner.show {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
                #dice3d-banner.crit-success {
                    border-color: #ffd700;
                    box-shadow: 0 0 30px rgba(255, 215, 0, 0.7);
                }
                #dice3d-banner.crit-fail {
                    border-color: #ff3344;
                    box-shadow: 0 0 30px rgba(255, 51, 68, 0.7);
                }
                .dice3d-header {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    width: 100%;
                    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
                    padding-bottom: 4px;
                }
                .dice3d-title {
                    font-size: 0.78rem;
                    letter-spacing: 2px;
                    text-transform: uppercase;
                    color: #e5c158;
                    font-weight: bold;
                }
                .dice3d-main-row {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 16px;
                    margin: 4px 0;
                }
                .dice3d-calc {
                    display: flex;
                    align-items: baseline;
                    gap: 6px;
                    font-size: 1.45rem;
                    font-weight: bold;
                }
                .dice3d-raw {
                    color: #f5f5f5;
                    font-size: 1.6rem;
                }
                .dice3d-mod {
                    color: #81c784;
                    font-size: 1.15rem;
                }
                .dice3d-mod.neg {
                    color: #ef9a9a;
                }
                .dice3d-eq {
                    color: #d4af37;
                    font-size: 1.1rem;
                    opacity: 0.8;
                }
                .dice3d-total {
                    font-size: 2.1rem;
                    font-weight: 900;
                    color: #ffffff;
                    text-shadow: 0 2px 10px rgba(0,0,0,0.9);
                    transition: all 0.25s ease;
                }
                .dice3d-total.summed {
                    transform: scale(1.18);
                    color: #ffd700;
                    text-shadow: 0 0 16px rgba(255, 215, 0, 0.8);
                }
                .dice3d-total.crit-success { color: #ffd700; }
                .dice3d-total.crit-fail { color: #ff4d4d; }
                .dice3d-status {
                    font-size: 0.92rem;
                    font-weight: bold;
                    letter-spacing: 1.5px;
                    padding: 3px 10px;
                    border-radius: 4px;
                    background: rgba(0, 0, 0, 0.6);
                    border: 1px solid transparent;
                    opacity: 0;
                    transform: scale(0.85);
                    transition: all 0.22s ease;
                }
                .dice3d-status.visible {
                    opacity: 1;
                    transform: scale(1);
                }
                .dice3d-status.success {
                    color: #a5d6a7;
                    border-color: #4caf50;
                    box-shadow: 0 0 10px rgba(76, 175, 80, 0.35);
                }
                .dice3d-status.failure {
                    color: #ef9a9a;
                    border-color: #f44336;
                    box-shadow: 0 0 10px rgba(244, 67, 54, 0.35);
                }
                .dice3d-status.crit-success {
                    color: #ffd700;
                    border-color: #ffd700;
                    box-shadow: 0 0 14px rgba(255, 215, 0, 0.6);
                }
                .dice3d-status.crit-fail {
                    color: #ff5252;
                    border-color: #ff5252;
                    box-shadow: 0 0 14px rgba(255, 82, 82, 0.6);
                }
                .dice3d-footer {
                    font-size: 0.72rem;
                    color: #b0bec5;
                    letter-spacing: 0.5px;
                }
            `;
            document.head.appendChild(style);
        }

        _setupThree() {
            if (this._scene) return;
            if (typeof THREE === 'undefined' || typeof document === 'undefined') return;

            const container = document.createElement('div');
            container.id = 'dice3d-container';
            container.style.display = 'none';

            const canvas = document.createElement('canvas');
            canvas.id = 'dice3d-canvas';
            container.appendChild(canvas);

            const banner = document.createElement('div');
            banner.id = 'dice3d-banner';
            banner.innerHTML = `
                <div class="dice3d-header">
                    <span class="dice3d-title" id="dice3d-title">D20 CHECK</span>
                </div>
                <div class="dice3d-main-row">
                    <div class="dice3d-calc" id="dice3d-calc">
                        <span class="dice3d-raw" id="dice3d-raw">14</span>
                        <span class="dice3d-mod" id="dice3d-mod">+0 PSI</span>
                        <span class="dice3d-eq">=</span>
                        <span class="dice3d-total" id="dice3d-num">14</span>
                    </div>
                    <div class="dice3d-status" id="dice3d-status">SUCCESS</div>
                </div>
                <div class="dice3d-footer" id="dice3d-detail">DC 12 · Roll 14 + 0 = 14</div>
            `;
            container.appendChild(banner);
            document.body.appendChild(container);

            this._container = container;
            this._canvas = canvas;
            this._banner = banner;

            const w = window.innerWidth || 1280;
            const h = window.innerHeight || 720;
            this._renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
            this._renderer.setSize(w, h);
            this._renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

            this._scene = new THREE.Scene();
            this._camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
            this._camera.position.set(0, 0, 7.5);

            // Studio lighting
            const ambient = new THREE.AmbientLight(0xfff7ed, 1.4);
            this._scene.add(ambient);

            const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
            keyLight.position.set(4, 6, 8);
            this._scene.add(keyLight);

            const fillLight = new THREE.DirectionalLight(0xaaccff, 1.2);
            fillLight.position.set(-6, -3, 5);
            this._scene.add(fillLight);

            const rimLight = new THREE.PointLight(0xffd700, 2.5, 14);
            rimLight.position.set(0, 2.5, 3.0);
            this._scene.add(rimLight);
            this._rimLight = rimLight;

            // Build d20 with custom triangular UVs
            this._createD20Mesh();

            window.addEventListener('resize', () => {
                if (!this._renderer || !this._camera) return;
                const nw = window.innerWidth || 1280;
                const nh = window.innerHeight || 720;
                this._camera.aspect = nw / nh;
                this._camera.updateProjectionMatrix();
                this._renderer.setSize(nw, nh);
            });
        }

        _createFaceTexture(number, isGold = false, isCrimson = false) {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');

            const pTop = { x: 256, y: 45 };
            const pLeft = { x: 32, y: 450 };
            const pRight = { x: 480, y: 450 };

            // Fill background
            ctx.fillStyle = isGold ? '#533708' : isCrimson ? '#380808' : '#0a0d12';
            ctx.fillRect(0, 0, 512, 512);

            // Draw Triangle Facet Body
            ctx.beginPath();
            ctx.moveTo(pTop.x, pTop.y);
            ctx.lineTo(pRight.x, pRight.y);
            ctx.lineTo(pLeft.x, pLeft.y);
            ctx.closePath();

            const grad = ctx.createRadialGradient(256, 305, 20, 256, 305, 260);
            if (isGold) {
                grad.addColorStop(0, '#e5b84c');
                grad.addColorStop(0.65, '#9e731b');
                grad.addColorStop(1, '#4f3507');
            } else if (isCrimson) {
                grad.addColorStop(0, '#c62828');
                grad.addColorStop(0.65, '#7f1313');
                grad.addColorStop(1, '#3b0606');
            } else {
                grad.addColorStop(0, '#2e3846');
                grad.addColorStop(0.6, '#181e26');
                grad.addColorStop(1, '#090b0e');
            }
            ctx.fillStyle = grad;
            ctx.fill();

            // Heavy Gold/Filigree Outer Border
            ctx.strokeStyle = isGold ? '#ffe082' : isCrimson ? '#ff6666' : '#d4af37';
            ctx.lineWidth = 26;
            ctx.lineJoin = 'round';
            ctx.stroke();

            // Inner Fine Inlay
            ctx.beginPath();
            ctx.moveTo(256, 95);
            ctx.lineTo(435, 415);
            ctx.lineTo(77, 415);
            ctx.closePath();
            ctx.strokeStyle = isGold ? 'rgba(255, 240, 180, 0.8)' : isCrimson ? 'rgba(255, 150, 150, 0.8)' : 'rgba(212, 175, 55, 0.65)';
            ctx.lineWidth = 6;
            ctx.stroke();

            // Sized-down, elegant, ultra-crisp numeral in center of facet
            const numY = 305;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '900 155px "Montserrat", "Arial Black", "Trebuchet MS", sans-serif';

            // Thick deep black shadow/outline for extreme clarity
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 18;
            ctx.lineJoin = 'miter';
            ctx.miterLimit = 2;
            ctx.strokeText(String(number), 256, numY);

            // Crisp brilliant white numeral fill
            ctx.fillStyle = '#ffffff';
            ctx.fillText(String(number), 256, numY);

            // Underline bar for 6 & 9 so they are never confused
            if (number === 6 || number === 9) {
                ctx.fillStyle = '#000000';
                ctx.fillRect(190, 385, 132, 18);
                ctx.fillStyle = isGold ? '#ffe082' : isCrimson ? '#ff6666' : '#ffd700';
                ctx.fillRect(194, 388, 124, 12);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.generateMipmaps = true;
            tex.minFilter = THREE.LinearMipmapLinearFilter;
            tex.needsUpdate = true;
            return tex;
        }

        _createD20Mesh() {
            const baseGeom = new THREE.IcosahedronGeometry(0.78, 0);
            const nonIndexed = baseGeom.toNonIndexed();
            nonIndexed.clearGroups();

            const pos = nonIndexed.attributes.position;
            const uvs = new Float32Array(20 * 3 * 2);
            this._faceNormals = [];
            this._faceUpVectors = [];
            this._faceRightVectors = [];

            for (let i = 0; i < 20; i++) {
                nonIndexed.addGroup(i * 3, 3, i);

                const i0 = i * 3;
                const vA = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
                const vB = new THREE.Vector3(pos.getX(i0 + 1), pos.getY(i0 + 1), pos.getZ(i0 + 1));
                const vC = new THREE.Vector3(pos.getX(i0 + 2), pos.getY(i0 + 2), pos.getZ(i0 + 2));

                const center = new THREE.Vector3().add(vA).add(vB).add(vC).divideScalar(3);
                const normal = new THREE.Vector3()
                    .crossVectors(vB.clone().sub(vA), vC.clone().sub(vA))
                    .normalize();
                
                if (normal.dot(center) < 0) {
                    normal.negate();
                }

                // Explicit local frame anchored directly to vertex A
                const uVec = vA.clone().sub(center).normalize();
                const rVec = new THREE.Vector3().crossVectors(normal, uVec).normalize();

                this._faceNormals[i] = normal;
                this._faceUpVectors[i] = uVec;
                this._faceRightVectors[i] = rVec;

                // Determine which vertex is right vs left
                const dotB = vB.clone().sub(center).dot(rVec);
                let uvB, uvC;
                if (dotB > 0) {
                    uvB = [0.94, 0.12];
                    uvC = [0.06, 0.12];
                } else {
                    uvB = [0.06, 0.12];
                    uvC = [0.94, 0.12];
                }

                const uvMap = {
                    0: [0.5, 0.92],
                    1: uvB,
                    2: uvC
                };

                for (let k = 0; k < 3; k++) {
                    const uvIdx = (i0 + k) * 2;
                    const uv = uvMap[k];
                    uvs[uvIdx] = uv[0];
                    uvs[uvIdx + 1] = uv[1];
                }
            }

            nonIndexed.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

            const materials = [];
            for (let i = 1; i <= 20; i++) {
                const is20 = (i === 20);
                const is1 = (i === 1);
                const tex = this._createFaceTexture(i, is20, is1);
                materials.push(new THREE.MeshStandardMaterial({
                    map: tex,
                    roughness: is20 ? 0.15 : is1 ? 0.2 : 0.22,
                    metalness: is20 ? 0.85 : is1 ? 0.5 : 0.6,
                    color: 0xffffff
                }));
            }

            this._diceMesh = new THREE.Mesh(nonIndexed, materials);
            this._scene.add(this._diceMesh);
        }

        _orientFace(targetNum) {
            if (!this._diceMesh) return;
            const faceIdx = Math.max(0, Math.min(19, targetNum - 1));
            const normal = this._faceNormals[faceIdx];
            const up = this._faceUpVectors[faceIdx];
            const right = this._faceRightVectors[faceIdx];

            if (!normal || !up || !right) return;

            // Rotate mesh so face normal points to +Z, up points to +Y, right points to +X
            const rotMatrix = new THREE.Matrix4().makeBasis(right, up, normal);
            rotMatrix.transpose();
            this._diceMesh.quaternion.setFromRotationMatrix(rotMatrix);
        }

        _playSE(name, volume = 90, pitch = 100) {
            if (typeof AudioManager !== 'undefined' && AudioManager.playSe) {
                AudioManager.playSe({ name, volume, pitch: Math.round(pitch), pan: 0 });
            } else if (typeof SoundManager !== 'undefined') {
                if (name === 'Ok') SoundManager.playOk?.();
                else if (name.includes('Buzzer')) SoundManager.playBuzzer?.();
            }
        }

        rollD20(options = {}) {
            const {
                dc = null,
                modifier = 0,
                statName = '',
                actionName = 'Action Check',
                actor = null,
                forcedRoll = null
            } = options;

            const rawRoll = forcedRoll !== null ? forcedRoll : Math.floor(Math.random() * 20) + 1;
            const nat1 = (rawRoll === 1);
            const nat20 = (rawRoll === 20);
            const total = rawRoll + modifier;
            
            let success = false;
            if (nat20) {
                success = true;
            } else if (nat1) {
                success = false;
            } else if (dc !== null) {
                success = (total >= dc);
            } else {
                success = (rawRoll >= 10);
            }

            const resultData = {
                roll: rawRoll,
                modifier,
                total,
                dc,
                success,
                nat1,
                nat20,
                statName,
                actionName
            };

            const shouldShow3D = this._shouldShow3D(options);

            if (!shouldShow3D) {
                const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                const statPart = statName ? ` (${statName})` : '';
                const dcStr = dc !== null ? ` vs DC ${dc}` : '';
                const outcomeStr = nat20 ? '🌟 CRITICAL SUCCESS!' : nat1 ? '💀 CRITICAL FAILURE!' : success ? '✓ SUCCESS' : '✗ FAILURE';
                const toastMsg = `🎲 [${actionName}] Roll: ${rawRoll}${modStr}${statPart} = ${total}${dcStr} ➔ ${outcomeStr}`;
                
                if (window.ParchmentToast && typeof window.ParchmentToast.show === 'function') {
                    window.ParchmentToast.show(toastMsg, {
                        severity: (nat20 || success) ? 'good' : 'danger',
                        duration: 200
                    });
                }
                if (nat20 || success) this._playSE('PixelUI/PixelUI (18)', 90, 100);
                else this._playSE('PixelUI/PixelUI (27)', 85, 90);
                return Promise.resolve(resultData);
            }

            if (typeof THREE === 'undefined' || typeof window === 'undefined' || !window.document) {
                return Promise.resolve(resultData);
            }

            return new Promise((resolve) => {
                this._setupThree();
                if (!this._container) {
                    return resolve(resultData);
                }
                this._container.className = '';
                this._container.style.display = 'flex';
                this._banner.className = '';

                const titleEl = document.getElementById('dice3d-title');
                const rawEl = document.getElementById('dice3d-raw');
                const modEl = document.getElementById('dice3d-mod');
                const numEl = document.getElementById('dice3d-num');
                const statusEl = document.getElementById('dice3d-status');
                const detailEl = document.getElementById('dice3d-detail');

                if (titleEl) titleEl.textContent = actionName.toUpperCase();
                if (rawEl) rawEl.textContent = String(rawRoll);
                if (modEl) {
                    const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                    modEl.textContent = `${modStr} ${statName || ''}`.trim();
                    modEl.className = 'dice3d-mod' + (modifier < 0 ? ' neg' : '');
                }
                if (numEl) {
                    numEl.textContent = String(rawRoll);
                    numEl.className = 'dice3d-total' + (nat20 ? ' crit-success' : nat1 ? ' crit-fail' : '');
                }
                if (statusEl) {
                    statusEl.className = 'dice3d-status';
                }
                if (detailEl) {
                    detailEl.textContent = dc !== null ? `DC ${dc}` : `Standard Check`;
                }

                const startX = (Math.random() > 0.5 ? 1 : -1) * (4.2 + Math.random() * 1.0);
                const startY = 2.8 + Math.random() * 1.0;
                const endX = (Math.random() - 0.5) * 0.25;
                const endY = 0.05;

                const startRotX = Math.random() * Math.PI * 6;
                const startRotY = Math.random() * Math.PI * 6;
                const startRotZ = Math.random() * Math.PI * 6;

                const startTime = performance.now();
                // Extended, unhurried cinematic pacing
                const rollDuration = 1000;    // 1.0s smooth tumble & landing
                const pauseBeforeSum = 650;   // 0.65s raw roll assessment pause
                const holdDuration = 2200;    // 2.2s comfortable display of calculated total & outcome
                const fadeDuration = 450;     // 0.45s smooth dissolve exit
                const totalDuration = rollDuration + pauseBeforeSum + holdDuration + fadeDuration;

                if (this._rimLight) {
                    this._rimLight.color.setHex(nat20 ? 0xffd700 : nat1 ? 0xff2233 : 0xd4af37);
                }

                // Initial dice shake sound
                this._playSE('Casino/dice_shake_' + (Math.floor(Math.random() * 3) + 1), 85, 95 + Math.random() * 10);

                let midTumbled = false;
                let landed = false;
                let summed = false;
                let exiting = false;

                const animate = (currentTime) => {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(1, elapsed / rollDuration);

                    // Mid-roll dice tumble sound
                    if (!midTumbled && elapsed >= 320) {
                        midTumbled = true;
                        this._playSE('Casino/dice_throw_' + (Math.floor(Math.random() * 3) + 1), 95, 95 + Math.random() * 10);
                    }

                    // Gentle, smooth easing curve
                    const easeOutQuart = (x) => 1 - Math.pow(1 - x, 4);
                    const p = easeOutQuart(progress);

                    if (progress < 1) {
                        this._diceMesh.position.x = startX + (endX - startX) * p;
                        this._diceMesh.position.y = startY + (endY - startY) * p + Math.sin(progress * Math.PI) * 0.8;
                        this._diceMesh.position.z = Math.sin(progress * Math.PI) * 1.5;

                        this._diceMesh.rotation.x = startRotX * (1 - progress);
                        this._diceMesh.rotation.y = startRotY * (1 - progress);
                        this._diceMesh.rotation.z = startRotZ * (1 - progress);
                        this._diceMesh.scale.setScalar(0.58 + progress * 0.22);
                    } else {
                        const activeHoldTime = elapsed - rollDuration;

                        // Check if we reached the smooth exit phase
                        if (activeHoldTime >= (pauseBeforeSum + holdDuration)) {
                            if (!exiting) {
                                exiting = true;
                                this._banner.className = '';
                                if (this._container) this._container.classList.add('fade-out');
                            }
                            const exitProgress = Math.min(1, (activeHoldTime - (pauseBeforeSum + holdDuration)) / fadeDuration);
                            this._diceMesh.position.y = endY + exitProgress * 0.35;
                            this._diceMesh.scale.setScalar(0.8 * (1 - exitProgress * 0.15));
                        } else {
                            this._diceMesh.position.set(endX, endY, 0);
                            this._diceMesh.scale.setScalar(0.8);
                        }

                        this._orientFace(rawRoll);

                        // Phase 1: Landing
                        if (!landed) {
                            landed = true;
                            this._banner.className = 'show' + (nat20 ? ' crit-success' : nat1 ? ' crit-fail' : '');

                            // Landing impact sound
                            this._playSE('Casino/dice_grab_' + (Math.floor(Math.random() * 2) + 1), 75, 105);
                        }

                        // Phase 2: Visual summing sequence after landing assessment pause
                        if (activeHoldTime >= pauseBeforeSum && !summed) {
                            summed = true;
                            const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                            const statPart = statName ? ` (${statName})` : '';

                            if (numEl) {
                                numEl.textContent = String(total);
                                numEl.classList.add('summed');
                            }
                            if (detailEl) {
                                if (dc !== null) {
                                    detailEl.textContent = `DC ${dc} · Roll ${rawRoll}${modStr}${statPart} = ${total}`;
                                } else {
                                    detailEl.textContent = `Roll ${rawRoll}${modStr}${statPart} = ${total}`;
                                }
                            }
                            if (statusEl) {
                                if (nat20) {
                                    statusEl.textContent = 'CRITICAL SUCCESS!';
                                    statusEl.className = 'dice3d-status crit-success visible';
                                } else if (nat1) {
                                    statusEl.textContent = 'CRITICAL FAILURE!';
                                    statusEl.className = 'dice3d-status crit-fail visible';
                                } else {
                                    statusEl.textContent = success ? 'SUCCESS' : 'FAILURE';
                                    statusEl.className = 'dice3d-status ' + (success ? 'success visible' : 'failure visible');
                                }
                            }

                            // Stat sum sound & outcome chime
                            this._playSE('Item3', 85, 115);
                            if (nat20) {
                                this._playSE('Bell3', 95, 120);
                            } else if (nat1) {
                                this._playSE('Down1', 90, 85);
                            } else if (success) {
                                this._playSE('PixelUI/PixelUI (18)', 90, 100);
                            } else {
                                this._playSE('PixelUI/PixelUI (27)', 85, 90);
                            }
                        }
                    }

                    this._renderer.render(this._scene, this._camera);

                    if (elapsed < totalDuration) {
                        this._animFrameId = requestAnimationFrame(animate);
                    } else {
                        setTimeout(() => {
                            this._container.style.display = 'none';
                            this._container.className = '';
                            resolve(resultData);
                        }, 50);
                    }
                };

                this._animFrameId = requestAnimationFrame(animate);
            });
        }

        rollPercentage(chancePercent, options = {}) {
            const clamped = Math.max(5, Math.min(95, Math.round(chancePercent)));
            const dc = Math.max(2, Math.min(20, 21 - Math.round(clamped / 5)));
            return this.rollD20({
                ...options,
                dc,
                actionName: options.actionName || 'Percentage Check'
            });
        }
    }

    window.Dice3D = new Dice3DManager();
})();
