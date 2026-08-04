/*:
 * @target MZ
 * @plugindesc [v2.6] Grid-based character sprite selector with bust selection window.
 * @author OmniLex (Modified by Claude)
 *
 * @param GridColumns
 * @text Grid Columns
 * @desc Number of columns to display in the sprite selection grid.
 * @type number
 * @min 1
 * @max 10
 * @default 5
 *
 * @param GridRows
 * @text Grid Rows
 * @desc Maximum number of rows to display per page in the sprite selection grid.
 * @type number
 * @min 1
 * @max 8
 * @default 4
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
  const params = PluginManager.parameters(pluginName);
  const gridColumns = Number(params["GridColumns"] || 5);
  const gridRows = Number(params["GridRows"] || 4);

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
    "Skab/!$CatBoy": { cutoff: 0 },
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
    NPCs03Color: { cutoff: 0 },
    Actor2: { cutoff: 0 },
    Heroes02Color: { cutoff: 6 },
    Actor3RMVX: { cutoff: 0 },
    Actor1: { cutoff: 0 },
    Heroes01Color: { cutoff: 0 },
    Evil01: { cutoff: 0 },
    Actor2RMVX: { cutoff: 0 },
    School01RM: { cutoff: 0 },
    Actor1RMVX: { cutoff: 0 },
    NPCs02Color: { cutoff: null },
    NPCs01Color: { cutoff: null },
    FarmCharacters01RM: { cutoff: null },
    Actor3: { cutoff: null },
    Evil01Color: { cutoff: null },
    emPath: { cutoff: null },
  };

  // Sprite sheets offered in the grid are driven by NPCs.json: only entries
  // flagged "npc": true are selectable. window.WorldGen.NPCs is loaded
  // synchronously by DataService before plugin IIFEs run (same source the
  // NPCSystem character pool uses). SPRITE_SHEET_CONFIG is kept only as an
  // optional per-sheet cutoff override (see loop below); it no longer decides
  // which sheets appear. Falls back to the config keys if the DB is unavailable.
  // Restrict the grid to Skab-folder sheets only. These are the curated single
  // ($) portrait sheets; limiting to them keeps the option list small so the
  // scene loads quickly instead of lazy-loading hundreds of npc:true sheets.
  const npcDatabase = window.WorldGen && window.WorldGen.NPCs;
  const isSkabSheet = (name) => name.startsWith("Skab/");
  const spriteSheets = (npcDatabase
    ? Object.keys(npcDatabase).filter((k) => npcDatabase[k].npc === true)
    : Object.keys(SPRITE_SHEET_CONFIG)
  ).filter(isSkabSheet);

  // Build a comprehensive list of all sprite options (file + index) considering cutoffs
  const spriteOptions = [];
  const indexToLetter = (index) => {
    // Convert 0 -> A, 1 -> B, ... 25 -> Z, 26 -> AA, etc.
    let letters = "";
    let i = index;
    do {
      letters = String.fromCharCode(65 + (i % 26)) + letters;
      i = Math.floor(i / 26) - 1;
    } while (i >= 0);
    return letters;
  };

  const decamelCase = (str) => {
    if (!str) return "";
    return str
      .replace(/_/g, " ")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/([a-z\d])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
  };

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
    for (let index = 0; index <= cutoffIndex; index++) {
      spriteOptions.push({ name: name, index: index });
    }
  }

  // Function to select a random sprite from available options
  function selectRandomSprite(actorId) {
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

    // Refresh player if this is the party leader
    if (actorId === $gameParty.leader().actorId()) {
      $gamePlayer.refresh();
    }

    return randomSprite;
  }

  // Columns in the sprite board and the height each sprite is drawn at. Six
  // columns across the left page leaves room for double-size sprites; the
  // selection window's maxCols() must match, or the cursor and the visible
  // grid disagree about what sits above and below a cell.
  const SPRITE_GRID_COLS = 6;
  const SPRITE_GRID_SIZE = 96;

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

  // Scene to handle sprite grid selection
  class Scene_SpriteGridSelector extends Scene_MenuBase {
    constructor() {
      super();
      this._actorId = 1; // Default to Actor 1
    }

    // Add a method to set the actor ID
    setActor(actorId) {
      this._actorId = actorId;
    }

    create() {
      // Make sure stylesheet is loaded

      // The creation common event opens this selector with a fixed actor id, so
      // retarget it at the party member actually being created; otherwise the
      // second and third characters would paint their sprite, bust and portrait
      // style onto the first one.
      if (window.Scene_CharacterCreation &&
          window.Scene_CharacterCreation._interruptedStep >= 0) {
        this._actorId = (window.Scene_CharacterCreation._currentPartyMemberIndex || 0) + 1;
      }

      super.create();
      this._lastSelectedIndex = -1;
      this._lastRenderedPattern = -1;
      this._lastRenderedDirection = -1;
      this._wasdInput = { up: false, down: false, left: false, right: false };
      this._wasdListener = (event) => {
        if (!this._gridWindow || !this._gridWindow.active) return;
        const key = event.key.toLowerCase();
        // Only handle WASD here. Arrow keys and controller are handled by Input.isTriggered/repeated.
        if (key === "w") {
          this._wasdInput.up = true;
          event.preventDefault();
        }
        if (key === "s") {
          this._wasdInput.down = true;
          event.preventDefault();
        }
        if (key === "a") {
          this._wasdInput.left = true;
          event.preventDefault();
        }
        if (key === "d") {
          this._wasdInput.right = true;
          event.preventDefault();
        }
      };
      window.addEventListener("keydown", this._wasdListener);
      this.preloadSprites();
      this.createHelpWindow();
      this.createGridWindow();
      this.createUIOverlay();
    }

    terminate() {
      super.terminate();
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
      if (this._wasdListener) {
        window.removeEventListener("keydown", this._wasdListener);
      }
      if (this._dndContainer) {
        this._dndContainer.innerHTML = ""; // Clear HTML immediately!
        this._dndContainer.style.display = "none";
      }
    }

    createUIOverlay() {
      // 1. Mute MZ windows
      if (this._helpWindow) {
        this._helpWindow.visible = false;
        this._helpWindow.opacity = 0;
      }
      if (this._gridWindow) {
        this._gridWindow.visible = false;
        this._gridWindow.opacity = 0;
      }

      // 2. Create container
      let container = document.getElementById("character-creation-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "character-creation-container";
        document.body.appendChild(container);
      }

      // Clear any pending timeout and ensure styles are clean
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }

      this._dndContainer = container;
      this._dndContainer.style.display = "flex";
      this._dndContainer.style.opacity = "1";
      this._dndContainer.style.pointerEvents = "auto";
      this._dndContainer.innerHTML = ""; // Wipe clean to prevent stale DOM layout leaking

      // Wheel + L2/R2 scrolling for the sprite board. See CCScroll.
      if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);

      this.refreshUIOverlayDOM();

      // Selector overlay is now rendered and visible, drop the transition veil
      // so it does not stay covering the sprite selector as a black screen.
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
    }

    getSpriteStyle(spriteName, spriteIndex, animate = false, size = 48) {
      if (!spriteName) return "";
      const geo = spriteFrameGeometry(spriteName);
      const url = `img/characters/${spriteName}.png`;

      let pattern = 1; // Standing middle
      let directionRow = 0; // Facing down by default
      if (animate) {
        const frame = Math.floor(Graphics.frameCount / 12) % 4;
        pattern = frame === 3 ? 1 : frame;
        directionRow = Math.floor(Graphics.frameCount / 48) % 4;
      }

      const bg = spriteFrameBackground(geo, spriteIndex, pattern, directionRow);
      const box = spriteFrameBox(geo, size);

      // The sheet decides both the slice and the frame proportions, so a sprite
      // whose bitmap has not arrived yet is restyled once it does.
      if (!geo.ready && geo.bitmap) {
        geo.bitmap.addLoadListener(() => {
          const className = `cc-sprite-img-${spriteName.replace(/[^a-zA-Z0-9]/g, "_")}-${spriteIndex}`;
          const els = document.querySelectorAll(`.${className}`);
          if (els.length === 0) return;
          const loaded = spriteFrameGeometry(spriteName);
          const loadedBg = spriteFrameBackground(
            loaded,
            spriteIndex,
            pattern,
            directionRow,
          );
          const loadedBox = spriteFrameBox(loaded, size);
          els.forEach((el) => {
            el.style.width = `${loadedBox.width}px`;
            el.style.height = `${loadedBox.height}px`;
            el.style.backgroundSize = loadedBg.size;
            el.style.backgroundPosition = loadedBg.position;
          });
        });
      }

      return `background-image: url('${url}'); background-position: ${bg.position}; background-size: ${bg.size}; width: ${box.width}px; height: ${box.height}px; image-rendering: pixelated;`;
    }

    refreshUIOverlayDOM() {
      if (!this._dndContainer) return;
      const getLocalizedText = (en, it) =>
        ConfigManager.language === "it" ? it : en;

      const activeIndex = this._gridWindow.index();
      const activeItem = spriteOptions[activeIndex];

      // Find or create .cc-pockets-spread structure once to avoid layout thrashing and preserve scroll positions
      let spread = this._dndContainer.querySelector(".cc-pockets-spread");
      if (!spread) {
        this._dndContainer.innerHTML = `
                    <div class="cc-pockets-spread">
                        <div class="cc-page cc-page-left"></div>
                        <div class="cc-page cc-page-right" style="align-items: center; justify-content: center;"></div>
                    </div>
                `;
        spread = this._dndContainer.querySelector(".cc-pockets-spread");
      }

      const leftPage = spread.querySelector(".cc-page-left");
      const rightPage = spread.querySelector(".cc-page-right");

      // Update Left Page Content (RECRUIT INVENTORY selection grid)
      if (leftPage) {
        if (leftPage.innerHTML.trim() === "") {
          // Perform initial render of the left page
          const cards = spriteOptions
            .map((entry, idx) => {
              const isSelected = idx === activeIndex;
              const spriteDivStyle = this.getSpriteStyle(
                entry.name,
                entry.index,
                isSelected,
                SPRITE_GRID_SIZE,
              );
              const className = `cc-sprite-img-${entry.name.replace(/[^a-zA-Z0-9]/g, '_')}-${entry.index}`;

              return `
                            <div class="cc-wanted-card cc-sprite-card ${isSelected ? "selected" : ""}" style="display: flex; justify-content: center; align-items: center; cursor: pointer; border: 2px solid ${isSelected ? "#8b5a2b" : "transparent"}; border-radius: 6px; padding: 4px; box-shadow: none; background: ${isSelected ? "rgba(139, 90, 43, 0.15)" : "none"}; width: 100%; min-width: 0; min-height: 0; height: ${SPRITE_GRID_SIZE + 16}px; overflow: hidden; box-sizing: border-box; transition: all 0.2s ease; margin: 0;" onclick="SceneManager._scene.onSpriteCardClick(${idx})">
                                <div class="cc-wanted-sprite ${className}" style="${spriteDivStyle} margin: 0;"></div>
                            </div>
                        `;
            })
            .join("");

          // The board fills the page and stretches its cells, so the sprites
          // get the whole left page instead of a 580px letterbox.
          leftPage.innerHTML = `
                        <h2 class="cc-header-gothic">${T('CharCreate.selectSprite')}</h2>

                        <div class="cc-presets-board" style="grid-template-columns: repeat(${SPRITE_GRID_COLS}, minmax(0, 1fr)); flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; gap: 10px; padding: 14px; justify-items: stretch; align-content: start;">
                            ${cards}
                        </div>
                    `;
        } else {
          // Update only selected card states and reset previously selected cards' walking patterns to 1 (standing)
          const cards = leftPage.querySelectorAll(".cc-wanted-card");
          cards.forEach((card, idx) => {
            const entry = spriteOptions[idx];
            const spriteDiv = card.querySelector(".cc-wanted-sprite");
            if (idx === activeIndex) {
              card.classList.add("selected");
              card.style.borderColor = "#8b5a2b";
              card.style.backgroundColor = "rgba(139, 90, 43, 0.15)";
            } else {
              if (card.classList.contains("selected")) {
                card.classList.remove("selected");
                card.style.borderColor = "transparent";
                card.style.backgroundColor = "transparent";
                // Reset to standing middle frame (pattern = 1)
                if (spriteDiv && entry) {
                  spriteDiv.style.backgroundPosition =
                    this.getBackgroundPosition(entry.name, entry.index, 1, 0);
                }
              }
            }
          });
        }
      }

      // Update Right Page Content (SPECIMEN PROFILE preview & buttons)
      if (rightPage && activeItem) {
        // The sheet file name is CamelCase (GoblinIllusionist); the dossier
        // reads it back as words.
        const cleanName = decamelCase(
          activeItem.name
            .split("/")
            .pop()
            .replace(/^[$!]+/, ""),
        );
        const spriteDivStyle = this.getSpriteStyle(
          activeItem.name,
          activeItem.index,
          true,
        );

        rightPage.innerHTML = `

                    
                    <div class="cc-incubator-frame" style="width: 180px; height: 180px; border-radius: 50%; background: radial-gradient(circle, #f7eed7 0%, #ecdcb9 100%); margin: 24px 0; display: flex; align-items: center; justify-content: center;">
                        <div id="cc-preview-sprite" style="${spriteDivStyle} transform: scale(2.5);"></div>
                    </div>

                    <div class="cc-dossier-card" style="width: 90%; text-align: center;">
                        <div class="cc-option-title">${cleanName}</div>
                        <div class="cc-wanted-class" style="color: #8b5a2b; font-weight: bold; margin-top: 4px;">${T('CharCreate.spriteIndex')}: ${activeItem.index}</div>
                    </div>


                    <div class="cc-button-panel" style="margin-top: 24px;">
                        <button class="cc-btn-treaty" onclick="SceneManager._scene.popScene()">${T('CharCreate.back')}</button>
                        <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onSpriteCardConfirm()">${T('CharCreate.continue2')}</button>
                    </div>
                `;
      }

      // Auto-scroll selected card into view
      setTimeout(() => {
        const selectedCard = this._dndContainer.querySelector(
          ".cc-wanted-card.selected",
        );
        if (selectedCard) {
          selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 10);
    }

    onSpriteCardClick(index) {
      if (this._gridWindow) {
        if (this._gridWindow.index() === index) {
          this.onSpriteCardConfirm();
        } else {
          this._gridWindow.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onSpriteCardConfirm() {
      if (this._gridWindow) {
        this._gridWindow.processOk();
      }
    }

    updateUIInput() {
      const windowObj = this._gridWindow;
      if (!windowObj || !windowObj.active) return;

      const maxItems = windowObj.maxItems();
      if (maxItems <= 0) return;

      let moved = false;
      let index = windowObj.index();

      const isDown = Input.isTriggered("down") || Input.isRepeated("down") || this._wasdInput.down;
      const isUp = Input.isTriggered("up") || Input.isRepeated("up") || this._wasdInput.up;
      const isRight = Input.isTriggered("right") || Input.isRepeated("right") || this._wasdInput.right;
      const isLeft = Input.isTriggered("left") || Input.isRepeated("left") || this._wasdInput.left;

      // Consume WASD inputs
      this._wasdInput.up = false;
      this._wasdInput.down = false;
      this._wasdInput.left = false;
      this._wasdInput.right = false;

      if (isDown) {
        const cols = windowObj.maxCols();
        if (index + cols < maxItems) {
          index += cols;
        } else {
          index = index % cols;
        }
        moved = true;
      } else if (isUp) {
        const cols = windowObj.maxCols();
        if (index - cols >= 0) {
          index -= cols;
        } else {
          let target =
            Math.floor((maxItems - 1) / cols) * cols + (index % cols);
          if (target >= maxItems) target -= cols;
          index = target >= 0 ? target : 0;
        }
        moved = true;
      } else if (isRight) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols < cols - 1 && index + 1 < maxItems) {
          index += 1;
          moved = true;
        }
      } else if (isLeft) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols > 0) {
          index -= 1;
          moved = true;
        }
      } else if (Input.isTriggered("ok")) {
        SoundManager.playOk();
        this.onSpriteCardConfirm();
      } else if (Input.isTriggered("cancel")) {
        SoundManager.playCancel();
        this.popScene();
      }

      if (moved) {
        SoundManager.playCursor();
        windowObj.select(index);
        this.refreshUIOverlayDOM();
      }
    }

    update() {
      super.update();
      if (this._dndContainer && this._dndContainer.style.display !== "none") {
        this.updateUIInput();
        if (window.CCScroll) window.CCScroll.update(this._dndContainer);
        const activeIndex = this._gridWindow.index();
        const frame = Math.floor(Graphics.frameCount / 12) % 4;
        const pattern = frame === 3 ? 1 : frame;
        const directionRow = Math.floor(Graphics.frameCount / 48) % 4;

        if (this._lastSelectedIndex !== activeIndex) {
          this._lastSelectedIndex = activeIndex;
          this._lastRenderedPattern = pattern;
          this._lastRenderedDirection = directionRow;
          this.refreshUIOverlayDOM();
        } else if (
          this._lastRenderedPattern !== pattern ||
          this._lastRenderedDirection !== directionRow
        ) {
          this._lastRenderedPattern = pattern;
          this._lastRenderedDirection = directionRow;
          this.updateSpriteAnimations(pattern, directionRow);
        }
      }
    }

    getBackgroundPosition(spriteName, spriteIndex, pattern, directionRow = 0) {
      if (!spriteName) return "";
      const geo = spriteFrameGeometry(spriteName);
      return spriteFrameBackground(geo, spriteIndex, pattern, directionRow)
        .position;
    }

    updateSpriteAnimations(pattern, directionRow) {
      const activeIndex = this._gridWindow.index();
      const activeItem = spriteOptions[activeIndex];
      if (!activeItem) return;

      const bp = this.getBackgroundPosition(
        activeItem.name,
        activeItem.index,
        pattern,
        directionRow,
      );

      // 1. Update specimen incubator preview sprite
      const previewEl = document.getElementById("cc-preview-sprite");
      if (previewEl) {
        previewEl.style.backgroundPosition = bp;
      }

      // 2. Update selected card's walking sprite
      const selectedCardSpriteEl = this._dndContainer.querySelector(
        ".cc-wanted-card.selected .cc-wanted-sprite",
      );
      if (selectedCardSpriteEl) {
        selectedCardSpriteEl.style.backgroundPosition = bp;
      }
    }

    createHelpWindow() {
      const rect = this.helpWindowRect();
      this._helpWindow = new Window_Help(rect);
      this._helpWindow.setText(T('CharCreate.selectCharacterSprite'));
      this.addWindow(this._helpWindow);
    }

    helpWindowRect() {
      const wx = 0;
      const wy = 0;
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(1, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createGridWindow() {
      const rect = this.gridWindowRect();
      this._gridWindow = new Window_SpriteGrid(rect);
      this._gridWindow.setHandler("ok", this.onSpriteSelected.bind(this));
      this._gridWindow.setHandler("cancel", this.popScene.bind(this));
      this.addWindow(this._gridWindow);
      this._gridWindow.activate();
      this._gridWindow.select(0);
    }

    gridWindowRect() {
      const wx = 0;
      const wy = this._helpWindow.height;
      const ww = Graphics.boxWidth;
      const wh = Graphics.boxHeight - wy;
      return new Rectangle(wx, wy, ww, wh);
    }

    preloadSprites() {
      // Only warm the first page of sheets; the grid lazy-loads the rest per
      // visible cell (drawCharacterSprite). Bulk-loading every npc:true sheet
      // (hundreds) up front would spike memory and stall scene entry.
      const firstPageCount = gridColumns * gridRows;
      const uniqueSheets = [
        ...new Set(spriteOptions.slice(0, firstPageCount).map((o) => o.name)),
      ];
      uniqueSheets.forEach((filename) => {
        ImageManager.loadCharacter(filename);
      });
    }

    onSpriteSelected() {
      const index = this._gridWindow.index();
      if (index >= 0 && index < spriteOptions.length) {
        const entry = spriteOptions[index];
        const actor = $gameActors.actor(this._actorId);

        // Apply the selected sprite to the specified actor
        actor.setCharacterImage(entry.name, entry.index);

        // Refresh player if this is the party leader
        if (this._actorId === $gameParty.leader().actorId()) {
          $gamePlayer.refresh();
        }

        SoundManager.playOk();

        // Portrait style is exclusive (chosen on the wizard's portrait step):
        // a "model" character skips the bust gallery entirely and goes straight
        // to the 3D editor, a "bust" character never sees the editor.
        if (actor && actor.portraitMode && actor.portraitMode() === "model" &&
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

        // Look up associated bust from SpritesAssociation
        let preselectedBust = null;
        const spritesAssoc =
          window.Sprites && window.Sprites.SpritesAssociation;
        if (spritesAssoc && spritesAssoc[entry.name]) {
          const busts = spritesAssoc[entry.name];
          preselectedBust =
            busts[entry.index] !== undefined ? busts[entry.index] : busts[0];
        }

        // Open bust selection window
        this.createBustSelectionScene(preselectedBust);
      }
    }

    createBustSelectionScene(preselectedBust) {
      const sceneClass = Scene_BustSelector;
      SceneManager.push(sceneClass);
      if (SceneManager._nextScene) {
        SceneManager._nextScene.setActor(this._actorId);
        if (preselectedBust) {
          SceneManager._nextScene.setPreselectedBust(preselectedBust);
        }
      }
    }
  }

  // Window to display the sprite grid
  class Window_SpriteGrid extends Window_Selectable {
    constructor(rect) {
      super(rect);
      this._sprites = spriteOptions;
      this._characterSprites = [];
      this._bustBitmaps = new Map(); // Cache for bust bitmaps
      this._lastAnimFrame = 0;
      this._animationCount = 0;
      this._lastSelectedIndex = -1;
      this.refresh();
    }

    processCursorMove() {
      // All cursor movement is handled by Scene_SpriteGridSelector.updateUIInput()
      // to support WASD, arrow keys, and controller without double-movement issues.
    }

    maxCols() {
      return SPRITE_GRID_COLS;
    }

    maxItems() {
      return this._sprites.length;
    }

    itemWidth() {
      return Math.floor(
        (this.innerWidth - this.colSpacing() * (this.maxCols() - 1)) /
          this.maxCols(),
      );
    }

    itemHeight() {
      // Increased height to accommodate sprite name under the image
      return 90;
    }

    spacing() {
      return 8;
    }

    colSpacing() {
      return this.spacing();
    }

    rowSpacing() {
      return this.spacing();
    }

    update() {
      super.update();

      // Check if selection changed
      if (this.index() !== this._lastSelectedIndex) {
        if (this._lastSelectedIndex >= 0) {
          this.redrawItem(this._lastSelectedIndex);
        }
        this._lastSelectedIndex = this.index();
      }

      // Update animation for selected sprite only
      if (this.index() >= 0) {
        this._animationCount++;
        if (this._animationCount % 12 === 0) {
          this.updateCharacterAnimation();
        }
      }
    }

    updateCharacterAnimation() {
      const index = this.index();
      if (index >= 0) {
        this.redrawItem(index);
      }
    }

    drawAllItems() {
      super.drawAllItems();

      // Clear any existing character sprites
      if (this._characterSprites) {
        this._characterSprites.forEach((sprite) => {
          if (sprite && sprite.parent) {
            sprite.parent.removeChild(sprite);
          }
        });
      }
      this._characterSprites = [];
    }

    drawItem(index) {
      if (!this._sprites[index]) return;

      const sprite = this._sprites[index];
      const rect = this.itemRect(index);

      // Draw a background for the item
      this.drawItemBackground(index);

      // Shift sprite up slightly to make room for name
      const spriteY = rect.y + rect.height / 2 - 12;
      this.drawCharacterSprite(
        sprite.name,
        sprite.index,
        rect.x + rect.width / 2,
        spriteY,
        index === this.index(),
      );

      // Draw sprite name minus prefixes
      this.drawSpriteName(sprite.name, rect);
    }

    drawSpriteName(name, rect) {
      const fileName = name.split("/").pop();
      const displayName = fileName.replace(/^[$!]+/, "");
      this.contents.fontSize = 14;
      this.drawText(
        displayName,
        rect.x,
        rect.y + rect.height - 24,
        rect.width,
        "center",
      );
      this.resetFontSettings();
    }

    drawCharacterSprite(characterName, characterIndex, x, y, isSelected) {
      // Find the index in the sprite options array
      const spriteIndex = this._sprites.findIndex(
        (s) => s.name === characterName && s.index === characterIndex,
      );

      // Get the complete item rect
      const rect = this.itemRectWithPadding(this.indexToRect(spriteIndex));

      // Load character bitmap
      const bitmap = ImageManager.loadCharacter(characterName);
      if (!bitmap.isReady()) {
        bitmap.addLoadListener(() => this.redrawItem(spriteIndex));
        return;
      }

      // Determine character sheet type and its real row count (a handful of
      // sheets carry a single facing row, see spriteFrameGeometry)
      const geo = spriteFrameGeometry(characterName);
      const big = geo.isBig;

      // Calculate pattern (animation frame) - only animate selected sprite
      let pattern = 1; // Default to middle frame (standing)
      if (isSelected) {
        const frameCount = Graphics.frameCount || this._animationCount;
        const animFrame = Math.floor((frameCount / 12) % 4);
        // Pattern for walking: 0, 1, 2, 1
        pattern = animFrame === 3 ? 1 : animFrame;
      }

      // Face down (direction 2), clamped to the facings the sheet actually has
      const direction = 2;
      const dirRow = Math.min(direction / 2 - 1, geo.dirRows - 1);

      // Calculate dimensions and source rectangle
      const pw = geo.frameW;
      const ph = geo.frameH;

      // For big characters: pattern = column (animation frame), direction = row
      // For regular characters: characterIndex determines position in grid
      const sx = (big ? pattern : (characterIndex % 4) * 3 + pattern) * pw;
      const sy =
        (big ? dirRow : Math.floor(characterIndex / 4) * 4 + dirRow) * ph;

      // Use integer scaling for pixel perfect rendering
      const scale = 1; // 1x scale for compact grid
      const dw = Math.floor(pw * scale);
      const dh = Math.floor(ph * scale);

      // Use integer coordinates for pixel perfect positioning
      const dx = Math.floor(x - dw / 2);
      const dy = Math.floor(y - dh / 2);

      // Draw directly to the window contents with integer coordinates
      this.contents.blt(
        bitmap,
        Math.floor(sx),
        Math.floor(sy),
        Math.floor(pw),
        Math.floor(ph),
        dx,
        dy,
        dw,
        dh,
      );
    }

    drawItemBackground(index) {
      // Do nothing - no background highlight for selected item
    }

    // Helper method to convert index to rect coordinates
    indexToRect(index) {
      if (index < 0) return new Rectangle(0, 0, 0, 0);
      const maxCols = this.maxCols();
      const itemWidth = this.itemWidth();
      const itemHeight = this.itemHeight();
      const colSpacing = this.colSpacing();
      const rowSpacing = this.rowSpacing();
      const col = index % maxCols;
      const row = Math.floor(index / maxCols);
      const x = col * itemWidth + col * colSpacing;
      const y = row * itemHeight + row * rowSpacing;
      return new Rectangle(x, y, itemWidth, itemHeight);
    }

    // Add padding to rect
    itemRectWithPadding(rect) {
      const padding = this.itemPadding();
      return new Rectangle(
        rect.x + padding,
        rect.y + padding,
        rect.width - padding * 2,
        rect.height - padding * 2,
      );
    }

    select(index) {
      const lastIndex = this.index();
      super.select(index);

      if (lastIndex !== index) {
        // Force complete redraw of both the previous and new selected items
        if (lastIndex >= 0) this.redrawItem(lastIndex);
        if (index >= 0) this.redrawItem(index);
      }
    }

    // Override the cursor rectangle to hide the selection border
    refreshCursor() {
      // Override to hide the cursor/border completely
      this.setCursorRect(0, 0, 0, 0);
    }
  }

  // Scene for bust selection
  class Scene_BustSelector extends Scene_MenuBase {
    constructor() {
      super();
      this._actorId = 1;
      this._bustList = [];
      this._preselectedBust = null;
    }

    setActor(actorId) {
      this._actorId = actorId;
    }

    setPreselectedBust(bustName) {
      this._preselectedBust = bustName;
    }

    create() {
      // Make sure stylesheet is loaded

      super.create();
      this._lastSelectedIndex = -1;
      this._lastCatMode = null;
      this._lastCategoryRendered = null;
      this._wasdInput = { up: false, down: false, left: false, right: false };
      this._wasdListener = (event) => {
        if (!this._bustListWindow || !this._bustListWindow.active) return;
        const key = event.key.toLowerCase();
        // Only handle WASD here. Arrow keys and controller are handled by Input.isTriggered/repeated.
        if (key === "w") {
          this._wasdInput.up = true;
          event.preventDefault();
        }
        if (key === "s") {
          this._wasdInput.down = true;
          event.preventDefault();
        }
        if (key === "a") {
          this._wasdInput.left = true;
          event.preventDefault();
        }
        if (key === "d") {
          this._wasdInput.right = true;
          event.preventDefault();
        }
      };
      window.addEventListener("keydown", this._wasdListener);
      this.createHelpWindow();
      this.createBustListWindow();
      this.createBustPreviewWindow();
      this.loadBustList();
      if (this._preselectedBust) {
        this._bustListWindow.preselectBust(this._preselectedBust);
      }
      this.createUIOverlay();
    }

    terminate() {
      super.terminate();
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
      if (this._wasdListener) {
        window.removeEventListener("keydown", this._wasdListener);
      }
      if (this._dndContainer) {
        this._dndContainer.innerHTML = ""; // Clear HTML immediately!
        this._dndContainer.style.display = "none";
      }
    }

    createUIOverlay() {
      // 1. Mute MZ windows
      if (this._helpWindow) {
        this._helpWindow.visible = false;
        this._helpWindow.opacity = 0;
      }
      if (this._bustListWindow) {
        this._bustListWindow.visible = false;
        this._bustListWindow.opacity = 0;
      }
      if (this._bustPreviewWindow) {
        this._bustPreviewWindow.visible = false;
        this._bustPreviewWindow.opacity = 0;
      }

      // 2. Create container
      let container = document.getElementById("character-creation-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "character-creation-container";
        document.body.appendChild(container);
      }

      // Clear any pending timeout and ensure styles are clean
      if (window._ccOverlayTimeout) {
        clearTimeout(window._ccOverlayTimeout);
        window._ccOverlayTimeout = null;
      }

      this._dndContainer = container;
      this._dndContainer.style.display = "flex";
      this._dndContainer.style.opacity = "1";
      this._dndContainer.style.pointerEvents = "auto";
      this._dndContainer.innerHTML = ""; // Wipe clean to prevent stale DOM layout leaking

      // Wheel + L2/R2 scrolling for both boards. See CCScroll.
      if (window.CCScroll) window.CCScroll.bindWheel(this._dndContainer);

      this.refreshUIOverlayDOM();
    }

    refreshUIOverlayDOM() {
      if (!this._dndContainer) return;
      const getLocalizedText = (en, it) =>
        ConfigManager.language === "it" ? it : en;

      const isInCategoryMode = this._bustListWindow.isInCategoryMode();
      const activeIndex = this._bustListWindow.index();

      // Find all categories loaded in the bust list window
      const categories = Object.keys(
        this._bustListWindow._bustCategories,
      ).filter((cat) => this._bustListWindow._bustCategories[cat].length > 0);

      // Determine active category index and current category name
      let activeCategoryIndex = -1;
      let currentCat = "";
      if (isInCategoryMode) {
        activeCategoryIndex = activeIndex;
        currentCat = categories[activeIndex] || categories[0];
      } else {
        currentCat = this._bustListWindow.getCurrentCategory() || categories[0];
        activeCategoryIndex = categories.indexOf(currentCat);
      }

      // Left Page: Grid of presets for selected category
      const busts = this._bustListWindow._bustCategories[currentCat] || [];
      const bustCards = busts
        .map((bName, idx) => {
          const isSelected = !isInCategoryMode && idx === activeIndex;
          const decamelName = decamelCase(bName);
          return `
                    <div class="cc-wanted-card cc-bust-card ${isSelected ? "selected" : ""}" onclick="SceneManager._scene.onBustCardClick(${idx})">
                        <div class="cc-bust-image" style="background-image: url('img/busts/${bName}.png');"></div>
                        <div class="cc-wanted-name">${decamelName}</div>
                    </div>
                `;
        })
        .join("");

      const leftHtml = `
                <div class="cc-page cc-page-left" style="padding: 24px 48px 24px 24px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;">
                    <h2 class="cc-header-gothic" style="margin-bottom: 8px; width: 100%; text-align: center;">${currentCat ? currentCat.toUpperCase() + " " : ""}${T('CharCreate.presets')}</h2>

                    <div class="cc-presets-board" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; width: 100%; padding-right: 4px; align-content: start;">
                        ${bustCards}
                    </div>
                </div>
            `;

      // Right Page: BIOMETRIC REGISTRY Categories list (Vertical List instead of Grid)
      const searchTerm = (this._categorySearchTerm || "").trim().toLowerCase();
      const categoryCards = categories
        .map((cat, idx) => ({ cat, idx }))
        .filter(({ cat }) => !searchTerm || cat.toLowerCase().includes(searchTerm))
        .map(({ cat, idx }) => {
          const isSelected = idx === activeCategoryIndex;
          const count = this._bustListWindow._bustCategories[cat].length;
          return `
                    <div class="cc-card-option ${isSelected ? "selected" : ""}" onclick="SceneManager._scene.onCategoryCardClick(${idx})">
                        <div class="cc-option-title">${bustCategoryLabel(cat)}</div>
                        <span class="cc-element-badge">${count} ${T('CharCreate.presets2')}</span>
                    </div>
                `;
        })
        .join("");

      const rightHtml = `
                <div class="cc-page cc-page-right" style="padding: 24px; display: flex; flex-direction: column; height: 100%; box-sizing: border-box; overflow: hidden;">
                    <h2 class="cc-header-gothic" style="margin-bottom: 8px; width: 100%; text-align: center;">${T('CharCreate.humanoidSpecies')}</h2>
                    <input type="text" class="cc-species-search" value="${(this._categorySearchTerm || "").replace(/"/g, "&quot;")}" placeholder="${T('CharCreate.searchSpecies')}" oninput="SceneManager._scene.onCategorySearch(this.value)" onkeydown="event.stopPropagation()" onkeyup="event.stopPropagation()" />
                    <div class="cc-presets-board cc-categories-list" style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; flex: 1; overflow-x: hidden; overflow-y: auto; padding-right: 4px; width: 100%; min-height: 0; margin-top: 0; align-content: start;">
                        ${categoryCards}
                    </div>

                    <div class="cc-button-panel" style="margin-top: 16px; width: 100%;">
                        <button class="cc-btn-treaty" onclick="SceneManager._scene.onBustCancel()">${T('CharCreate.back')}</button>
                        ${
                          !isInCategoryMode
                            ? `
                            <button class="cc-btn-treaty confirm" onclick="SceneManager._scene.onBustCardConfirm()">${T('CharCreate.continue')}</button>
                        `
                            : ""
                        }
                    </div>
                </div>
            `;

      // Find or create .cc-pockets-spread structure once to avoid layout thrashing and preserve scroll positions
      let spread = this._dndContainer.querySelector(".cc-pockets-spread");
      const hasCategoryCards =
        spread && spread.querySelector(".cc-card-option");
      let shouldFullRender =
        !spread || (!hasCategoryCards && categories.length > 0);

      if (shouldFullRender) {
        this._lastCategoryRendered = currentCat;
        this._dndContainer.innerHTML = `
                    <div class="cc-pockets-spread">
                        ${leftHtml}
                        ${rightHtml}
                    </div>
                `;
      } else {
        // Optimized path: just update selected classes or rebuild right column parts if category changed
        const leftPage = spread.querySelector(".cc-page-left");
        const rightPage = spread.querySelector(".cc-page-right");

        if (this._lastCategoryRendered !== currentCat) {
          this._lastCategoryRendered = currentCat;

          // Update Left Page Header (since PRESETS is now on left page)
          if (leftPage) {
            const leftTitle = leftPage.querySelector(".cc-header-gothic");
            if (leftTitle) {
              leftTitle.innerHTML = `${currentCat ? currentCat.toUpperCase() + " " : ""}${T('CharCreate.presets')}`;
            }

            // Update presets board grid content (on left page)
            const presetsBoard = leftPage.querySelector(".cc-presets-board");
            if (presetsBoard) {
              presetsBoard.innerHTML = bustCards;
            }
          }
        }

        // Update Right Page Category Cards Selected states (since BIOMETRIC REGISTRY is on right page)
        if (rightPage) {
          const catCards = rightPage.querySelectorAll(".cc-card-option");
          catCards.forEach((card, idx) => {
            card.classList.toggle("selected", idx === activeCategoryIndex);
          });
        }

        // Update Left Page Presets Board Selected states (since PRESETS is on left page)
        if (leftPage) {
          const cards = leftPage.querySelectorAll(".cc-wanted-card");
          cards.forEach((card, idx) => {
            if (!isInCategoryMode && idx === activeIndex) {
              card.classList.add("selected");
            } else {
              card.classList.remove("selected");
            }
          });
        }

        // Update confirm button presence in button panel (on right page)
        if (rightPage) {
          const btnPanel = rightPage.querySelector(".cc-button-panel");
          if (btnPanel) {
            let confirmBtn = btnPanel.querySelector(".confirm");
            if (!isInCategoryMode) {
              if (!confirmBtn) {
                // Add confirm button
                confirmBtn = document.createElement("button");
                confirmBtn.className = "cc-btn-treaty confirm";
                confirmBtn.onclick = () =>
                  SceneManager._scene.onBustCardConfirm();
                confirmBtn.textContent = T('CharCreate.confirmBust');
                btnPanel.appendChild(confirmBtn);
              }
            } else {
              if (confirmBtn) {
                confirmBtn.remove();
              }
            }
          }
        }
      }

      // Auto-scroll selected card into view (Category card or Preset card depending on mode)
      setTimeout(() => {
        const isCat = this._bustListWindow.isInCategoryMode();
        const selector = isCat
          ? ".cc-card-option.selected"
          : ".cc-wanted-card.selected";
        const selectedCard = this._dndContainer.querySelector(selector);
        if (selectedCard) {
          selectedCard.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }, 10);
    }

    onCategorySearch(value) {
      this._categorySearchTerm = value || "";
      const term = this._categorySearchTerm.trim().toLowerCase();
      if (!this._dndContainer) return;
      const cards = this._dndContainer.querySelectorAll(
        ".cc-page-right .cc-card-option",
      );
      cards.forEach((card) => {
        const titleEl = card.querySelector(".cc-option-title");
        const name = titleEl ? titleEl.textContent.toLowerCase() : "";
        card.style.display = !term || name.includes(term) ? "flex" : "none";
      });
    }

    onCategoryCardClick(index) {
      if (this._bustListWindow) {
        const categories = Object.keys(
          this._bustListWindow._bustCategories,
        ).filter((cat) => this._bustListWindow._bustCategories[cat].length > 0);
        const category = categories[index];
        if (category) {
          this._bustListWindow._currentCategory = category;
          this._bustListWindow._categoryMode = false;
          this._bustListWindow.updateDisplayList();
          this._bustListWindow._index = -1;
          this._bustListWindow.select(0);
          this._bustListWindow.refresh();
          if (this._bustListWindow.isHandled("select")) {
            this._bustListWindow.callHandler("select");
          }
          this.refreshUIOverlayDOM();
        }
      }
    }

    onBustCardClick(index) {
      if (this._bustListWindow) {
        const isInCategoryMode = this._bustListWindow.isInCategoryMode();
        if (isInCategoryMode) {
          const categories = Object.keys(
            this._bustListWindow._bustCategories,
          ).filter(
            (cat) => this._bustListWindow._bustCategories[cat].length > 0,
          );
          const activeIndex = this._bustListWindow.index();
          const category = categories[activeIndex] || categories[0];
          if (category) {
            this._bustListWindow._currentCategory = category;
            this._bustListWindow._categoryMode = false;
            this._bustListWindow.updateDisplayList();
            this._bustListWindow._index = -1;
            this._bustListWindow.select(index); // Select the clicked bust!
            this._bustListWindow.refresh();
            if (this._bustListWindow.isHandled("select")) {
              this._bustListWindow.callHandler("select");
            }
            this.refreshUIOverlayDOM();
            return;
          }
        }

        if (this._bustListWindow.index() === index && !isInCategoryMode) {
          this.onBustCardConfirm();
        } else {
          this._bustListWindow.select(index);
          this.refreshUIOverlayDOM();
        }
      }
    }

    onBustCardConfirm() {
      if (this._bustListWindow) {
        this._bustListWindow.processOk();
      }
    }

    updateUIInput() {
      const windowObj = this._bustListWindow;
      if (!windowObj || !windowObj.active) return;

      const maxItems = windowObj.maxItems();
      if (maxItems <= 0) return;

      let moved = false;
      let index = windowObj.index();
      const isCat = windowObj.isInCategoryMode();

      const isDown = Input.isTriggered("down") || Input.isRepeated("down") || this._wasdInput.down;
      const isUp = Input.isTriggered("up") || Input.isRepeated("up") || this._wasdInput.up;
      const isRight = Input.isTriggered("right") || Input.isRepeated("right") || this._wasdInput.right;
      const isLeft = Input.isTriggered("left") || Input.isRepeated("left") || this._wasdInput.left;

      // Consume WASD inputs
      this._wasdInput.up = false;
      this._wasdInput.down = false;
      this._wasdInput.left = false;
      this._wasdInput.right = false;

      if (isDown) {
        const cols = windowObj.maxCols();
        if (index + cols < maxItems) {
          index += cols;
        } else {
          index = index % cols;
        }
        moved = true;
      } else if (isUp) {
        const cols = windowObj.maxCols();
        if (index - cols >= 0) {
          index -= cols;
        } else {
          let target =
            Math.floor((maxItems - 1) / cols) * cols + (index % cols);
          if (target >= maxItems) target -= cols;
          index = target >= 0 ? target : 0;
        }
        moved = true;
      } else if (isRight) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols < cols - 1 && index + 1 < maxItems) {
          index += 1;
          moved = true;
        }
      } else if (isLeft) {
        const cols = windowObj.maxCols();
        if (cols > 1 && index % cols > 0) {
          index -= 1;
          moved = true;
        }
      } else if (Input.isTriggered("ok")) {
        SoundManager.playOk();
        if (isCat) {
          // Open category
          windowObj.openCategory(index);
        } else {
          // Confirm bust
          this.onBustCardConfirm();
        }
      } else if (Input.isTriggered("cancel")) {
        SoundManager.playCancel();
        if (isCat) {
          SceneManager.pop();
        } else {
          windowObj.goBackToCategories();
        }
      }

      if (moved) {
        SoundManager.playCursor();
        windowObj.select(index);
        this.refreshUIOverlayDOM();
      }
    }

    update() {
      super.update();
      if (this._dndContainer && this._dndContainer.style.display !== "none") {
        this.updateUIInput();
        if (window.CCScroll) window.CCScroll.update(this._dndContainer);
        const activeIndex = this._bustListWindow.index();
        const isCatMode = this._bustListWindow.isInCategoryMode();
        if (
          this._lastSelectedIndex !== activeIndex ||
          this._lastCatMode !== isCatMode
        ) {
          this._lastSelectedIndex = activeIndex;
          this._lastCatMode = isCatMode;
          this.refreshUIOverlayDOM();
        }
      }
    }

    createHelpWindow() {
      const rect = this.helpWindowRect();
      this._helpWindow = new Window_Help(rect);
      this._helpWindow.setText(T('CharCreate.selectBustImage'));
      this.addWindow(this._helpWindow);
    }

    helpWindowRect() {
      const wx = 0;
      const wy = 0;
      const ww = Graphics.boxWidth;
      const wh = this.calcWindowHeight(1, false);
      return new Rectangle(wx, wy, ww, wh);
    }

    createBustListWindow() {
      const rect = this.bustListWindowRect();
      this._bustListWindow = new Window_BustList(rect);
      this._bustListWindow.setHandler("ok", this.onBustSelected.bind(this));
      this._bustListWindow.setHandler("cancel", this.onBustCancel.bind(this));
      this._bustListWindow.setHandler("select", this.onBustSelect.bind(this));
      this.addWindow(this._bustListWindow);
      this._bustListWindow.activate();
      this._bustListWindow.select(0);
      this.onBustSelect();
    }

    createBustPreviewWindow() {
      const rect = this.bustPreviewWindowRect();
      this._bustPreviewWindow = new Window_BustPreview(rect);
      this.addWindow(this._bustPreviewWindow);
    }

    bustListWindowRect() {
      const wx = 0;
      const wy = this._helpWindow.height;
      const ww = Math.floor(Graphics.boxWidth * 0.3);
      const wh = Graphics.boxHeight - wy;
      return new Rectangle(wx, wy, ww, wh);
    }

    bustPreviewWindowRect() {
      const wx = Math.floor(Graphics.boxWidth * 0.3);
      const wy = this._helpWindow.height;
      const ww = Graphics.boxWidth - wx;
      const wh = Graphics.boxHeight - wy;
      return new Rectangle(wx, wy, ww, wh);
    }

    loadBustList() {}

    onBustSelect() {
      const selectedBust = this._bustListWindow.getSelectedBust();
      const isInCategoryMode = this._bustListWindow.isInCategoryMode();

      if (isInCategoryMode) {
        if (this._bustPreviewWindow) {
          this._bustPreviewWindow.setBust(null);
        }
        this._helpWindow.setText(T('CharCreate.pressOkToOpenCategory'));
      } else {
        if (this._bustPreviewWindow) {
          this._bustPreviewWindow.setBust(selectedBust);
        }
        this._helpWindow.setText(T('CharCreate.selectedBust', { name: selectedBust }));
      }
    }

    onBustSelected() {
      const isInCategoryMode = this._bustListWindow.isInCategoryMode();

      if (isInCategoryMode) {
        const selectedIndex = this._bustListWindow.index();
        this._bustListWindow.openCategory(selectedIndex);
        SoundManager.playOk();
      } else {
        const selectedBust = this._bustListWindow.getSelectedBust();
        if (selectedBust) {
          // The bust belongs to the actor this selector was opened for, not
          // always the first party member.
          const actorId = this._actorId || 1;
          const bustActor = $gameActors.actor(actorId);
          bustActor.setVnBust(selectedBust);
          // Picking a bust settles this character's portrait style.
          if (bustActor.setPortraitMode) bustActor.setPortraitMode("bust");
          const currentCategory = this._bustListWindow.getCurrentCategory();
          const genderValue = bustActor.gender();
          // Reproduction type variable: 87 for actor 1, 115 / 116 for 2 / 3.
          const reproductiveVar = actorId === 2 ? 115 : actorId === 3 ? 116 : 87;

          // i18n-ignore-start: bust folder ids
          if (currentCategory === "Bot") {
            $gameVariables.setValue(reproductiveVar, -1);
          } else if (currentCategory === "Goblin" && genderValue === 1) {
            // i18n-ignore-end
            $gameVariables.setValue(reproductiveVar, 2);
          }

          SoundManager.playOk();

          // A bust IS the character's portrait: the 3D model editor is the
          // other, mutually exclusive branch (reached from the sprite step) and
          // is never chained after a bust pick.
          SceneManager.pop();
          SceneManager.pop();
        }
      }
    }

    onBustCancel() {
      const isInCategoryMode = this._bustListWindow.isInCategoryMode();

      if (isInCategoryMode) {
        SoundManager.playCancel();
        SceneManager.pop();
      } else {
        this._bustListWindow.goBackToCategories();
        SoundManager.playCancel();
      }
    }
  }

  // Window to display list of busts (left panel)
  class Window_BustList extends Window_Selectable {
    constructor(rect) {
      super(rect);
      this._bustFiles = [];
      this._bustCategories = {};
      this._allBusts = [];
      this._categoryMode = true; // True = showing categories, False = showing busts in category
      this._currentCategory = null;
      this.loadBustFiles();
      this.refresh();
    }

    async loadBustFiles() {
      this._allBusts = [];

      // Try to use Node.js fs module for file system access asynchronously
      try {
        const fs = require("fs").promises;
        const path = require("path");
        const bustsPath = path.join(
          path.dirname(process.mainModule.filename),
          "img/busts/",
        );

        const files = await fs.readdir(bustsPath);

        // Load stats in parallel using Promise.all to maximize performance
        const statPromises = files.map(async (file) => {
          if (/\.(png|jpg|jpeg|gif|webp)$/i.test(file)) {
            const filePath = path.join(bustsPath, file);
            try {
              const stat = await fs.stat(filePath);
              // Only include files (not subdirectories) and only image files, ignoring corrupt placeholder images < 50KB (like 7.png)
              if (stat.isFile() && stat.size > 50000) {
                return file.replace(/\.(png|jpg|jpeg|gif|webp)$/i, "");
              }
            } catch (e) {
              // Ignore single file read errors
            }
          }
          return null;
        });

        const results = await Promise.all(statPromises);
        this._allBusts = results.filter((name) => name !== null);
      } catch (error) {
        console.error("Error loading bust files asynchronously:", error);
        // Fallback: try common numbering patterns if Node.js fs is unavailable
        this.loadBustFilesFallback();
        return;
      }

      // Sort alphabetically
      this._allBusts.sort((a, b) => a.localeCompare(b));
      this.categorizeBusts();

      // Refresh window and UI overlay once the data loads
      const scene = SceneManager._scene;
      if (scene && scene._preselectedBust) {
        this.preselectBust(scene._preselectedBust);
      } else {
        this.refresh();
        this.select(0);
      }

      if (scene && typeof scene.refreshUIOverlayDOM === "function") {
        scene.refreshUIOverlayDOM();
      }
      if (this.isHandled("select")) {
        this.callHandler("select");
      }
      // Selector is now populated and visible, drop the transition veil.
      if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
    }

    loadBustFilesFallback() {
      // Fallback method using image loading tests
      const commonNames = [
        "0",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        // i18n-ignore-start: img/characters file names
        "Astronaut1",
        "ElvenTrader",
        "GoblinBard",
        "GoblinCleric",
        "GoblinMonk",
        "GoblinVampire",
        "Miner",
        "Nurse1",
        "Scavenger",
        "VoidSpawn",
        "Space Horrors 01",
        "Space Horrors 03",
        "Space Horrors 04",
        // i18n-ignore-end
      ];

      let loadedCount = 0;
      const totalToTry = commonNames.length;

      commonNames.forEach((filename) => {
        this.tryAddBust(filename, () => {
          loadedCount++;
          if (loadedCount === totalToTry) {
            this._allBusts.sort((a, b) => a.localeCompare(b));
            this.categorizeBusts();
            const scene = SceneManager._scene;
            if (scene && scene._preselectedBust) {
              this.preselectBust(scene._preselectedBust);
            } else {
              this.refresh();
              this.select(0);
            }
            if (scene && typeof scene.refreshUIOverlayDOM === "function") {
              scene.refreshUIOverlayDOM();
            }
            if (this.isHandled("select")) {
              this.callHandler("select");
            }
            if (window.CCTransitionVeil) window.CCTransitionVeil.hide();
          }
        });
      });
    }

    tryAddBust(filename, callback) {
      // Create an image element to test if file exists
      const image = new Image();
      image.onload = () => {
        // File exists, add it if not already in list
        if (this._allBusts.indexOf(filename) === -1) {
          this._allBusts.push(filename);
        }
        if (callback) callback();
      };
      image.onerror = () => {
        // File doesn't exist, skip silently
        if (callback) callback();
      };
      // Use crossOrigin to avoid CORS issues with local files
      image.crossOrigin = "anonymous";
      image.src = `img/busts/${filename}.png`;
    }

    categorizeBusts() {
      // i18n-ignore-start: category ids, matched against the bust file name
      // prefix; the label is resolved by bustCategoryLabel() where it is drawn.
      this._bustCategories = {
        Human: [],
        Goblin: [],
        Orc: [],
        Dwarven: [],
        Rabbit: [],
        Cyclop: [],
        Gnome: [],
        Elven: [],
        Bot: [],
        Undead: [],
        Devil: [],
        Dog: [],
        Android: [],
        Avian: [],
        Cat: [],
        Elephant: [],
        Goat: [],

        Kobold: [],
        Alien: [],
        Exotic: [],
        Insectoid: [],
      };

      for (const bust of this._allBusts) {
        if (bust.startsWith("Orc")) {
          this._bustCategories["Orc"].push(bust);
        } else if (bust.startsWith("Goblin")) {
          this._bustCategories["Goblin"].push(bust);
        } else if (bust.startsWith("Elven")) {
          this._bustCategories["Elven"].push(bust);
        } else if (bust.startsWith("Bot")) {
          this._bustCategories["Bot"].push(bust);
        } else if (bust.startsWith("Exotic")) {
          this._bustCategories["Exotic"].push(bust);
        } else if (bust.startsWith("Elephant")) {
          this._bustCategories["Elephant"].push(bust);
        } else if (bust.startsWith("Goat")) {
          this._bustCategories["Goat"].push(bust);
        } else if (bust.startsWith("Cyclop")) {
          this._bustCategories["Cyclop"].push(bust);
        } else if (bust.startsWith("Dwarven")) {
          this._bustCategories["Dwarven"].push(bust);
        } else if (bust.startsWith("Rabbit")) {
          this._bustCategories["Rabbit"].push(bust);
        } else if (bust.startsWith("Gnome")) {
          this._bustCategories["Gnome"].push(bust);
        } else if (bust.startsWith("Android")) {
          this._bustCategories["Android"].push(bust);
        } else if (bust.startsWith("Cat")) {
          this._bustCategories["Cat"].push(bust);
        } else if (bust.startsWith("Kobold")) {
          this._bustCategories["Kobold"].push(bust);
        } else if (bust.startsWith("Alien")) {
          this._bustCategories["Alien"].push(bust);
        } else if (bust.startsWith("Undead")) {
          this._bustCategories["Undead"].push(bust);
        } else if (bust.startsWith("Devil")) {
          this._bustCategories["Devil"].push(bust);
        } else if (bust.startsWith("Insectoid")) {
          this._bustCategories["Insectoid"].push(bust);
        } else if (bust.startsWith("Dog")) {
          this._bustCategories["Dog"].push(bust);
        } else {
          this._bustCategories["Human"].push(bust);
        }
      }
      // i18n-ignore-end

      // Update bust files to show categories if in category mode
      this.updateDisplayList();
    }

    updateDisplayList() {
      if (this._categoryMode) {
        // Show categories
        this._bustFiles = Object.keys(this._bustCategories).filter(
          (cat) => this._bustCategories[cat].length > 0,
        );
      } else if (this._currentCategory) {
        // Show busts in current category
        this._bustFiles = [...this._bustCategories[this._currentCategory]];
      }
    }

    isCategory(index) {
      return this._categoryMode && this._bustFiles[index] !== undefined;
    }

    openCategory(index) {
      const category = this._bustFiles[index];
      if (category && this._bustCategories[category].length > 0) {
        this._currentCategory = category;
        this._categoryMode = false;
        this.updateDisplayList();
        this._index = -1; // Reset index
        this.select(0);
        this.refresh();
        // Trigger the select handler to update preview
        if (this.isHandled("select")) {
          this.callHandler("select");
        }
        if (SceneManager._scene && SceneManager._scene.refreshUIOverlayDOM) {
          SceneManager._scene.refreshUIOverlayDOM();
        }
      }
    }

    goBackToCategories() {
      this._categoryMode = true;
      this._currentCategory = null;
      this.updateDisplayList();
      this._index = -1; // Reset index
      this.select(0);
      this.refresh();
      // Trigger the select handler to update preview
      if (this.isHandled("select")) {
        this.callHandler("select");
      }
      if (SceneManager._scene && SceneManager._scene.refreshUIOverlayDOM) {
        SceneManager._scene.refreshUIOverlayDOM();
      }
    }

    processCursorMove() {
      // All cursor movement is handled by Scene_BustSelector.updateUIInput()
      // to support WASD, arrow keys, and controller without double-movement issues.
    }

    maxCols() {
      return this._categoryMode ? 1 : 3;
    }

    maxItems() {
      return this._bustFiles.length;
    }

    itemHeight() {
      return this.lineHeight();
    }

    drawItem(index) {
      if (!this._bustFiles[index]) return;

      const filename = this._bustFiles[index];
      const rect = this.itemLineRect(index);

      // If in category mode, add folder icon or special formatting
      if (this._categoryMode) {
        this.changeTextColor(this.systemColor());
        this.drawText("" + filename, rect.x, rect.y, rect.width);
        this.resetTextColor();
      } else {
        // In bust mode, remove category prefix from display name
        this.drawText(filename, rect.x, rect.y, rect.width);
      }
    }

    getSelectedBust() {
      if (this.index() >= 0 && this.index() < this._bustFiles.length) {
        return this._bustFiles[this.index()];
      }
      return null;
    }

    getCurrentCategory() {
      return this._currentCategory;
    }

    isInCategoryMode() {
      return this._categoryMode;
    }

    preselectBust(bustName) {
      // Find which category contains this bust
      let targetCategory = null;
      for (const cat of Object.keys(this._bustCategories)) {
        if (this._bustCategories[cat].includes(bustName)) {
          targetCategory = cat;
          break;
        }
      }

      // If no category found, stay in default category view
      if (!targetCategory) return;

      // Switch into that category
      this._currentCategory = targetCategory;
      this._categoryMode = false;
      this.updateDisplayList();

      // Select the bust within the category
      const bustIndex = this._bustFiles.indexOf(bustName);
      this._index = -1;
      this.select(bustIndex >= 0 ? bustIndex : 0);
      this.refresh();
      if (bustIndex >= 0) this.ensureCursorVisible();
    }

    select(index) {
      super.select(index);
      // Trigger the select handler when selection changes
      if (this.isHandled("select")) {
        this.callHandler("select");
      }
    }
  }

  // Window to display bust preview (right panel)
  class Window_BustPreview extends Window_Base {
    constructor(rect) {
      super(rect);
      this._bustBitmap = null;
      this._currentBust = null;
      this.refresh();
    }

    setBust(filename) {
      if (this._currentBust !== filename) {
        this._currentBust = filename;
        this._bustBitmap = null;
        this.refresh();
      }
    }

    refresh() {
      this.contents.clear();

      if (!this._currentBust) {
        this.drawText(T('CharCreate.selectABust'), 0, 0, this.contentsWidth(), "center");
        return;
      }

      const bitmap = ImageManager.loadBitmap(`img/busts/`, this._currentBust);
      if (!bitmap.isReady()) {
        bitmap.addLoadListener(() => this.refresh());
        return;
      }

      // Draw the bust image centered in the preview window, cropping top 180 pixels
      const originalWidth = 889;
      const originalHeight = 1200;
      const cropTop = 180; // Crop top 180 pixels
      const croppedHeight = originalHeight - cropTop; // 1020 pixels

      const maxWidth = this.contentsWidth() - 16;
      const maxHeight = this.contentsHeight() - 16;

      // Calculate aspect ratio and scale accordingly based on cropped dimensions
      const scale = Math.min(
        maxWidth / originalWidth,
        maxHeight / croppedHeight,
      );
      const scaledWidth = Math.floor(originalWidth * scale);
      const scaledHeight = Math.floor(croppedHeight * scale);

      // Center the bust in the window
      const x = Math.floor((this.contentsWidth() - scaledWidth) / 2);
      const y = Math.floor((this.contentsHeight() - scaledHeight) / 2);

      // Draw the bust image with cropped top (starting from y=180 in the source image)
      this.contents.blt(
        bitmap,
        0,
        cropTop,
        originalWidth,
        croppedHeight,
        x,
        y,
        scaledWidth,
        scaledHeight,
      );
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

  // Global function to select a random bust and store it in appropriate variable
  window.selectRandomBustForActor = function (actorId) {
    // Get a list of all available bust files
    const availableBusts = [];

    // Try to use Node.js fs module for file system access
    try {
      const fs = require("fs");
      const path = require("path");
      const bustsPath = path.join(
        path.dirname(process.mainModule.filename),
        "img/busts/",
      );
      const files = fs.readdirSync(bustsPath);
      for (const file of files) {
        const filePath = path.join(bustsPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isFile() && /\.(png|jpg|jpeg|gif|webp)$/i.test(file)) {
          const nameWithoutExt = file.replace(
            /\.(png|jpg|jpeg|gif|webp)$/i,
            "",
          );
          availableBusts.push(nameWithoutExt);
        }
      }
    } catch (error) {
      console.warn("Could not load bust files via fs, using fallback list");
      // Fallback: add some common bust names
      for (let i = 1; i <= 200; i++) {
        availableBusts.push(String(i));
      }
    }

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
