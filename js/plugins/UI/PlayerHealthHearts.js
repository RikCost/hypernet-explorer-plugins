//=============================================================================
// Player Health Hearts Display (Enhanced)
// Version: 1.1.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Player Health Hearts Display v1.1.0
 * @author Omni-Lex
 * @version 1.1.0
 * @description Shows player health as hearts with smooth animations and effects
 * 
 * @param displayDuration
 * @text Display Duration
 * @desc How long to show hearts (in frames, 60 = 1 second)
 * @type number
 * @min 60
 * @max 600
 * @default 240
 * 
 * @param heartEmpty
 * @text Empty Heart Symbol
 * @desc Symbol for empty heart
 * @type string
 * @default ♡
 * 
 * @param heartFull
 * @text Full Heart Symbol
 * @desc Symbol for full heart
 * @type string
 * @default ♥
 * 
 * @param fontSize
 * @text Font Size
 * @desc Size of heart symbols
 * @type number
 * @min 16
 * @max 48
 * @default 28
 * 
 * @param animationSpeed
 * @text Animation Speed
 * @desc Speed of heart loss/gain animations (higher = faster)
 * @type number
 * @min 1
 * @max 10
 * @default 4
 * 
 * @help PlayerHealthHearts.js
 * 
 * Enhanced version with smooth animations:
 * - Hearts fade in/out when lost or gained
 * - Smooth scaling animations
 * - Outline effects for better visibility
 * - Bounce effect when taking damage
 * - Glow effect when healing
 */

