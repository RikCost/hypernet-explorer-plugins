//=============================================================================
// BookViewer.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Advanced Book Viewer v2.0 - Custom page flip animation with responsive design
 * @author Enhanced Edition
 * @url https://your-website.com
 *
 * @command openBook
 * @text Open Book
 * @desc Opens a book with custom flip animation
 *
 * @arg bookName
 * @text Book Name
 * @desc Name of the book file (without .json extension)
 * @type string
 * @default book1
 *
 * @help
 * ============================================================================
 * Advanced Book Viewer Plugin v2.0
 * ============================================================================
 * 
 * Features:
 * - Custom page flip animation without RPG Maker windows
 * - Responsive design for 16:9 aspect ratio
 * - Improved typography with better readability
 * - Realistic book appearance with shadows and textures
 * - Smooth animations and transitions
 * 
 * Controls:
 * - Left Arrow / Mouse Click Left Side: Previous page
 * - Right Arrow / Mouse Click Right Side: Next page
 * - Up Arrow / Down Arrow: Jump backward / forward 10 pages
 * - Page Up / Page Down (keyboard) or L1 / R1 (gamepad): Jump backward / forward 10 pages
 * - Shift (keyboard) or L2 (gamepad): Jump to the cover
 * - C (keyboard) or R2 (gamepad): Jump to the last page
 * - Escape / Right Click: Close book
 * - Mouse Wheel: Scroll pages
 *
 * Every book opens on a generated cover page (title and author, guessed from
 * the source text) before its actual content.
 */

