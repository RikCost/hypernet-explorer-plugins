//=============================================================================
// CustomSceneStatus.js
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Custom Scene Status v2.0.0
 * @author OmniLex & Antigravity
 * @version 2.0.0
 * @description Gorgeous D&D Book Spread Status screen with campfire sepia aesthetic and biological limb tracking.
 * @param maxDescriptionLength
 * @text Max Description Length
 * @desc Maximum number of characters for character descriptions
 * @type number
 * @default 200
 * @min 50
 * @max 500
 *
 * @command setCharacterDescription
 * @text Set Character Description
 * @desc Set a description for a party member
 *
 * @arg partyMemberIndex
 * @text Party Member
 * @desc Which party member (1, 2, or 3)
 * @type select
 * @option Party Member 1
 * @value 1
 * @option Party Member 2
 * @value 2
 * @option Party Member 3
 * @value 3
 * @default 1
 *
 * @arg description
 * @text Description
 * @desc The character description text
 * @type multiline_string
 * @default
 *
 * @help CustomSceneStatus.js
 *
 * This plugin replaces the default Scene_Status with a custom version.
 *
 * --- Features ---
 * - Double-page parchment layout spreading across the screen (D&D Book Theme)
 * - Circular companion selection tabs at the top of the sheet
 * - Correctly cropped bust portraits drawn dynamically inside an ornate portrait frame
 * - Sepia status gauges for Vitals (HP), Energy (MP), Tension (TP) and Level Progression (EXP)
 * - Embossed medallions grid showing STR, CON, DEX, INT, WIS, PSI and active stat modifiers
 * - Alignment elemental badge, and a traits page writing every trait out in full
 * - Right-page sections (Attributes / Traits / Passives / Anatomy), the last one
 *   read being the one the sheet opens on next time
 * - Scrollable biological limb-health vitals tracking (Dwarf Fortress limb damage)
 * - Fast, flicker-free rendering with left-page caching
 */