(() => {
    'use strict';
    
    const pluginName = 'PlayerHealthHearts';
    const parameters = PluginManager.parameters(pluginName);
    
    const displayDuration = parseInt(parameters['displayDuration']) || 240;
    const heartEmpty = parameters['heartEmpty'] || '♡';
    const heartFull = parameters['heartFull'] || '♥';
    const fontSize = parseInt(parameters['fontSize']) || 28;
    const animationSpeed = parseInt(parameters['animationSpeed']) || 4;
    
    let healthDisplay = null;
    let displayTimer = 0;
    let lastKnownHp = 0;
    let isMapScene = false;
    let heartStates = []; // Track individual heart states for animation
    let damageShake = 0;
    let healGlow = 0;
    let playerFlashTimer = 0;
    let playerFlashIntensity = 0;
    let floorDamageActive = false;
    let floorDamageCooldown = 0;
    
    // Heart state object
    function HeartState(index) {
        this.index = index;
        this.visible = true;
        this.scale = 1.0;
        this.opacity = 255;
        this.targetScale = 1.0;
        this.targetOpacity = 255;
        this.animationTimer = 0;
        this.type = 'full'; // 'full', 'empty', or 'lost'
    }
    
    // Create enhanced health display window
    function Window_HealthHearts() {
        this.initialize(...arguments);
    }
    
    Window_HealthHearts.prototype = Object.create(Window_Base.prototype);
    Window_HealthHearts.prototype.constructor = Window_HealthHearts;
    
    Window_HealthHearts.prototype.initialize = function() {
        const rect = new Rectangle(10, 10, 250, 80);
        Window_Base.prototype.initialize.call(this, rect);
        this.opacity = 0;
        this.contentsOpacity = 255;
        this.visible = false;
        this.padding = 8;
        
        // Initialize heart states
        heartStates = [];
        for (let i = 0; i < 5; i++) {
            heartStates.push(new HeartState(i));
        }
    };
    
    Window_HealthHearts.prototype.refresh = function() {
        const actor = $gameParty.leader();
        if (!actor) return;

        const hpRate = actor.hp / actor.mhp;
        const targetHearts = this.calculateHearts(hpRate);

        // Update heart states based on current health
        this.updateHeartStates(targetHearts);

        // Cache the rendered hearts: the outline draw is ~125 drawText calls, so
        // skip the full re-render when the visible state hasn't changed. Shake and
        // glow vary every frame (random jitter / pulsing), so those force a redraw.
        const needsForcedRedraw = damageShake > 0 || healGlow > 0;
        let sig = "";
        for (let i = 0; i < heartStates.length; i++) {
            const h = heartStates[i];
            sig += h.type + Math.round(h.scale * 20) + ":" + Math.round(h.opacity) + "|";
        }
        if (!needsForcedRedraw && sig === this._lastRenderSig) {
            return; // nothing visibly changed since last render
        }
        this._lastRenderSig = needsForcedRedraw ? null : sig;

        this.contents.clear();
        // Draw hearts with individual animations
        this.drawAnimatedHearts();
    };
    
    Window_HealthHearts.prototype.calculateHearts = function(hpRate) {
        if (hpRate >= 0.9) return 5;
        if (hpRate >= 0.7) return 4;
        if (hpRate >= 0.5) return 3;
        if (hpRate >= 0.3) return 2;
        if (hpRate >= 0.1) return 1;
        return 0;
    };
    
    Window_HealthHearts.prototype.updateHeartStates = function(targetHearts) {
        for (let i = 0; i < 5; i++) {
            const heart = heartStates[i];
            const shouldBeFull = i < targetHearts;
            
            if (shouldBeFull && heart.type !== 'full') {
                // Heart should be gained
                heart.type = 'full';
                heart.targetScale = 1.2;
                heart.targetOpacity = 255;
                heart.animationTimer = 30;
                healGlow = Math.max(healGlow, 30);
            } else if (!shouldBeFull && heart.type === 'full') {
                // Heart should be lost
                heart.type = 'lost';
                heart.targetScale = 0.3;
                heart.targetOpacity = 0;
                heart.animationTimer = 45;
                damageShake = Math.max(damageShake, 20);
            } else if (!shouldBeFull && heart.type !== 'empty' && heart.type !== 'lost') {
                // Heart should be empty
                heart.type = 'empty';
                heart.targetScale = 0.9;
                heart.targetOpacity = 180;
            }
        }
    };
    
    Window_HealthHearts.prototype.updateAnimations = function() {
        let hasActiveAnimations = false;
        
        for (let i = 0; i < heartStates.length; i++) {
            const heart = heartStates[i];
            
            if (heart.animationTimer > 0) {
                heart.animationTimer--;
                hasActiveAnimations = true;
                
                // Smooth interpolation
                const progress = 1 - (heart.animationTimer / 45);
                const easeProgress = this.easeOutBounce(progress);
                
                heart.scale = this.lerp(heart.scale, heart.targetScale, 0.15);
                heart.opacity = this.lerp(heart.opacity, heart.targetOpacity, 0.12);
                
                // Special effects during animation
                if (heart.type === 'lost' && heart.animationTimer > 20) {
                    // Add some bounce before disappearing
                    heart.scale = heart.targetScale + Math.sin(heart.animationTimer * 0.5) * 0.1;
                }
            } else {
                // Smooth return to normal state
                heart.scale = this.lerp(heart.scale, heart.targetScale, 0.1);
                heart.opacity = this.lerp(heart.opacity, heart.targetOpacity, 0.1);
                
                // Set final target values for stable states
                if (heart.type === 'full') {
                    heart.targetScale = 1.0;
                } else if (heart.type === 'empty') {
                    heart.targetScale = 0.9;
                    heart.targetOpacity = 180;
                }
            }
        }
        
        // Update screen effects
        if (damageShake > 0) {
            damageShake--;
        }
        if (healGlow > 0) {
            healGlow--;
        }
        
        // Update floor damage flash effect
        if (floorDamageActive) {
            // Keep red intensity high while taking damage
            playerFlashIntensity = 0.7 + Math.sin(Date.now() * 0.01) * 0.2; // Subtle pulsing
            floorDamageCooldown = 60; // Reset cooldown when active
        } else if (floorDamageCooldown > 0) {
            // Fade out gradually after stopping floor damage
            floorDamageCooldown--;
            playerFlashIntensity = Math.max(0, (floorDamageCooldown / 60) * 0.7);
        } else {
            playerFlashIntensity = 0;
        }
        
        // Reset floor damage active flag (will be set again if still on damaging floor)
        floorDamageActive = false;
        
        return hasActiveAnimations;
    };
    
    // Pre-rendered heart glyph cache: during shake/glow the HUD redraws every
    // frame and the 8-direction outline loop alone is ~125 drawText calls. Each
    // glyph variant is rasterized once into an offscreen bitmap and blitted with
    // the per-frame shake offsets instead. A glyph is split into three layers so
    // the per-frame alphas (heart opacity, glow fade) can be applied at blit time
    // via paintOpacity without changing the original compositing:
    //   'outline' - the opaque black 8-direction offset draws
    //   'stroke'  - drawText's built-in outline stroke (fixed alpha in the original)
    //   'fill'    - the glyph fill at full color, faded by paintOpacity when blitted
    const heartGlyphCache = new Map();

    Window_HealthHearts.prototype._heartGlyph = function(mode, symbol, glyphFontSize, maxWidth, color) {
        const key = mode + '|' + symbol + '|' + glyphFontSize + '|' + maxWidth + '|' + (color || '');
        let bmp = heartGlyphCache.get(key);
        if (bmp) return bmp;
        if (heartGlyphCache.size >= 400) {
            // Cap: drop everything; variants are cheap to rebuild on demand.
            for (const cached of heartGlyphCache.values()) cached.destroy();
            heartGlyphCache.clear();
        }
        const contents = this.contents;
        const lineHeight = this.lineHeight();
        const outlineSize = Math.max(1, Math.floor(glyphFontSize / 14));
        const pad = (mode === 'outline' ? outlineSize : 0) + 8;
        bmp = new Bitmap(maxWidth + pad * 2, lineHeight + pad * 2);
        bmp.fontFace = contents.fontFace;
        bmp.fontBold = contents.fontBold;
        bmp.fontItalic = contents.fontItalic;
        bmp.fontSize = glyphFontSize;
        bmp.outlineWidth = contents.outlineWidth;
        bmp.outlineColor = mode === 'fill' ? 'rgba(0, 0, 0, 0)' : contents.outlineColor;
        bmp.textColor = mode === 'stroke' ? 'rgba(0, 0, 0, 0)' : color;
        if (mode === 'outline') {
            for (let ox = -outlineSize; ox <= outlineSize; ox++) {
                for (let oy = -outlineSize; oy <= outlineSize; oy++) {
                    if (ox !== 0 || oy !== 0) {
                        bmp.drawText(symbol, pad + ox, pad + oy, maxWidth, lineHeight, 'left');
                    }
                }
            }
        } else {
            bmp.drawText(symbol, pad, pad, maxWidth, lineHeight, 'left');
        }
        bmp._phhPad = pad;
        heartGlyphCache.set(key, bmp);
        return bmp;
    };

    Window_HealthHearts.prototype._bltHeartGlyph = function(bmp, x, y, opacity) {
        const contents = this.contents;
        contents.paintOpacity = opacity;
        contents.blt(bmp, 0, 0, bmp.width, bmp.height, x - bmp._phhPad, y - bmp._phhPad);
        contents.paintOpacity = 255;
    };

    Window_HealthHearts.prototype.drawAnimatedHearts = function() {
        const heartSpacing = 32;
        const baseY = 10;

        // Apply screen shake for damage
        const shakeX = damageShake > 0 ? (Math.random() - 0.5) * (damageShake * 0.3) : 0;
        const shakeY = damageShake > 0 ? (Math.random() - 0.5) * (damageShake * 0.2) : 0;

        for (let i = 0; i < heartStates.length; i++) {
            const heart = heartStates[i];
            const baseX = 10 + (i * heartSpacing);
            const x = baseX + shakeX;
            const y = baseY + shakeY;

            // Skip completely invisible hearts
            if (heart.opacity <= 10) continue;

            // Calculate scaled font size
            const scaledFontSize = Math.floor(fontSize * heart.scale);
            if (scaledFontSize <= 0) continue;

            // Calculate position offset for scaling effect (center the scaling)
            const scaleOffsetX = (fontSize - scaledFontSize) / 2;
            const scaleOffsetY = (fontSize - scaledFontSize) / 2;
            const finalX = x + scaleOffsetX;
            const finalY = y + scaleOffsetY;

            // Determine heart symbol and color
            const symbol = heart.type === 'full' ? heartFull : heartEmpty;
            const maxWidth = scaledFontSize + 10;
            let heartRgb;

            if (heart.type === 'full') {
                heartRgb = 'rgb(255, 100, 100)';

                // Add glow effect when healing (larger, lighter heart behind)
                if (healGlow > 0) {
                    const glowIntensity = healGlow / 30;
                    const glowSize = scaledFontSize + 4;
                    this._bltHeartGlyph(this._heartGlyph('stroke', symbol, glowSize, maxWidth),
                        finalX - 2, finalY - 2, 255);
                    this._bltHeartGlyph(this._heartGlyph('fill', symbol, glowSize, maxWidth, 'rgb(150, 255, 150)'),
                        finalX - 2, finalY - 2, glowIntensity * heart.opacity * 0.6);
                }
            } else if (heart.type === 'empty') {
                heartRgb = 'rgb(200, 200, 200)';
            } else {
                heartRgb = 'rgb(150, 150, 150)';
            }

            // Outline in 8 directions (pre-rendered), then the main heart:
            // built-in stroke at full strength, fill faded by heart opacity.
            this._bltHeartGlyph(this._heartGlyph('outline', symbol, scaledFontSize, maxWidth, '#000000'),
                finalX, finalY, 255);
            this._bltHeartGlyph(this._heartGlyph('stroke', symbol, scaledFontSize, maxWidth),
                finalX, finalY, 255);
            this._bltHeartGlyph(this._heartGlyph('fill', symbol, scaledFontSize, maxWidth, heartRgb),
                finalX, finalY, heart.opacity);
        }

        // Reset font settings to default
        this.resetFontSettings();
    };
    
    // Utility functions for smooth animations
    Window_HealthHearts.prototype.lerp = function(start, end, factor) {
        return start + (end - start) * factor;
    };
    
    Window_HealthHearts.prototype.easeOutBounce = function(t) {
        if (t < 1 / 2.75) {
            return 7.5625 * t * t;
        } else if (t < 2 / 2.75) {
            return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
        } else if (t < 2.5 / 2.75) {
            return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
        } else {
            return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
        }
    };
    
    // Show the health display with entrance animation
    function showHealthDisplay() {
        if (!isMapScene) return;
        
        if (!healthDisplay) {
            healthDisplay = new Window_HealthHearts();
            SceneManager._scene.addChild(healthDisplay);
        }
        
        healthDisplay.refresh();
        healthDisplay.visible = true;
        healthDisplay.contentsOpacity = 0; // Start invisible for fade-in
        displayTimer = displayDuration;
    }
    
    // Hide the health display with exit animation
    function hideHealthDisplay() {
        if (healthDisplay && displayTimer <= 0) {
            healthDisplay.visible = false;
            damageShake = 0;
            healGlow = 0;
        }
    }
    
    // Check for health changes
    function checkHealthChange() {
        if (!isMapScene) return;
        
        const actor = $gameParty.leader();
        if (!actor) return;
        
        const currentHp = actor.hp;
        
        if (currentHp !== lastKnownHp && lastKnownHp > 0) {
            showHealthDisplay();
        }
        
        lastKnownHp = currentHp;
    }
    
    // Update display with animations
    function updateHealthDisplay() {
        if (healthDisplay && healthDisplay.visible) {
            // Fade in effect
            if (healthDisplay.contentsOpacity < 255) {
                healthDisplay.contentsOpacity = Math.min(255, healthDisplay.contentsOpacity + 8);
            }
            
            // Update heart animations
            const hasActiveAnimations = healthDisplay.updateAnimations();
            
            // Refresh display to show animation updates
            if (hasActiveAnimations || damageShake > 0 || healGlow > 0) {
                healthDisplay.refresh();
            }
        }
        
        if (displayTimer > 0) {
            displayTimer--;
            
            // Fade out effect in last 30 frames
            if (displayTimer <= 30 && healthDisplay) {
                const fadeAlpha = displayTimer / 30;
                healthDisplay.contentsOpacity = Math.floor(255 * fadeAlpha);
            }
            
            if (displayTimer <= 0) {
                hideHealthDisplay();
            }
        }
    }
    
    // Hook into Scene_Map
    const _Scene_Map_initialize = Scene_Map.prototype.initialize;
    Scene_Map.prototype.initialize = function() {
        _Scene_Map_initialize.call(this);
        isMapScene = true;
        
        const actor = $gameParty.leader();
        if (actor) {
            lastKnownHp = actor.hp;
        }
    };
    
    const _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function() {
        _Scene_Map_terminate.call(this);
        isMapScene = false;
        hideHealthDisplay();
        
        if (healthDisplay) {
            this.removeChild(healthDisplay);
            healthDisplay = null;
        }
        
        // Reset animation states
        damageShake = 0;
        healGlow = 0;
        playerFlashTimer = 0;
        playerFlashIntensity = 0;
        floorDamageActive = false;
        floorDamageCooldown = 0;
    };
    
    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.call(this);
        checkHealthChange();
        updateHealthDisplay();
    };
    
    // Hook into Game_Actor methods
    const _Game_Actor_refresh = Game_Actor.prototype.refresh;
    Game_Actor.prototype.refresh = function() {
        const oldHp = this._hp;
        _Game_Actor_refresh.call(this);
        
        if (this === $gameParty.leader() && isMapScene && oldHp !== this._hp) {
            setTimeout(() => checkHealthChange(), 1);
        }
    };
    
    const _Game_Battler_setHp = Game_Battler.prototype.setHp;
    Game_Battler.prototype.setHp = function(hp) {
        const oldHp = this._hp;
        _Game_Battler_setHp.call(this, hp);
        
        if (this === $gameParty.leader() && isMapScene && oldHp !== this._hp) {
            setTimeout(() => checkHealthChange(), 1);
        }
    };
    
    // Clean up when changing scenes
    const _SceneManager_goto = SceneManager.goto;
    SceneManager.goto = function(sceneClass) {
        if (healthDisplay && SceneManager._scene) {
            SceneManager._scene.removeChild(healthDisplay);
            healthDisplay = null;
        }
        damageShake = 0;
        healGlow = 0;
        playerFlashTimer = 0;
        playerFlashIntensity = 0;
        floorDamageActive = false;
        floorDamageCooldown = 0;
        _SceneManager_goto.call(this, sceneClass);
    };
    
    //=============================================================================
    // Floor Damage Animation Override
    //=============================================================================
    
    // Override floor damage to flash player instead of screen
    const _Game_Actor_executeFloorDamage = Game_Actor.prototype.executeFloorDamage;
    Game_Actor.prototype.executeFloorDamage = function() {
        const damage = Math.floor(this.basicFloorDamage() * this.fdr);
        
        // Apply damage without screen flash
        this.gainHp(-damage);
        
        // Trigger continuous player flash effect
        if (this === $gameParty.leader() && isMapScene && damage > 0) {
            floorDamageActive = true; // Keep red as long as taking damage
            damageShake = Math.max(damageShake, 8); // Gentler shake for continuous damage
        }
        
        // Show damage popup if desired (optional)
        if (damage > 0) {
            this.startDamagePopup();
        }
        
        return damage;
    };
    
    // Override screen flash to prevent it during floor damage
    const _Scene_Map_updateEncounterEffect = Scene_Map.prototype.updateEncounterEffect;
    Scene_Map.prototype.updateEncounterEffect = function() {
        // Only call original if it's not floor damage causing the flash
        if (!floorDamageActive && floorDamageCooldown <= 0) {
            _Scene_Map_updateEncounterEffect.call(this);
        }
    };
    
    // Apply/clear the plugin's red flash on a single sprite. Only ever touches the
    // blend color when this plugin is actively flashing or has a flash of its own to
    // clear, so it never clobbers tints applied by other plugins (lighting, etc).
    function _phhApplyFlash(sprite, color) {
        if (color) {
            sprite.setBlendColor(color);
            sprite._phhFlashApplied = true;
        } else if (sprite._phhFlashApplied) {
            sprite.setBlendColor([0, 0, 0, 0]);
            sprite._phhFlashApplied = false;
        }
    }

    // Apply red flash to the player sprite.
    const _Sprite_Character_updateOther = Sprite_Character.prototype.updateOther;
    Sprite_Character.prototype.updateOther = function() {
        _Sprite_Character_updateOther.call(this);

        if (this._character === $gamePlayer) {
            _phhApplyFlash(this, playerFlashIntensity > 0
                ? [255, 100, 100, playerFlashIntensity * 255]
                : null);
        }
    };

    // Apply the red flash to party followers during floor damage.
    const _Sprite_Character_update = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        _Sprite_Character_update.call(this);

        if (this._character === $gamePlayer) return; // player handled in updateOther
        // Fast path: nothing to apply and nothing to clear, so skip the
        // follower check entirely (this runs for every character sprite).
        if (playerFlashIntensity === 0 && !this._phhFlashApplied) return;
        if (!(this._character instanceof Game_Follower)) return;

        _phhApplyFlash(this, playerFlashIntensity > 0
            ? [255, 80, 80, playerFlashIntensity * 180]
            : null);
    };
    
    // Disable default screen flash for floor damage
    const _Game_Screen_startFlashForDamage = Game_Screen.prototype.startFlashForDamage;
    Game_Screen.prototype.startFlashForDamage = function() {
        // Only allow screen flash if it's not from floor damage
        if (!floorDamageActive && floorDamageCooldown <= 0) {
            _Game_Screen_startFlashForDamage.call(this);
        }
    };
})();