(() => {
    'use strict';

    const pluginName = "BookViewer";

    // Font configuration for better readability
    const FONT_CONFIG = {
        family: 'Georgia, "Times New Roman", serif',
        size: { text: 22, title: 28, pageNumber: 16 },
        lineHeight: 1.6,
        color: {
            text: '#2c2416',
            title: '#1a1410',
            pageNumber: '#8b7355'
        }
    };

    // Book layout configuration
    const BOOK_CONFIG = {
        margin: { top: 80, bottom: 80, outer: 120, inner: 60 },
        padding: 40,
        spineWidth: 6,
        charsPerPage: 850
    };

    PluginManager.registerCommand(pluginName, "openBook", args => {
        const bookName = args.bookName;
        SceneManager.push(Scene_BookViewer);
        SceneManager.prepareNextScene(bookName);
    });

    //-----------------------------------------------------------------------------
    // BookManager - Enhanced with better text processing
    //-----------------------------------------------------------------------------
    
    class BookManager {
        static _bookProgress = {};
        static _bookCache = {};
        
        static loadBook(bookName) {
            if (this._bookCache[bookName]) {
                return this._bookCache[bookName];
            }

            const fs = require('fs');
            const path = require('path');
            const base = path.dirname(process.mainModule.filename);
            
            // Check for .md first, then .txt, then .json
            const extensions = ['.md', '.txt', '.json'];
            let bookPath = '';
            let ext = '';
            
            for (const e of extensions) {
                const p = path.join(base, 'books', `${bookName}${e}`);
                if (fs.existsSync(p)) {
                    bookPath = p;
                    ext = e;
                    break;
                }
            }
            
            if (!bookPath) {
                throw new Error(`Book file not found: ${bookName} (.md, .txt, or .json)`);
            }
            
            let data = fs.readFileSync(bookPath, 'utf8');
            // Remove BOM if present
            if (data.charCodeAt(0) === 0xFEFF) {
                data = data.slice(1);
            }
            
            let bookData;
            if (ext === '.json') {
                bookData = JSON.parse(data);
            } else {
                // For .md and .txt, wrap the text in an object with a 'text' property
                bookData = { text: data };
            }
            
            this._bookCache[bookName] = bookData;
            return bookData;
        }
        
        static getLastPage(bookName) {
            return this._bookProgress[bookName] || 0;
        }
        
        static setLastPage(bookName, page) {
            this._bookProgress[bookName] = page;
        }
        
        static splitIntoPages(text, charsPerPage) {
            const pages = [];
            const paragraphs = text.split(/\n\n+/);
            let currentPage = '';
            
            for (const paragraph of paragraphs) {
                const trimmedPara = paragraph.trim();
                if (!trimmedPara) continue;
                
                // Check if adding this paragraph would exceed page limit
                const testPage = currentPage + (currentPage ? '\n\n' : '') + trimmedPara;
                
                if (testPage.length > charsPerPage) {
                    // If current page has content, save it
                    if (currentPage) {
                        pages.push(currentPage);
                        currentPage = trimmedPara;
                    } else {
                        // Paragraph is too long for one page, split it
                        const words = trimmedPara.split(' ');
                        let tempPage = '';
                        
                        for (const word of words) {
                            const testWord = tempPage + (tempPage ? ' ' : '') + word;
                            if (testWord.length > charsPerPage) {
                                if (tempPage) {
                                    pages.push(tempPage);
                                    tempPage = word;
                                } else {
                                    pages.push(word);
                                    tempPage = '';
                                }
                            } else {
                                tempPage = testWord;
                            }
                        }
                        
                        currentPage = tempPage;
                    }
                } else {
                    currentPage = testPage;
                }
            }
            
            if (currentPage) {
                pages.push(currentPage);
            }
            
            // Ensure even number of pages
            if (pages.length % 2 === 1) {
                pages.push('');
            }

            return pages;
        }

        // Best-effort title/author guess so every book can show a cover,
        // even though the source text carries no metadata of its own.
        static parseCoverInfo(text, bookName) {
            const rawLines = text.split(/\r?\n/);
            let title = '';
            let titleIndex = -1;

            for (let i = 0; i < Math.min(rawLines.length, 60); i++) {
                const line = rawLines[i].trim();
                if (!line) continue;
                if (/^\*+/.test(line)) continue;
                if (/^(by|author)[:\s]/i.test(line)) continue;
                if (line.length < 3 || line.length > 60) continue;
                title = line;
                titleIndex = i;
                break;
            }

            let author = '';
            if (titleIndex >= 0) {
                const searchEnd = Math.min(rawLines.length, titleIndex + 20);
                for (let i = titleIndex + 1; i < searchEnd; i++) {
                    const line = rawLines[i].trim();
                    if (!line) continue;
                    const match = line.match(/^by\s+(.+)$/i);
                    if (match) {
                        author = match[1].trim();
                        break;
                    }
                    if (line.length > 60) break;
                }
            }

            if (!title) {
                title = bookName
                    .replace(/[_-]+/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase())
                    .trim() || bookName;
            }

            return { title, author };
        }
    }

    //-----------------------------------------------------------------------------
    // Scene_BookViewer - Custom scene without RPG Maker windows
    //-----------------------------------------------------------------------------

    class Scene_BookViewer extends Scene_Base {
        prepare(bookName) {
            this._bookName = bookName;
            this._config = BOOK_CONFIG;
            this._fontConfig = FONT_CONFIG.size;
        }
        
        create() {
            super.create();
            this.createBackground();
            this.loadBookData();
            this.createBookDisplay();
            this.createPageFlipLayer();
            this.setupEventHandlers();
            this.startOpeningAnimation();
        }
        
        loadBookData() {
            try {
                const bookData = BookManager.loadBook(this._bookName);
                const contentPages = BookManager.splitIntoPages(
                    bookData.text,
                    this._config.charsPerPage
                );
                const cover = BookManager.parseCoverInfo(bookData.text, this._bookName);

                // The cover always takes the first page slot; pad back to an
                // even count so the left/right pairing stays intact.
                this._pages = [{ cover: true, title: cover.title, author: cover.author }, ...contentPages];
                if (this._pages.length % 2 !== 0) {
                    this._pages.push('');
                }

                this._currentPageIndex = BookManager.getLastPage(this._bookName);
                this._totalPages = this._pages.length;
            } catch (e) {
                console.error(e);
                SceneManager.goto(Scene_Map);
            }
        }
        
        createBackground() {
            // Dark wooden desk background
            this._backgroundSprite = new Sprite();
            this._backgroundSprite.bitmap = new Bitmap(Graphics.width, Graphics.height);
            
            const bitmap = this._backgroundSprite.bitmap;
            const gradient = bitmap.context.createRadialGradient(
                Graphics.width / 2, Graphics.height / 2, 0,
                Graphics.width / 2, Graphics.height / 2, Graphics.width / 2
            );
            gradient.addColorStop(0, '#3d2f23');
            gradient.addColorStop(1, '#1a1410');
            
            bitmap.context.fillStyle = gradient;
            bitmap.context.fillRect(0, 0, Graphics.width, Graphics.height);
            
            // Add subtle texture
            for (let i = 0; i < 1000; i++) {
                const x = Math.random() * Graphics.width;
                const y = Math.random() * Graphics.height;
                const opacity = Math.random() * 0.03;
                bitmap.context.fillStyle = `rgba(255, 255, 255, ${opacity})`;
                bitmap.context.fillRect(x, y, 1, 1);
            }
            
            this.addChild(this._backgroundSprite);
        }
        
        createBookDisplay() {
            this._bookContainer = new Sprite();
            this._bookContainer.x = Graphics.width / 2;
            this._bookContainer.y = Graphics.height / 2;
            
            // Calculate book dimensions
            const bookWidth = Graphics.width - this._config.margin.outer * 2;
            const bookHeight = Graphics.height - this._config.margin.top - this._config.margin.bottom;
            
            // Create book shadow
            this._bookShadow = new Sprite();
            this._bookShadow.bitmap = new Bitmap(bookWidth + 40, bookHeight + 40);
            this._bookShadow.bitmap.fillRect(0, 0, bookWidth + 40, bookHeight + 40, 'rgba(0, 0, 0, 0.3)');
            this._bookShadow.anchor.x = 0.5;
            this._bookShadow.anchor.y = 0.5;
            this._bookShadow.filters = [new PIXI.filters.BlurFilter(10)];
            this._bookContainer.addChild(this._bookShadow);
            
            // Create book background
            this._bookBackground = new Sprite();
            this._bookBackground.bitmap = new Bitmap(bookWidth, bookHeight);
            this._bookBackground.anchor.x = 0.5;
            this._bookBackground.anchor.y = 0.5;
            
            // Draw book pages with gradient
            const bgBitmap = this._bookBackground.bitmap;
            const bgCtx = bgBitmap.context;
            
            // Left page
            const leftGradient = bgCtx.createLinearGradient(
                -bookWidth/2, 0, 0, 0
            );
            leftGradient.addColorStop(0, '#f9f4e8');
            leftGradient.addColorStop(1, '#f0e8d8');
            bgCtx.fillStyle = leftGradient;
            bgCtx.fillRect(0, 0, bookWidth/2, bookHeight);
            
            // Right page
            const rightGradient = bgCtx.createLinearGradient(
                bookWidth/2, 0, bookWidth, 0
            );
            rightGradient.addColorStop(0, '#f0e8d8');
            rightGradient.addColorStop(1, '#f9f4e8');
            bgCtx.fillStyle = rightGradient;
            bgCtx.fillRect(bookWidth/2, 0, bookWidth/2, bookHeight);
            
            // Draw spine
            bgCtx.fillStyle = '#3d2817';
            bgCtx.fillRect(bookWidth/2 - this._config.spineWidth/2, 0, 
                          this._config.spineWidth, bookHeight);
            
            // Add spine shadow
            const spineGradient = bgCtx.createLinearGradient(
                bookWidth/2 - 30, 0, bookWidth/2 + 30, 0
            );
            spineGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            spineGradient.addColorStop(0.4, 'rgba(0, 0, 0, 0.15)');
            spineGradient.addColorStop(0.5, 'rgba(0, 0, 0, 0.25)');
            spineGradient.addColorStop(0.6, 'rgba(0, 0, 0, 0.15)');
            spineGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            bgCtx.fillStyle = spineGradient;
            bgCtx.fillRect(bookWidth/2 - 30, 0, 60, bookHeight);
            
            this._bookContainer.addChild(this._bookBackground);
            
            // Create text containers for pages
            this._leftPageText = new Sprite();
            this._leftPageText.bitmap = new Bitmap(bookWidth/2 - this._config.padding, 
                                                   bookHeight - this._config.padding * 2);
            this._leftPageText.anchor.x = 1;
            this._leftPageText.anchor.y = 0.5;
            this._leftPageText.x = -this._config.spineWidth/2 - 10;
            this._bookContainer.addChild(this._leftPageText);
            
            this._rightPageText = new Sprite();
            this._rightPageText.bitmap = new Bitmap(bookWidth/2 - this._config.padding, 
                                                    bookHeight - this._config.padding * 2);
            this._rightPageText.anchor.x = 0;
            this._rightPageText.anchor.y = 0.5;
            this._rightPageText.x = this._config.spineWidth/2 + 10;
            this._bookContainer.addChild(this._rightPageText);

            // Soft shadow cast by the flipping page onto the page it is
            // uncovering, brightest at the spine and strongest mid-flip.
            this._flipShadow = new Sprite();
            this._flipShadow.bitmap = new Bitmap(160, bookHeight);
            const shadowCtx = this._flipShadow.bitmap.context;
            const shadowGradient = shadowCtx.createLinearGradient(0, 0, 160, 0);
            shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0.35)');
            shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            shadowCtx.fillStyle = shadowGradient;
            shadowCtx.fillRect(0, 0, 160, bookHeight);
            this._flipShadow.anchor.x = 0;
            this._flipShadow.anchor.y = 0.5;
            this._flipShadow.x = 0;
            this._flipShadow.visible = false;
            this._bookContainer.addChild(this._flipShadow);

            this.addChild(this._bookContainer);
            
            // Initial opacity for animation
            this._bookContainer.opacity = 0;
        }
        
        createPageFlipLayer() {
            this._flipContainer = new Sprite();
            this._flipContainer.x = Graphics.width / 2;
            this._flipContainer.y = Graphics.height / 2;
            
            // Create flip page sprite
            const bookWidth = Graphics.width - this._config.margin.outer * 2;
            const bookHeight = Graphics.height - this._config.margin.top - this._config.margin.bottom;
            
            this._flipPage = new Sprite();
            this._flipPage.bitmap = new Bitmap(bookWidth/2, bookHeight);
            this._flipPage.anchor.y = 0.5;
            this._flipPage.visible = false;
            
            this._flipPageBack = new Sprite();
            this._flipPageBack.bitmap = new Bitmap(bookWidth/2, bookHeight);
            this._flipPageBack.anchor.y = 0.5;
            this._flipPageBack.visible = false;
            
            this._flipContainer.addChild(this._flipPageBack);
            this._flipContainer.addChild(this._flipPage);
            
            this.addChild(this._flipContainer);
            
            // Animation properties
            this._flipAnimation = {
                active: false,
                progress: 0,
                duration: 20,
                direction: 1, // 1 for forward, -1 for backward
                startPage: 0,
                endPage: 0
            };
        }
        
        setupEventHandlers() {
            // Mouse support
            this._mouseHandler = this.handleMouse.bind(this);
            this._wheelHandler = this.handleWheel.bind(this);
            document.addEventListener('click', this._mouseHandler);
            document.addEventListener('wheel', this._wheelHandler);
        }
        
        handleMouse(event) {
            if (this._flipAnimation.active || this._isClosing) return;
            
            const x = Graphics.pageToCanvasX(event.pageX);
            const centerX = Graphics.width / 2;
            
            if (x < centerX) {
                this.previousPage();
            } else {
                this.nextPage();
            }
        }
        
        handleWheel(event) {
            if (this._flipAnimation.active || this._isClosing) return;
            
            if (event.deltaY > 0) {
                this.nextPage();
            } else {
                this.previousPage();
            }
            event.preventDefault();
        }
        
        startOpeningAnimation() {
            this._openingAnimation = {
                active: true,
                progress: 0,
                duration: 30
            };
        }
        
        update() {
            super.update();
            
            if (this._openingAnimation && this._openingAnimation.active) {
                this.updateOpeningAnimation();
            } else if (this._closingAnimation && this._closingAnimation.active) {
                this.updateClosingAnimation();
            } else if (this._flipAnimation.active) {
                this.updateFlipAnimation();
            } else {
                this.updateInput();
            }
        }
        
        updateOpeningAnimation() {
            const anim = this._openingAnimation;
            anim.progress++;
            
            const t = anim.progress / anim.duration;
            const eased = this.easeOutCubic(t);
            
            this._bookContainer.opacity = eased * 255;
            this._bookContainer.scale.x = 0.8 + eased * 0.2;
            this._bookContainer.scale.y = 0.8 + eased * 0.2;
            
            if (anim.progress >= anim.duration) {
                anim.active = false;
                this._bookContainer.scale.x = 1;
                this._bookContainer.scale.y = 1;
                this.drawCurrentPages();
            }
        }
        
        updateClosingAnimation() {
            const anim = this._closingAnimation;
            anim.progress++;
            
            const t = anim.progress / anim.duration;
            const eased = this.easeInCubic(t);
            
            this._bookContainer.opacity = 255 * (1 - eased);
            this._bookContainer.scale.x = 1 - eased * 0.2;
            this._bookContainer.scale.y = 1 - eased * 0.2;
            
            if (anim.progress >= anim.duration) {
                BookManager.setLastPage(this._bookName, this._currentPageIndex);
                SceneManager.pop();
            }
        }
        
        updateFlipAnimation() {
            // Safety check: ensure flip sprites exist
            if (!this._flipPage || !this._flipPageBack) {
                console.warn('BookViewer: Flip sprites missing during animation, aborting');
                this._flipAnimation.active = false;
                return;
            }

            const anim = this._flipAnimation;
            anim.progress++;

            const rawT = anim.progress / anim.duration;
            const t = this.easeInOutQuad(rawT);
            const angle = t * Math.PI;

            // Calculate flip position and scale
            const flipX = Math.cos(angle);
            const scaleX = Math.abs(flipX);
            // Slight vertical bulge simulates the page curling as it turns.
            const curl = 1 - 0.05 * Math.sin(angle);

            this._flipPage.scale.y = curl;
            this._flipPageBack.scale.y = curl;

            if (anim.direction > 0) {
                // Flipping forward (right to left)
                this._flipPage.scale.x = scaleX;
                this._flipPage.x = flipX * (Graphics.width - this._config.margin.outer * 2) / 4;

                // Show back of page when past 90 degrees
                if (t > 0.5) {
                    this._flipPage.visible = false;
                    this._flipPageBack.visible = true;
                    this._flipPageBack.scale.x = scaleX;
                    this._flipPageBack.x = flipX * (Graphics.width - this._config.margin.outer * 2) / 4;
                }
            } else {
                // Flipping backward (left to right)
                this._flipPage.scale.x = -scaleX;
                this._flipPage.x = -flipX * (Graphics.width - this._config.margin.outer * 2) / 4;

                if (t > 0.5) {
                    this._flipPage.visible = false;
                    this._flipPageBack.visible = true;
                    this._flipPageBack.scale.x = -scaleX;
                    this._flipPageBack.x = -flipX * (Graphics.width - this._config.margin.outer * 2) / 4;
                }
            }

            // Add shadow effect
            const shadowOpacity = 1 - Math.abs(flipX);
            this._flipPage.opacity = 255 - shadowOpacity * 50;
            this._flipPageBack.opacity = 255 - shadowOpacity * 50;

            // Cast the spine shadow onto the page being uncovered, peaking
            // when the flipping page is edge-on (angle = 90deg).
            if (this._flipShadow) {
                const shadowStrength = Math.sin(angle);
                this._flipShadow.visible = shadowStrength > 0.02;
                this._flipShadow.opacity = 220 * shadowStrength;
                this._flipShadow.scale.x = (anim.direction > 0 ? 1 : -1) * (0.3 + 0.7 * shadowStrength);
            }

            if (anim.progress >= anim.duration) {
                anim.active = false;
                this._flipPage.visible = false;
                this._flipPageBack.visible = false;
                this._flipPage.scale.y = 1;
                this._flipPageBack.scale.y = 1;
                if (this._flipShadow) this._flipShadow.visible = false;
                this._currentPageIndex = anim.endPage;
                this.drawCurrentPages();

                // Play sound effect
                AudioManager.playSe({ name: 'Book1', volume: 50, pitch: 100, pan: 0 });
            }
        }
        
        updateInput() {
            // 'run' and 'kick' are the L2/R2 (LT/RT) action slots in this
            // game's gamepad map, reused here as jump-to-cover / jump-to-end.
            if (Input.isTriggered('cancel') || TouchInput.isTriggered() && TouchInput.isLongPressed()) {
                this.onCancel();
            } else if (Input.isTriggered('run')) {
                this.goToStart();
            } else if (Input.isTriggered('kick')) {
                this.goToEnd();
            } else if (Input.isRepeated('pagedown')) {
                // R1 on a gamepad, Page Down on keyboard
                this.jumpForward();
            } else if (Input.isRepeated('pageup')) {
                // L1 on a gamepad, Page Up on keyboard
                this.jumpBackward();
            } else if (Input.isRepeated('down')) {
                this.jumpForward();
            } else if (Input.isRepeated('up')) {
                this.jumpBackward();
            } else if (Input.isRepeated('right')) {
                this.nextPage();
            } else if (Input.isRepeated('left')) {
                this.previousPage();
            }
        }
        
        drawCurrentPages() {
            // Safety check: ensure page text sprites exist
            if (!this._leftPageText || !this._rightPageText ||
                !this._leftPageText.bitmap || !this._rightPageText.bitmap) {
                console.warn('BookViewer: Page text sprites not initialized');
                return;
            }

            this.drawPage(this._leftPageText.bitmap, this._pages[this._currentPageIndex] || '', true);
            this.drawPage(this._rightPageText.bitmap, this._pages[this._currentPageIndex + 1] || '', false);

            this.drawPageNumbers();
        }
        
        drawPage(bitmap, page, isLeft) {
            bitmap.clear();

            if (!page) return;

            if (typeof page === 'object' && page.cover) {
                this.drawCoverPage(bitmap, page.title, page.author);
                return;
            }

            const text = page;

            // Set font
            bitmap.fontFace = FONT_CONFIG.family;
            bitmap.fontSize = this._fontConfig.text;
            bitmap.textColor = FONT_CONFIG.color.text;

            const lines = this.wrapText(text, bitmap.width - 20);
            const lineHeight = this._fontConfig.text * FONT_CONFIG.lineHeight;

            for (let i = 0; i < lines.length; i++) {
                const y = 10 + i * lineHeight;
                if (y + lineHeight > bitmap.height) break;

                bitmap.drawText(lines[i], 10, y, bitmap.width - 20, lineHeight, isLeft ? 'left' : 'left');
            }
        }

        drawCoverPage(bitmap, title, author) {
            const w = bitmap.width;
            const h = bitmap.height;
            const ctx = bitmap.context;

            // Decorative double border
            const inset = 14;
            ctx.strokeStyle = 'rgba(61, 40, 23, 0.55)';
            ctx.lineWidth = 2;
            ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);
            ctx.lineWidth = 1;
            ctx.strokeRect(inset + 6, inset + 6, w - (inset + 6) * 2, h - (inset + 6) * 2);

            bitmap.fontFace = FONT_CONFIG.family;
            bitmap.fontSize = this._fontConfig.title;
            bitmap.textColor = FONT_CONFIG.color.title;

            const titleLines = this.wrapText(title || '', w - 80);
            const lineHeight = this._fontConfig.title * FONT_CONFIG.lineHeight;
            const blockHeight = titleLines.length * lineHeight;
            let y = h / 2 - blockHeight / 2 - (author ? 30 : 0);

            for (const line of titleLines) {
                bitmap.drawText(line, 20, y, w - 40, lineHeight, 'center');
                y += lineHeight;
            }

            // Flourish beneath the title
            ctx.strokeStyle = 'rgba(139, 115, 85, 0.6)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(w / 2 - 40, y + 8);
            ctx.lineTo(w / 2 + 40, y + 8);
            ctx.stroke();

            if (author) {
                bitmap.fontSize = this._fontConfig.pageNumber + 4;
                bitmap.textColor = FONT_CONFIG.color.pageNumber;
                bitmap.drawText(author, 20, y + 20, w - 40, 30, 'center');
            }
        }

        drawPageNumbers() {
            const leftPage = this._pages[this._currentPageIndex];
            const rightPage = this._pages[this._currentPageIndex + 1];
            const leftNum = this._currentPageIndex + 1;
            const rightNum = this._currentPageIndex + 2;

            // Clear previous numbers area
            const numY = this._leftPageText.bitmap.height - 30;

            // Left page number (covers do not show a page number)
            if (leftNum <= this._totalPages && !(leftPage && leftPage.cover)) {
                this._leftPageText.bitmap.fontSize = this._fontConfig.pageNumber;
                this._leftPageText.bitmap.textColor = FONT_CONFIG.color.pageNumber;
                this._leftPageText.bitmap.drawText(
                    leftNum.toString(),
                    10,
                    numY,
                    this._leftPageText.bitmap.width - 20,
                    30,
                    'center'
                );
            }
            
            // Right page number
            if (rightNum <= this._totalPages && !(rightPage && rightPage.cover)) {
                this._rightPageText.bitmap.fontSize = this._fontConfig.pageNumber;
                this._rightPageText.bitmap.textColor = FONT_CONFIG.color.pageNumber;
                this._rightPageText.bitmap.drawText(
                    rightNum.toString(),
                    10,
                    numY,
                    this._rightPageText.bitmap.width - 20,
                    30,
                    'center'
                );
            }
        }
        
        wrapText(text, maxWidth) {
            const words = text.split(' ');
            const lines = [];
            let currentLine = '';
            
            const testBitmap = new Bitmap(1, 1);
            testBitmap.fontFace = FONT_CONFIG.family;
            testBitmap.fontSize = this._fontConfig.text;
            
            for (const word of words) {
                // Handle line breaks in text
                if (word.includes('\n')) {
                    const parts = word.split('\n');
                    for (let i = 0; i < parts.length; i++) {
                        if (i === 0) {
                            const testLine = currentLine + (currentLine ? ' ' : '') + parts[i];
                            const testWidth = testBitmap.measureTextWidth(testLine);
                            
                            if (testWidth > maxWidth && currentLine) {
                                lines.push(currentLine);
                                currentLine = parts[i];
                            } else {
                                currentLine = testLine;
                            }
                        } else {
                            if (currentLine) {
                                lines.push(currentLine);
                            }
                            currentLine = parts[i];
                        }
                    }
                } else {
                    const testLine = currentLine + (currentLine ? ' ' : '') + word;
                    const testWidth = testBitmap.measureTextWidth(testLine);
                    
                    if (testWidth > maxWidth && currentLine) {
                        lines.push(currentLine);
                        currentLine = word;
                    } else {
                        currentLine = testLine;
                    }
                }
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
            
            return lines;
        }
        
        nextPage() {
            if (this._flipAnimation.active || this._currentPageIndex >= this._totalPages - 2) return;
            
            this.startFlipAnimation(1);
        }
        
        previousPage() {
            if (this._flipAnimation.active || this._currentPageIndex <= 0) return;

            this.startFlipAnimation(-1);
        }

        jumpForward() {
            if (this._flipAnimation.active) return;

            // Calculate target page (skip 10 pages)
            let targetPage = this._currentPageIndex + 10;

            // Ensure target is even (pages are shown in pairs)
            if (targetPage % 2 !== 0) {
                targetPage--;
            }

            // Apply upper limit check
            if (targetPage >= this._totalPages - 1) {
                targetPage = this._totalPages - 2;
            }

            // Don't move if we're already at or past the target
            if (targetPage <= this._currentPageIndex) return;

            this.startFlipAnimation(1, targetPage, 14);
        }

        jumpBackward() {
            if (this._flipAnimation.active) return;

            // Calculate target page (skip back 10 pages)
            let targetPage = this._currentPageIndex - 10;

            // Ensure target is even (pages are shown in pairs)
            if (targetPage % 2 !== 0) {
                targetPage++;
            }

            // Apply lower limit check
            if (targetPage < 0) {
                targetPage = 0;
            }

            // Don't move if we're already at or before the target
            if (targetPage >= this._currentPageIndex) return;

            this.startFlipAnimation(-1, targetPage, 14);
        }

        goToStart() {
            if (this._flipAnimation.active || this._currentPageIndex <= 0) return;
            this.startFlipAnimation(-1, 0, 18);
        }

        goToEnd() {
            if (this._flipAnimation.active) return;
            const lastPage = this._totalPages - 2;
            if (this._currentPageIndex >= lastPage) return;
            this.startFlipAnimation(1, lastPage, 18);
        }

        startFlipAnimation(direction, endPage, duration = 20) {
            // Safety check: ensure flip sprites are properly initialized
            if (!this._flipPage || !this._flipPageBack ||
                !this._flipPage.anchor || !this._flipPageBack.anchor) {
                console.warn('BookViewer: Flip sprites not properly initialized, recreating...');
                this.createPageFlipLayer();
                // If still not initialized, skip animation and just change pages
                if (!this._flipPage || !this._flipPageBack ||
                    !this._flipPage.anchor || !this._flipPageBack.anchor) {
                    console.error('BookViewer: Failed to initialize flip sprites, skipping animation');
                    this._currentPageIndex += (direction > 0 ? 2 : -2);
                    this.drawCurrentPages();
                    return;
                }
            }

            const anim = this._flipAnimation;
            anim.active = true;
            anim.progress = 0;
            anim.duration = duration;
            anim.direction = direction;
            anim.startPage = this._currentPageIndex;
            anim.endPage = (endPage !== undefined && endPage !== null)
                ? endPage
                : this._currentPageIndex + (direction > 0 ? 2 : -2);

            // Prepare flip page content
            if (direction > 0) {
                // Forward flip - show right page flipping
                this.drawPage(this._flipPage.bitmap, this._pages[this._currentPageIndex + 1] || '', false);
                this.drawPage(this._flipPageBack.bitmap, this._pages[anim.endPage] || '', true);
            } else {
                // Backward flip - show left page flipping
                this.drawPage(this._flipPage.bitmap, this._pages[this._currentPageIndex] || '', true);
                this.drawPage(this._flipPageBack.bitmap, this._pages[anim.endPage + 1] || '', false);
            }

            this._flipPage.visible = true;
            this._flipPageBack.visible = false;

            // Set anchor points for flip
            if (direction > 0) {
                this._flipPage.anchor.x = 0;
                this._flipPageBack.anchor.x = 1;
            } else {
                this._flipPage.anchor.x = 1;
                this._flipPageBack.anchor.x = 0;
            }
        }
        
        onCancel() {
            if (this._closingAnimation) return;
            
            this._closingAnimation = {
                active: true,
                progress: 0,
                duration: 20
            };
            
            AudioManager.playSe({ name: 'Cancel2', volume: 50, pitch: 100, pan: 0 });
        }
        
        // Easing functions
        easeOutCubic(t) {
            return 1 - Math.pow(1 - t, 3);
        }
        
        easeInCubic(t) {
            return t * t * t;
        }

        easeInOutQuad(t) {
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        }

        terminate() {
            super.terminate();
            // Clean up event listeners
            if (this._mouseHandler) {
                document.removeEventListener('click', this._mouseHandler);
            }
            if (this._wheelHandler) {
                document.removeEventListener('wheel', this._wheelHandler);
            }

            // Clean up sprites to prevent interference with other scenes
            if (this._flipPage) {
                this._flipPage.destroy();
                this._flipPage = null;
            }
            if (this._flipPageBack) {
                this._flipPageBack.destroy();
                this._flipPageBack = null;
            }
            if (this._bookContainer) {
                this._bookContainer.destroy({ children: true });
                this._bookContainer = null;
                this._flipShadow = null;
            }
            if (this._flipContainer) {
                this._flipContainer.destroy({ children: true });
                this._flipContainer = null;
            }
            if (this._backgroundSprite) {
                this._backgroundSprite.destroy();
                this._backgroundSprite = null;
            }
        }
    }

    // Export classes
    window.Scene_BookViewer = Scene_BookViewer;
    window.BookManager = BookManager;

})();