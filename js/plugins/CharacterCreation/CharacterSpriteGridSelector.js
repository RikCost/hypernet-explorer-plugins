/*:
 * @target MZ
 * @plugindesc [v2.6] Grid-based character sprite selector with bust selection window.
 * @author OmniLex (Modified by Claude)
 *
 * The board lays itself out from the page it is given (see SPRITE_GRID_COLS);
 * the old GridColumns / GridRows parameters only ever sized a preload batch
 * and are gone with it.
 *
 * @command OpenSpriteSelector
 * @text Open Sprite Selector
 * @desc Opens the grid-based sprite selection UI to pick a sprite for Actor #1.
 *
 * @command OpenSpriteSelectorForActor
 * @text Open Sprite Selector For Actor
 * @desc Opens the sprite selection UI for a specific actor.
 *
 * @arg actorId
 * @text Actor ID
 * @desc The ID of the actor to change the sprite for.
 * @type number
 * @min 1
 * @default 1
 *
 * @command SelectRandomSprite
 * @text Select Random Sprite
 * @desc Randomly selects a sprite for a specific actor without opening the UI.
 *
 * @arg actorId
 * @text Actor ID
 * @desc The ID of the actor to change the sprite for.
 * @type number
 * @min 1
 * @default 1
 */

(() => {
  const pluginName = "CharacterSpriteGridSelector";

  // Bust categories are ids (the bust file name prefix). This is the one place
  // they are shown, so this is the one place they are translated.
  const bustCategoryLabel = (cat) => {
    const key = 'CharCreate.bustCategory.' + cat;
    return T.has(key) ? T(key) : cat;
  };

  // Unified sprite sheet configuration with cutoffs
  // cutoff: max sprite index to include (0 = first sprite only, 7 = all 8 sprites, null = use default)
  const SPRITE_SHEET_CONFIG = {
    "Skab/!$KillerBot": { cutoff: 0 },
    "Skab/!$2": { cutoff: 0 },
    "Skab/!$3": { cutoff: 0 },
    "Skab/!$AirlinePilot": { cutoff: 0 },
    "Skab/!$AlienDargos": { cutoff: 0 },
    "Skab/!$AlienGrey": { cutoff: 0 },
    "Skab/!$AlienTrucker": { cutoff: 0 },
    "Skab/!$AlpineGuide": { cutoff: 0 },
    "Skab/!$Anarchist": { cutoff: 0 },
    "Skab/!$AnarchistSamurai": { cutoff: 0 },
    "Skab/!$11": { cutoff: 0 },
    "Skab/!$AndroidArchpriest": { cutoff: 0 },
    "Skab/!$AndroidExperiment": { cutoff: 0 },
    "Skab/!$14": { cutoff: 0 },
    "Skab/!$Archivist": { cutoff: 0 },
    "Skab/!$ArchivistBackpacker": { cutoff: 0 },
    "Skab/!$AvianCommando": { cutoff: 0 },
    "Skab/!$ArchivistGuard": { cutoff: 0 },
    "Skab/!$19": { cutoff: 0 },
    "Skab/!$AvianNoble": { cutoff: 0 },
    "Skab/!$21": { cutoff: 0 },
    "Skab/!$Farmer": { cutoff: 0 },
    "Skab/!$GoblinRecruit": { cutoff: 0 },
    "Skab/!$GoblinShogun": { cutoff: 0 },
    "Skab/!$BotSpaceman": { cutoff: 0 },
    "Skab/!$BotGuardian": { cutoff: 0 },
    "Skab/!$GnomeExplorer": { cutoff: 0 },
    "Skab/!$28": { cutoff: 0 },
    "Skab/!$Catboy": { cutoff: 0 },
    "Skab/!$CatCourier": { cutoff: 0 },
    "Skab/!$ElvenPirate": { cutoff: 0 },
    "Skab/!$32": { cutoff: 0 },
    "Skab/!$33": { cutoff: 0 },
    "Skab/!$VoidPerson": { cutoff: 0 },
    "Skab/!$Witch1": { cutoff: 0 },
    "Skab/!$SwordInstructor": { cutoff: 0 },
    "Skab/!$Samurai": { cutoff: 0 },
    "Skab/!$SchoolTeacher": { cutoff: 0 },
    "Skab/!$PirateAdventurer": { cutoff: 0 },
    "Skab/!$OrcSamurai": { cutoff: 0 },
    "Skab/!$AncientWitch": { cutoff: 0 },
    "Skab/!$BotSamurai": { cutoff: 0 },
    "Skab/!$DesertPunk": { cutoff: 0 },
    "Skab/!$Doctor2": { cutoff: 0 },
    "Skab/!$ElvenSpacer": { cutoff: 0 },
    "Skab/!$ExoticBard": { cutoff: 0 },
    "Skab/!$Fisherman": { cutoff: 0 },
    "Skab/!$GoblinIllusionist": { cutoff: 0 },
    "Skab/!$HighCommand": { cutoff: 0 },
    "Skab/!$LeatherDaddy": { cutoff: 0 },
    "Skab/!$Lich": { cutoff: 0 },
    "Skab/!$Madman": { cutoff: 0 },
    "Skab/!$Mafia": { cutoff: 0 },
    "Skab/!$Nurse2": { cutoff: 0 },
    "Skab/!$PrimaryDoctor": { cutoff: 0 },
    "Skab/!$WastelandParamedic": { cutoff: 0 },
  };

  // Sprite sheets offered in the grid are driven by NPCs.json. window.WorldGen.NPCs
  // is loaded synchronously by DataService before plugin IIFEs run (same source
  // the NPCSystem character pool uses). SPRITE_SHEET_CONFIG is kept only as an
  // optional per-sheet cutoff override (see loop below); it no longer decides
  // which sheets appear. Falls back to the config keys if the DB is unavailable.
  // ONE rule decides what is on the board: "npc": true, nothing else. Beta
  // sheets (NPCs.json -> beta, a sheet outside the original folder) are on it
  // too, but they are dealt AFTER every ordinary sheet, under their own header,
  // so the top of the board is always the curated set. The grid lazy-loads a
  // page at a time, so the longer list costs nothing to enter.
  const npcDatabase = window.WorldGen && window.WorldGen.NPCs;
  const isBetaSheet = (name) =>
    !!(npcDatabase && npcDatabase[name] && npcDatabase[name].beta === true);
  // A goblin world offers goblin faces and a monster world offers nothing that
  // reads as a person: the board is the world's own wardrobe, so it answers to
  // the same rule the procedural inhabitants are dealt from
  // (SpriteCatalog.allowedInPopulation). The board is built at load, before any
  // world is active, so it is rebuilt whenever the mode it was built for is no
  // longer the one in force (see rebuildSpriteBoard).
  // The board is keyed on BOTH world answers, since either can narrow it: the
  // alternate timeline (goblin / monster) and the magic level (severed bans
  // every magical face, unbound bans every ordinary one).
  const populationMode = () => {
    const pop = (window.SpriteCatalog && window.SpriteCatalog.populationMode)
      ? window.SpriteCatalog.populationMode() : "normal";
    const magic = (window.MagicNature && window.MagicNature.level()) || "normal";
    return pop + ":" + magic;
  };
  const allowedSheet = (name) => {
    const SC = window.SpriteCatalog;
    if (!SC) return true;
    const entry = npcDatabase && npcDatabase[name];
    if (SC.allowedInMagic && !SC.allowedInMagic(name, entry)) return false;
    if (SC.allowedInPopulation && !SC.allowedInPopulation(name, entry)) return false;
    return true;
  };
  // Inside each of those two blocks the Skab folder is dealt first: it holds the
  // faces this world was drawn for, so it leads whichever block it lands in.
  const isSkabSheet = (name) => name.startsWith("Skab/");
  const spriteSheets = [];
  function rebuildSpriteSheets() {
    spriteSheets.length = 0;
    const offered = (npcDatabase
      ? Object.keys(npcDatabase).filter(
          (k) => npcDatabase[k] && npcDatabase[k].npc === true,
        )
      : Object.keys(SPRITE_SHEET_CONFIG)
    ).filter(allowedSheet);
    const deal = (beta) => {
      for (const name of offered) {
        if (isBetaSheet(name) === beta && isSkabSheet(name)) spriteSheets.push(name);
      }
      for (const name of offered) {
        if (isBetaSheet(name) === beta && !isSkabSheet(name)) spriteSheets.push(name);
      }
    };
    deal(false);
    deal(true);
  }
  rebuildSpriteSheets();

  // Build a comprehensive list of all sprite options (file + index) considering cutoffs
  const spriteOptions = [];
  // Where the beta block starts in that list, -1 when the board holds none.
  let BETA_START = -1;

  const decamelCase = (str) => {
    if (!str) return "";
    return str
      .replace(/_/g, " ")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  };

  function rebuildSpriteOptions() {
    spriteOptions.length = 0;
    BETA_START = -1;
    for (const name of spriteSheets) {
      const config = SPRITE_SHEET_CONFIG[name];
      // Determine cutoff index for this sheet (use config or default based on sheet type)
      let cutoffIndex = config && config.cutoff !== null ? config.cutoff : null;
      if (cutoffIndex === null) {
        // No cutoff given: default to 0 for single ($) sheets, or 7 for standard sheets (8 sprites)
        cutoffIndex = name.includes("$") ? 0 : 7;
      } else {
        // If cutoff provided, clamp it within valid range
        if (name.includes("$")) {
          cutoffIndex = 0; // single-character sheet can only have index 0
        } else if (cutoffIndex > 7) {
          cutoffIndex = 7; // multi-character sheets have at most indices 0-7
        }
      }

      // Add each sprite (up to cutoff index) as a separate option
      if (BETA_START < 0 && isBetaSheet(name)) BETA_START = spriteOptions.length;
      for (let index = 0; index <= cutoffIndex; index++) {
        spriteOptions.push({ name: name, index: index });
      }
    }
  }
  rebuildSpriteOptions();

  // Function to select a random sprite from available options
  function selectRandomSprite(actorId) {
    // A random face is drawn from the world's own wardrobe, so the board is
    // re-dealt first if this is the first ask inside a narrowed world.
    rebuildSpriteBoard();
    // Guard against empty sprite options
    if (!spriteOptions || spriteOptions.length === 0) {
      return undefined;
    }

    // Get random index from available sprites
    const randomIndex = Math.floor(Math.random() * spriteOptions.length);
    const randomSprite = spriteOptions[randomIndex];

    // Apply the randomly selected sprite to the specified actor
    const actor = $gameActors.actor(actorId);
    if (!actor) {
      return undefined;
    }
    actor.setCharacterImage(randomSprite.name, randomSprite.index);

    // Refresh player if this is the party leader. The party is genuinely empty
    // for part of character creation (it is rebuilt member by member), so the
    // leader is asked for rather than assumed.
    const leader = $gameParty && $gameParty.leader();
    if (leader && actorId === leader.actorId()) {
      $gamePlayer.refresh();
    }

    return randomSprite;
  }

  // Columns in the sprite board and the box each sprite is fitted into. Six
  // columns across the left page leaves room for double-size sprites. The
  // cursor and the board read this same number, so they can never disagree
  // about what sits above and below a cell.
  const SPRITE_GRID_COLS = 6;
  const SPRITE_GRID_SIZE = 96;
  // The right page's own portrait used to paint at SPRITE_GRID_SIZE and let a
  // CSS transform blow it up 2x afterward. A transform repaints outside the
  // element's box without the flex column ever reserving room for it, so the
  // walking sprite was drawn straight over the bust above it. Painting it at
  // its real final size instead means the layout actually holds space for
  // what is on screen. The no-bust plate has nothing above it to overlap, so
  // it keeps painting at SPRITE_GRID_SIZE and growing via CSS transform.
  const SPRITE_PREVIEW_SIZE = 192;

  // A dozen of the curated sheets are not the 3x4 grid RPG Maker assumes for a
  // "$" character: they hold a single facing row (DrivingInstructor, Jester,
  // Spacer, BotStellar...). Slicing them as four rows yields an 18px tall
  // letterbox of the sprite, and the frame aspect that comes out of it (96x18)
  // was blowing the board's columns open, since a "1fr" track never shrinks
  // below its content. Read the row count off the bitmap instead: a frame this
  // short cannot be a character.
  const SPRITE_MIN_FRAME_HEIGHT = 36;

  const spriteFrameGeometry = (spriteName) => {
    const isBig = ImageManager.isBigCharacter(spriteName);
    const bitmap = spriteName ? ImageManager.loadCharacter(spriteName) : null;
    const ready = !!bitmap && bitmap.width > 0 && bitmap.height > 0;
    const cols = isBig ? 3 : 12;
    let rows = isBig ? 4 : 8;
    if (ready && isBig && bitmap.height / rows < SPRITE_MIN_FRAME_HEIGHT) {
      rows = 1;
    }
    return {
      isBig,
      ready,
      bitmap,
      cols,
      rows,
      // Facings the sheet carries: a full sheet has 4, a single-row one has 1.
      dirRows: isBig ? rows : 4,
      frameW: ready ? bitmap.width / cols : 0,
      frameH: ready ? bitmap.height / rows : 0,
    };
  };

  // Frame drawn as a CSS background: which slice, and how the sheet is scaled.
  const spriteFrameBackground = (geo, spriteIndex, pattern, directionRow) => {
    const dir = geo.dirRows > 0 ? directionRow % geo.dirRows : 0;
    let fx;
    let fy;
    if (geo.isBig) {
      fx = pattern;
      fy = dir;
    } else {
      fx = (spriteIndex % 4) * 3 + pattern;
      fy = Math.floor(spriteIndex / 4) * 4 + dir;
    }
    const pctX = geo.cols > 1 ? (fx / (geo.cols - 1)) * 100 : 0;
    const pctY = geo.rows > 1 ? (fy / (geo.rows - 1)) * 100 : 0;
    return {
      position: `${pctX}% ${pctY}%`,
      size: `${geo.cols * 100}% ${geo.rows * 100}%`,
    };
  };

  // Fit one frame inside a square cell without distorting it, so no sheet can
  // ever push a grid column wider than the others.
  const spriteFrameBox = (geo, box) => {
    if (!geo.ready) return { width: box, height: box };
    const scale = Math.min(box / geo.frameW, box / geo.frameH);
    return {
      width: Math.round(geo.frameW * scale),
      height: Math.round(geo.frameH * scale),
    };
  };

  //===========================================================================
  // Sprite board
  //
  // The catalogue is 706 sheets. The old board built a card for every one of
  // them up front, and painted each card BEFORE its sheet had loaded: with no
  // bitmap there is no frame size, so the cell was written out as a 96x96
  // square with the whole sheet stretched into it, and a load listener resized
  // it the moment the file arrived. That is the squash-and-snap every sprite
  // did on the way in. Two rules replace it:
  //
  //   1. The grid is virtualised, the same way the bust gallery is: only the
  //      rows on screen exist as elements, three dozen cards rather than 706,
  //      and scrolling recycles them rather than building more.
  //   2. Nothing is ever painted at a guessed size. A cell is laid out at a
  //      fixed size and its art stays blank until the sheet reports its real
  //      frame, so a sprite appears at the right proportions and never resizes
  //      under the player.
  //
  // Nothing is drawn through Window_Base any more: the old Window_SpriteGrid
  // was held at opacity 0 behind the overlay and still blitted the visible
  // rows, and redrew the selected one every twelve frames.
  //===========================================================================

  const SPRITE_DIR = "img/characters/";
  const SPRITE_GRID_GAP = 10;
  const SPRITE_GRID_OVERSCAN = 1;
  // The card: the art box plus its padding.
  const SPRITE_CELL_H = SPRITE_GRID_SIZE + 16;
  // Frames between walk frames, and between the facings the selected sprite
  // turns through. Both were read off Graphics.frameCount before.
  const SPRITE_WALK_FRAMES = 12;
  const SPRITE_TURN_FRAMES = 48;
  // The band the "Beta sprites" header sits in, between the two blocks.
  const SPRITE_HEADER_H = 36;

  // The rows of the board, laid out once. A row belongs to one block or the
  // other and carries its own top, so the header's band is folded in here and
  // nowhere else: every other reader (the cursor, the virtualiser, the cell
  // placer) asks this table where a row stands rather than multiplying an
  // index by a row height. Columns stay plain arithmetic within a row, since a
  // block always starts a fresh one.
  const spriteRows = [];
  const spriteRowOfIndex = [];
  // Where the header band stands, -1 when the board holds no beta sheets.
  let spriteHeaderTop = -1;
  let spriteCanvasH = 0;
  function rebuildSpriteRows() {
    spriteRows.length = 0;
    spriteRowOfIndex.length = 0;
    for (let i = 0; i < spriteOptions.length; i++) spriteRowOfIndex.push(0);
    spriteHeaderTop = -1;
    let top = 0;
    const pushBlock = (from, to, beta) => {
      for (let i = from; i <= to; i += SPRITE_GRID_COLS) {
        const last = Math.min(to, i + SPRITE_GRID_COLS - 1);
        for (let k = i; k <= last; k++) spriteRowOfIndex[k] = spriteRows.length;
        spriteRows.push({ from: i, to: last, top, beta });
        top += SPRITE_CELL_H + SPRITE_GRID_GAP;
      }
    };
    const end = spriteOptions.length - 1;
    const ordinaryEnd = (BETA_START < 0 ? spriteOptions.length : BETA_START) - 1;
    if (ordinaryEnd >= 0) pushBlock(0, ordinaryEnd, false);
    if (BETA_START >= 0 && BETA_START <= end) {
      // A board that is nothing but beta sheets needs no divider.
      if (ordinaryEnd >= 0) {
        spriteHeaderTop = top;
        top += SPRITE_HEADER_H + SPRITE_GRID_GAP;
      }
      pushBlock(BETA_START, end, true);
    }
    spriteCanvasH = Math.max(0, top - SPRITE_GRID_GAP);
  }
  rebuildSpriteRows();

  // The whole board, re-dealt for the world in force. Cheap (a few thousand
  // array pushes) and only ever done when the answer has actually changed, so
  // opening the grid twice in one world costs nothing.
  // The bust gallery's half of the same rule. Categories the world has nothing
  // left in are dropped by the caller; a mode that filters everything away
  // keeps the gallery as it was, so a data gap is never a locked door.
  function filterBustCategories(categories) {
    const SC = window.SpriteCatalog;
    if (!SC || typeof SC.bustAllowedInPopulation !== "function") return categories;
    if (!SC.allowedBustNames || !SC.allowedBustNames()) return categories;
    const out = {};
    let kept = 0;
    for (const cat of Object.keys(categories || {})) {
      out[cat] = (categories[cat] || []).filter((n) => SC.bustAllowedInPopulation(n));
      kept += out[cat].length;
    }
    return kept ? out : categories;
  }

  let boardPopulationMode = populationMode();
  function rebuildSpriteBoard() {
    const mode = populationMode();
    if (mode === boardPopulationMode && spriteOptions.length) return;
    boardPopulationMode = mode;
    rebuildSpriteSheets();
    rebuildSpriteOptions();
    rebuildSpriteRows();
  }

  // Sheet names carry a folder and characters like "!$", which a path keeps
  // but a url must escape. encodeURI leaves the slash alone.
  const spriteSheetUrl = (name) => `${SPRITE_DIR}${encodeURI(name)}.png`;

  const spriteFrameKey = (name, index) => `${name}#${index}`;

  // The bust a sheet is drawn with, if it has one. NPCs.json carries one entry
  // per sprite index; a sheet with a single bust lends it to every index.
  const bustForSprite = (name, index) => {
    let busts = null;
    if (window.SpriteCatalog && window.SpriteCatalog.busts) {
      busts = window.SpriteCatalog.busts(name);
    }
    if ((!busts || !busts.length) && window.Sprites && window.Sprites.SpritesAssociation) {
      busts = window.Sprites.SpritesAssociation[name];
    }
    if (!busts || !busts.length) return null;
    return busts[index] !== undefined && busts[index] !== null ? busts[index] : busts[0];
  };

  // Paints one frame of a sheet onto an element, and answers whether it could.
  // Until the bitmap can report its real frame the element is left blank and
  // the paint repeats when the sheet arrives: writing a guessed size first and
  // correcting it after is what made every sprite squash and snap.
  const paintSpriteFrame = (el, name, index, box, pattern, directionRow) => {
    if (!el) return false;
    const key = spriteFrameKey(name, index);
    el.dataset.sprite = key;
    const geo = spriteFrameGeometry(name);
    if (!geo.ready) {
      el.style.backgroundImage = "none";
      el.style.opacity = "0";
      if (geo.bitmap) {
        geo.bitmap.addLoadListener(() => {
          // The element may have been recycled onto another sheet meanwhile.
          if (el.dataset.sprite !== key) return;
          paintSpriteFrame(el, name, index, box, pattern, directionRow);
        });
      }
      return false;
    }
    const frame = spriteFrameBackground(geo, index, pattern, directionRow);
    const size = spriteFrameBox(geo, box);
    el.style.width = `${size.width}px`;
    el.style.height = `${size.height}px`;
    el.style.backgroundImage = `url("${spriteSheetUrl(name)}")`;
    el.style.backgroundPosition = frame.position;
    el.style.backgroundSize = frame.size;
    el.style.opacity = "1";
    return true;
  };

  class Scene_SpriteGridSelector extends Scene_MenuBase {
    constructor() {
      super();
      this._actorId = 1;
    }

    setActor(actorId) {
      this._actorId = actorId || 1;
    }

    create() {
      // The creation common event opens this selector with a fixed actor id, so
      // retarget it at the party member actually being created; otherwise the
      // second and third characters would paint their sprite, bust and portrait
      // style onto the first one.
      if (window.Scene_CharacterCreation &&
          window.Scene_CharacterCreation._interruptedStep >= 0) {
        this._actorId = (window.Scene_CharacterCreation._currentPartyMemberIndex || 0) + 1;
      }

      // The board is the wardrobe of the world being played in, and this
      // plugin's lists are built at load, before a world is active.
      rebuildSpriteBoard();

      super.create();
      this._alive = true;
      this._index = 0;
      this._cells = new Map();
      this._pool = [];
      this._headerEl = null;
      this._cellW = 0;
      this._gridDirty = true;
      this._needsCursorScroll = false;
      this._pattern = 1;
      this._direction = 0;
      this._wasd = { up: false, down: false, left: false, right: false };
      this.bindKeys();
      this.buildOverlay();
      this.refreshSelection();
    }

    //-- lifecycle ------------------------------------------------------------

    bindKeys() {
      this._wasdListener = (event) => {
        if (!this._alive) return;
        const key = String(event.key || "").toLowerCase();
        // WASD only. Arrows and the pad are read through Input in update().
        const dir = { w: "up", s: "down", a: "left", d: "right" }[key];
        if (!dir) return;
        this._wasd[dir] = true;
        event.preventDefault();
      };
      window.addEventListener("keydown", this._wasdListener);
      this._resizeListener = () => {
        this._cellW = 0;
        this._gridDirty = true;
      };
      window.addEventListener("resize", this._resizeListener);
    }

    terminate() {
      super.terminate();
      this._alive = false;
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
      window.removeEventListener("keydown", this._wasdListener);
      window.removeEventListener("resize", this._resizeListener);
      this._cells.clear();
      this._pool.length = 0;
      this._headerEl = null;
      if (this._overlay) {
        this._overlay.innerHTML = "";
        this._overlay.style.display = "none";
      }
    }

    //-- the page -------------------------------------------------------------

    buildOverlay() {
      let container = document.getElementById("character-creation-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "character-creation-container";
        document.body.appendChild(container);
      }
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }
      this._overlay = container;
      container.style.display = "flex";
      container.style.opacity = "1";
      container.style.pointerEvents = "auto";
      container.innerHTML = "";
      if (window.CCScroll) window.CCScroll.bindWheel(container);

      container.innerHTML = `
        <div class="cc-pockets-spread">
          <div class="cc-page cc-page-left" style="padding: 24px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;">
            <h2 class="cc-header-gothic" style="margin-bottom: 8px; width: 100%; text-align: center;"></h2>
            <div class="cc-presets-board cc-sprite-vgrid" style="flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; width: 100%; padding-right: 4px;">
              <div class="cc-sprite-vcanvas"></div>
            </div>
          </div>
          <div class="cc-page cc-page-right" style="padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; box-sizing: border-box; overflow: hidden;">
            <div class="cc-sprite-portrait">
              <div class="cc-sprite-portrait-bust"></div>
              <div class="cc-sprite-portrait-sprite"></div>
            </div>
            <div class="cc-dossier-card" style="width: 90%; text-align: center;">
              <div class="cc-option-title"></div>
              <div class="cc-wanted-class cc-sprite-index"></div>
            </div>
            <div class="cc-button-panel" style="margin-top: 24px; width: 100%;"></div>
          </div>
        </div>
      `;

      this._gridEl = container.querySelector(".cc-sprite-vgrid");
      this._canvasEl = container.querySelector(".cc-sprite-vcanvas");
      this._portraitEl = container.querySelector(".cc-sprite-portrait");
      this._bustEl = container.querySelector(".cc-sprite-portrait-bust");
      this._previewEl = container.querySelector(".cc-sprite-portrait-sprite");
      this._nameEl = container.querySelector(".cc-page-right .cc-option-title");
      this._indexEl = container.querySelector(".cc-sprite-index");
      container.querySelector(".cc-page-left h2").textContent = T("CharCreate.selectSprite");

      const slots = window.CCButtons.slots(container.querySelector(".cc-button-panel"));
      const back = document.createElement("button");
      back.className = "cc-btn-treaty";
      back.textContent = window.CCButtons.backLabel();
      back.addEventListener("click", () => this.leaveWithoutPicking());
      slots.back.appendChild(back);
      const confirm = document.createElement("button");
      confirm.className = "cc-btn-treaty confirm";
      confirm.textContent = window.CCButtons.continueLabel();
      confirm.addEventListener("click", () => this.onSpriteConfirm());
      slots.next.appendChild(confirm);

      // One listener on the board rather than an inline handler a card: the
      // grid rebuilds its cells constantly and must not re-bind on every pass.
      this._gridEl.addEventListener("click", (event) => {
        const card = event.target.closest(".cc-sprite-card");
        if (card) this.onSpriteCardClick(Number(card.dataset.index));
      });
      this._gridEl.addEventListener("scroll", () => {
        this._gridDirty = true;
      });

      // The board is up: the veil can come off without waiting for the sheets.
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
    }

    //-- the virtualised grid -------------------------------------------------

    measureGrid() {
      const width = this._gridEl.clientWidth - 4;
      if (width <= 0) return false;
      this._cellW = Math.floor(
        (width - SPRITE_GRID_GAP * (SPRITE_GRID_COLS - 1)) / SPRITE_GRID_COLS,
      );
      this._canvasEl.style.height = `${spriteCanvasH}px`;
      this.placeSectionHeader();
      return true;
    }

    // The "Beta sprites" band between the two blocks. It scrolls with the
    // board, so it lives in the canvas beside the cards rather than over the
    // pane, and it is built once: the virtualiser never recycles it.
    placeSectionHeader() {
      if (spriteHeaderTop < 0) return;
      if (!this._headerEl) {
        this._headerEl = document.createElement("div");
        this._headerEl.className = "cc-sprite-section";
        this._headerEl.textContent = T("CharCreate.betaSprites");
        this._canvasEl.appendChild(this._headerEl);
      }
      this._headerEl.style.top = `${spriteHeaderTop}px`;
      this._headerEl.style.height = `${SPRITE_HEADER_H}px`;
    }

    takeCell() {
      const cell = this._pool.pop();
      if (cell) return cell;
      const card = document.createElement("div");
      card.className = "cc-wanted-card cc-sprite-card";
      const art = document.createElement("div");
      art.className = "cc-wanted-sprite";
      card.appendChild(art);
      card._art = art;
      return card;
    }

    renderGrid() {
      if (!this._cellW && !this.measureGrid()) {
        // The page has not been laid out yet: try again next frame.
        this._gridDirty = true;
        return;
      }
      const total = spriteOptions.length;
      if (!total) return;
      if (this._needsCursorScroll) {
        this._needsCursorScroll = false;
        this.scrollCursorIntoView();
      }
      // Which rows are on screen, read off the row table rather than divided
      // out of a uniform row height: the header band makes the rows below it
      // stand lower than their index alone would say.
      const rowHeight = SPRITE_CELL_H + SPRITE_GRID_GAP;
      const top = this._gridEl.scrollTop - SPRITE_GRID_OVERSCAN * rowHeight;
      const bottom =
        this._gridEl.scrollTop + this._gridEl.clientHeight + SPRITE_GRID_OVERSCAN * rowHeight;
      let from = -1;
      let to = -1;
      for (const row of spriteRows) {
        if (row.top + SPRITE_CELL_H < top) continue;
        if (row.top > bottom) break;
        if (from < 0) from = row.from;
        to = row.to;
      }
      if (from < 0) {
        for (const [index, cell] of this._cells) {
          cell.remove();
          this._pool.push(cell);
          this._cells.delete(index);
        }
        return;
      }
      to = Math.min(total - 1, to);

      for (const [index, cell] of this._cells) {
        if (index < from || index > to) {
          cell.remove();
          this._pool.push(cell);
          this._cells.delete(index);
        }
      }

      for (let index = from; index <= to; index++) {
        if (this._cells.has(index)) {
          this.placeCell(this._cells.get(index), index);
          continue;
        }
        const cell = this.takeCell();
        this._cells.set(index, cell);
        this.fillCell(cell, index);
        this.placeCell(cell, index);
        this._canvasEl.appendChild(cell);
      }
    }

    placeCell(cell, index) {
      const row = spriteRows[spriteRowOfIndex[index]];
      const col = index - row.from;
      cell.style.left = `${col * (this._cellW + SPRITE_GRID_GAP)}px`;
      cell.style.top = `${row.top}px`;
      cell.style.width = `${this._cellW}px`;
      cell.style.height = `${SPRITE_CELL_H}px`;
      cell.classList.toggle("selected", index === this._index);
    }

    fillCell(cell, index) {
      const entry = spriteOptions[index];
      cell.dataset.index = String(index);
      // An unselected card stands still facing the player; the selected one
      // joins the walk already in progress rather than standing there until
      // the next frame comes round.
      const walking = index === this._index;
      paintSpriteFrame(
        cell._art,
        entry.name,
        entry.index,
        SPRITE_GRID_SIZE,
        walking ? this._pattern : 1,
        walking ? this._direction : 0,
      );
    }

    scrollCursorIntoView() {
      const pane = this._gridEl;
      // Before the page has been laid out the pane has no height, and every
      // row reads as below the fold: scrolling to one then would jump the
      // board off the top row. Leave it to the first reconcile instead.
      if (!this._cellW || pane.clientHeight <= 0) {
        this._needsCursorScroll = true;
        return;
      }
      const row = spriteRows[spriteRowOfIndex[this._index]];
      if (!row) return;
      // Stepping onto the first beta row shows the header that names it.
      const top = row.beta && row.top === spriteHeaderTop + SPRITE_HEADER_H + SPRITE_GRID_GAP
        ? spriteHeaderTop
        : row.top;
      if (top < pane.scrollTop) pane.scrollTop = top;
      else if (top + SPRITE_CELL_H > pane.scrollTop + pane.clientHeight) {
        pane.scrollTop = top + SPRITE_CELL_H - pane.clientHeight;
      }
    }

    //-- selection ------------------------------------------------------------

    selectedEntry() {
      return spriteOptions[this._index] || null;
    }

    refreshSelection() {
      const entry = this.selectedEntry();
      if (!entry) return;
      for (const [index, cell] of this._cells) {
        const wasSelected = cell.classList.contains("selected");
        const isSelected = index === this._index;
        cell.classList.toggle("selected", isSelected);
        // A card that has just been let go goes back to standing still.
        if (wasSelected && !isSelected) {
          const other = spriteOptions[index];
          paintSpriteFrame(cell._art, other.name, other.index, SPRITE_GRID_SIZE, 1, 0);
        }
      }
      this.scrollCursorIntoView();

      // The right page: the sheet's own bust, with the sprite standing beside
      // it rather than over it, so neither hides the other.
      const bust = bustForSprite(entry.name, entry.index);
      this._portraitEl.classList.toggle("no-bust", !bust);
      this._bustEl.style.backgroundImage = bust ? `url("${bustArtUrl(bust)}")` : "none";
      // The sheet file name is CamelCase (GoblinIllusionist); the dossier reads
      // it back as words.
      this._nameEl.textContent = decamelCase(
        entry.name.split("/").pop().replace(/^[$!]+/, ""),
      );
      this._indexEl.textContent = `${T("CharCreate.spriteIndex")}: ${entry.index}`;
      this.paintAnimated(true);
    }

    // The selected sprite walks, on the card and on the right page.
    paintAnimated(force) {
      const entry = this.selectedEntry();
      if (!entry) return;
      const frame = Math.floor(Graphics.frameCount / SPRITE_WALK_FRAMES) % 4;
      const pattern = frame === 3 ? 1 : frame;
      const direction = Math.floor(Graphics.frameCount / SPRITE_TURN_FRAMES) % 4;
      if (!force && pattern === this._pattern && direction === this._direction) return;
      this._pattern = pattern;
      this._direction = direction;
      const previewBox = this._portraitEl && this._portraitEl.classList.contains("no-bust")
        ? SPRITE_GRID_SIZE
        : SPRITE_PREVIEW_SIZE;
      paintSpriteFrame(this._previewEl, entry.name, entry.index, previewBox, pattern, direction);
      const cell = this._cells.get(this._index);
      if (cell) {
        paintSpriteFrame(cell._art, entry.name, entry.index, SPRITE_GRID_SIZE, pattern, direction);
      }
    }

    onSpriteCardClick(index) {
      if (!(index >= 0) || index >= spriteOptions.length) return;
      if (index === this._index) {
        this.onSpriteConfirm();
        return;
      }
      SoundManager.playCursor();
      this._index = index;
      this.refreshSelection();
    }

    onSpriteConfirm() {
      this.onSpriteSelected();
    }

    //-- input ----------------------------------------------------------------

    ccScrollTarget() {
      return this._gridEl;
    }

    updateInput() {
      const held = (name) => Input.isTriggered(name) || Input.isRepeated(name);
      const down = held("down") || this._wasd.down;
      const up = held("up") || this._wasd.up;
      const right = held("right") || this._wasd.right;
      const left = held("left") || this._wasd.left;
      this._wasd.up = this._wasd.down = this._wasd.left = this._wasd.right = false;

      const count = spriteOptions.length;
      if (!count) return;
      let index = this._index;
      let moved = false;
      // The cursor walks the row table, not an index divided by the column
      // count: the two blocks each start a fresh row, so the last ordinary row
      // may be a short one and stepping down off it must land under the column
      // it was standing in.
      const rowIndex = spriteRowOfIndex[index] || 0;
      const row = spriteRows[rowIndex];
      const col = row ? index - row.from : 0;
      const stepToRow = (target) => (target ? Math.min(target.from + col, target.to) : index);

      if (down) {
        index = stepToRow(spriteRows[rowIndex + 1] || spriteRows[0]);
        moved = true;
      } else if (up) {
        index = stepToRow(spriteRows[rowIndex - 1] || spriteRows[spriteRows.length - 1]);
        moved = true;
      } else if (right) {
        if (row && index < row.to) {
          index += 1;
          moved = true;
        }
      } else if (left) {
        if (row && index > row.from) {
          index -= 1;
          moved = true;
        }
      } else if (Input.isTriggered("ok")) {
        SoundManager.playOk();
        this.onSpriteConfirm();
        return;
      } else if (Input.isTriggered("cancel")) {
        SoundManager.playCancel();
        this.leaveWithoutPicking();
        return;
      }

      if (!moved) return;
      SoundManager.playCursor();
      this._index = index;
      this.refreshSelection();
    }

    update() {
      super.update();
      if (!this._overlay || this._overlay.style.display === "none") return;
      this.updateInput();
      if (window.CCScroll) window.CCScroll.update(this._overlay);
      if (this._gridDirty) {
        this._gridDirty = false;
        this.renderGrid();
      }
      this.paintAnimated(false);
    }

    //-- leaving --------------------------------------------------------------

    onSpriteSelected() {
      const entry = this.selectedEntry();
      if (!entry) return;
      const actor = $gameActors.actor(this._actorId);
      if (!actor) return;

      // Apply the selected sprite to the specified actor
      actor.setCharacterImage(entry.name, entry.index);

      // Refresh player if this is the party leader. Same rule as
      // selectRandomSprite: the board is reachable while the party is empty.
      const leader = $gameParty && $gameParty.leader();
      if (leader && this._actorId === leader.actorId()) {
        $gamePlayer.refresh();
      }

      SoundManager.playOk();

      // Quick mode: this pick is the whole of the character's appearance and
      // half of who they are. The bust is the one the sheet comes with rather
      // than one browsed for, and the sheet's own NPCs.json record settles
      // gender and body archetype, so the wizard never has to ask. Leaving
      // here pops straight back to the map, where the creation common event
      // resumes at the class step.
      if (this._isQuickCreation()) {
        const bust = bustForSprite(entry.name, entry.index);
        if (bust) {
          actor.setVnBust(bust);
          if (actor.setPortraitMode) actor.setPortraitMode("bust");
        } else if (window.selectRandomBustForActor) {
          // A sheet with no portrait of its own still needs a face to be read
          // by, and the gallery is not on offer here.
          window.selectRandomBustForActor(this._actorId);
        }
        const utils = window.CharacterCreationUtils;
        if (utils && utils.applyIdentityFromSprite) {
          utils.applyIdentityFromSprite(this._actorId - 1, entry.name);
        }
        this.popScene();
        return;
      }

      // Portrait style is exclusive (chosen on the wizard's portrait step): a
      // "model" character skips the bust gallery entirely and goes straight to
      // the 3D editor, a "bust" character never sees the editor.
      if (actor.portraitMode && actor.portraitMode() === "model" &&
          window.Scene_CC3DModel && window.CC3DModel && window.CC3DModel.isAvailable()) {
        let suggestedBase = null;
        if (window.CC3DModel.suggestBaseFromName) {
          suggestedBase = window.CC3DModel.suggestBaseFromName(entry.name || "");
        }
        window.Scene_CC3DModel.setup(this._actorId, null, {
          suggestedBase: suggestedBase,
          returnByPop: true,
        });
        SceneManager.push(window.Scene_CC3DModel);
        return;
      }

      this.createBustSelectionScene(bustForSprite(entry.name, entry.index));
    }

    // Backing out of the board. The character keeps the sheet they already
    // had, which in Quick mode still has to answer for gender and body: this
    // board is the only place that question is ever put, so leaving it unasked
    // would strand the member with whatever the one before them settled on.
    leaveWithoutPicking() {
      if (this._isQuickCreation()) {
        const actor = $gameActors.actor(this._actorId);
        const utils = window.CharacterCreationUtils;
        if (actor && utils && utils.applyIdentityFromSprite) {
          utils.applyIdentityFromSprite(this._actorId - 1, actor.characterName());
        }
      }
      // Opened by a paused creation run: Back means back. Drop the rest of the
      // chain (the name prompt) and tell the wizard to reopen the step that
      // sent the player here rather than move on to the next one.
      const wizard = window.Scene_CharacterCreation;
      if (wizard && wizard.cancelSubScreens) wizard.cancelSubScreens();
      this.popScene();
    }

    // True when this board was opened by a paused Quick-mode creation run, the
    // one flow that takes the sprite as the answer to more than one question.
    // The board is also reachable from menus and from the other creation
    // modes, which all still browse busts afterwards.
    _isQuickCreation() {
      const wizard = window.Scene_CharacterCreation;
      return !!(wizard && wizard._interruptedStep >= 0 &&
        wizard.isQuickMode && wizard.isQuickMode());
    }

    createBustSelectionScene(preselectedBust) {
      SceneManager.push(Scene_BustSelector);
      if (SceneManager._nextScene) {
        SceneManager._nextScene.setActor(this._actorId);
        if (preselectedBust) {
          SceneManager._nextScene.setPreselectedBust(preselectedBust);
        }
      }
    }
  }

  //===========================================================================
  // Bust gallery
  //
  // img/busts holds 690 portraits, 883x1200 apiece and better than half a
  // megabyte a file: 412 MB of art. The old gallery put every bust of the open
  // category into the DOM at once, so opening Human (456 of them) asked the
  // browser for some 260 MB of files and, as they arrived, close to 2 GB of
  // decoded pixels. What holds that down now is the grid itself: it is
  // virtualised, so only the rows on screen (plus a row of overscan either
  // side) exist as elements, about a dozen cards whatever the category's size,
  // and scrolling recycles them rather than building more.
  //
  // The art is the bust file itself, whole and uncropped, at whatever size it
  // ships. bustArtUrl() is the single place that decides where a card's image
  // comes from, so pointing the gallery at a folder of downscaled copies later
  // is a one line change.
  //
  // Nothing is drawn through Window_Base any more. The old Window_BustList and
  // Window_BustPreview were held at opacity 0 behind the overlay and still
  // blitted an 883x1200 bitmap on every cursor move.
  //===========================================================================

  const BUST_DIR = "img/busts/";
  // Placeholder art ships at ~4 KB; a real bust is half a megabyte.
  const BUST_MIN_BYTES = 50000;

  const BUST_GRID_COLS = 3;
  const BUST_GRID_GAP = 16;
  const BUST_GRID_OVERSCAN = 1;
  // The busts' own 883x1200. A cell of that shape holds a whole portrait with
  // nothing cut off it and no empty band beside it.
  const BUST_CELL_RATIO = 1200 / 883;
  const CATEGORY_COLS = 2;
  // Frames the cursor must rest before the right page loads the portrait, so
  // holding a direction does not walk a whole category through the decoder.
  const PREVIEW_SETTLE_FRAMES = 12;

  const nodeRequire = (name) => {
    try {
      return require(name);
    } catch (e) {
      return null;
    }
  };

  // Where a bust's picture comes from. The one place to change when the
  // downscaled copies land in a folder of their own.
  const bustArtUrl = (name) => `${BUST_DIR}${encodeURIComponent(name)}.png`;

  const gameRoot = () => {
    const path = nodeRequire("path");
    if (!path || typeof process === "undefined" || !process.mainModule) return null;
    try {
      return path.dirname(process.mainModule.filename);
    } catch (e) {
      return null;
    }
  };

  // Category ids in the order the species list shows them. A bust belongs to
  // the first id its file name starts with, and to Human when it starts with
  // none of them. The label is resolved by bustCategoryLabel() where it is
  // drawn, so these stay ids.
  // i18n-ignore-start: category ids, matched against the bust file name prefix
  const BUST_CATEGORIES = [
    "Human", "Goblin", "Orc", "Dwarven", "Rabbit", "Cyclop", "Gnome", "Elven",
    "Bot", "Undead", "Devil", "Dog", "Android", "Avian", "Cat", "Elephant",
    "Goat", "Kobold", "Alien", "Exotic", "Insectoid",
  ];
  const BUST_FALLBACK_CATEGORY = "Human";
  // i18n-ignore-end

  //---------------------------------------------------------------------------
  // The list of busts and how they group. Scanned once per session: the scene
  // is entered again for every party member and the folder does not change
  // under it.
  //---------------------------------------------------------------------------
  const BustCatalogue = {
    _load: null,

    // Promise of { names, sizes (name -> bytes), categories (id -> names) }.
    load() {
      if (!this._load) this._load = this._scan();
      return this._load;
    },

    // Whatever has already been scanned, for callers that cannot wait.
    peek() {
      return this._data || null;
    },

    async _scan() {
      let names = [];
      const sizes = new Map();
      const fs = nodeRequire("fs");
      const path = nodeRequire("path");
      const root = gameRoot();
      if (fs && path && root) {
        try {
          const dir = path.join(root, BUST_DIR);
          const files = await fs.promises.readdir(dir);
          // The byte size doubles as the thumbnail cache key, so a repainted
          // bust invalidates its own thumbnail without any versioning.
          const scanned = await Promise.all(
            files.map(async (file) => {
              if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) return null;
              try {
                const stat = await fs.promises.stat(path.join(dir, file));
                if (!stat.isFile() || stat.size <= BUST_MIN_BYTES) return null;
                return { name: file.replace(/\.[^.]+$/, ""), size: stat.size };
              } catch (e) {
                return null;
              }
            }),
          );
          for (const entry of scanned) {
            if (!entry) continue;
            names.push(entry.name);
            sizes.set(entry.name, entry.size);
          }
        } catch (e) {
          names = [];
        }
      }
      // No file system (a browser build): fall back to every bust the sprite
      // catalogue names, which is the set the game actually references.
      if (!names.length) names = this._fromSpriteCatalogue();
      names.sort((a, b) => a.localeCompare(b));
      this._data = { names, sizes, categories: this._categorize(names) };
      return this._data;
    },

    _fromSpriteCatalogue() {
      const assoc = window.Sprites && window.Sprites.SpritesAssociation;
      if (!assoc) return [];
      const found = new Set();
      for (const sheet of Object.keys(assoc)) {
        const busts = assoc[sheet];
        if (!Array.isArray(busts)) continue;
        for (const bust of busts) if (bust) found.add(String(bust));
      }
      return Array.from(found);
    },

    _categorize(names) {
      const categories = {};
      for (const id of BUST_CATEGORIES) categories[id] = [];
      for (const name of names) {
        const id = BUST_CATEGORIES.find(
          (cat) => cat !== BUST_FALLBACK_CATEGORY && name.startsWith(cat),
        );
        categories[id || BUST_FALLBACK_CATEGORY].push(name);
      }
      return categories;
    },
  };

  //---------------------------------------------------------------------------
  // The gallery itself. Left page: the open category's busts, virtualised.
  // Right page: the selected bust at full size, the species list and the
  // buttons.
  //---------------------------------------------------------------------------
  class Scene_BustSelector extends Scene_MenuBase {
    constructor() {
      super();
      this._actorId = 1;
      this._preselectedBust = null;
    }

    setActor(actorId) {
      this._actorId = actorId || 1;
    }

    setPreselectedBust(bustName) {
      this._preselectedBust = bustName;
    }

    create() {
      super.create();
      this._alive = true;
      this._categories = [];
      this._filtered = [];
      this._all = {};
      this._catIndex = 0;
      this._bustIndex = 0;
      this._openCategory = null;
      this._busts = [];
      this._needsCursorScroll = false;
      this._mode = "category";
      this._search = "";
      this._cells = new Map();
      this._pool = [];
      this._cellW = 0;
      this._cellH = 0;
      this._gridDirty = false;
      this._previewWait = 0;
      this._previewShown = null;
      this._wasd = { up: false, down: false, left: false, right: false };
      this.bindKeys();
      this.buildOverlay();
      this.loadBustList();
    }

    //-- lifecycle ------------------------------------------------------------

    bindKeys() {
      this._wasdListener = (event) => {
        if (!this._alive || document.activeElement === this._searchEl) return;
        const key = String(event.key || "").toLowerCase();
        // WASD only. Arrows and the pad are read through Input in update().
        const dir = { w: "up", s: "down", a: "left", d: "right" }[key];
        if (!dir) return;
        this._wasd[dir] = true;
        event.preventDefault();
      };
      window.addEventListener("keydown", this._wasdListener);
      this._resizeListener = () => {
        this._cellW = 0;
        this._gridDirty = true;
      };
      window.addEventListener("resize", this._resizeListener);
    }

    terminate() {
      super.terminate();
      this._alive = false;
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
      window.removeEventListener("keydown", this._wasdListener);
      window.removeEventListener("resize", this._resizeListener);
      if (this._previewEl) this._previewEl.removeAttribute("src");
      this._cells.clear();
      this._pool.length = 0;
      if (this._overlay) {
        this._overlay.innerHTML = "";
        this._overlay.style.display = "none";
      }
    }

    //-- the page -------------------------------------------------------------

    buildOverlay() {
      let container = document.getElementById("character-creation-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "character-creation-container";
        document.body.appendChild(container);
      }
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }
      this._overlay = container;
      container.style.display = "flex";
      container.style.opacity = "1";
      container.style.pointerEvents = "auto";
      container.innerHTML = "";
      if (window.CCScroll) window.CCScroll.bindWheel(container);

      const pageStyle =
        "padding: 24px; display: flex; flex-direction: column; height: 100%;" +
        " box-sizing: border-box; overflow: hidden;";
      container.innerHTML = `
        <div class="cc-pockets-spread">
          <div class="cc-page cc-page-left" style="${pageStyle} padding-right: 48px;">
            <h2 class="cc-header-gothic cc-bust-title" style="margin-bottom: 8px; width: 100%; text-align: center;"></h2>
            <div class="cc-presets-board cc-bust-vgrid" style="flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; width: 100%; padding-right: 4px;">
              <div class="cc-bust-vcanvas"></div>
            </div>
          </div>
          <div class="cc-page cc-page-right" style="${pageStyle}">
            <div class="cc-bust-preview"><img alt="" /></div>
            <h2 class="cc-header-gothic" style="margin-bottom: 8px; width: 100%; text-align: center;"></h2>
            <input type="text" class="cc-species-search" />
            <div class="cc-presets-board cc-categories-list" style="display: grid; grid-template-columns: repeat(${CATEGORY_COLS}, minmax(0, 1fr)); gap: 10px; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; width: 100%; padding-right: 4px; align-content: start;"></div>
            <div class="cc-button-panel" style="margin-top: 16px; width: 100%;"></div>
          </div>
        </div>
      `;

      this._titleEl = container.querySelector(".cc-bust-title");
      this._gridEl = container.querySelector(".cc-bust-vgrid");
      this._canvasEl = container.querySelector(".cc-bust-vcanvas");
      this._previewEl = container.querySelector(".cc-bust-preview img");
      this._listEl = container.querySelector(".cc-categories-list");
      this._searchEl = container.querySelector(".cc-species-search");
      this._buttonsEl = container.querySelector(".cc-button-panel");
      container.querySelector(".cc-page-right h2").textContent = T("CharCreate.humanoidSpecies");
      this._searchEl.placeholder = T("CharCreate.searchSpecies");

      this.buildButtons();

      // One listener a board rather than an inline handler a card: the grid
      // rebuilds its cells constantly and must not re-bind on every pass.
      this._gridEl.addEventListener("click", (event) => {
        const card = event.target.closest(".cc-bust-card");
        if (card) this.onBustCardClick(Number(card.dataset.index));
      });
      this._gridEl.addEventListener("scroll", () => {
        this._gridDirty = true;
      });
      this._listEl.addEventListener("click", (event) => {
        const card = event.target.closest(".cc-card-option");
        if (card) this.onCategoryCardClick(String(card.dataset.category));
      });
      // The field owns the keyboard while it has focus, so neither RMMZ's
      // Input nor the WASD listener sees what is typed into it. Escape and
      // Enter hand it back, or there would be no way off the field on a
      // keyboard.
      for (const type of ["keydown", "keyup", "keypress"]) {
        this._searchEl.addEventListener(type, (event) => {
          event.stopPropagation();
          if (type === "keydown" && (event.key === "Escape" || event.key === "Enter")) {
            this._searchEl.blur();
          }
        });
      }
      this._searchEl.addEventListener("input", () => this.onCategorySearch(this._searchEl.value));
    }

    buildButtons() {
      // Back on the left, Random in the middle, Continue on the right: the same
      // bar, in the same order, as every other creation step (CCButtons).
      const slots = window.CCButtons.slots(this._buttonsEl);

      const back = document.createElement("button");
      back.className = "cc-btn-treaty";
      back.textContent = window.CCButtons.backLabel();
      back.addEventListener("click", () => this.onBustCancel());
      slots.back.appendChild(back);

      // Always present, never gated on the gallery having loaded: if the
      // img/busts scan comes back empty (or is still running) the species
      // list and grid stay bare, and Continue has nothing to pick. Random
      // draws from availableBustNames(), which falls back to its own
      // synchronous folder read rather than waiting on BustCatalogue's scan.
      this._randomEl = document.createElement("button");
      this._randomEl.className = "cc-btn-treaty";
      this._randomEl.textContent = window.CCButtons.randomLabel();
      this._randomEl.addEventListener("click", () => this.onBustRandom());
      slots.mid.appendChild(this._randomEl);

      this._confirmEl = document.createElement("button");
      this._confirmEl.className = "cc-btn-treaty confirm";
      this._confirmEl.textContent = window.CCButtons.continueLabel();
      this._confirmEl.addEventListener("click", () => this.onBustConfirm());
      slots.next.appendChild(this._confirmEl);
      // Hidden with `visibility`, not `display`: while the species list has the
      // cursor there is nothing to confirm, but Back and Random must not slide
      // sideways when Continue comes and goes.
      window.CCButtons.setShown(this._confirmEl, false);
    }

    // The id a random pick's bust name would file under, mirroring
    // BustCatalogue._categorize so the Bot/Goblin reproduction-type quirk in
    // finishWithBust reads the same whether the pick came off the gallery or
    // off this shortcut.
    categoryForBustName(name) {
      const id = BUST_CATEGORIES.find(
        (cat) => cat !== BUST_FALLBACK_CATEGORY && name.startsWith(cat),
      );
      return id || BUST_FALLBACK_CATEGORY;
    }

    //-- data -----------------------------------------------------------------

    loadBustList() {
      BustCatalogue.load().then((data) => {
        if (!this._alive) return;
        // A goblin world wears goblin faces and a monster world wears nothing
        // that reads as a person's. The gallery is read off the img/busts
        // folder, so the wardrobe has to say which of those files belong here.
        const categories = filterBustCategories(data.categories);
        this._categories = BUST_CATEGORIES.filter(
          (cat) => categories[cat] && categories[cat].length > 0,
        );
        this._all = categories;
        this._filtered = this._categories.slice();
        this._openCategory = this._filtered[0] || null;
        this.renderCategories();
        if (this._preselectedBust) this.preselect(this._preselectedBust);
        this.openCategoryBusts(this._openCategory);
        this.refreshMode();
        if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
      });
    }

    preselect(bustName) {
      const category = this._categories.find(
        (cat) => this._all[cat].indexOf(bustName) >= 0,
      );
      if (!category) return;
      this._openCategory = category;
      this._catIndex = Math.max(0, this._filtered.indexOf(category));
      this._bustIndex = Math.max(0, this._all[category].indexOf(bustName));
      this._mode = "bust";
    }

    openCategoryBusts(category) {
      this._openCategory = category;
      this._busts = (category && this._all[category]) || [];
      if (this._bustIndex >= this._busts.length) this._bustIndex = 0;
      this._titleEl.textContent = category
        ? `${bustCategoryLabel(category).toUpperCase()} ${T("CharCreate.presets")}`
        : T("CharCreate.presets");
      // A new list means every cell holds the wrong bust: drop them all and
      // let the next reconcile rebuild only what is on screen. The cells keep
      // their size (only the count changed), so the board is not re-measured:
      // walking the species list would otherwise force a layout a keypress.
      this.releaseCells();
      this._gridEl.scrollTop = 0;
      this.updateCanvasHeight();
      this._gridDirty = true;
      // The board cannot be measured until it has been laid out, so a cursor
      // that did not start at the top (a preselected bust) is scrolled to on
      // the first reconcile that succeeds.
      this._needsCursorScroll = true;
      this.schedulePreview();
    }

    //-- the species list -----------------------------------------------------

    renderCategories() {
      this._listEl.innerHTML = "";
      const fragment = document.createDocumentFragment();
      this._catCards = new Map();
      for (const category of this._categories) {
        const card = document.createElement("div");
        card.className = "cc-card-option";
        card.dataset.category = category;
        const title = document.createElement("div");
        title.className = "cc-option-title";
        title.textContent = bustCategoryLabel(category);
        const count = document.createElement("span");
        count.className = "cc-element-badge";
        count.textContent = `${this._all[category].length} ${T("CharCreate.presets2")}`;
        card.appendChild(title);
        card.appendChild(count);
        fragment.appendChild(card);
        this._catCards.set(category, card);
      }
      this._listEl.appendChild(fragment);
      this.refreshCategorySelection();
    }

    refreshCategorySelection() {
      if (!this._catCards) return;
      const current = this._filtered[this._catIndex];
      for (const [category, card] of this._catCards) {
        card.classList.toggle("selected", category === current);
      }
      const card = this._catCards.get(current);
      if (card) this.scrollIntoPane(this._listEl, card.offsetTop, card.offsetHeight);
    }

    onCategorySearch(value) {
      if (!this._catCards) return;
      this._search = String(value || "");
      const term = this._search.trim().toLowerCase();
      const open = this._filtered[this._catIndex];
      this._filtered = this._categories.filter(
        (cat) => !term || bustCategoryLabel(cat).toLowerCase().includes(term),
      );
      for (const [category, card] of this._catCards) {
        card.style.display = this._filtered.indexOf(category) >= 0 ? "flex" : "none";
      }
      const kept = this._filtered.indexOf(open);
      this._catIndex = kept >= 0 ? kept : 0;
      this.refreshCategorySelection();
    }

    //-- the virtualised grid -------------------------------------------------

    measureGrid() {
      const width = this._gridEl.clientWidth - 4;
      if (width <= 0) return false;
      this._cellW = Math.floor((width - BUST_GRID_GAP * (BUST_GRID_COLS - 1)) / BUST_GRID_COLS);
      this._cellH = Math.round(this._cellW * BUST_CELL_RATIO);
      this.updateCanvasHeight();
      return true;
    }

    // The spacer under the cells is what the pane actually scrolls.
    updateCanvasHeight() {
      if (!this._cellH) return;
      const rows = Math.ceil(this._busts.length / BUST_GRID_COLS);
      const height = rows > 0 ? rows * (this._cellH + BUST_GRID_GAP) - BUST_GRID_GAP : 0;
      this._canvasEl.style.height = `${height}px`;
    }

    releaseCells() {
      for (const cell of this._cells.values()) {
        cell.remove();
        this._pool.push(cell);
      }
      this._cells.clear();
    }

    takeCell() {
      const cell = this._pool.pop();
      if (cell) return cell;
      const card = document.createElement("div");
      card.className = "cc-wanted-card cc-bust-card";
      const art = document.createElement("div");
      art.className = "cc-bust-image";
      const name = document.createElement("div");
      name.className = "cc-wanted-name";
      card.appendChild(art);
      card.appendChild(name);
      card._art = art;
      card._name = name;
      return card;
    }

    renderGrid() {
      if (!this._cellW && !this.measureGrid()) {
        // The page has not been laid out yet: try again next frame.
        this._gridDirty = true;
        return;
      }
      const total = this._busts.length;
      if (!total) {
        this.releaseCells();
        return;
      }
      if (this._needsCursorScroll) {
        this._needsCursorScroll = false;
        const row = Math.floor(this._bustIndex / BUST_GRID_COLS);
        this.scrollIntoPane(this._gridEl, row * (this._cellH + BUST_GRID_GAP), this._cellH);
      }
      const rowHeight = this._cellH + BUST_GRID_GAP;
      const firstRow = Math.max(0, Math.floor(this._gridEl.scrollTop / rowHeight) - BUST_GRID_OVERSCAN);
      const lastRow =
        Math.floor((this._gridEl.scrollTop + this._gridEl.clientHeight) / rowHeight) + BUST_GRID_OVERSCAN;
      const from = firstRow * BUST_GRID_COLS;
      const to = Math.min(total - 1, lastRow * BUST_GRID_COLS + BUST_GRID_COLS - 1);

      for (const [index, cell] of this._cells) {
        if (index < from || index > to) {
          cell.remove();
          this._pool.push(cell);
          this._cells.delete(index);
        }
      }

      for (let index = from; index <= to; index++) {
        if (this._cells.has(index)) {
          this.placeCell(this._cells.get(index), index);
          continue;
        }
        const cell = this.takeCell();
        this._cells.set(index, cell);
        this.fillCell(cell, index);
        this.placeCell(cell, index);
        this._canvasEl.appendChild(cell);
      }
    }

    placeCell(cell, index) {
      const col = index % BUST_GRID_COLS;
      const row = Math.floor(index / BUST_GRID_COLS);
      cell.style.left = `${col * (this._cellW + BUST_GRID_GAP)}px`;
      cell.style.top = `${row * (this._cellH + BUST_GRID_GAP)}px`;
      cell.style.width = `${this._cellW}px`;
      cell.style.height = `${this._cellH}px`;
      cell.classList.toggle("selected", this._mode === "bust" && index === this._bustIndex);
    }

    fillCell(cell, index) {
      const name = this._busts[index];
      cell.dataset.index = String(index);
      cell.dataset.bust = name;
      cell._name.textContent = decamelCase(name);
      cell._art.style.backgroundImage = `url("${bustArtUrl(name)}")`;
    }

    refreshBustSelection() {
      for (const [index, cell] of this._cells) {
        cell.classList.toggle("selected", this._mode === "bust" && index === this._bustIndex);
      }
      if (this._mode !== "bust" || !this._cellH) return;
      const row = Math.floor(this._bustIndex / BUST_GRID_COLS);
      this.scrollIntoPane(this._gridEl, row * (this._cellH + BUST_GRID_GAP), this._cellH);
    }

    // Straight scrollTop arithmetic. scrollIntoView({behavior:"smooth"}) on a
    // timeout, which is what this used to be, animates on every cursor step
    // and fights the next one.
    scrollIntoPane(pane, top, height) {
      if (top < pane.scrollTop) pane.scrollTop = top;
      else if (top + height > pane.scrollTop + pane.clientHeight) {
        pane.scrollTop = top + height - pane.clientHeight;
      }
    }

    //-- the full size preview ------------------------------------------------

    schedulePreview() {
      this._previewWait = PREVIEW_SETTLE_FRAMES;
    }

    showPreview() {
      const name = this.previewBust();
      if (name === this._previewShown) return;
      this._previewShown = name;
      if (!name) {
        this._previewEl.removeAttribute("src");
        return;
      }
      // Drop the old one before asking for the next, and never hold two.
      // The card on the left has already loaded this same file, so the page
      // is a browser cache hit rather than a second decode.
      this._previewEl.removeAttribute("src");
      this._previewEl.src = bustArtUrl(name);
    }

    //-- selection ------------------------------------------------------------

    // What Confirm would take: nothing at all while the cursor is on the
    // species list.
    selectedBust() {
      if (this._mode !== "bust") return null;
      return this._busts[this._bustIndex] || null;
    }

    // What the right page shows. Browsing species previews that species' first
    // portrait, so the list reads as more than a row of counts.
    previewBust() {
      const index = this._mode === "bust" ? this._bustIndex : 0;
      return this._busts[index] || null;
    }

    refreshMode() {
      window.CCButtons.setShown(this._confirmEl, this._mode === "bust");
      this.refreshBustSelection();
      this.refreshCategorySelection();
      this.schedulePreview();
    }

    enterCategory(category) {
      if (!category) return;
      const changed = category !== this._openCategory;
      this._catIndex = Math.max(0, this._filtered.indexOf(category));
      this._mode = "bust";
      this._bustIndex = 0;
      if (changed) this.openCategoryBusts(category);
      this.refreshMode();
    }

    backToCategories() {
      this._mode = "category";
      this.refreshMode();
    }

    onCategoryCardClick(category) {
      SoundManager.playOk();
      this.enterCategory(category);
    }

    onBustCardClick(index) {
      if (!(index >= 0) || index >= this._busts.length) return;
      if (this._mode === "bust" && index === this._bustIndex) {
        this.onBustConfirm();
        return;
      }
      SoundManager.playCursor();
      this._mode = "bust";
      this._bustIndex = index;
      this.refreshMode();
    }

    //-- input ----------------------------------------------------------------

    // CCScroll drives L2/R2 at whichever board holds the cursor.
    ccScrollTarget() {
      return this._mode === "bust" ? this._gridEl : this._listEl;
    }

    readDirection() {
      const held = (name) => Input.isTriggered(name) || Input.isRepeated(name);
      const direction = {
        up: held("up") || this._wasd.up,
        down: held("down") || this._wasd.down,
        left: held("left") || this._wasd.left,
        right: held("right") || this._wasd.right,
      };
      this._wasd.up = this._wasd.down = this._wasd.left = this._wasd.right = false;
      return direction;
    }

    updateInput() {
      if (document.activeElement === this._searchEl) return;
      const direction = this.readDirection();
      const inBusts = this._mode === "bust";
      const count = inBusts ? this._busts.length : this._filtered.length;
      // Leaving must work before the catalogue has finished loading.
      if (!count) {
        if (Input.isTriggered("cancel")) this.onBustCancel();
        return;
      }
      const cols = inBusts ? BUST_GRID_COLS : CATEGORY_COLS;
      let index = inBusts ? this._bustIndex : this._catIndex;
      let moved = false;

      if (direction.down) {
        index = index + cols < count ? index + cols : index % cols;
        moved = true;
      } else if (direction.up) {
        if (index - cols >= 0) {
          index -= cols;
        } else {
          let target = Math.floor((count - 1) / cols) * cols + (index % cols);
          if (target >= count) target -= cols;
          index = Math.max(0, target);
        }
        moved = true;
      } else if (direction.right) {
        if (index % cols < cols - 1 && index + 1 < count) {
          index += 1;
          moved = true;
        }
      } else if (direction.left) {
        if (index % cols > 0) {
          index -= 1;
          moved = true;
        }
      } else if (Input.isTriggered("ok")) {
        SoundManager.playOk();
        if (inBusts) this.onBustConfirm();
        else this.enterCategory(this._filtered[this._catIndex]);
        return;
      } else if (Input.isTriggered("cancel")) {
        this.onBustCancel();
        return;
      }

      if (!moved) return;
      SoundManager.playCursor();
      if (inBusts) {
        this._bustIndex = index;
        this.refreshBustSelection();
        this.schedulePreview();
      } else {
        this._catIndex = index;
        this.refreshCategorySelection();
        // The board follows the highlighted species, so the player reads the
        // portraits without having to enter the category first.
        this.openCategoryBusts(this._filtered[index]);
      }
    }

    update() {
      super.update();
      if (!this._overlay || this._overlay.style.display === "none") return;
      this.updateInput();
      if (window.CCScroll) window.CCScroll.update(this._overlay);
      if (this._gridDirty) {
        this._gridDirty = false;
        this.renderGrid();
      }
      if (this._previewWait > 0 && --this._previewWait === 0) this.showPreview();
    }

    //-- leaving --------------------------------------------------------------

    // The actor-side effects of settling on a bust, shared by the ordinary
    // gallery Confirm and by the Random shortcut: which bust, and which
    // category it reads as for the Bot/Goblin reproduction-type quirk.
    finishWithBust(bustName, category) {
      // The bust belongs to the actor this selector was opened for, not always
      // the first party member.
      const actorId = this._actorId || 1;
      const actor = $gameActors.actor(actorId);
      if (!actor) return;
      actor.setVnBust(bustName);
      // Picking a bust settles this character's portrait style.
      if (actor.setPortraitMode) actor.setPortraitMode("bust");

      // Reproduction type variable: 87 for actor 1, 115 / 116 for 2 / 3.
      const reproductiveVar = actorId === 2 ? 115 : actorId === 3 ? 116 : 87;
      // i18n-ignore-start: bust folder ids
      if (category === "Bot") {
        $gameVariables.setValue(reproductiveVar, -1);
      } else if (category === "Goblin" && actor.gender() === 1) {
        // i18n-ignore-end
        $gameVariables.setValue(reproductiveVar, 2);
      }

      SoundManager.playOk();

      // A bust IS the character's portrait: the 3D model editor is the other,
      // mutually exclusive branch (reached from the sprite step) and is never
      // chained after a bust pick.
      //
      // Two pops by default: this gallery is opened from the sprite grid, so
      // confirming leaves both and lands on whatever opened the grid - the
      // creation wizard, which then opens the name prompt and carries on. A
      // caller that pushed the gallery straight over its own scene (the
      // Detailed creation editor) sets _confirmPops to 1 and gets its scene
      // back instead.
      const pops = Scene_BustSelector._confirmPops || 2;
      Scene_BustSelector._confirmPops = 0;
      for (let i = 0; i < pops; i++) SceneManager.pop();
    }

    onBustConfirm() {
      const bustName = this.selectedBust();
      if (!bustName) return;
      this.finishWithBust(bustName, this._openCategory);
    }

    // Always clickable, whatever state the gallery's own scan is in.
    // availableBustNames() (module scope, below) prefers BustCatalogue's
    // scan but falls back to its own synchronous folder read, so this works
    // even when the species list never populated.
    onBustRandom() {
      const names = availableBustNames();
      if (!names || !names.length) return;
      const bustName = names[Math.floor(Math.random() * names.length)];
      this.finishWithBust(bustName, this.categoryForBustName(bustName));
    }

    onBustCancel() {
      SoundManager.playCancel();
      if (this._mode === "bust") {
        this.backToCategories();
      } else {
        Scene_BustSelector._confirmPops = 0;
        SceneManager.pop();
      }
    }
  }

  // Patch the prepareNextScene method to properly handle Scene_SpriteGridSelector and Scene_BustSelector
  const _SceneManager_prepareNextScene = SceneManager.prepareNextScene;
  SceneManager.prepareNextScene = function (sceneClass, ...args) {
    if (
      sceneClass === Scene_SpriteGridSelector ||
      sceneClass === Scene_BustSelector
    ) {
      // Handle sprite grid selector and bust selector preparation
      const [actorId] = args;
      if (sceneClass === Scene_SpriteGridSelector) {
        Scene_SpriteGridSelector.prototype.setActor = function (actorId) {
          this._actorId = actorId || 1;
        };
      } else if (sceneClass === Scene_BustSelector) {
        Scene_BustSelector.prototype.setActor = function (actorId) {
          this._actorId = actorId || 1;
        };
      }
      _SceneManager_prepareNextScene.apply(this, [sceneClass]);
      if (this._nextScene && actorId) {
        this._nextScene.setActor(actorId);
      }
    } else {
      // Handle all other scenes normally
      _SceneManager_prepareNextScene.apply(this, arguments);
    }
  };

  // Exported so a scene that wants the grid over its own (the Detailed
  // creation editor) can push it and be returned to by the usual pop.
  window.Scene_SpriteGridSelector = Scene_SpriteGridSelector;
  window.Scene_BustSelector = Scene_BustSelector;

  // The sprite board's services. paintFrame is the one way to draw a frame of
  // a character sheet into a DOM element without it flashing at the wrong size
  // on the way in.
  window.SpriteBoard = {
    options: () => spriteOptions,
    // The bust NPCs.json pairs with a sheet's sprite index, or null.
    bustFor: bustForSprite,
    sheetUrl: spriteSheetUrl,
    paintFrame: paintSpriteFrame,
    // Build the board (and start the bust folder scan) ahead of the scene that
    // needs them. Character creation calls this the moment the wizard opens, so
    // the sprite step has nothing left to wait for by the time it is reached;
    // both are cached, so the call is free once it has been made.
    warm() {
      rebuildSpriteBoard();
      BustCatalogue.load();
    },
  };

  // The gallery's catalogue, for anyone who wants the bust list without
  // opening the scene.
  window.BustGallery = {
    categoryIds: BUST_CATEGORIES,
    // Promise of { names, sizes, categories }.
    load: () => BustCatalogue.load(),
    // Whatever has been scanned already, or null.
    peek: () => BustCatalogue.peek(),
    // Where a bust's picture is loaded from.
    artUrl: bustArtUrl,
  };

  // Register plugin commands
  PluginManager.registerCommand(pluginName, "OpenSpriteSelector", () => {
    SceneManager.push(Scene_SpriteGridSelector);
  });

  PluginManager.registerCommand(
    pluginName,
    "OpenSpriteSelectorForActor",
    (args) => {
      const actorId = parseInt(args.actorId) || 1;
      SceneManager.push(Scene_SpriteGridSelector);
      if (SceneManager._nextScene) {
        SceneManager._nextScene.setActor(actorId);
      }
    },
  );

  // Register the new random sprite selection command
  PluginManager.registerCommand(pluginName, "SelectRandomSprite", (args) => {
    const actorId = parseInt(args.actorId) || 1;
    const randomSprite = selectRandomSprite(actorId);
  });

  // Expose selectRandomSprite globally for use by other plugins
  window.selectRandomSpriteForActor = function (actorId) {
    return selectRandomSprite(actorId);
  };

  // The list a random pick draws from, resolved once. Randomizing a whole
  // party used to stat all 730 files once per member. The world it was
  // resolved for is remembered with it, since a narrowed world draws from a
  // narrower folder (see filterBustCategories for the gallery's half).
  let randomBustPool = null;
  let randomBustPoolMode = null;

  // What is left of a scanned folder once the world has had its say.
  const narrowBustPool = (names) => {
    const SC = window.SpriteCatalog;
    if (!SC || typeof SC.bustAllowedInPopulation !== "function") return names;
    if (!SC.allowedBustNames || !SC.allowedBustNames()) return names;
    const kept = names.filter((n) => SC.bustAllowedInPopulation(n));
    return kept.length ? kept : names;
  };

  const availableBustNames = () => {
    const mode = populationMode();
    if (randomBustPool && randomBustPoolMode === mode) return randomBustPool;
    randomBustPoolMode = mode;
    const scanned = BustCatalogue.peek();
    if (scanned && scanned.names.length) {
      randomBustPool = narrowBustPool(scanned.names);
      return randomBustPool;
    }
    // Nothing scanned yet: read the folder once here and warm the catalogue
    // for whoever asks next.
    BustCatalogue.load();
    const names = [];
    try {
      const fs = require("fs");
      const path = require("path");
      const bustsPath = path.join(
        path.dirname(process.mainModule.filename),
        BUST_DIR,
      );
      for (const file of fs.readdirSync(bustsPath)) {
        if (!/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) continue;
        const stat = fs.statSync(path.join(bustsPath, file));
        // Skip the placeholder art, as the gallery does.
        if (stat.isFile() && stat.size > BUST_MIN_BYTES) {
          names.push(file.replace(/\.[^.]+$/, ""));
        }
      }
    } catch (error) {
      const assoc = window.Sprites && window.Sprites.SpritesAssociation;
      for (const sheet of Object.keys(assoc || {})) {
        for (const bust of assoc[sheet] || []) if (bust) names.push(String(bust));
      }
    }
    randomBustPool = narrowBustPool(names);
    return randomBustPool;
  };

  // Global function to select a random bust and store it in appropriate variable
  window.selectRandomBustForActor = function (actorId) {
    const availableBusts = availableBustNames();

    if (availableBusts.length === 0) {
      console.warn("No bust files available for random selection");
      return null;
    }

    // Select a random bust
    const randomIndex = Math.floor(Math.random() * availableBusts.length);
    const randomBust = availableBusts[randomIndex];

    // A bust is a bust for every member: store it on the actor's own bust
    // field and settle their portrait style on it.
    const actor = $gameActors.actor(actorId);
    if (actor) {
      actor.setVnBust(randomBust);
      if (actor.setPortraitMode) actor.setPortraitMode("bust");
    }

    return randomBust;
  };
})();
