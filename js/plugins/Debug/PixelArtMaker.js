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

    function hexToInt(hex) {
        return parseInt(hex.replace('#', '0x'), 16);
    }

    class UIButton extends PIXI.Container {
        constructor(width, height, text, onClick, bgColor = 0x333333, textColor = '#ffffff') {
            super();
            this.baseBgColor = bgColor;
            this.interactive = true;
            this.buttonMode = true;
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

            this.on('pointerdown', (e) => {
                if (e.data.button === 0) onClick();
            });
            this.on('pointerover', () => { this.bg.alpha = 0.7; });
            this.on('pointerout', () => { this.bg.alpha = 1.0; });
        }
    }

    class PixelCanvas extends PIXI.Container {
        constructor() {
            super();
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
            
            this.interactive = true;
            
            this.on('pointerdown', this.onPointerDown.bind(this));
            this.on('pointermove', this.onPointerMove.bind(this));
            
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

        getPixelCoords(e) {
            const localPos = this.sprite.worldTransform.applyInverse(e.data.global);
            return {
                x: Math.floor(localPos.x),
                y: Math.floor(localPos.y)
            };
        }

        onPointerDown(e) {
            if (e.data.button === 2 || e.data.button === 1) {
                SceneManager._scene.startPan(e);
                return;
            }
            if (e.data.button === 0) {
                this.isDrawing = true;
                const coords = this.getPixelCoords(e);
                this.applyTool(coords.x, coords.y);
                this.lastX = coords.x;
                this.lastY = coords.y;
            }
        }

        onPointerMove(e) {
            if (this.isDrawing) {
                const coords = this.getPixelCoords(e);
                if (coords.x !== this.lastX || coords.y !== this.lastY) {
                    this.drawLine(this.lastX, this.lastY, coords.x, coords.y);
                    this.lastX = coords.x;
                    this.lastY = coords.y;
                }
            }
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
            
            const scene = SceneManager._scene;
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
            
            this.createBackground();
            this.createCanvas();
            this.createUI();
        }

        createBackground() {
            this.bg = new PIXI.Graphics();
            this.bg.beginFill(0x1e1e1e);
            this.bg.drawRect(0, 0, Graphics.width, Graphics.height);
            this.bg.endFill();
            this.addChild(this.bg);
            
            this.panCatcher = new PIXI.Graphics();
            this.panCatcher.beginFill(0x000000, 0.001);
            this.panCatcher.drawRect(0, 0, Graphics.width, Graphics.height);
            this.panCatcher.endFill();
            this.panCatcher.interactive = true;
            this.panCatcher.on('pointerdown', this.onGlobalPointerDown.bind(this));
            this.panCatcher.on('pointermove', this.onGlobalPointerMove.bind(this));
            this.panCatcher.on('pointerup', this.onGlobalPointerUp.bind(this));
            this.panCatcher.on('pointerupoutside', this.onGlobalPointerUp.bind(this));
            this.addChild(this.panCatcher);
        }

        createCanvas() {
            this.canvasContainer = new PixelCanvas();
            this.centerCanvas();
            this.addChild(this.canvasContainer);
        }

        createUI() {
            // Toolbar
            this.toolbar = new PIXI.Container();
            this.addChild(this.toolbar);
            
            const tools = ['pencil', 'eraser', 'fill', 'picker'];
            tools.forEach((tool, index) => {
                const btn = new UIButton(90, 40, tool.toUpperCase(), () => {
                    this.setTool(tool);
                });
                btn.y = index * 50;
                this.toolbar.addChild(btn);
                btn.toolName = tool;
            });
            this.toolbar.x = 20;
            this.toolbar.y = 80;
            this.updateToolbarHighlight();
            
            // Palette
            this.paletteUI = new PIXI.Container();
            this.addChild(this.paletteUI);
            
            const swatchesPerRow = 2;
            const swatchSize = 35;
            const padding = 5;
            
            PALETTE.forEach((hex, index) => {
                const x = (index % swatchesPerRow) * (swatchSize + padding);
                const y = Math.floor(index / swatchesPerRow) * (swatchSize + padding);
                
                const swatch = new PIXI.Graphics();
                swatch.beginFill(0xFFFFFF); // white bg for border
                swatch.drawRect(-1, -1, swatchSize + 2, swatchSize + 2);
                swatch.beginFill(hexToInt(hex));
                swatch.drawRect(0, 0, swatchSize, swatchSize);
                swatch.endFill();
                swatch.x = x;
                swatch.y = y;
                swatch.interactive = true;
                swatch.buttonMode = true;
                swatch.on('pointerdown', (e) => {
                    if (e.data.button === 0) this.setColor(hex);
                });
                this.paletteUI.addChild(swatch);
            });
            
            this.paletteUI.x = Graphics.width - 20 - (swatchesPerRow * (swatchSize + padding));
            this.paletteUI.y = 80;
            
            // Current color indicator
            this.currentColorIndicator = new PIXI.Graphics();
            this.updateColorIndicator();
            this.currentColorIndicator.x = this.paletteUI.x;
            this.currentColorIndicator.y = 20;
            this.addChild(this.currentColorIndicator);
            
            // Topbar
            this.topbar = new PIXI.Container();
            this.addChild(this.topbar);
            
            const sizes = [16, 32, 64, 128];
            sizes.forEach((sz, index) => {
                const btn = new UIButton(70, 30, `${sz}px`, () => {
                    this.canvasContainer.resizeCanvas(sz);
                    this.centerCanvas();
                });
                btn.x = 20 + index * 80;
                btn.y = 20;
                this.topbar.addChild(btn);
            });
            
            const clearBtn = new UIButton(80, 30, 'CLEAR', () => {
                this.canvasContainer.ctx.clearRect(0, 0, this.canvasContainer.canvasSize, this.canvasContainer.canvasSize);
                this.canvasContainer.texture.update();
            }, 0xc0392b);
            clearBtn.x = 20 + sizes.length * 80 + 20;
            clearBtn.y = 20;
            this.topbar.addChild(clearBtn);
            
            const saveBtn = new UIButton(80, 30, 'SAVE', () => {
                this.saveImage();
            }, 0x27ae60);
            saveBtn.x = clearBtn.x + 90;
            saveBtn.y = 20;
            this.topbar.addChild(saveBtn);
            
            const exitBtn = new UIButton(80, 30, 'EXIT', () => {
                SceneManager.pop();
            }, 0x7f8c8d);
            exitBtn.x = saveBtn.x + 90;
            exitBtn.y = 20;
            this.topbar.addChild(exitBtn);
        }

        centerCanvas() {
            this.canvasContainer.x = Graphics.width / 2 - (this.canvasContainer.canvasSize * this.canvasContainer.zoom) / 2;
            this.canvasContainer.y = Graphics.height / 2 - (this.canvasContainer.canvasSize * this.canvasContainer.zoom) / 2;
        }

        onGlobalPointerDown(e) {
            if (e.data.button === 2 || e.data.button === 1) {
                this.startPan(e);
            }
        }

        onGlobalPointerMove(e) {
            if (this.isPanning) {
                const dx = e.data.global.x - this.panStart.x;
                const dy = e.data.global.y - this.panStart.y;
                this.canvasContainer.x = this.containerStart.x + dx;
                this.canvasContainer.y = this.containerStart.y + dy;
            } else if (this.canvasContainer.isDrawing) {
                this.canvasContainer.onPointerMove(e);
            }
        }

        onGlobalPointerUp(e) {
            this.isPanning = false;
            this.canvasContainer.isDrawing = false;
        }

        startPan(e) {
            this.isPanning = true;
            this.panStart = { x: e.data.global.x, y: e.data.global.y };
            this.containerStart = { x: this.canvasContainer.x, y: this.canvasContainer.y };
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
            this.toolbar.children.forEach(btn => {
                if (btn.toolName === this.currentTool) {
                    btn.bg.tint = 0x666666;
                } else {
                    btn.bg.tint = btn.baseBgColor;
                }
            });
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
            if (Input.isTriggered('cancel')) { SceneManager.pop(); return; }

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
