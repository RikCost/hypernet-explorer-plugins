/*:
 * @target MZ
 * @plugindesc Pool Game v1.0.0
 * @author Omni-Lex
 * @help
 * ============================================================================
 * Pool Game Plugin for RPG Maker MZ
 * ============================================================================
 * 
 * This plugin adds a fully playable pool game to your RPG Maker MZ project.
 * The game features realistic physics, ball collisions, and a top-down view.
 * 
 * Controls:
 * - Arrow Keys: Rotate the cue stick
 * - Hold Space: Charge power (release to shoot)
 * - ESC: Exit the game
 * 
 * Player 2 is controlled by CPU
 * 
 * @command openPoolGame
 * @text Open Pool Game
 * @desc Opens the pool game scene
 * 
 */

(() => {
    'use strict';
    
    const pluginName = 'PoolGame';
    
    // Plugin Commands
    PluginManager.registerCommand(pluginName, 'openPoolGame', args => {
        SceneManager.push(Scene_Pool);
    });
    
    // Pool Game Scene
    class Scene_Pool extends Scene_Base {
        create() {
            super.create();
            this.createBackground();
            this.createPoolGame();
            this.createUI();
        }
        
        createBackground() {
            this._backgroundSprite = new Sprite();
            this._backgroundSprite.bitmap = new Bitmap(Graphics.width, Graphics.height);
            this._backgroundSprite.bitmap.fillAll('#1a1a1a');
            this.addChild(this._backgroundSprite);
        }
        
        createPoolGame() {
            this._poolGame = new PoolGame();
            this.addChild(this._poolGame);
        }
        
        createUI() {
            this._exitButton = new Sprite_Button('cancel');
            this._exitButton.x = Graphics.width - 100;
            this._exitButton.y = 20;
            this._exitButton.setClickHandler(this.popScene.bind(this));
            this.addChild(this._exitButton);
            
            // Info text
            this._infoText = new Sprite();
            this._infoText.bitmap = new Bitmap(600, 150);
            this._infoText.bitmap.fontSize = 20;
            this._infoText.x = 20;
            this._infoText.y = 20;
            this.addChild(this._infoText);
            this.updateInfo();
        }
        
        updateInfo() {
            const isSplitScreen = window.$gameSplitScreen && window.$gameSplitScreen.active;
            const powerPct = Math.floor(this._poolGame.power * 100);
            // Only clear+redraw when a value that affects the text actually changes.
            const sig = this._poolGame.currentPlayer + '|' + powerPct + '|' + (isSplitScreen ? 1 : 0);
            if (this._infoSig === sig) return;
            this._infoSig = sig;

            const bitmap = this._infoText.bitmap;
            bitmap.clear();
            bitmap.textColor = '#ffffff';
            const playerText = this._poolGame.currentPlayer === 1 ? T('PoolGame.player1') : (isSplitScreen ? T('PoolGame.player2') : T('PoolGame.player2Cpu'));
            bitmap.drawText(playerText, 0, 0, 600, 30, 'left');
            
            if (this._poolGame.currentPlayer === 1) {
                bitmap.drawText(T('PoolGame.controlsP1'), 0, 30, 600, 30, 'left');
                bitmap.drawText(T('PoolGame.power', { pct: Math.floor(this._poolGame.power * 100) }), 0, 60, 600, 30, 'left');
            } else if (this._poolGame.currentPlayer === 2 && isSplitScreen) {
                bitmap.drawText(T('PoolGame.controlsP2'), 0, 30, 600, 30, 'left');
                bitmap.drawText(T('PoolGame.power', { pct: Math.floor(this._poolGame.power * 100) }), 0, 60, 600, 30, 'left');
            } else {
                bitmap.drawText(T('PoolGame.cpuThinking'), 0, 30, 600, 30, 'left');
            }
        }
        
        update() {
            super.update();
            if (Input.isTriggered('cancel')) {
                this.popScene();
            }
            
            if (window.AsciiMode && window.AsciiMode.active) {
                this.renderAsciiPool();
            } else {
                this.updateInfo();
            }
        }

        start() {
            super.start();
            if (window.AsciiMode && window.AsciiMode.active) {
                window.AsciiMode.createCanvas();
                if (window.AsciiMode.canvas) window.AsciiMode.canvas.style.display = 'block';
                this._backgroundSprite.visible = false;
                this._poolGame.visible = false;
                this._exitButton.visible = false;
                this._infoText.visible = false;
            }
        }

        terminate() {
            if (this._poolGame && typeof this._poolGame.destroy === 'function') {
                this._poolGame.destroy();
                this._poolGame = null;
            }
            super.terminate();
            if (window.AsciiMode && window.AsciiMode.canvas) {
                window.AsciiMode.canvas.style.display = 'none';
            }
        }

        renderAsciiPool() {
            const ctx = window.AsciiMode.context;
            const canvas = window.AsciiMode.canvas;
            if (!ctx || !canvas) return;

            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const game = this._poolGame;
            if (!game) return;

            const origW = game.tableWidth;
            const origH = game.tableHeight;
            const origX = game.tableX;
            const origY = game.tableY;

            // Calculate scale factor to make it bigger and centered
            const scaleFactor = Math.min((canvas.width * 0.8) / origW, (canvas.height * 0.8) / origH);

            const newW = origW * scaleFactor;
            const newH = origH * scaleFactor;
            const newX = (canvas.width - newW) / 2;
            const newY = (canvas.height - newH) / 2;

            const mapX = (x) => newX + (x - origX) * scaleFactor;
            const mapY = (y) => newY + (y - origY) * scaleFactor;

            const fontSize = Math.floor((window.AsciiMode.fontSize || 24) * scaleFactor);
            ctx.font = `${fontSize}px ${window.AsciiMode.fontFamily || 'monospace'}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Draw Table Border
            ctx.strokeStyle = '#8b4513';
            ctx.lineWidth = 10 * game.scaleFactor * scaleFactor;
            ctx.strokeRect(newX, newY, newW, newH);

            // Draw Table Surface
            ctx.fillStyle = '#0a3c0a';
            ctx.fillRect(newX, newY, newW, newH);

            // Draw Pockets
            ctx.fillStyle = '#000000';
            game.pockets.forEach(pocket => {
                ctx.beginPath();
                ctx.arc(mapX(pocket.x), mapY(pocket.y), pocket.radius * scaleFactor, 0, Math.PI * 2);
                ctx.fill();
                
                ctx.fillStyle = '#FFFFFF';
                ctx.fillText('0', mapX(pocket.x), mapY(pocket.y));
                ctx.fillStyle = '#000000';
            });

            // Draw Balls
            game.balls.forEach(ball => {
                if (ball.isPocketed) return;

                let char = ball.number.toString();
                if (ball.number === 0) char = '@';
                
                // Use ball color if available
                if (ball.color !== undefined) {
                    ctx.fillStyle = '#' + ball.color.toString(16).padStart(6, '0');
                } else {
                    ctx.fillStyle = '#FFFFFF';
                    if (ball.number === 0) ctx.fillStyle = '#FFFFFF';
                    else if (ball.number === 8) ctx.fillStyle = '#FFFFFF';
                    else if (ball.number < 8) ctx.fillStyle = '#FFFF00';
                    else ctx.fillStyle = '#00FFFF';
                }
                
                ctx.fillText(char, mapX(ball.x), mapY(ball.y));
            });

            // Draw Cue Stick and Aim Line
            if (!game.ballsMoving && game.cueBall && !game.cueBall.isPocketed) {
                // Aim Line
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.lineWidth = 2 * game.scaleFactor * scaleFactor;
                ctx.beginPath();
                ctx.moveTo(mapX(game.cueBall.x), mapY(game.cueBall.y));
                const aimLength = 300 * game.scaleFactor;
                const aimX = game.cueBall.x + Math.cos(game.cueAngle) * aimLength;
                const aimY = game.cueBall.y + Math.sin(game.cueAngle) * aimLength;
                ctx.lineTo(mapX(aimX), mapY(aimY));
                ctx.stroke();

                // Cue Stick
                ctx.strokeStyle = '#8B4513';
                ctx.lineWidth = 6 * game.scaleFactor * scaleFactor;
                ctx.beginPath();
                const baseOffset = game.cueBall.radius + 5;
                const offset = baseOffset + game.power * 50;
                const stickLength = 200 * game.scaleFactor;
                const stickStartX = game.cueBall.x - Math.cos(game.cueAngle) * offset;
                const stickStartY = game.cueBall.y - Math.sin(game.cueAngle) * offset;
                const stickEndX = game.cueBall.x - Math.cos(game.cueAngle) * (offset + stickLength);
                const stickEndY = game.cueBall.y - Math.sin(game.cueAngle) * (offset + stickLength);
                ctx.moveTo(mapX(stickStartX), mapY(stickStartY));
                ctx.lineTo(mapX(stickEndX), mapY(stickEndY));
                ctx.stroke();
            }

            // Draw UI
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'left';
            ctx.font = `20px ${window.AsciiMode.fontFamily || 'monospace'}`;
            
            const isSplitScreen = window.$gameSplitScreen && window.$gameSplitScreen.active;
            const playerText = game.currentPlayer === 1 ? T('PoolGame.player1') : (isSplitScreen ? T('PoolGame.player2') : T('PoolGame.player2Cpu'));
            ctx.fillText(playerText, 20, 30);

            if (game.currentPlayer === 1) {
                ctx.fillText(T('PoolGame.controlsP1'), 20, 60);
            } else if (game.currentPlayer === 2 && isSplitScreen) {
                ctx.fillText(T('PoolGame.controlsP2'), 20, 60);
            } else {
                ctx.fillText(T('PoolGame.cpuThinking'), 20, 60);
            }

            // Power Bar
            if (game.isCharging || (game.currentPlayer === 2 && game.cpuThinking)) {
                const barWidth = 200;
                const barHeight = 20;
                const barX = (canvas.width - barWidth) / 2;
                const barY = canvas.height - 100;

                ctx.fillStyle = '#333333';
                ctx.fillRect(barX, barY, barWidth, barHeight);

                const color = game.power < 0.5 ? '#00FF00' : game.power < 0.8 ? '#FFFF00' : '#FF0000';
                ctx.fillStyle = color;
                ctx.fillRect(barX, barY, barWidth * game.power, barHeight);

                ctx.strokeStyle = '#FFFFFF';
                ctx.lineWidth = 2;
                ctx.strokeRect(barX, barY, barWidth, barHeight);
            }
        }
    }
    
    // Pool Game Class
    class PoolGame extends PIXI.Container {
        constructor() {
            super();
            this.currentPlayer = 1;
            this.balls = [];
            this.pockets = [];
            this.cueBall = null;
            this.ballsMoving = false;
            this.cueAngle = 0;
            this.power = 0;
            this.isCharging = false;
            this.powerDirection = 1;
            this.cpuThinking = false;
            this.cpuShotTimer = 0;
            this.isGameOver = false;
            this._respawnTimeout = null;

            this.setupTable();
            this.setupBalls();
            this.setupCueStick();
            
            // Start game loop
            this.ticker = new PIXI.Ticker();
            this.ticker.add(this.update, this);
            this.ticker.start();
        }
        
        setupTable() {
            // Table dimensions
            this.scaleFactor = Math.min((Graphics.width * 0.8) / 700, (Graphics.height * 0.8) / 350);
            this.tableWidth = 700 * this.scaleFactor;
            this.tableHeight = 350 * this.scaleFactor;
            this.tableX = (Graphics.width - this.tableWidth) / 2;
            this.tableY = (Graphics.height - this.tableHeight) / 2;
            
            // Draw table
            const table = new PIXI.Graphics();
            table.beginFill(0x0d5c0d);
            table.drawRect(this.tableX, this.tableY, this.tableWidth, this.tableHeight);
            table.endFill();
            
            // Draw rails
            table.lineStyle(10 * this.scaleFactor, 0x8b4513);
            table.drawRect(this.tableX - 5 * this.scaleFactor, this.tableY - 5 * this.scaleFactor, this.tableWidth + 10 * this.scaleFactor, this.tableHeight + 10 * this.scaleFactor);
            
            this.addChild(table);
            
            // Setup pockets
            const pocketRadius = 20 * this.scaleFactor;
            const pocketPositions = [
                {x: this.tableX, y: this.tableY},
                {x: this.tableX + this.tableWidth / 2, y: this.tableY},
                {x: this.tableX + this.tableWidth, y: this.tableY},
                {x: this.tableX, y: this.tableY + this.tableHeight},
                {x: this.tableX + this.tableWidth / 2, y: this.tableY + this.tableHeight},
                {x: this.tableX + this.tableWidth, y: this.tableY + this.tableHeight}
            ];
            
            pocketPositions.forEach(pos => {
                const pocket = new PIXI.Graphics();
                pocket.beginFill(0x000000);
                pocket.drawCircle(0, 0, pocketRadius);
                pocket.endFill();
                pocket.x = pos.x;
                pocket.y = pos.y;
                this.addChild(pocket);
                this.pockets.push({x: pos.x, y: pos.y, radius: pocketRadius});
            });
        }
        
        setupBalls() {
            const ballRadius = 12 * this.scaleFactor;
            const startX = this.tableX + this.tableWidth * 0.75;
            const startY = this.tableY + this.tableHeight / 2;
            
            // Cue ball
            this.cueBall = this.createBall(this.tableX + this.tableWidth * 0.25, startY, 0xffffff, ballRadius, 0);
            
            // Rack formation
            const colors = [
                0xffff00, 0x0000ff, 0xff0000, 0x800080, 0xffa500,
                0x008000, 0x8b4513, 0x000000, 0xffff00, 0x0000ff,
                0xff0000, 0x800080, 0xffa500, 0x008000, 0x8b4513
            ];
            
            let ballIndex = 0;
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col <= row; col++) {
                    const x = startX + row * ballRadius * 1.8;
                    const y = startY + (col - row / 2) * ballRadius * 2.1;
                    this.createBall(x, y, colors[ballIndex], ballRadius, ballIndex + 1);
                    ballIndex++;
                }
            }
        }
        
        createBall(x, y, color, radius, number) {
            const ball = new PIXI.Container();
            
            // Ball graphic
            const circle = new PIXI.Graphics();
            circle.beginFill(color);
            circle.drawCircle(0, 0, radius);
            circle.endFill();
            
            // Add stripe for balls 9-15
            if (number > 8) {
                circle.beginFill(0xffffff);
                circle.drawRect(-radius * 0.8, -radius * 0.3, radius * 1.6, radius * 0.6);
                circle.endFill();
            }
            
            ball.addChild(circle);
            
            // Add number
            if (number > 0) {
                const text = new PIXI.Text(number.toString(), {
                    fontFamily: 'Arial',
                    fontSize: 12,
                    fill: number === 8 ? 0xffffff : 0x000000,
                    align: 'center'
                });
                text.anchor.set(0.5);
                ball.addChild(text);
            }
            
            ball.x = x;
            ball.y = y;
            ball.vx = 0;
            ball.vy = 0;
            ball.radius = radius;
            ball.number = number;
            ball.color = color;
            ball.isPocketed = false;
            
            this.balls.push(ball);
            this.addChild(ball);
            
            return ball;
        }
        
        setupCueStick() {
            // Create cue stick container
            this.cueStick = new PIXI.Container();
            
            const stickLength = 200 * this.scaleFactor;
            const stickWidth = 6 * this.scaleFactor;
            
            // Draw the cue stick
            const stick = new PIXI.Graphics();
            stick.beginFill(0x8B4513); // Brown color
            stick.drawRect(-stickLength, -stickWidth / 2, stickLength, stickWidth); // Main shaft
            stick.endFill();
            
            // Add tip
            stick.beginFill(0x000000);
            stick.drawRect(-10 * this.scaleFactor, -stickWidth / 2 + 1, 10 * this.scaleFactor, stickWidth - 2);
            stick.endFill();
            
            // Add decorative rings
            stick.beginFill(0xFFD700);
            stick.drawRect(-50 * this.scaleFactor, -stickWidth / 2 - 1, 5 * this.scaleFactor, stickWidth + 2);
            stick.drawRect(-150 * this.scaleFactor, -stickWidth / 2 - 1, 5 * this.scaleFactor, stickWidth + 2);
            stick.endFill();
            
            this.cueStick.addChild(stick);
            
            // Add aiming line
            this.aimLine = new PIXI.Graphics();
            this.cueStick.addChild(this.aimLine);
            
            // Add power indicator
            this.powerBar = new PIXI.Graphics();
            this.addChild(this.powerBar);
            
            this.addChild(this.cueStick);
        }
        
        updateCueStick() {
            if (this.ballsMoving || !this.cueBall || this.cueBall.isPocketed) {
                this.cueStick.visible = false;
                return;
            }
            
            this.cueStick.visible = true;
            
            // Position cue stick at cue ball
            this.cueStick.x = this.cueBall.x;
            this.cueStick.y = this.cueBall.y;
            
            // Set rotation
            this.cueStick.rotation = this.cueAngle;
            
            // Offset based on power
            const baseOffset = this.cueBall ? this.cueBall.radius + 5 : 20;
            const offset = baseOffset + this.power * 50;
            this.cueStick.children[0].x = -offset;
            
            // Update aim line
            this.aimLine.clear();
            this.aimLine.lineStyle(2 * this.scaleFactor, 0xFFFFFF, 0.3);
            this.aimLine.moveTo(0, 0);
            this.aimLine.lineTo(300 * this.scaleFactor, 0);
            
            // Update power bar
            this.powerBar.clear();
            if (this.isCharging || (this.currentPlayer === 2 && this.cpuThinking)) {
                const barWidth = 200;
                const barHeight = 20;
                const barX = (Graphics.width - barWidth) / 2;
                const barY = Graphics.height - 100;
                
                // Background
                this.powerBar.beginFill(0x333333);
                this.powerBar.drawRect(barX, barY, barWidth, barHeight);
                this.powerBar.endFill();
                
                // Power fill
                const color = this.power < 0.5 ? 0x00FF00 : this.power < 0.8 ? 0xFFFF00 : 0xFF0000;
                this.powerBar.beginFill(color);
                this.powerBar.drawRect(barX, barY, barWidth * this.power, barHeight);
                this.powerBar.endFill();
                
                // Border
                this.powerBar.lineStyle(2, 0xFFFFFF);
                this.powerBar.drawRect(barX, barY, barWidth, barHeight);
            }
        }
        
        handleInput() {
            if (this.ballsMoving) return;
            
            const isSplitScreen = window.$gameSplitScreen && window.$gameSplitScreen.active;
            
            if (this.currentPlayer === 1) {
                // Rotation - reduced sensitivity
                const rotSpeed = 0.02; // Reduced from 0.05
                if (Input.isPressed('left')) {
                    this.cueAngle -= rotSpeed;
                }
                if (Input.isPressed('right')) {
                    this.cueAngle += rotSpeed;
                }
                
                // Power charging
                if (Input.isPressed('ok') || Input.isLongPressed('ok')) {
                    this.isCharging = true;
                    this.power += this.powerDirection * 0.02;
                    
                    // Oscillate power for better control
                    if (this.power >= 1) {
                        this.power = 1;
                        this.powerDirection = -1;
                    } else if (this.power <= 0) {
                        this.power = 0;
                        this.powerDirection = 1;
                    }
                } else if (this.isCharging) {
                    // Release - shoot!
                    this.shoot();
                    this.isCharging = false;
                    this.power = 0;
                    this.powerDirection = 1;
                }
            } else if (this.currentPlayer === 2 && isSplitScreen) {
                // Player 2 controls
                const rotSpeed = 0.02;
                const p2 = window.$gameSplitScreen && window.$gameSplitScreen.p2Input;
                if (!p2) return;

                if (p2.left) {
                    this.cueAngle -= rotSpeed;
                }
                if (p2.right) {
                    this.cueAngle += rotSpeed;
                }
                
                if (p2.action) {
                    this.isCharging = true;
                    this.power += this.powerDirection * 0.02;
                    
                    if (this.power >= 1) {
                        this.power = 1;
                        this.powerDirection = -1;
                    } else if (this.power <= 0) {
                        this.power = 0;
                        this.powerDirection = 1;
                    }
                } else if (this.isCharging) {
                    this.shoot();
                    this.isCharging = false;
                    this.power = 0;
                    this.powerDirection = 1;
                }
            }
        }
        
        handleCPU() {
            if (this.ballsMoving || this.currentPlayer !== 2 || !this.cueBall || this.cueBall.isPocketed) return;
            
            if (!this.cpuThinking) {
                this.cpuThinking = true;
                this.cpuShotTimer = 0;
                
                // Find best shot
                const targetBall = this.findBestTarget();
                if (targetBall) {
                    // Calculate angle to target
                    const dx = targetBall.x - this.cueBall.x;
                    const dy = targetBall.y - this.cueBall.y;
                    this.cpuTargetAngle = Math.atan2(dy, dx);

                    // Add some randomness for realism
                    this.cpuTargetAngle += (Math.random() - 0.5) * 0.2;

                    // Calculate power based on distance
                    const distance = Math.hypot(dx, dy);
                    this.cpuTargetPower = Math.min(distance / 300, 0.8) + Math.random() * 0.2;
                } else {
                    // No valid target (all balls pocketed) - abort the CPU turn
                    this.cpuThinking = false;
                    return;
                }
            }
            
            // Animate CPU shot
            if (this.cpuThinking) {
                this.cpuShotTimer++;
                
                // Rotate to target angle
                const angleDiff = this.cpuTargetAngle - this.cueAngle;
                this.cueAngle += angleDiff * 0.1;
                
                // Charge power
                if (this.cpuShotTimer > 30 && this.cpuShotTimer < 90) {
                    this.power = Math.min(this.power + 0.02, this.cpuTargetPower);
                }
                
                // Shoot
                if (this.cpuShotTimer > 100) {
                    this.shoot();
                    this.cpuThinking = false;
                    this.power = 0;
                }
            }
        }
        
        findBestTarget() {
            // Simple AI: find closest ball that has a clear path
            let bestBall = null;
            let bestDistance = Infinity;
            
            for (const ball of this.balls) {
                if (ball.isPocketed || ball === this.cueBall) continue;
                
                const dx = ball.x - this.cueBall.x;
                const dy = ball.y - this.cueBall.y;
                const distance = Math.hypot(dx, dy);
                
                // Check if path is clear (simple check)
                let pathClear = true;
                const steps = 10;
                for (let i = 1; i < steps; i++) {
                    const checkX = this.cueBall.x + (dx * i / steps);
                    const checkY = this.cueBall.y + (dy * i / steps);
                    
                    for (const otherBall of this.balls) {
                        if (otherBall === ball || otherBall === this.cueBall || otherBall.isPocketed) continue;
                        
                        const checkDist = Math.hypot(otherBall.x - checkX, otherBall.y - checkY);
                        if (checkDist < this.cueBall.radius * 2) {
                            pathClear = false;
                            break;
                        }
                    }
                    if (!pathClear) break;
                }
                
                if (pathClear && distance < bestDistance) {
                    bestDistance = distance;
                    bestBall = ball;
                }
            }
            
            return bestBall || this.balls.find(b => !b.isPocketed && b !== this.cueBall);
        }
        
        shoot() {
            if (!this.cueBall || this.cueBall.isPocketed) return;
            
            const speed = this.power * 20; // Max speed of 20
            this.cueBall.vx = Math.cos(this.cueAngle) * speed;
            this.cueBall.vy = Math.sin(this.cueAngle) * speed;
        }
        
        update(delta) {
            if (this.isGameOver || this._destroyed) return;
            const isSplitScreen = window.$gameSplitScreen && window.$gameSplitScreen.active;

            if (this.currentPlayer === 1 || (this.currentPlayer === 2 && isSplitScreen)) {
                this.handleInput();
            } else {
                this.handleCPU();
            }
            
            this.updateCueStick();
            
            const friction = 0.985;
            const minVelocity = 0.1;
            let anyMoving = false;
            
            // Update ball positions
            this.balls.forEach(ball => {
                if (ball.isPocketed) return;
                
                // Apply friction
                ball.vx *= friction;
                ball.vy *= friction;
                
                // Stop if velocity is too low
                if (Math.abs(ball.vx) < minVelocity) ball.vx = 0;
                if (Math.abs(ball.vy) < minVelocity) ball.vy = 0;
                
                // Update position
                ball.x += ball.vx;
                ball.y += ball.vy;
                
                // Check if moving
                if (ball.vx !== 0 || ball.vy !== 0) anyMoving = true;
                
                // Wall collisions
                if (ball.x - ball.radius < this.tableX || ball.x + ball.radius > this.tableX + this.tableWidth) {
                    ball.vx = -ball.vx * 0.8;
                    ball.x = Math.max(this.tableX + ball.radius, Math.min(this.tableX + this.tableWidth - ball.radius, ball.x));
                }
                if (ball.y - ball.radius < this.tableY || ball.y + ball.radius > this.tableY + this.tableHeight) {
                    ball.vy = -ball.vy * 0.8;
                    ball.y = Math.max(this.tableY + ball.radius, Math.min(this.tableY + this.tableHeight - ball.radius, ball.y));
                }
            });
            
            // Ball-to-ball collisions
            for (let i = 0; i < this.balls.length; i++) {
                for (let j = i + 1; j < this.balls.length; j++) {
                    const ball1 = this.balls[i];
                    const ball2 = this.balls[j];
                    
                    if (ball1.isPocketed || ball2.isPocketed) continue;
                    
                    const dx = ball2.x - ball1.x;
                    const dy = ball2.y - ball1.y;
                    const dist = Math.hypot(dx, dy);
                    
                    if (dist < ball1.radius + ball2.radius) {
                        // Collision detected
                        const nx = dx / dist;
                        const ny = dy / dist;
                        
                        // Relative velocity
                        const dvx = ball2.vx - ball1.vx;
                        const dvy = ball2.vy - ball1.vy;
                        const dvn = dvx * nx + dvy * ny;
                        
                        // Don't resolve if velocities are separating
                        if (dvn > 0) continue;
                        
                        // Collision impulse
                        const impulse = dvn;
                        
                        // Apply impulse
                        ball1.vx += impulse * nx;
                        ball1.vy += impulse * ny;
                        ball2.vx -= impulse * nx;
                        ball2.vy -= impulse * ny;
                        
                        // Separate balls
                        const overlap = ball1.radius + ball2.radius - dist;
                        const separateX = nx * overlap / 2;
                        const separateY = ny * overlap / 2;
                        ball1.x -= separateX;
                        ball1.y -= separateY;
                        ball2.x += separateX;
                        ball2.y += separateY;
                    }
                }
            }
            
            // Check pockets
            this.balls.forEach(ball => {
                if (ball.isPocketed) return;
                
                this.pockets.forEach(pocket => {
                    const dist = Math.hypot(ball.x - pocket.x, ball.y - pocket.y);
                    if (dist < pocket.radius) {
                        ball.isPocketed = true;
                        ball.visible = false;
                        
                        // Check game state
                        if (ball.number === 0) {
                            // Cue ball pocketed - respawn
                            this._respawnTimeout = setTimeout(() => {
                                this._respawnTimeout = null;
                                if (this._destroyed || this.isGameOver) return;
                                ball.x = this.tableX + this.tableWidth * 0.25;
                                ball.y = this.tableY + this.tableHeight / 2;
                                ball.vx = 0;
                                ball.vy = 0;
                                ball.isPocketed = false;
                                ball.visible = true;
                            }, 1000);
                        } else if (ball.number === 8) {
                            // 8-ball pocketed - game over
                            this.gameOver();
                        }
                    }
                });
            });
            
            this.ballsMoving = anyMoving;
            
            // Switch players when balls stop
            if (!this.ballsMoving && this.wasMoving) {
                this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
                if (this.parent && this.parent.updateInfo) {
                    this.parent.updateInfo();
                }
            }
            
            this.wasMoving = this.ballsMoving;
        }
        
        gameOver() {
            if (this.isGameOver) return;
            this.isGameOver = true;
            this.ballsMoving = false;
            // Simple game over - you can expand this
            const winner = this.currentPlayer === 1 ? T('PoolGame.youWin') : T('PoolGame.cpuWins');
            if (window.MinigameFun) this.currentPlayer === 1 ? window.MinigameFun.won('Billiards') : window.MinigameFun.lost('Billiards');
            const gameOverText = new PIXI.Text(winner, {
                fontFamily: 'Arial',
                fontSize: 48,
                fill: 0xFFFFFF,
                align: 'center',
                stroke: 0x000000,
                strokeThickness: 5
            });
            gameOverText.anchor.set(0.5);
            gameOverText.x = Graphics.width / 2;
            gameOverText.y = Graphics.height / 2;
            this.addChild(gameOverText);
        }
        
        destroy() {
            if (this._destroyed) return;
            this._destroyed = true;
            if (this._respawnTimeout) {
                clearTimeout(this._respawnTimeout);
                this._respawnTimeout = null;
            }
            if (this.ticker) {
                this.ticker.stop();
                this.ticker.destroy();
                this.ticker = null;
            }
            super.destroy();
        }
    }
    
    // Register the scene
    window.Scene_Pool = Scene_Pool;
})();