(() => {
  // A severed-magic world has no magic in it, so there is nothing to spend a
  // magic meter on: the MP row is not drawn at all. See window.MagicNature.
  function hideMpBar() {
    const MN = window.MagicNature;
    return !!(MN && typeof MN.level === "function" && MN.level() === "severed");
  }

    'use strict';

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
            injectStyles() {
                if (document.getElementById('char-switch-hint-styles')) return;
                const style = document.createElement('style');
                style.id = 'char-switch-hint-styles';
                style.textContent = `
                    .companion-switcher { display:flex; align-items:center; gap:6px; }
                    .char-switch-hint {
                        font-family:'Lora',serif; font-size:0.732rem; font-weight:bold;
                        line-height:1; letter-spacing:0.5px; color:var(--text-primary-hover);
                        border:1.5px solid var(--text-primary-hover); border-radius:3px;
                        padding:2px 5px; opacity:0.7; user-select:none; white-space:nowrap;
                        text-transform:uppercase; flex-shrink:0;
                    }
                `;
                document.head.appendChild(style);
            },
            parts(memberCount) {
                this.injectStyles();
                if (!memberCount || memberCount <= 1) return { left: '', right: '' };
                if (this.isControllerConnected()) {
                    return {
                        left: '<span class="char-switch-hint">L</span>',
                        right: '<span class="char-switch-hint">R</span>'
                    };
                }
                return { left: '', right: '<span class="char-switch-hint">TAB</span>' };
            },
            inner(tabsRowHTML, memberCount) {
                const p = this.parts(memberCount);
                return p.left + tabsRowHTML + p.right;
            },
            wrap(tabsRowHTML, memberCount) {
                return `<div class="companion-switcher">${this.inner(tabsRowHTML, memberCount)}</div>`;
            },
            installTabKey(scene, onCycle) {
                if (scene._charSwitchTabListener) return;
                scene._charSwitchTabListener = (e) => {
                    if (e.key !== 'Tab') return; // i18n-ignore: DOM key name
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

    const pluginName = 'CustomSceneStatus';
    const parameters = PluginManager.parameters(pluginName);
    const maxDescriptionLength = parseInt(parameters['maxDescriptionLength'] || 200);


    let _statsI18n = null;

    const _loadStatsI18n = async () => {
        const lang = ConfigManager.language || 'en';
        const url = `js/i18n/${lang}/stats.json`;
        try {
            const response = await fetch(url);
            _statsI18n = await response.json();
        } catch (e) {
            console.error('CustomSceneStatus: Failed to load i18n data from ' + url, e);
        }
    };

    const _si18n = (key, fallback) => {
        if (_statsI18n && _statsI18n[key]) {
            return _statsI18n[key];
        }
        return fallback !== undefined ? fallback : key;
    };

    // Legacy trait data still ships { en: "...", it: "..." } objects instead of
    // an i18n key path; pick the active language and fall back to English.
    const _pickLocalized = (obj) => {
        if (!obj || typeof obj !== 'object') return "";
        const lang = ConfigManager.language || 'en';
        return obj[lang] || obj.en || "";
    };

    _loadStatsI18n();

    // Initialize character descriptions storage safely.
    // Stored on $gameSystem so descriptions persist into save files ($dataSystem is
    // not serialized into saves and lost the data across load).
    function initializeDescriptions() {
        if ($gameSystem && !$gameSystem._characterDescriptions) {
            $gameSystem._characterDescriptions = {};
        }
    }

    //=============================================================================
    // Bust Image Loading Helper
    //=============================================================================

    function getActorBustImagePath(actor) {
        if (!actor) return null;

        const actorId = actor.actorId && actor.actorId();
        const characterName = actor.characterName();
        const { SpritesAssociation } = window.Sprites || {};

        // Player 1 (Actor 1) special handling
        if (actorId === 1) {
            // Priority 1: Check Variable 109 (Player 1 bust name)
            const player1BustName = $gameActors.actor(1).vnBust();
            if (player1BustName && player1BustName !== "") {
                return "img/busts/" + player1BustName;
            }

            // Priority 2: If Switch 77 is ON, use Variable 106 for monster form
            if ($gameSwitches.value(77)) {
                const player1MonsterName = $gameActors.actor(1).vnBattler();
                if (player1MonsterName && player1MonsterName !== "") {
                    return "img/enemies/" + player1MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Player 2 (Actor 2) special handling
        if (actorId === 2) {
            // Priority 1: Check Variable 117 (Player 2 bust name)
            const player2BustName = $gameActors.actor(2).vnBust();
            if (player2BustName && player2BustName !== "") {
                return "img/busts/" + player2BustName;
            }

            // Priority 2: If Switch 78 is ON, use Variable 107 for monster form
            if ($gameSwitches.value(78)) {
                const player2MonsterName = $gameActors.actor(2).vnBattler();
                if (player2MonsterName && player2MonsterName !== "") {
                    return "img/enemies/" + player2MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Player 3 (Actor 3) special handling
        if (actorId === 3) {
            // Priority 1: Check Variable 118 (Player 3 bust name)
            const player3BustName = $gameActors.actor(3).vnBust();
            if (player3BustName && player3BustName !== "") {
                return "img/busts/" + player3BustName;
            }

            // Priority 2: If Switch 79 is ON, use Variable 108 for monster form
            if ($gameSwitches.value(79)) {
                const player3MonsterName = $gameActors.actor(3).vnBattler();
                if (player3MonsterName && player3MonsterName !== "") {
                    return "img/enemies/" + player3MonsterName;
                }
            }

            // Priority 3: Fall back to SpritesAssociation
            if (characterName && SpritesAssociation) {
                const spritesheetName = characterName.split('.')[0];
                const characterIndex = actor.characterIndex();

                if (SpritesAssociation[spritesheetName] &&
                    SpritesAssociation[spritesheetName][characterIndex]) {
                    const bustName = SpritesAssociation[spritesheetName][characterIndex];
                    return "img/busts/" + bustName;
                }
            }

            return "img/busts/7";
        }

        // Fallback to SpritesAssociation for any other actors
        if (characterName && SpritesAssociation) {
            const spritesheetName = characterName.split('.')[0];
            const characterIndex = actor.characterIndex();

            if (SpritesAssociation[spritesheetName] &&
                SpritesAssociation[spritesheetName][characterIndex]) {
                const bustName = SpritesAssociation[spritesheetName][characterIndex];
                return "img/busts/" + bustName;
            }
        }

        // Final fallback to default bust path structure
        return "img/busts/7";
    }

    function drawBustImage(bitmap, actor, x, y, width, height) {
        const bustPath = getActorBustImagePath(actor);

        // Always clear the area first
        bitmap.clearRect(x, y, width, height);

        if (!bustPath) return;

        // Determine if this is an enemy image (don't crop) or bust image (crop)
        const shouldCrop = !bustPath.includes('img/enemies/');

        // Load the main bust image
        const bustBitmap = ImageManager.loadBitmap('', bustPath);

        bustBitmap.addLoadListener(() => {
            // Check if the bitmap actually loaded successfully
            if (bustBitmap.width > 0 && bustBitmap.height > 0) {
                drawBustToCanvas(bitmap, bustBitmap, x, y, width, height, shouldCrop);
            }
        });
    }

    function drawBustToCanvas(bitmap, sourceBitmap, x, y, width, height, shouldCrop = true) {
        try {
            // Disable image smoothing for pixel-perfect rendering
            const context = bitmap.context;
            const oldSmoothing = context.imageSmoothingEnabled;
            context.imageSmoothingEnabled = false;

            // Get source image dimensions
            const sourceWidth = sourceBitmap.width > 0 ? sourceBitmap.width : 889;
            const sourceHeight = sourceBitmap.height > 0 ? sourceBitmap.height : 1200;

            let cropTop = 0;
            let cropLeft = 0;
            let croppedSourceWidth = sourceWidth;
            let croppedSourceHeight = sourceHeight;

            // For bust images, zoom in on the face area with tighter cropping
            if (shouldCrop) {
                // Crop from top to show face details (320px from top instead of 180px)
                cropTop = 320;
                // Crop from sides to zoom in (center 60% of width)
                cropLeft = Math.round(sourceWidth * 0.2);
                croppedSourceWidth = Math.round(sourceWidth * 0.6);
                croppedSourceHeight = sourceHeight - cropTop;
            }

            const aspectRatio = croppedSourceWidth / croppedSourceHeight;

            // Calculate draw dimensions to fit within the display area while maintaining aspect ratio
            let drawWidth = width;
            let drawHeight = Math.round(width / aspectRatio);

            // If height exceeds available space, scale down
            if (drawHeight > height) {
                drawHeight = height;
                drawWidth = Math.round(height * aspectRatio);
            }

            // Center the image within the specified area
            const drawX = Math.round(x + (width - drawWidth) / 2);
            const drawY = Math.round(y + (height - drawHeight) / 2);

            // Draw the image (cropped if it's a bust, full if it's an enemy)
            bitmap.blt(sourceBitmap, cropLeft, cropTop, croppedSourceWidth, croppedSourceHeight, drawX, drawY, drawWidth, drawHeight);

            // Restore original smoothing setting
            context.imageSmoothingEnabled = oldSmoothing;
        } catch (error) {
            // Silently handle errors
        }
    }

    //=============================================================================
    // Translation Helper
    //=============================================================================



    // Copy lives in js/i18n/<lang>/plugins/SceneStatus.json.
    function getText(key) {
        return T("SceneStatus." + key);
    }

    let i18nData = null;

    const loadI18nData = async () => {
        const lang = ConfigManager.language || "en";
        const url = `js/i18n/${lang}/traits.json`;
        try {
            const response = await fetch(url);
            i18nData = await response.json();
            // Trait names and descriptions are read straight out of this bank,
            // so redraw a status screen that opened before the fetch landed.
            const scene = SceneManager._scene;
            if (scene instanceof Scene_Status && scene.refreshUIStatus) {
                scene.refreshUIStatus();
            }
        } catch (e) {
            console.error("CustomSceneStatus: Failed to load i18n data from " + url, e);
        }
    };

    const resolveI18nPath = (path, obj) => {
        if (!path || !obj) return null;
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
    };

    // A trait's name/description is either an i18n key path into traits.json
    // (loaded into i18nData) or a legacy { en, it } object. Anything that does
    // not resolve falls back to the raw value so a missing translation still
    // reads as something.
    const resolveTraitField = (value) => {
        if (!value) return "";
        if (typeof value === 'object') return _pickLocalized(value);
        const text = String(value);
        if (text.includes('.')) {
            const resolved = i18nData ? resolveI18nPath(text, i18nData) : null;
            if (typeof resolved === 'string') return resolved;
        }
        return text;
    };

    const escapeAttr = (text) => String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    // Database display names, localized the way the rest of the menus do it.
    const dbName = (entry) =>
        window.CCDbName ? window.CCDbName(entry) : (entry && entry.name) || "";

    const iconStyle = (iconIndex, size) => {
        const box = `width:${size}px; height:${size}px; display:inline-block; flex:0 0 auto;`;
        if (!iconIndex) return box;
        const col = iconIndex % 16;
        const row = Math.floor(iconIndex / 16);
        return `${box} background-image:url('img/system/IconSet.png'); background-size:${size * 16}px auto; background-position:-${col * size}px -${row * size}px; image-rendering:pixelated;`;
    };

    const TRAIT_CATEGORY_KEYS = {
        genetic: "tabGenetic",
        physical: "tabPhysical",
        mental: "tabMental",
        magical: "tabMagical"
    };   // i18n-ignore: keys into Traits.<tab*>

    const paramDisplayName = (key) => ({
        hp: _si18n("HP", "HP"),
        mp: _si18n("MP", "MP"),
        atk: _si18n("ATT", "STR"),
        def: _si18n("DEF", "CON"),
        mat: _si18n("M.ATT", "INT"),
        mdf: _si18n("M.DEF", "WIS"),
        agi: _si18n("AGILITY", "DEX"),
        luk: _si18n("LUCK", "PSI"),
        eva: "EVA"   // i18n-ignore: universal stat abbreviation
    })[key] || key;

    // Specializations (js/db/Skills/Specialization.json) this trait gives a head
    // start in. Empty until window.Specializations finishes its async load.
    const traitSpecializations = (trait) => {
        if (!trait || typeof trait.name !== "string") return [];
        if (!window.Specializations || !window.Specializations.ready) return [];
        const slug = trait.name.split(".")[1];
        if (!slug) return [];
        const rows = [];
        window.Specializations.list.forEach(spec => {
            const level = spec.traitStart && spec.traitStart[slug];
            if (level) rows.push(`${window.Specializations.displayName(spec)} (${window.Specializations.levelName(level)})`);
        });
        return rows.sort();
    };

    // A trait written out in full: what it is, what it says, and everything it
    // does to the character. One of these is drawn per trait on the traits tab,
    // so nothing about a trait is hidden behind a chip any more.
    function buildTraitDossierHTML(trait) {
        const name = resolveTraitField(trait.name);
        const desc = resolveTraitField(trait.description);
        const categoryKey = TRAIT_CATEGORY_KEYS[trait.category];

        const badge = (label, color) =>
            `<span class="status-trait-badge"${color ? ` style="color:${color}"` : ""}>${escapeAttr(label)}</span>`;

        const iconBadge = (iconIndex, label, suffix) =>
            `<span class="status-trait-badge"><span style="${iconStyle(iconIndex, 16)}"></span>${escapeAttr(label)}${suffix ? ` ${suffix}` : ""}</span>`;

        const statBadges = (stats, color) => Object.keys(stats || {}).map(key => {
            const value = stats[key];
            return badge(`${paramDisplayName(key)} ${value > 0 ? "+" : ""}${value}`, color);
        }).join("");

        // trait.items is a flat array with one entry per copy, so tally by id.
        const counted = (ids) => {
            const tally = {};
            (ids || []).forEach(id => { tally[id] = (tally[id] || 0) + 1; });
            return tally;
        };
        const dbBadges = (ids, table) => {
            const tally = counted(ids);
            return Object.keys(tally).map(id => {
                const entry = table[id];
                return entry ? iconBadge(entry.iconIndex, dbName(entry), tally[id] > 1 ? `x${tally[id]}` : "") : "";
            }).join("");
        };

        const skillBadges = (trait.skills || []).map(id => {
            const skill = $dataSkills[id];
            return skill ? iconBadge(skill.iconIndex, dbName(skill), "") : "";
        }).join("");

        const equipBadges = (trait.equipment || []).map(id => {
            const entry = $dataWeapons[id] || $dataArmors[id];
            return entry ? iconBadge(entry.iconIndex, dbName(entry), "") : "";
        }).join("");

        const specBadges = traitSpecializations(trait).map(text => badge(text)).join("");

        const row = (label, content) => content ? `
            <div class="status-trait-row">
                <span class="status-trait-row-label">${label}</span>
                <span class="status-trait-badges">${content}</span>
            </div>
        ` : "";

        // What the trait cost to take, in the same badge the creation screen
        // prices it with. TraitPoints lives in TraitSelector.js.
        const points = window.TraitPoints;
        const costBadge = points ? points.costBadgeHTML(points.costOf(trait)) : "";

        return `
            <div class="status-trait-head">
                <span style="${iconStyle(trait.icon, 22)}"></span>
                <span class="status-trait-name">${escapeAttr(name)}</span>
                ${costBadge}
            </div>
            <div class="status-trait-desc">${escapeAttr(desc) || T('SceneStatus.trait.noDescription')}</div>
            ${row(T('SceneStatus.trait.category'), categoryKey ? badge(T('Traits.' + categoryKey)) : "")}
            ${row(T('Traits.benefits'), statBadges(trait.positive, 'var(--text-forest-green)'))}
            ${row(T('Traits.drawbacks'), statBadges(trait.negative, 'var(--accent-red-3)'))}
            ${row(T('Traits.grantsSkills'), skillBadges)}
            ${row(T('Traits.startingItems'), dbBadges(trait.items, $dataItems))}
            ${row(T('SceneStatus.trait.equipment'), equipBadges)}
            ${row(T('SceneStatus.trait.specializations'), specBadges)}
        `;
    }

    // The purse the character's traits were bought out of, printed above them:
    // what was spent, out of what the budget and the drawbacks made available.
    function buildTraitPointsHTML(traits) {
        const points = window.TraitPoints;
        if (!points) return "";
        const tally = points.tally(traits);
        const paidBack = tally.credit > 0 ? ` <span class="trait-cost refund">+${tally.credit}</span>` : "";
        return `
            <div class="status-trait-points">
                <span class="status-trait-row-label">${T('SceneStatus.trait.points')}</span>
                <span><b>${tally.spent}</b> / ${tally.available}${paidBack}</span>
            </div>
        `;
    }

    // Every trait the character carries, each one fully written out, however
    // many there are: the page scrolls rather than capping the list. A stored
    // entry is sometimes a trimmed copy (id, icon and name only), so the trait
    // database is read over it before the dossier is built.
    function buildTraitsPageHTML(actor) {
        const stored = (actor && actor._selectedTraits) || [];
        if (stored.length === 0) {
            return `<div class="status-traits-empty">${T('SceneStatus.ui.noTraits')}</div>`;
        }
        const traits = stored.map(entry => {
            const full = getTraitById(entry.id);
            return full ? Object.assign({}, full, entry) : entry;
        });
        return buildTraitPointsHTML(traits) + traits
            .map(trait => `<div class="status-trait-entry">${buildTraitDossierHTML(trait)}</div>`)
            .join("");
    }

    //=============================================================================
    // Right-page tabs
    //
    // The sheet is read one section at a time instead of stacking every card
    // down a page that was never tall enough for them: the raw numbers (the
    // default), the traits written out, what is permanently on, and the body's
    // own condition. The chips are the shared bookmark-tab design the backpack
    // and the shop already use (.backpack-tabs / .backpack-tab in css/theme.css).
    //=============================================================================

    const STATUS_TABS = [
        { id: "attributes", labelKey: "SceneStatus.ui.tabAttributes" },
        { id: "traits", labelKey: "SceneStatus.ui.tabTraits" },
        { id: "passives", labelKey: "SceneStatus.ui.tabPassives" },
        { id: "anatomy", labelKey: "SceneStatus.ui.tabAnatomy" },
        { id: "diseases", labelKey: "SceneStatus.ui.tabDiseases" }
    ];

    // The section the sheet opens on. Attributes is what the page is for, and
    // whichever tab was last read is kept on $gameSystem so re-opening the
    // screen (or another character's) comes back to it rather than to the top.
    const DEFAULT_STATUS_TAB = STATUS_TABS[0].id;

    const rememberedStatusTab = () => {
        const stored = $gameSystem ? $gameSystem._statusActiveTab : null;
        return STATUS_TABS.some(tab => tab.id === stored) ? stored : DEFAULT_STATUS_TAB;
    };

    const rememberStatusTab = (tabId) => {
        if ($gameSystem) $gameSystem._statusActiveTab = tabId;
    };

    // How far one press of up / down moves the traits page, in pixels.
    const TRAIT_SCROLL_STEP = 48;

    // The element a class declares (<elem: n> in its notebox) doubles as the
    // emblem of its signature passive. 0 when the class declares none, which
    // leaves the row's icon slot empty rather than printing a wrong sprite.
    const ELEMENT_ICONS = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];

    const classElementIcon = (actorClass) => {
        const match = actorClass && actorClass.note && actorClass.note.match(/<elem:\s*(\d+)>/);
        if (!match) return 0;
        return ELEMENT_ICONS[parseInt(match[1], 10)] || 0;
    };

    // Everything that is always on for this character: the class's signature
    // passive and the passive each selected trait carries, both read from
    // BattleSystemPassiveSkills so the wording matches the creation screens.
    function buildPassivesHTML(actor) {
        const api = window.BattleSystemPassiveSkills;
        const actorClass = actor.currentClass();
        const rows = [];

        if (api && actorClass) {
            const name = api.getPassiveName(actorClass.id);
            if (name) {
                rows.push({
                    icon: classElementIcon(actorClass),
                    name: name,
                    desc: api.getPassiveEffect(actorClass.id),
                    tag: T("SceneStatus.ui.sourceClass")
                });
            }
        }

        if (api && api.getActorTraitPassives) {
            api.getActorTraitPassives(actor).forEach(passive => {
                const trait = getTraitById(passive.traitId);
                rows.push({
                    icon: (trait && trait.icon) || 0,
                    name: passive.name,
                    desc: passive.desc,
                    tag: T("SceneStatus.ui.sourceTrait")
                });
            });
        }

        if (!rows.length) {
            return `<div class="status-empty-note">${T("SceneStatus.ui.noPassives")}</div>`;
        }

        return rows.map(row => `
            <div class="status-passive-row">
                <span style="${iconStyle(row.icon, 32)}"></span>
                <div class="status-passive-body">
                    <div class="status-passive-name">
                        <span>${escapeAttr(row.name)}</span>
                        <span class="status-passive-tag">${escapeAttr(row.tag)}</span>
                    </div>
                    <div class="status-passive-desc">${escapeAttr(row.desc)}</div>
                </div>
            </div>
        `).join("");
    }

    //=============================================================================
    // Seeded Random Number Generator
    //=============================================================================

    class SeededRandom {
        constructor(seed) {
            this.seed = seed;
        }

        next() {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
        }
    }

    function stringToSeed(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    //=============================================================================
    // Trait Generation
    //=============================================================================

    function getTraitById(traitId) {
        if (!window.Health || !window.Health.Traits) {
            return null;
        }
        return window.Health.Traits.find(trait => trait.id === traitId);
    }

    // A companion's traits, rolled from their name so the same character always
    // carries the same ones. The roll goes through TraitPoints, so a generated
    // sheet is bought out of the same purse a player would spend and can never
    // hold more than the budget pays for. Only id / icon / name are stored: the
    // rest is read back out of the trait database when the sheet is drawn.
    function generateRandomTraits(actorName) {
        const points = window.TraitPoints;
        if (!points || !window.Health || !(window.Health.Traits || []).length) {
            return [];
        }
        const rng = new SeededRandom(stringToSeed(actorName));
        return points.pick({ rng: () => rng.next() }).map(trait => ({
            id: trait.id,
            icon: trait.icon,
            name: trait.name
        }));
    }

    function ensureActorTraits(actor, partyIndex) {
        if (partyIndex === 0) {
            // First party member has no auto-generated traits
            if (!actor._selectedTraits) {
                actor._selectedTraits = [];
            }
        } else {
            // Other party members get seeded random traits
            if (!actor._selectedTraits || actor._selectedTraits.length === 0) {
                actor._selectedTraits = generateRandomTraits(actor.name());
            }
        }
    }

    //=============================================================================
    // Plugin Commands
    //=============================================================================

    PluginManager.registerCommand(pluginName, "setCharacterDescription", args => {
        const partyIndex = parseInt(args.partyMemberIndex) - 1;
        const description = args.description || "";
        const actor = $gameParty.allMembers()[partyIndex];

        if (actor) {
            if (!$gameSystem || !$gameSystem._characterDescriptions) {
                initializeDescriptions();
            }

            const truncatedDescription = description.length > maxDescriptionLength
                ? description.substring(0, maxDescriptionLength) + "..."
                : description;

            $gameSystem._characterDescriptions[actor.actorId()] = truncatedDescription;
            window.skipLocalization = true;
            $gameMessage.add(T("SceneStatus.descriptionSet", { name: actor.name() }));
            window.skipLocalization = false;
        } else {
            window.skipLocalization = true;
            $gameMessage.add(T("SceneStatus.invalidIndex"));
            window.skipLocalization = false;
        }
    });

    //=============================================================================
    // Eager i18n initialization
    //=============================================================================
    loadI18nData();

    //=============================================================================
    // Scene_Status Overrides & UI UI Spread Engine
    //=============================================================================

    const _Scene_Status_create = Scene_Status.prototype.create;
    Scene_Status.prototype.create = function () {
        _Scene_Status_create.call(this);

        // Hide standard canvas windows
        if (this._statusWindow) {
            this._statusWindow.visible = false;
            this._statusWindow.deactivate();
        }
        if (this._statesWindow) {
            this._statesWindow.visible = false;
            this._statesWindow.deactivate();
        }
        if (this._paramsWindow) {
            this._paramsWindow.visible = false;
            this._paramsWindow.deactivate();
        }

        // Set actor index to active menu actor
        this._actorIndex = $gameParty.allMembers().indexOf(this.actor());
        if (this._actorIndex < 0) this._actorIndex = 0;

        // UI UI states
        this._dndActiveSection = "stats"; // "stats", "bodyparts"
        this._dndSelectedIndex = 0;
        this._dndLastLeftPageKey = "";
        this._dndActiveTab = rememberedStatusTab();

        this.createUIStatusOverlay();
        window.CharSwitcher.installTabKey(this, (dir) => {
            if (dir > 0) this.nextActor();
            else this.previousActor();
        });
    };

    Scene_Status.prototype.start = function () {
        Scene_MenuBase.prototype.start.call(this);
        this.refreshActor();
    };

    Scene_Status.prototype.refreshActor = function () {
        const actor = this.actor();
        ensureActorTraits(actor, this._actorIndex);
        this.refreshUIStatus();
    };

    Scene_Status.prototype.onActorChange = function () {
        Scene_MenuBase.prototype.onActorChange.call(this);
        this.refreshActor();
    };

    Scene_Status.prototype.update = function () {
        Scene_MenuBase.prototype.update.call(this);
        this.updateUIStatusInput();
    };

    Scene_Status.prototype.nextActor = function () {
        this._actorIndex = (this._actorIndex + 1) % $gameParty.allMembers().length;
        this.refreshActor();
        SoundManager.playCursor();
    };

    Scene_Status.prototype.previousActor = function () {
        this._actorIndex = (this._actorIndex - 1 + $gameParty.allMembers().length) % $gameParty.allMembers().length;
        this.refreshActor();
        SoundManager.playCursor();
    };

    Scene_Status.prototype.actor = function () {
        return $gameParty.allMembers()[this._actorIndex];
    };

    const _Scene_Status_terminate = Scene_Status.prototype.terminate;
    Scene_Status.prototype.terminate = function () {
        _Scene_Status_terminate.call(this);
        this.cleanupStatus3D();
        window.CharSwitcher.removeTabKey(this);
        if (this._dndContainer) {
            const container = this._dndContainer;
            container.style.transition = "opacity 0.2s ease-out";
            container.style.opacity = "0";
            container.style.pointerEvents = "none";
            setTimeout(() => {
                if (container && container.parentNode) {
                    container.parentNode.removeChild(container);
                }
            }, 200);
            this._dndContainer = null;
        }
        // Cleanup styles to prevent bleed-through/shrinking of main menu spread
        const styleBlock = document.getElementById("status-styles");
        if (styleBlock) {
            styleBlock.remove();
        }
    };

    // --- Overlay & CSS Engine ---

    Scene_Status.prototype.createUIStatusOverlay = function () {
        // Inject Google Fonts


        // Inject custom stylesheet block
        // Create DOM wrapper
        this._dndContainer = document.createElement("div");
        this._dndContainer.id = "status-menu-container";
        this._dndContainer.style.opacity = "0";
        this._dndContainer.style.transition = "opacity 0.22s ease-out";
        document.body.appendChild(this._dndContainer);

        this.refreshUIStatus();

        setTimeout(() => {
            if (this._dndContainer) {
                this._dndContainer.style.opacity = "1";
            }
        }, 16);
    };

    Scene_Status.prototype.refreshUIStatus = function () {
        if (!this._dndContainer) return;

        const actor = this.actor();
        if (!actor) return;

        const backBtnText = T("SceneStatus.back");

        // Check if book spread framework is present; if not, build it once
        let spread = this._dndContainer.querySelector(".book-spread");
        if (!spread) {
            this._dndContainer.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        <div style="position: relative; display: flex; align-items: center; justify-content: center; border-bottom: 2px dashed #bba16d; padding-bottom: 6px; margin-bottom: 10px; min-height: 36px; margin-top: 4px">
                            <div class="back-button focusable" onclick="SceneManager._scene.popScene()" style="position: absolute; font-family: 'Lora', serif; font-size: 0.96rem; background: transparent; color: var(--text-primary-hover); padding: 4px 12px; border-radius: 4px; font-weight: bold; transition: all 0.2s ease; border: 1.5px solid var(--text-primary-hover); display: inline-flex; height: fit-content">
                                ${backBtnText}
                            </div>
                            <h2 class="title" id="status-actor-name" style="border: none; margin: 0; padding: 0"></h2>
                        </div>
                        
                        <div class="status-bust-wrapper">
                            <canvas id="status-bust" width="440" height="500"></canvas>
                        </div>
                        
                        <div class="status-gauges-box">
                            <div class="status-gauge-grid">
                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.hp')}</span>
                                    <span class="gauge-value" id="status-hp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner hp" id="status-hp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.mp')}</span>
                                    <span class="gauge-value" id="status-mp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner mp" id="status-mp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.ap')}</span>
                                    <span class="gauge-value" id="status-tp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner tp" id="status-tp-bar"></div>
                                </div>
                            </div>

                            <div class="status-gauge-row">
                                <div class="status-gauge-meta">
                                    <span class="gauge-label">${T('SceneStatus.ui.experience')}</span>
                                    <span class="gauge-value" id="status-exp-text"></span>
                                </div>
                                <div class="status-gauge-bar-outer">
                                    <div class="status-gauge-bar-inner exp" id="status-exp-bar"></div>
                                </div>
                                <div class="status-gauge-note" id="status-exp-next"></div>
                            </div>
                            </div>

                            <div class="status-needs-rows" id="status-needs"></div>
                        </div>
                    </div>
                    <div class="right-page" style="position:relative">
                        <div class="status-right-header">
                            <div class="companion-switcher" id="status-companion-switcher"></div>
                        </div>

                        <div class="backpack-tabs status-tabs" id="status-tabs"></div>

                        <div id="status-lower-cards">
                            <div class="status-tab-panel" data-status-tab="passives">
                                <div class="bodyparts-card">
                                    <div class="card-label">${T('SceneStatus.ui.passiveAbilities')}</div>
                                    <div class="bodyparts-list" id="status-passives-list"></div>
                                </div>
                            </div>

                            <div class="status-tab-panel" data-status-tab="anatomy">
                                <div class="bodyparts-card status-card-fixed">
                                    <div class="card-label" id="status-archetype-label">${T('SceneStatus.ui.archetype')}</div>
                                    <div id="status-archetype" style="padding:4px 2px; font-family:'Lora',serif"></div>
                                </div>

                                <div class="bodyparts-card">
                                    <div class="card-label">${T('SceneStatus.ui.biologicalVitals')}</div>
                                    <div class="bodyparts-list" id="bodyparts-scroll-container"></div>
                                </div>
                            </div>

                            <div class="status-tab-panel" data-status-tab="attributes">
                                <div id="status-attr-cards">
                                    <div class="stats-medallions-grid" id="status-medallions"></div>
                                </div>

                                <div class="status-alignment-row">
                                    <div id="status-alignment-container" style="display:contents"></div>
                                    <div id="status-magicsystem-container" style="display:contents"></div>
                                </div>
                            </div>

                            <div class="status-tab-panel" data-status-tab="traits">
                                <div class="bodyparts-card">
                                    <div class="card-label">${T('SceneStatus.ui.characterTraits')}</div>
                                    <div class="status-traits-full" id="status-traits"></div>
                                </div>
                            </div>

                            <div class="status-tab-panel" data-status-tab="diseases">
                                <div class="bodyparts-card">
                                    <div class="card-label">${T('SceneStatus.ui.tabDiseases')}</div>
                                    <div class="bodyparts-list" id="status-diseases"></div>
                                </div>
                            </div>
                        </div>

                        <div class="status-actions" id="status-actions"></div>
                    </div>
                </div>
            `;
            spread = this._dndContainer.querySelector(".book-spread");
        }

        // 1. Companion navigation tabs HTML
        const allMembers = $gameParty.allMembers();
        let companionTabsHTML = "";
        allMembers.forEach((member, idx) => {
            const isSelected = member === actor ? "selected" : "";
            companionTabsHTML += `
                <div class="companion-tab ${isSelected}" onclick="SceneManager._scene.selectUIActor(${idx})">
                    ${member.name()}
                </div>
            `;
        });
        const tabsRow = spread.querySelector("#status-companion-switcher");
        if (tabsRow) {
            tabsRow.innerHTML = window.CharSwitcher.inner(
                `<div class="companion-tabs-row" style="border-bottom:none; margin-bottom:0; padding-bottom:0">${companionTabsHTML}</div>`,
                allMembers.length
            );
        }

        // 1b. Right page section tabs, and the actions bar sitting under them.
        // Empathize is offered only while the panel plugin is loaded, since it
        // is what owns the character sheet the button opens.
        const tabsEl = spread.querySelector("#status-tabs");
        if (tabsEl) {
            tabsEl.innerHTML = STATUS_TABS.map(tab => `
                <div class="backpack-tab focusable${tab.id === this._dndActiveTab ? " active" : ""}"
                     data-status-tab-btn="${tab.id}"
                     onclick="SceneManager._scene.selectStatusTab('${tab.id}')">${T(tab.labelKey)}</div>
            `).join("");
        }
        this.applyStatusTab();

        const actionsEl = spread.querySelector("#status-actions");
        if (actionsEl) {
            actionsEl.innerHTML = (window.NPCEmpathize && window.NPCEmpathize.openForActor)
                ? `<div class="inspect-btn focusable" onclick="SceneManager._scene.openStatusEmpathize()">${T("SceneStatus.ui.empathize")}</div>`
                : "";
        }

        // 2. Left Page content updates
        const actorNameEl = spread.querySelector("#status-actor-name");
        if (actorNameEl) actorNameEl.textContent = T("SceneStatus.actorLine", { name: actor.name(), klass: actor.currentClass().name, level: actor.level });

        // Calculate EXP
        const currentExp = actor.currentExp() || 0;
        let expRate = 0;
        let expForThisLevel = 0;
        let expGainedThisLevel = 0;
        if (actor.isMaxLevel()) {
            expRate = 1;
        } else {
            const currentLevelExp = actor.currentLevelExp();
            const nextLevelExp = actor.nextLevelExp();
            expForThisLevel = nextLevelExp - currentLevelExp;
            expGainedThisLevel = currentExp - currentLevelExp;
            expRate = expForThisLevel > 0 ? (expGainedThisLevel / expForThisLevel) : 0;
        }

        // Update Left Page Gauges
        const hpTextEl = spread.querySelector("#status-hp-text");
        if (hpTextEl) hpTextEl.textContent = `${actor.hp} / ${actor.mhp}`;
        const hpBarEl = spread.querySelector("#status-hp-bar");
        if (hpBarEl) hpBarEl.style.width = `${actor.hpRate() * 100}%`;

        const mpTextEl = spread.querySelector("#status-mp-text");
        if (mpTextEl) mpTextEl.textContent = `${actor.mp} / ${actor.mmp}`;
        const mpBarEl = spread.querySelector("#status-mp-bar");
        if (mpBarEl) mpBarEl.style.width = `${actor.mpRate() * 100}%`;
        // Nothing to spend it on in a severed world: the whole row goes.
        if (hideMpBar()) {
            const row = (mpBarEl && mpBarEl.closest(".status-gauge-row")) ||
                        (mpTextEl && mpTextEl.closest(".status-gauge-row"));
            if (row) row.style.display = "none";
            else {
                if (mpTextEl) mpTextEl.style.display = "none";
                if (mpBarEl && mpBarEl.parentElement) mpBarEl.parentElement.style.display = "none";
            }
        }

        const tpTextEl = spread.querySelector("#status-tp-text");
        if (tpTextEl) tpTextEl.textContent = `${actor.tp} / ${actor.maxTp()}`;
        const tpBarEl = spread.querySelector("#status-tp-bar");
        if (tpBarEl) tpBarEl.style.width = `${(actor.tp / actor.maxTp()) * 100}%`;

        // The gauge counts the points earned inside the current level; the line
        // under it says how many are still owed before the next one, which is
        // what a player actually wants to know from this screen.
        const expTextEl = spread.querySelector("#status-exp-text");
        const expNextEl = spread.querySelector("#status-exp-next");
        if (actor.isMaxLevel()) {
            if (expTextEl) expTextEl.textContent = T("SceneStatus.ui.expMax");
            if (expNextEl) expNextEl.textContent = "";
        } else {
            if (expTextEl) expTextEl.textContent = `${expGainedThisLevel} / ${expForThisLevel}`;
            if (expNextEl) {
                expNextEl.textContent = T("SceneStatus.ui.expToNext", {
                    exp: Math.max(0, expForThisLevel - expGainedThisLevel),
                    level: actor.level + 1
                });
            }
        }
        const expBarEl = spread.querySelector("#status-exp-bar");
        if (expBarEl) expBarEl.style.width = `${expRate * 100}%`;

        // Character Needs gauges (hunger / sleep / hygiene / social / leisure)
        // Sourced from TimeDateSystem. Each is guarded so the status screen still
        // works when that plugin is absent.
        const needsEl = spread.querySelector("#status-needs");
        if (needsEl) {
            const needDefs = [
                { label: T("SceneStatus.need.hunger"), cls: "hunger", fn: "hungerPercent" },
                { label: T("SceneStatus.need.sleep"), cls: "sleep", fn: "sleepPercent" },
                { label: T("SceneStatus.need.hygiene"), cls: "hygiene", fn: "hygienePercent" },
                { label: T("SceneStatus.need.social"), cls: "social", fn: "socialPercent" },
                { label: T("SceneStatus.need.leisure"), cls: "leisure", fn: "leisurePercent" }
            ];

            // Uniform needs palette: gold when healthy, orange when low, red
            // when critical. Inline color overrides the per-class gradient so
            // every needs bar reads on the same scale.
            const needColor = (p) => p <= 20 ? '#d9433a' : (p <= 50 ? '#e2933a' : '#d4a64e');

            let needsHTML = "";
            needDefs.forEach(need => {
                if (typeof actor[need.fn] !== "function") return;
                const pct = Math.max(0, Math.min(100, Math.round(actor[need.fn]())));
                const c = needColor(pct);
                needsHTML += `
                    <div class="status-gauge-row">
                        <div class="status-gauge-meta">
                            <span class="gauge-label">${need.label}</span>
                            <span class="gauge-value" style="color:${c}">${pct}%</span>
                        </div>
                        <div class="status-gauge-bar-outer">
                            <div class="status-gauge-bar-inner ${need.cls}" style="width: ${pct}%; background:${c}"></div>
                        </div>
                    </div>
                `;
            });

            // Addiction cravings hang off the same list, read the other way
            // round: the bar fills as the craving grows, so a full one is this
            // character in withdrawal. A character with no addiction trait has
            // no meter and adds no row.
            const addictions = window.AddictionSystem;
            if (addictions) {
                const cravingColor = (p) => p >= 80 ? '#d9433a' : (p >= 50 ? '#e2933a' : '#d4a64e');
                addictions.cravingsFor(actor).forEach(craving => {
                    const pct = Math.max(0, Math.min(100, Math.round(craving.value)));
                    const c = cravingColor(pct);
                    needsHTML += `
                    <div class="status-gauge-row">
                        <div class="status-gauge-meta">
                            <span class="gauge-label">${craving.label}</span>
                            <span class="gauge-value" style="color:${c}">${pct}%</span>
                        </div>
                        <div class="status-gauge-bar-outer">
                            <div class="status-gauge-bar-inner" style="width: ${pct}%; background:${c}"></div>
                        </div>
                    </div>
                `;
                });
            }

            needsEl.innerHTML = needsHTML;
        }

        // 3. Right Page Content updates
        const params = [
            { name: _si18n("ATT", "STR"), val: actor.param(2), id: 2 },
            { name: _si18n("DEF", "CON"), val: actor.param(3), id: 3 },
            { name: _si18n("AGILITY", "DEX"), val: actor.param(6), id: 6 },
            { name: _si18n("M.ATT", "INT"), val: actor.param(4), id: 4 },
            { name: _si18n("M.DEF", "WIS"), val: actor.param(5), id: 5 },
            { name: _si18n("LUCK", "PSI"), val: actor.param(7), id: 7 }
        ];

        const getModText = (val) => {
            const m = Math.floor((val - 10) / 2);
            return m >= 0 ? "+" + m : String(m);
        };

        let paramsGridHTML = "";
        params.forEach(p => {
            const mod = getModText(p.val);
            const modifier = (actor._statModifiers && actor._statModifiers[p.id]) || 0;
            let displayValHTML = `<span class="stat-number">${p.val}</span>`;
            if (modifier !== 0) {
                const origVal = p.val - modifier;
                displayValHTML = `
                    <span class="stat-number debuffed" style="text-decoration: line-through; color: var(--text-blood-red); font-size: 0.892em; margin-right: 4px">${origVal}</span>
                    <span class="stat-number">${p.val}</span>
                `;
            }

            paramsGridHTML += `
                <div class="stat-medallion">
                    <div class="stat-medallion-lbl">${p.name}</div>
                    <div class="stat-medallion-val">${displayValHTML}</div>
                </div>
            `;
        });
        const medallionsEl = spread.querySelector("#status-medallions");
        if (medallionsEl) medallionsEl.innerHTML = paramsGridHTML;

        // Alignment Element
        let elementHTML = "";
        const actorClass = actor.currentClass();
        if (actorClass && actorClass.note) {
            const elemMatch = actorClass.note.match(/<elem:\s*(\d+)>/);
            if (elemMatch) {
                const elementId = parseInt(elemMatch[1]);
                if (elementId > 0 && elementId < $dataSystem.elements.length) {
                    const elementName = $dataSystem.elements[elementId];
                    const elementIcons = [0, 96, 64, 65, 66, 67, 68, 69, 70, 71];
                    const elementIcon = elementIcons[elementId] || 0;
                    const x = (elementIcon % 16) * 32;
                    const y = Math.floor(elementIcon / 16) * 32;

                    elementHTML = `
                        <div class="status-element-box">
                            <span class="element-title">${T('SceneStatus.ui.alignment')}</span>
                            <span class="element-badge">
                                <span class="icon" style="background: url('img/system/IconSet.png') -${x}px -${y}px no-repeat; width: 32px; height: 32px; display: inline-block; transform: scale(0.7); vertical-align: middle; margin-right: -4px"></span>
                                <span style="vertical-align: middle">${elementName}</span>
                            </span>
                        </div>
                    `;
                }
            }
        }
        const alignmentContainer = spread.querySelector("#status-alignment-container");
        if (alignmentContainer) alignmentContainer.innerHTML = elementHTML;

        // Magic System badge (gen_class_magic_system_tags.js): only a
        // magical class carries the tag at all, so a mundane profession's
        // row simply stays empty rather than printing "None".
        let magicSystemHTML = "";
        if (actorClass && actorClass.note) {
            const magicMatch = actorClass.note.match(/<MagicalSystem:\s*([^>]+)>/i);
            if (magicMatch) {
                const systemKey = magicMatch[1].trim();
                const systemName = T('SkillsMenu.magicSystem.' + systemKey) || systemKey;
                magicSystemHTML = `
                    <div class="status-element-box">
                        <span class="element-title">${T('SceneStatus.ui.magicSystem')}</span>
                        <span class="element-badge">
                            <span style="vertical-align: middle">${systemName}</span>
                        </span>
                    </div>
                `;
            }
        }
        const magicSystemContainer = spread.querySelector("#status-magicsystem-container");
        if (magicSystemContainer) magicSystemContainer.innerHTML = magicSystemHTML;

        // Traits, each one written out in full on its own tab: the page they
        // used to share was never tall enough for a dossier, so they were chips
        // that had to be hovered one at a time to say anything.
        const traitsEl = spread.querySelector("#status-traits");
        if (traitsEl) traitsEl.innerHTML = buildTraitsPageHTML(actor);

        // The illnesses page is Health_DiseaseSystem's own sheet, printed
        // verbatim, so the status screen and the Biologics tab can never
        // disagree about what somebody is carrying or what would treat it.
        const diseasesEl = spread.querySelector("#status-diseases");
        if (diseasesEl) {
            diseasesEl.innerHTML = window.DiseaseSystem && window.DiseaseSystem.panelHTML
                ? window.DiseaseSystem.panelHTML(actor)
                : `<div class="status-traits-empty">${T('SceneStatus.ui.noDiseaseData')}</div>`;
        }

        // Body archetype, sourced from Health_Core. A creature built from two
        // archetypes is a hybrid and is named as both; the gestation term shown
        // is the one a pregnancy of this actor would actually run for (the
        // median of the two, or a single day for mitosis).
        const archetypeLabelEl = spread.querySelector("#status-archetype-label");
        const archetypeEl = spread.querySelector("#status-archetype");
        if (archetypeEl) {
            const health = window.HealthCore;
            const keys = (health && health.getActorArchetypeKeys)
                ? health.getActorArchetypeKeys(actor) : [];
            const names = keys.map(k => health.getArchetypeDisplayName(k)).filter(Boolean);
            const isHybrid = names.length > 1;
            if (archetypeLabelEl) {
                archetypeLabelEl.textContent = isHybrid
                    ? T("SceneStatus.ui.hybridArchetype")
                    : T("SceneStatus.ui.archetype");
            }
            if (names.length) {
                const ccUtils = window.CharacterCreationUtils;
                const memberIndex = $gameParty.members().indexOf(actor);
                const repVar = (ccUtils && ccUtils.getReproductiveVariableId)
                    ? ccUtils.getReproductiveVariableId(Math.max(0, memberIndex)) : 87;
                const repType = $gameVariables.value(repVar);
                const term = health.getPregnancyDuration(actor, repType);
                archetypeEl.innerHTML = `
                    <div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px">
                        <span style="font-weight:bold; color:var(--text-primary-hover); font-size:0.942em">${names.join(" / ")}</span>
                        <span style="color:var(--text-card-medium); font-size:0.856em; white-space:nowrap">${T('SceneStatus.ui.gestationTerm', { days: term })}</span>
                    </div>
                `;
            } else {
                archetypeEl.innerHTML = `<div style="color:var(--text-card-medium); font-size:0.856em">${T('SceneStatus.ui.noArchetype')}</div>`;
            }
        }

        // Passive abilities: the class's signature passive plus every trait
        // passive this character carries, all of them always on.
        const passivesEl = spread.querySelector("#status-passives-list");
        if (passivesEl) passivesEl.innerHTML = buildPassivesHTML(actor);

        // Biological Body Parts List
        if (!actor._bodyParts && window.initializeBodyParts) {
            window.initializeBodyParts(actor);
        }
        const bodyParts = [];
        if (actor._bodyParts) {
            for (const key in actor._bodyParts) {
                if (actor._bodyParts[key]) bodyParts.push(actor._bodyParts[key]);
            }
        }
        bodyParts.sort((a, b) => {
            const aD = (a.destroyed || a.currentHp <= 0) ? 0 : 1;
            const bD = (b.destroyed || b.currentHp <= 0) ? 0 : 1;
            return aD - bD;
        });

        let bodyPartsHTML = "";
        if (bodyParts.length === 0) {
            bodyPartsHTML = `<div style="font-family: 'Lora', serif; text-align: center; color: var(--text-card-medium); padding: 12px; font-size:0.892em">${T('SceneStatus.ui.noVitals')}</div>`;
        } else {
            bodyParts.forEach((part, idx) => {
                const isDestroyed = part.destroyed || part.currentHp <= 0;
                const hpRate = part.maxHp > 0 ? (part.currentHp / part.maxHp) : 0;
                const hpPercent = Math.round(hpRate * 100);
                const isSelected = (this._dndActiveSection === "bodyparts" && this._dndSelectedIndex === idx) ? "selected" : "";
                const strikeClass = isDestroyed ? "destroyed" : "";
                const hpText = isDestroyed ? "DESTROYED" : `${part.currentHp}/${part.maxHp}`;
                const barWidth = isDestroyed ? 0 : hpPercent;
                const partName = (typeof part.name === 'string' && part.name.includes('.') && window.getArchetypeText)
                    ? window.getArchetypeText(part.name)
                    : part.name;

                bodyPartsHTML += `
                    <div class="bodypart-row ${isSelected} ${strikeClass}" onclick="SceneManager._scene.selectUIBodyPart(${idx})">
                        <span class="bodypart-name">${partName}</span>
                        <div class="bodypart-hp-container">
                            <div class="bodypart-bar" style="width: ${barWidth}%"></div>
                            <span class="bodypart-hp-val">${hpText}</span>
                        </div>
                    </div>
                `;
            });
        }
        const bodyPartsEl = spread.querySelector("#bodyparts-scroll-container");
        if (bodyPartsEl) bodyPartsEl.innerHTML = bodyPartsHTML;

        // 4. Draw bust portrait canvas
        this.drawUIStatusBust(actor, "status-bust");

        // 5. Scroll selected body part into view if active
        if (this._dndActiveSection === "bodyparts" && this._dndActiveTab === "anatomy") {
            const selectedPart = spread.querySelector(".bodypart-row.selected");
            if (selectedPart) {
                selectedPart.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }
        }
    };

    //=============================================================================
    // Right-page tab controller. Only the active panel is in the layout, so a
    // section never has to share the page's height with the two it replaced.
    //=============================================================================

    Scene_Status.prototype.applyStatusTab = function () {
        if (!this._dndContainer) return;
        this._dndContainer.querySelectorAll(".status-tab-panel").forEach(panel => {
            panel.classList.toggle("active", panel.dataset.statusTab === this._dndActiveTab);
        });
        this._dndContainer.querySelectorAll("[data-status-tab-btn]").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.statusTabBtn === this._dndActiveTab);
        });
    };

    Scene_Status.prototype.selectStatusTab = function (tabId, silent) {
        if (!STATUS_TABS.some(tab => tab.id === tabId)) return;
        if (this._dndActiveTab === tabId) return;
        this._dndActiveTab = tabId;
        rememberStatusTab(tabId);
        if (!silent) SoundManager.playCursor();
        this.refreshUIStatus();
    };

    Scene_Status.prototype.cycleStatusTab = function (direction) {
        const index = STATUS_TABS.findIndex(tab => tab.id === this._dndActiveTab);
        const next = (index + direction + STATUS_TABS.length) % STATUS_TABS.length;
        this.selectStatusTab(STATUS_TABS[next].id);
    };

    // The full social sheet for this character, the same panel an NPC is read
    // in. Pushed, so Cancel there comes straight back to this screen.
    Scene_Status.prototype.openStatusEmpathize = function () {
        const actor = this.actor();
        if (!actor || !window.NPCEmpathize || !window.NPCEmpathize.openForActor) return;
        SoundManager.playOk();
        window.NPCEmpathize.openForActor(actor.actorId());
    };

    Scene_Status.prototype.drawUIStatusBust = function (actor, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        // Creature actors render a live procedural 3D model (reusing the Bestiary
        // viewport) in place of the flat 2D enemy battler, when the 3D battler
        // system is active and the chosen battler maps to a model.
        const info3D = this.getStatus3DInfo(actor);
        if (info3D) {
            canvas.style.display = 'none';
            this.syncStatus3D(info3D);
            return;
        }
        // Not a 3D creature: tear down any prior viewer and show the 2D portrait.
        this.cleanupStatus3D();
        canvas.style.display = '';

        const bustPath = getActorBustImagePath(actor);
        if (!bustPath) return;

        const bitmap = ImageManager.loadBitmap('', bustPath);
        const drawBust = () => {
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.imageSmoothingEnabled = true;

            const shouldCrop = false;
            const sourceWidth = bitmap.width > 0 ? bitmap.width : 889;
            const sourceHeight = bitmap.height > 0 ? bitmap.height : 1200;

            let cropTop = 0;
            let cropLeft = 0;
            let croppedSourceWidth = sourceWidth;
            let croppedSourceHeight = sourceHeight;

            const aspectRatio = croppedSourceWidth / croppedSourceHeight;
            let drawWidth = canvas.width;
            let drawHeight = Math.round(canvas.width / aspectRatio);

            if (drawHeight > canvas.height) {
                drawHeight = canvas.height;
                drawWidth = Math.round(canvas.height * aspectRatio);
            }

            const drawX = Math.round((canvas.width - drawWidth) / 2);
            const drawY = Math.round((canvas.height - drawHeight) / 2);

            ctx.drawImage(bitmap.canvas, cropLeft, cropTop, croppedSourceWidth, croppedSourceHeight, drawX, drawY, drawWidth, drawHeight);
        };

        if (bitmap.isReady()) {
            drawBust();
        } else {
            bitmap.addLoadListener(drawBust);
        }
    };

    //=============================================================================
    // 3D portrait viewport for creature actors (ported from Bestiary.js).
    // Only used when the 3D battler system is active and the actor's chosen
    // battler image resolves to a procedural archetype.
    //=============================================================================

    Scene_Status.prototype.getStatus3DInfo = function (actor) {
        if (!actor) return null;
        if (!(typeof THREE !== 'undefined' && window.Battler3D && window.Battler3D.create && window.Battler3D.resolveKey)) return null;
        // Portrait style is an exclusive choice made at character creation and
        // stored on the actor: a humanoid is EITHER a drawn bust OR a 3D model,
        // a creature EITHER a 2D battler image OR a 3D model. Anything but
        // "model" renders flat art, even when a stale 3D config is still around.
        // An unset value (characters made before the choice existed) keeps the
        // old behaviour of preferring the 3D model when one resolves.
        const portraitMode = typeof actor.portraitMode === 'function' ? actor.portraitMode() : 0;
        if (portraitMode === 'bust' || portraitMode === 'sprite') return null;
        // A monster recruited through the talk system records the enemy it came
        // from, so its own bespoke model is built instead of the first enemy
        // that happens to share the same battler art. The record is ignored once
        // the slot's portrait no longer matches it (a later character rewrote
        // the slot and never cleared the id).
        const recruitedId = actor._recruitedEnemyId;
        const recruited = recruitedId ? $dataEnemies[recruitedId] : null;
        const battlerField = typeof actor.vnBattler === 'function' ? actor.vnBattler() : null;
        if (recruited && battlerField && recruited.battlerName === battlerField) {
            const recruitKey = window.Battler3D.resolveKey(recruited);
            if (recruitKey) {
                return { kind: 'enemy', archKey: recruitKey, enemyId: recruited.id, actorId: actor.actorId() };
            }
        }
        // Creature monster form: getActorBustImagePath returns an img/enemies/
        // path precisely in that case, and the flat 2D enemy battler is
        // replaced by its procedural 3D model.
        const bustPath = getActorBustImagePath(actor);
        const marker = 'img/enemies/';
        if (bustPath && bustPath.includes(marker)) {
            const battlerName = bustPath.substring(bustPath.indexOf(marker) + marker.length);
            if (!battlerName) return null;
            // Resolve the procedural model from the enemy whose battler image matches.
            for (const enemy of $dataEnemies) {
                if (!enemy || enemy.battlerName !== battlerName) continue;
                const key = window.Battler3D.resolveKey(enemy);
                if (key) return { kind: 'enemy', archKey: key, enemyId: enemy.id, actorId: actor.actorId() };
            }
            return null;
        }
        // Humanoid actors with a saved character-creation 3D model config
        // render their customized procedural model instead of the flat bust.
        if (window.CC3DModel && window.CC3DModel.isAvailable && window.CC3DModel.isAvailable()) {
            const cfg = window.CC3DModel.getConfig(actor.actorId());
            if (cfg) return { kind: 'custom', cfg: cfg, actorId: actor.actorId() };
        }
        return null;
    };

    // Stable identity for a 3D portrait: rebuilding is only needed when the
    // subject actually changes (different creature, edited custom config).
    function status3DKey(info) {
        return info.kind === 'custom'
            ? 'custom:' + info.actorId + ':' + JSON.stringify(info.cfg)
            : 'enemy:' + info.enemyId;
    }

    Scene_Status.prototype.syncStatus3D = function (info) {
        const canvas = document.getElementById('status-bust-3d');
        const key = status3DKey(info);
        // Already showing this subject on a live canvas: just refresh which
        // limbs are hidden (they may have broken/healed since), then bail.
        if (this._status3D && canvas && this._status3D.canvas === canvas && this._status3DKey === key) {
            const m = this._status3D.model;
            const parts = (this.actor() && this.actor()._bodyParts) || null;
            if (m && parts && m.hideBrokenParts) { try { m.hideBrokenParts(parts); } catch (e) {} }
            return;
        }
        this._status3DKey = key;
        this.initStatus3D(info);
    };

    Scene_Status.prototype.initStatus3D = function (info) {
        this.cleanupStatus3D();
        if (typeof THREE === 'undefined' || !window.Battler3D || !window.Battler3D.create) return;
        const bustCanvas = document.getElementById('status-bust');
        const wrapper = bustCanvas ? bustCanvas.parentNode : null;
        if (!wrapper) return;

        // Reuse or create the 3D canvas overlay, sized to match the bust area.
        let canvas = document.getElementById('status-bust-3d');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'status-bust-3d';
            // Sized by the stylesheet (100% of the portrait box, letterboxed),
            // never in pixels: a fixed size would spill over the gauges below
            // once the page is shorter than the portrait.
            canvas.style.cssText = 'display:block; cursor:grab;';
            wrapper.appendChild(canvas);
        }
        canvas.style.display = 'block';

        const width = 440, height = 500;
        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
        renderer.setSize(width, height, false);
        renderer.setPixelRatio(1);

        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const keyLight  = new THREE.DirectionalLight(0xfff2d0, 0.85); keyLight.position.set(3, 5, 4);   scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xbcd4ff, 0.35); fillLight.position.set(-3, -2, 2); scene.add(fillLight);

        const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 300);
        camera.position.set(0, 0, 8);

        const pivot = new THREE.Group();
        scene.add(pivot);

        const state = {
            renderer, canvas, scene, camera, pivot,
            model: null, rafId: 0, disposed: false, dragging: false, attackTimer: 0, frameAcc: 0,
            activeButton: -1, prev: { x: 0, y: 0 }, clock: new THREE.Clock(), listeners: {}
        };
        this._status3D = state;

        // Build the subject: a creature's archetype model (rebuilt with the
        // random look seed rolled at creation, when one was saved) or the
        // custom humanoid assembled in the character-creation 3D step.
        let loadPromise;
        if (info.kind === 'custom') {
            loadPromise = window.CC3DModel.buildModel(info.cfg, info.actorId);
        } else {
            const fakeBattler = { enemyId: () => info.enemyId, index: () => 0 };
            const storedSeed = (window.CC3DModel && window.CC3DModel.getCreatureSeed)
                ? window.CC3DModel.getCreatureSeed(info.actorId) : null;
            const make = () => window.Battler3D.create(info.archKey, 0, 0, fakeBattler);
            const built = (storedSeed && window.CC3DModel && window.CC3DModel.withGenSeed)
                ? window.CC3DModel.withGenSeed(storedSeed, make) : make();
            if (!built) {
                try { renderer.dispose(); } catch (e) {}
                try { if (renderer.forceContextLoss) renderer.forceContextLoss(); } catch (e) {}
                this._status3D = null;
                return;
            }
            loadPromise = Promise.resolve(built.load(null, 0, 0, 0)).then(() => built);
        }

        // Reflect this creature's broken limbs: hide the meshes of any destroyed
        // body part (root parts are protected by the model, so it never blanks
        // the whole figure).
        const brokenParts = (this.actor() && this.actor()._bodyParts) || null;

        loadPromise.then((battler) => {
            if (!battler || state.disposed || !battler.model) return;
            try { battler.update(1 / 60); } catch (e) {}
            try { if (brokenParts && battler.hideBrokenParts) battler.hideBrokenParts(brokenParts); } catch (e) {}
            const box    = new THREE.Box3().setFromObject(battler.model);
            const size   = new THREE.Vector3(); box.getSize(size);
            const center = new THREE.Vector3(); box.getCenter(center);
            const holder = new THREE.Group();
            holder.position.copy(center).multiplyScalar(-1);
            holder.add(battler.model);
            if (window.PSXShader) window.PSXShader.applyToObject(battler.model);
            pivot.add(holder);
            const maxDim = Math.max(size.x, size.y, size.z) || 1;
            const fitDist = maxDim / (2 * Math.tan((40 * Math.PI / 180) / 2));
            camera.position.set(0, 0, fitDist * 1.2);
            camera.lookAt(0, 0, 0);
            state.model = battler;
            state.attackTimer = 1.2;
        }).catch(() => {});

        // ── Mouse / touch controls (mirror the Bestiary 3D preview) ─────────
        const L = state.listeners;
        L.onDown = (e) => {
            if (e.button === 0 || e.button === 1) {
                state.activeButton = e.button; state.dragging = true;
                state.prev = { x: e.clientX, y: e.clientY };
                if (e.button === 1) e.preventDefault();
                canvas.style.cursor = 'grabbing';
            }
        };
        L.onMove = (e) => {
            if (state.activeButton === -1) return;
            const dx = e.clientX - state.prev.x, dy = e.clientY - state.prev.y;
            if (state.activeButton === 0) {
                pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
            } else if (state.activeButton === 1) {
                const ps = 0.0035 * camera.position.z;
                camera.position.x -= dx * ps; camera.position.y += dy * ps;
            }
            state.prev = { x: e.clientX, y: e.clientY };
        };
        L.onUp = () => { state.activeButton = -1; state.dragging = false; canvas.style.cursor = 'grab'; };
        L.onWheel = (e) => {
            e.preventDefault();
            e.stopPropagation();
            camera.position.z = Math.max(1.5, Math.min(60, camera.position.z + e.deltaY * 0.012));
        };
        L.onAux = (e) => { if (e.button === 1) e.preventDefault(); };
        L.onCtx = (e) => e.preventDefault();
        L.onTStart = (e) => { if (e.touches.length === 1) { state.dragging = true; state.activeButton = 0; state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY }; } };
        L.onTMove = (e) => {
            if (e.touches.length === 1) {
                const dx = e.touches[0].clientX - state.prev.x, dy = e.touches[0].clientY - state.prev.y;
                pivot.rotation.y += dx * 0.012; pivot.rotation.x += dy * 0.012;
                state.prev = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        };
        L.onTEnd = () => { state.dragging = false; state.activeButton = -1; };

        canvas.addEventListener('mousedown',   L.onDown);
        canvas.addEventListener('mousemove',   L.onMove);
        window.addEventListener('mouseup',     L.onUp);
        canvas.addEventListener('wheel',       L.onWheel, { passive: false });
        canvas.addEventListener('auxclick',    L.onAux);
        canvas.addEventListener('contextmenu', L.onCtx);
        canvas.addEventListener('touchstart',  L.onTStart);
        canvas.addEventListener('touchmove',   L.onTMove);
        window.addEventListener('touchend',    L.onTEnd);

        const FRAME = 1 / 30;
        const animate = () => {
            if (state.disposed) return;
            state.rafId = requestAnimationFrame(animate);
            state.frameAcc += Math.min(state.clock.getDelta(), 0.05);
            if (state.frameAcc < FRAME) return;
            const dt = state.frameAcc;
            state.frameAcc = 0;
            if (state.model) {
                state.attackTimer -= dt;
                if (state.attackTimer <= 0 && state.model.currentAnimation === 'idle') {
                    const anim = (state.model.hasAnimation('specialattack') && Math.random() < 0.4)
                        ? 'specialattack' : 'attack';
                    try { state.model.playAnimation(anim, false); } catch (e) {}
                    state.attackTimer = 2.4 + Math.random() * 1.6;
                }
                try { state.model.update(dt); } catch (e) {}
            }
            if (window.PSXShader) {
                window.PSXShader.render(renderer, scene, camera);
            } else {
                renderer.render(scene, camera);
            }
        };
        animate();
    };

    Scene_Status.prototype.cleanupStatus3D = function () {
        const s = this._status3D;
        this._status3DKey = null;
        if (!s) return;
        s.disposed = true;
        cancelAnimationFrame(s.rafId);
        const L = s.listeners || {}, c = s.canvas;
        if (c) {
            c.removeEventListener('mousedown',   L.onDown);
            c.removeEventListener('mousemove',   L.onMove);
            c.removeEventListener('wheel',       L.onWheel);
            c.removeEventListener('auxclick',    L.onAux);
            c.removeEventListener('contextmenu', L.onCtx);
            c.removeEventListener('touchstart',  L.onTStart);
            c.removeEventListener('touchmove',   L.onTMove);
            if (c.parentNode) c.parentNode.removeChild(c);
        }
        window.removeEventListener('mouseup',  L.onUp);
        window.removeEventListener('touchend', L.onTEnd);
        // dispose() leaves the WebGL context alive. The browser caps live
        // contexts and force-loses the OLDEST past the cap, which is the game's
        // own canvas: PIXI then silently stops rendering and the picture freezes
        // until the game is restarted. A fresh canvas is built on every open, so
        // releasing the context here costs nothing.
        try { s.renderer.dispose(); } catch (e) {}
        try { if (s.renderer.forceContextLoss) s.renderer.forceContextLoss(); } catch (e) {}
        this._status3D = null;
    };

    Scene_Status.prototype.selectUIActor = function (index) {
        if (index >= 0 && index < $gameParty.allMembers().length) {
            this._actorIndex = index;
            SoundManager.playCursor();
            this.refreshActor();
        }
    };

    Scene_Status.prototype.selectUIBodyPart = function (index) {
        this._dndActiveSection = "bodyparts";
        this._dndSelectedIndex = index;
        SoundManager.playCursor();
        this.refreshUIStatus();
    };

    Scene_Status.prototype.getUIReproductionName = function (type) {
        switch (type) {
            case -1: return T("MainMenu.reproduction.none");
            case 0: return T("MainMenu.reproduction.testicles");
            case 1: return T("MainMenu.reproduction.uterus");
            case 2: return T("MainMenu.reproduction.oviparous");
            case 3: return T("MainMenu.reproduction.plant");
            case 4: return T("MainMenu.reproduction.mitosis");
            default: return T("MainMenu.reproduction.unknown");
        }
    };

    Scene_Status.prototype.getUIGenderName = function (gender) {
        switch (gender) {
            case 0: return T("MainMenu.gender.male");
            case 1: return T("MainMenu.gender.female");
            case 2: return T("MainMenu.gender.nonBinary");
            case 3: return T("MainMenu.gender.cocoon");
            default: return T("MainMenu.gender.fluid");
        }
    };

    Scene_Status.prototype.updateUIStatusInput = function () {
        if (Input.isTriggered('cancel') || TouchInput.isCancelled()) {
            SoundManager.playCancel();
            this.popScene();
            return;
        }

        // The shoulder buttons keep the party switcher they have on every other
        // book spread; left / right now turn the page's own tabs, which is the
        // only thing those keys can mean once the right page has sections.
        if (Input.isTriggered('pagedown')) {
            this.nextActor();
            return;
        }

        if (Input.isTriggered('pageup')) {
            this.previousActor();
            return;
        }

        if (Input.isTriggered('right')) {
            this.cycleStatusTab(1);
            return;
        }

        if (Input.isTriggered('left')) {
            this.cycleStatusTab(-1);
            return;
        }

        // The traits page is a stack of dossiers rather than a list of rows, so
        // there is nothing to move a cursor over: the keys scroll it.
        if (this._dndActiveTab === "traits") {
            const list = this._dndContainer && this._dndContainer.querySelector("#status-traits");
            if (list) {
                if (Input.isRepeated('down')) list.scrollTop += TRAIT_SCROLL_STEP;
                else if (Input.isRepeated('up')) list.scrollTop -= TRAIT_SCROLL_STEP;
            }
            return;
        }

        if (this._dndActiveTab !== "anatomy") return;

        const actor = this.actor();
        if (actor && actor._bodyParts) {
            const bodyParts = [];
            for (const key in actor._bodyParts) {
                if (actor._bodyParts[key]) bodyParts.push(actor._bodyParts[key]);
            }

            if (bodyParts.length > 0) {
                if (Input.isRepeated('down')) {
                    this._dndActiveSection = "bodyparts";
                    this._dndSelectedIndex = (this._dndSelectedIndex + 1) % bodyParts.length;
                    SoundManager.playCursor();
                    this.refreshUIStatus();
                    return;
                }
                if (Input.isRepeated('up')) {
                    this._dndActiveSection = "bodyparts";
                    this._dndSelectedIndex = (this._dndSelectedIndex - 1 + bodyParts.length) % bodyParts.length;
                    SoundManager.playCursor();
                    this.refreshUIStatus();
                    return;
                }
            }
        }
    };

    //=============================================================================
    // Window Constructors & Stub Prototypes for MZ compatibility
    //=============================================================================

    function Window_CustomStatus() {
        this.initialize(...arguments);
    }
    Window_CustomStatus.prototype = Object.create(Window_StatusBase.prototype);
    Window_CustomStatus.prototype.constructor = Window_CustomStatus;
    Window_CustomStatus.prototype.initialize = function (rect) {
        Window_StatusBase.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_CustomStatus.prototype.setActor = function (actor) { };
    Window_CustomStatus.prototype.setActorIndex = function (index) { };

    function Window_StatusStates() {
        this.initialize(...arguments);
    }
    Window_StatusStates.prototype = Object.create(Window_Base.prototype);
    Window_StatusStates.prototype.constructor = Window_StatusStates;
    Window_StatusStates.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_StatusStates.prototype.setActor = function (actor) { };

    function Window_StatusParams() {
        this.initialize(...arguments);
    }
    Window_StatusParams.prototype = Object.create(Window_Base.prototype);
    Window_StatusParams.prototype.constructor = Window_StatusParams;
    Window_StatusParams.prototype.initialize = function (rect) {
        Window_Base.prototype.initialize.call(this, rect);
        this.visible = false;
        this.active = false;
    };
    Window_StatusParams.prototype.setActor = function (actor) { };

})();