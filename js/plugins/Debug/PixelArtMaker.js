/*:
 * @target MZ
 * @plugindesc A complex pixel art maker inspired by Aseprite.
 * @author Omni-Lex
 *
 * @command openMaker
 * @text Open Pixel Art Maker
 * @desc Opens the Pixel Art Maker scene.
 *
 * @help
 * PixelArtMaker.js
 *
 * Provides an in-game pixel art editor using PIXI and HTML5 Canvas.
 * Features: Pencil, Eraser, Fill, Eyedropper, customizable sizes (up to 128px),
 * and a predefined palette.
 *
 * Input does NOT go through PIXI's interaction manager: its pointer events
 * never reach a scene here, so the toolbar, the palette and the drawing
 * surface are plain screen rectangles hit tested in update() against
 * TouchInput, the same input path every other scene in the game uses.
 *
 * Use Middle-Click or Right-Click and drag to pan the canvas.
 * Use the Mouse Wheel to zoom in and out.
 */

(() => {
    const pluginName = "PixelArtMaker";

    PluginManager.registerCommand(pluginName, "openMaker", args => {
        SceneManager.push(Scene_PixelArtMaker);
    });

    const PALETTE = [
        '#000000', '#f4f4f9', '#ffffff', '#4a90e2', '#e67e22', '#27ae60', '#333333', '#e0e0e0',
        '#2c3e50', '#666666', '#bbbbbb', '#8e44ad', '#732d91', '#219653', '#e2e8f0',
        '#7f8c8d', '#475569', '#cbd5e1', '#f8f9fa', '#d35400', '#f39c12', '#3498db',
        '#2980b9', '#d68910', '#fdf2e9', '#888888', '#eeeeee', '#444444', '#f1f5f9',
        '#aaaaaa', '#e74c3c', '#f0fff4', '#dcfce7', '#166534', '#fee2e2', '#991b1b'
    ];

    const TOOLS = ['pencil', 'eraser', 'fill', 'picker'];
    const SIZES = [16, 32, 64, 128];

    function hexToInt(hex) {
        return parseInt(hex.replace('#', '0x'), 16);
    }

    class UIButton extends PIXI.Container {
        constructor(width, height, text, bgColor = 0x333333, textColor = '#ffffff') {
            super();
            this.boxWidth = width;
            this.boxHeight = height;
            this.baseBgColor = bgColor;
            this.bg = new PIXI.Graphics();
            this.bg.beginFill(0xFFFFFF);
            this.bg.drawRect(0, 0, width, height);
            this.bg.endFill();
            this.bg.tint = bgColor;
            this.addChild(this.bg);

            this.label = new PIXI.Text(text, { fontFamily: 'sans-serif', fontSize: 14, fill: textColor, fontWeight: 'bold' });
            this.label.anchor.set(0.5);
            this.label.x = width / 2;
            this.label.y = height / 2;
            this.addChild(this.label);
        }

        setHovered(on) {
            this.bg.alpha = on ? 0.7 : 1.0;
        }

        setSelected(on) {
            this.bg.tint = on ? 0x666666 : this.baseBgColor;
        }
    }

    class PixelCanvas extends PIXI.Container {
        constructor(scene) {
            super();
            this.scene = scene;
            this.canvasSize = 32;
            this.zoom = 15;

            this.htmlCanvas = document.createElement('canvas');
            this.htmlCanvas.width = this.canvasSize;
            this.htmlCanvas.height = this.canvasSize;
            this.ctx = this.htmlCanvas.getContext('2d', { willReadFrequently: true });

            this.baseTexture = new PIXI.BaseTexture(this.htmlCanvas);
            this.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
            this.texture = new PIXI.Texture(this.baseTexture);
            this.sprite = new PIXI.Sprite(this.texture);

            this.bgGraphics = new PIXI.Graphics();
            this.gridGraphics = new PIXI.Graphics();

            this.addChild(this.bgGraphics);
            this.addChild(this.sprite);
            this.addChild(this.gridGraphics);

            this.isDrawing = false;
            this.lastX = -1;
            this.lastY = -1;

            this.resizeCanvas(32);
        }

        resizeCanvas(size) {
            if (size > 128) size = 128;
            this.canvasSize = size;
            this.htmlCanvas.width = size;
            this.htmlCanvas.height = size;
            this.ctx.clearRect(0, 0, size, size);

            this.texture.destroy(true);
            this.baseTexture = new PIXI.BaseTexture(this.htmlCanvas);
            this.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
            this.texture = new PIXI.Texture(this.baseTexture);
            this.sprite.texture = this.texture;

            this.bgGraphics.clear();
            this.bgGraphics.beginFill(0x888888);
            this.bgGraphics.drawRect(0, 0, size, size);
            this.bgGraphics.beginFill(0xcccccc);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    if ((x + y) % 2 === 0) {
                        this.bgGraphics.drawRect(x, y, 1, 1);
                    }
                }
            }
            this.bgGraphics.endFill();

            this.isDrawing = false;
            this.updateScale();
        }

        updateScale() {
            this.scale.set(this.zoom);
            this.drawGrid();
        }

        drawGrid() {
            this.gridGraphics.clear();
            if (this.zoom >= 4) {
                this.gridGraphics.lineStyle(1 / this.zoom, 0x000000, 0.3);
                for (let i = 0; i <= this.canvasSize; i++) {
                    this.gridGraphics.moveTo(i, 0);
                    this.gridGraphics.lineTo(i, this.canvasSize);
                    this.gridGraphics.moveTo(0, i);
                    this.gridGraphics.lineTo(this.canvasSize, i);
                }
            }
        }

        // Screen pixel -> art pixel. Derived from the container's own position
        // and zoom rather than worldTransform, which is only up to date after a
        // render and so lags a pan or a zoom made in the same frame.
        pixelAt(screenX, screenY) {
            return {
                x: Math.floor((screenX - this.x) / this.zoom),
                y: Math.floor((screenY - this.y) / this.zoom)
            };
        }

        contains(screenX, screenY) {
            const c = this.pixelAt(screenX, screenY);
            return c.x >= 0 && c.y >= 0 && c.x < this.canvasSize && c.y < this.canvasSize;
        }

        beginStroke(screenX, screenY) {
            const coords = this.pixelAt(screenX, screenY);
            this.isDrawing = true;
            this.applyTool(coords.x, coords.y);
            this.lastX = coords.x;
            this.lastY = coords.y;
        }

        continueStroke(screenX, screenY) {
            if (!this.isDrawing) return;
            const coords = this.pixelAt(screenX, screenY);
            if (coords.x !== this.lastX || coords.y !== this.lastY) {
                this.drawLine(this.lastX, this.lastY, coords.x, coords.y);
                this.lastX = coords.x;
                this.lastY = coords.y;
            }
        }

        endStroke() {
            this.isDrawing = false;
        }

        drawLine(x0, y0, x1, y1) {
            const dx = Math.abs(x1 - x0);
            const dy = Math.abs(y1 - y0);
            const sx = (x0 < x1) ? 1 : -1;
            const sy = (y0 < y1) ? 1 : -1;
            let err = dx - dy;

            while (true) {
                this.applyTool(x0, y0);
                if (x0 === x1 && y0 === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x0 += sx; }
                if (e2 < dx) { err += dx; y0 += sy; }
            }
        }

        applyTool(x, y) {
            if (x < 0 || x >= this.canvasSize || y < 0 || y >= this.canvasSize) return;

            const scene = this.scene;
            if (scene.currentTool === 'pencil') {
                this.ctx.fillStyle = scene.currentColor;
                this.ctx.fillRect(x, y, 1, 1);
                this.texture.update();
            } else if (scene.currentTool === 'eraser') {
                this.ctx.clearRect(x, y, 1, 1);
                this.texture.update();
            } else if (scene.currentTool === 'fill') {
                this.floodFill(x, y, scene.currentColor);
                this.texture.update();
                this.isDrawing = false;
            } else if (scene.currentTool === 'picker') {
                const pixelData = this.ctx.getImageData(x, y, 1, 1).data;
                if (pixelData[3] !== 0) {
                    const hex = "#" + (1 << 24 | pixelData[0] << 16 | pixelData[1] << 8 | pixelData[2]).toString(16).slice(1);
                    scene.setColor(hex);
                }
                this.isDrawing = false;
            }
        }

        floodFill(startX, startY, fillColorHex) {
            const imageData = this.ctx.getImageData(0, 0, this.canvasSize, this.canvasSize);
            const data = imageData.data;
            const width = this.canvasSize;
            const height = this.canvasSize;

            const startPos = (startY * width + startX) * 4;
            const startR = data[startPos];
            const startG = data[startPos + 1];
            const startB = data[startPos + 2];
            const startA = data[startPos + 3];

            const fillR = parseInt(fillColorHex.slice(1, 3), 16);
            const fillG = parseInt(fillColorHex.slice(3, 5), 16);
            const fillB = parseInt(fillColorHex.slice(5, 7), 16);
            const fillA = 255;

            if (startR === fillR && startG === fillG && startB === fillB && startA === fillA) return;

            const matchStartColor = (pos) => {
                return data[pos] === startR && data[pos + 1] === startG && data[pos + 2] === startB && data[pos + 3] === startA;
            };

            const colorPixel = (pos) => {
                data[pos] = fillR;
                data[pos + 1] = fillG;
                data[pos + 2] = fillB;
                data[pos + 3] = fillA;
            };

            const pixelStack = [[startX, startY]];

            while (pixelStack.length) {
                const newPos = pixelStack.pop();
                const x = newPos[0];
                let y = newPos[1];

                let pos = (y * width + x) * 4;
                while (y-- >= 0 && matchStartColor(pos)) {
                    pos -= width * 4;
                }
                pos += width * 4;
                ++y;

                let reachLeft = false;
                let reachRight = false;

                while (y++ < height - 1 && matchStartColor(pos)) {
                    colorPixel(pos);

                    if (x > 0) {
                        if (matchStartColor(pos - 4)) {
                            if (!reachLeft) {
                                pixelStack.push([x - 1, y]);
                                reachLeft = true;
                            }
                        } else if (reachLeft) {
                            reachLeft = false;
                        }
                    }

                    if (x < width - 1) {
                        if (matchStartColor(pos + 4)) {
                            if (!reachRight) {
                                pixelStack.push([x + 1, y]);
                                reachRight = true;
                            }
                        } else if (reachRight) {
                            reachRight = false;
                        }
                    }
                    pos += width * 4;
                }
            }
            this.ctx.putImageData(imageData, 0, 0);
        }
    }

    class Scene_PixelArtMaker extends Scene_Base {
        create() {
            super.create();
            this.currentTool = 'pencil';
            this.currentColor = '#ffffff';
            this.isPanning = false;
            this._zones = [];
            this._pointer = { x: 0, y: 0 };
            // A press inherited from the scene that opened this one must not
            // land on a button the moment the editor appears.
            this._armed = false;
            this._heldOnUI = false;

            this.createBackground();
            this.createCanvas();
            this.createUI();
            this.bindPointerEvents();
        }

        terminate() {
            super.terminate();
            this.unbindPointerEvents();
            TouchInput.clear();
        }

        createBackground() {
            this.bg = new PIXI.Graphics();
            this.bg.beginFill(0x1e1e1e);
            this.bg.drawRect(0, 0, Graphics.width, Graphics.height);
            this.bg.endFill();
            this.addChild(this.bg);
        }

        createCanvas() {
            this.canvasContainer = new PixelCanvas(this);
            this.centerCanvas();
            this.addChild(this.canvasContainer);
        }

        createUI() {
            // Toolbar
            this.toolbar = new PIXI.Container();
            this.toolbar.x = 20;
            this.toolbar.y = 80;
            this.addChild(this.toolbar);

            TOOLS.forEach((tool, index) => {
                const btn = new UIButton(90, 40, T('PixelArt.tools.' + tool));
                btn.y = index * 50;
                btn.toolName = tool;
                this.toolbar.addChild(btn);
                this.addZone(btn, () => this.setTool(tool));
            });
            this.updateToolbarHighlight();

            // Palette
            const swatchesPerRow = 2;
            const swatchSize = 35;
            const padding = 5;

            this.paletteUI = new PIXI.Container();
            this.paletteUI.x = Graphics.width - 20 - (swatchesPerRow * (swatchSize + padding));
            this.paletteUI.y = 80;
            this.addChild(this.paletteUI);

            PALETTE.forEach((hex, index) => {
                const swatch = new PIXI.Graphics();
                swatch.beginFill(0xFFFFFF); // white bg for border
                swatch.drawRect(-1, -1, swatchSize + 2, swatchSize + 2);
                swatch.beginFill(hexToInt(hex));
                swatch.drawRect(0, 0, swatchSize, swatchSize);
                swatch.endFill();
                swatch.x = (index % swatchesPerRow) * (swatchSize + padding);
                swatch.y = Math.floor(index / swatchesPerRow) * (swatchSize + padding);
                swatch.boxWidth = swatchSize;
                swatch.boxHeight = swatchSize;
                this.paletteUI.addChild(swatch);
                this.addZone(swatch, () => this.setColor(hex));
            });

            // Current color indicator
            this.currentColorIndicator = new PIXI.Graphics();
            this.updateColorIndicator();
            this.currentColorIndicator.x = this.paletteUI.x;
            this.currentColorIndicator.y = 20;
            this.addChild(this.currentColorIndicator);

            // Topbar
            this.topbar = new PIXI.Container();
            this.addChild(this.topbar);

            SIZES.forEach((sz, index) => {
                const btn = new UIButton(70, 30, T('PixelArt.size', { size: sz }));
                btn.x = 20 + index * 80;
                btn.y = 20;
                this.topbar.addChild(btn);
                this.addZone(btn, () => {
                    this.canvasContainer.resizeCanvas(sz);
                    this.centerCanvas();
                });
            });

            const clearBtn = new UIButton(80, 30, T('PixelArt.clear'), 0xc0392b);
            clearBtn.x = 20 + SIZES.length * 80 + 20;
            clearBtn.y = 20;
            this.topbar.addChild(clearBtn);
            this.addZone(clearBtn, () => {
                this.canvasContainer.ctx.clearRect(0, 0, this.canvasContainer.canvasSize, this.canvasContainer.canvasSize);
                this.canvasContainer.texture.update();
            });

            const saveBtn = new UIButton(80, 30, T('PixelArt.save'), 0x27ae60);
            saveBtn.x = clearBtn.x + 90;
            saveBtn.y = 20;
            this.topbar.addChild(saveBtn);
            this.addZone(saveBtn, () => this.saveImage());

            const exitBtn = new UIButton(80, 30, T('PixelArt.exit'), 0x7f8c8d);
            exitBtn.x = saveBtn.x + 90;
            exitBtn.y = 20;
            this.topbar.addChild(exitBtn);
            this.addZone(exitBtn, () => this.popScene());
        }

        // Registers a display object's screen rectangle as clickable. Its
        // absolute position is summed up the parent chain, so a node has to be
        // added to an already-positioned parent before it is registered.
        addZone(node, onClick) {
            let x = 0;
            let y = 0;
            for (let n = node; n && n !== this; n = n.parent) {
                x += n.x;
                y += n.y;
            }
            this._zones.push({ x, y, w: node.boxWidth, h: node.boxHeight, node, onClick });
        }

        zoneAt(x, y) {
            return this._zones.find(z => x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) || null;
        }

        centerCanvas() {
            this.canvasContainer.x = Graphics.width / 2 - (this.canvasContainer.canvasSize * this.canvasContainer.zoom) / 2;
            this.canvasContainer.y = Graphics.height / 2 - (this.canvasContainer.canvasSize * this.canvasContainer.zoom) / 2;
        }

        // --- Pointer plumbing -------------------------------------------------
        // TouchInput reports the left button only, so the middle/right button
        // used for panning is read from the document directly. The listeners
        // live and die with the scene.
        bindPointerEvents() {
            this._onDocMouseMove = e => this.setPointerFromPage(e.pageX, e.pageY);
            this._onDocMouseDown = e => {
                this.setPointerFromPage(e.pageX, e.pageY);
                if (e.button === 1 || e.button === 2) {
                    if (e.button === 1) e.preventDefault(); // no autoscroll cursor
                    this.startPan();
                }
            };
            this._onDocMouseUp = e => {
                if (e.button === 1 || e.button === 2) this.isPanning = false;
            };
            this._onDocTouch = e => {
                const touch = e.changedTouches && e.changedTouches[0];
                if (touch) this.setPointerFromPage(touch.pageX, touch.pageY);
            };
            document.addEventListener('mousemove', this._onDocMouseMove);
            document.addEventListener('mousedown', this._onDocMouseDown);
            document.addEventListener('mouseup', this._onDocMouseUp);
            document.addEventListener('touchstart', this._onDocTouch);
            document.addEventListener('touchmove', this._onDocTouch);
        }

        unbindPointerEvents() {
            if (this._onDocMouseMove) document.removeEventListener('mousemove', this._onDocMouseMove);
            if (this._onDocMouseDown) document.removeEventListener('mousedown', this._onDocMouseDown);
            if (this._onDocMouseUp) document.removeEventListener('mouseup', this._onDocMouseUp);
            if (this._onDocTouch) {
                document.removeEventListener('touchstart', this._onDocTouch);
                document.removeEventListener('touchmove', this._onDocTouch);
            }
            this._onDocMouseMove = this._onDocMouseDown = this._onDocMouseUp = this._onDocTouch = null;
        }

        setPointerFromPage(pageX, pageY) {
            this._pointer.x = Graphics.pageToCanvasX(pageX);
            this._pointer.y = Graphics.pageToCanvasY(pageY);
        }

        startPan() {
            this.isPanning = true;
            this.canvasContainer.endStroke();
            this.panStart = { x: this._pointer.x, y: this._pointer.y };
            this.containerStart = { x: this.canvasContainer.x, y: this.canvasContainer.y };
        }

        updatePan() {
            if (!this.isPanning) return;
            this.canvasContainer.x = this.containerStart.x + (this._pointer.x - this.panStart.x);
            this.canvasContainer.y = this.containerStart.y + (this._pointer.y - this.panStart.y);
        }

        updatePointer() {
            if (!this._armed) {
                if (!TouchInput.isPressed()) this._armed = true;
                return;
            }
            if (this.isPanning) return;

            const p = this._pointer;
            if (TouchInput.isTriggered()) {
                const zone = this.zoneAt(p.x, p.y);
                if (zone) {
                    this._heldOnUI = true;
                    zone.onClick();
                } else if (this.canvasContainer.contains(p.x, p.y)) {
                    this.canvasContainer.beginStroke(p.x, p.y);
                }
            } else if (TouchInput.isPressed()) {
                if (!this._heldOnUI) this.canvasContainer.continueStroke(p.x, p.y);
            } else {
                this._heldOnUI = false;
                this.canvasContainer.endStroke();
            }
        }

        updateHover() {
            const p = this._pointer;
            for (const zone of this._zones) {
                if (zone.node.setHovered) {
                    zone.node.setHovered(p.x >= zone.x && p.x < zone.x + zone.w &&
                                         p.y >= zone.y && p.y < zone.y + zone.h);
                }
            }
        }

        setTool(tool) {
            this.currentTool = tool;
            this.updateToolbarHighlight();
        }

        setColor(hex) {
            this.currentColor = hex;
            if (this.currentTool === 'eraser' || this.currentTool === 'picker') {
                this.setTool('pencil');
            }
            this.updateColorIndicator();
        }

        updateToolbarHighlight() {
            this.toolbar.children.forEach(btn => btn.setSelected(btn.toolName === this.currentTool));
        }

        updateColorIndicator() {
            this.currentColorIndicator.clear();
            this.currentColorIndicator.beginFill(hexToInt(this.currentColor));
            this.currentColorIndicator.lineStyle(2, 0xFFFFFF);
            this.currentColorIndicator.drawRect(0, 0, 75, 40);
            this.currentColorIndicator.endFill();
        }

        saveImage() {
            const dataURL = this.canvasContainer.htmlCanvas.toDataURL("image/png");
            const link = document.createElement('a');
            link.download = 'pixel_art.png';
            link.href = dataURL;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        update() {
            super.update();

            // Esc / controller B exits the editor (parity with the on-screen Exit button).
            if (Input.isTriggered('cancel')) { this.popScene(); return; }

            this.updatePan();
            this.updateHover();
            this.updatePointer();

            if (TouchInput.wheelY < 0) {
                this.canvasContainer.zoom = Math.min(this.canvasContainer.zoom + 1, 30);
                this.canvasContainer.updateScale();
            } else if (TouchInput.wheelY > 0) {
                this.canvasContainer.zoom = Math.max(this.canvasContainer.zoom - 1, 1);
                this.canvasContainer.updateScale();
            }

            // Controller: left analog stick pans the canvas, right stick Y zooms.
            if (window.AnalogStickInput) {
                const ax = AnalogStickInput.leftX();
                const ay = AnalogStickInput.leftY();
                if (ax !== 0 || ay !== 0) {
                    const panSpeed = 14; // px/frame at full deflection
                    this.canvasContainer.x -= ax * panSpeed;
                    this.canvasContainer.y -= ay * panSpeed;
                }
                this._analogZoomCooldown = (this._analogZoomCooldown || 0) - 1;
                const ry = AnalogStickInput.rightY();
                if (ry !== 0 && this._analogZoomCooldown <= 0) {
                    if (ry < 0) this.canvasContainer.zoom = Math.min(this.canvasContainer.zoom + 1, 30); // up = zoom in
                    else this.canvasContainer.zoom = Math.max(this.canvasContainer.zoom - 1, 1);
                    this.canvasContainer.updateScale();
                    this._analogZoomCooldown = 8; // frames between integer zoom steps
                }
            }
        }
    }
})();
