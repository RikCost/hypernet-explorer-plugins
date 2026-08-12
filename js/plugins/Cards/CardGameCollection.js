/*:
 * @target MZ
 * @plugindesc The card collection, the deck builder and the booster pack opening.
 * @author Esoteric Heavy Industries
 *
 * @command OpenCardCollection
 * @text Open Card Collection
 * @desc Opens the party's card collection and deck builder.
 *
 * @command OpenBoosterPack
 * @text Open Booster Pack
 * @desc Rolls a booster pack and opens it with the full animation. The cards are added to the party collection.
 *
 * @arg size
 * @text Cards in the pack
 * @type number
 * @min 1
 * @max 12
 * @default 6
 *
 * @command CaptureEnemyAsCard
 * @text Capture Enemy As Card
 * @desc In battle: tries to bind the weakest enemy still standing into a card. It dies either way if it works.
 *
 * @arg bonus
 * @text Bonus chance
 * @desc Flat percentage points added to the odds, for a skill stronger than the bare attempt.
 * @type number
 * @min -100
 * @max 100
 * @default 0
 *
 * @help CardGameCollection.js
 *
 * The collection belongs to the party, not to a member: one shelf, whoever is
 * leading. Copies of a card stack on one tile however differently each of them
 * was drawn.
 *
 * A deck holds between 9 and 20 cards and may only hold copies the party
 * actually owns. Several decks can be kept; one of them is active and is what a
 * duel is played with. A player who never opens this menu is dealt the best
 * legal hand their collection can make (CardGame.autoDeck).
 *
 * A booster pack is six cards, monsters and equipment from one pool, weighted
 * so the last of the six is never common.
 *
 * CaptureEnemyAsCard is the other way a card is won. Used in battle it picks
 * the weakest creature still standing and tries to bind it: mostly a question
 * of how badly hurt it already is, helped by the acting character's PSI
 * measured against the creature's own, and hopeless against anything more than
 * ten levels above the party's median. Success adds the card AND kills the
 * creature outright, so the collapse, the corpse and the spoils are the
 * ordinary ones. Read the model through window.CardCapture.odds(enemy, caster).
 *
 * Requires Cards/CardGameCore.js.
 */

(() => {
  "use strict";

  const PLUGIN = "Cards/CardGameCollection";
  const CG = () => window.CardGame;

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function playSe(name, volume, pitch) {
    try {
      AudioManager.playSe({ name, volume: volume == null ? 80 : volume, pitch: pitch == null ? 100 : pitch, pan: 0 });
    } catch (e) { /* a missing sound never stops the menu */ }
  }

  //===========================================================================
  // Style
  //===========================================================================

  const STYLE_ID = "cardcollection-style";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#cardcol-container{position:fixed;left:0;top:0;width:100%;height:100%;z-index:60;
  font-family:'Lora',serif;overflow:hidden;user-select:none;}
#cardcol-container *{box-sizing:border-box;}
.cc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;
  border-bottom:2px dashed #5e2f17;padding-bottom:6px;margin-bottom:10px;}
.cc-head h2{margin:0;font-size:1.25rem;color:#58180D;}
.cc-sub{font-size:.78rem;color:#5e2f17;opacity:.85;}
.cc-tabs{display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;}
.cc-tab{cursor:pointer;padding:3px 11px;border:1px solid #5e2f17;border-radius:4px;
  font-size:.8rem;font-weight:bold;color:#5e2f17;background:transparent;}
.cc-tab.on{background:#5e2f17;color:#f0e0c0;}
.cc-tab.focus{box-shadow:0 0 0 2px rgba(94,47,23,.5);}
.cc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:6px;
  overflow-y:auto;flex:1;min-height:0;padding-right:4px;align-content:start;}
.cc-cell{position:relative;height:96px;border-radius:7px;border:2px solid rgba(94,47,23,.4);
  background:rgba(94,47,23,.06);cursor:pointer;display:flex;flex-direction:column;
  align-items:center;justify-content:center;overflow:hidden;
  transition:transform .14s cubic-bezier(.2,1.4,.4,1),box-shadow .14s;}
.cc-cell:hover{transform:translateY(-5px) scale(1.05);box-shadow:0 8px 14px rgba(0,0,0,.3);}
.cc-cell.sel{border-color:#c9a227;box-shadow:0 0 0 2px rgba(201,162,39,.55),0 6px 14px rgba(0,0,0,.28);
  transform:translateY(-4px) scale(1.06);}
.cc-cell::after{content:'';position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;
  background:linear-gradient(115deg,transparent 40%,rgba(255,255,255,.42) 50%,transparent 60%);
  background-size:260% 100%;background-position:150% 0;opacity:0;}
.cc-cell.sel::after{opacity:1;animation:cc-shine 1.7s linear infinite;}
@keyframes cc-shine{to{background-position:-150% 0}}
/* Dealt in, not simply drawn: a filter change riffles the shelf. */
.cc-grid.cc-dealing .cc-cell{animation:cc-in .34s cubic-bezier(.2,1.35,.4,1) backwards;
  animation-delay:calc(var(--d) * 18ms);}
@keyframes cc-in{0%{transform:translateY(26px) rotate(-7deg) scale(.72);opacity:0}
  100%{transform:none;opacity:1}}
.cc-cell canvas,.cc-cell img{image-rendering:pixelated;max-width:100%;max-height:56px;object-fit:contain;}
.cc-cell .cc-qty{position:absolute;right:2px;bottom:2px;font-size:.66rem;font-weight:bold;
  background:rgba(0,0,0,.6);color:#ffe486;border-radius:3px;padding:0 4px;}
.cc-cell .cc-lbl{font-size:.55rem;text-align:center;line-height:1.05;color:#3d2f26;
  max-height:2.2em;overflow:hidden;padding:0 2px;}
.cc-cell.r1{border-color:#3d6fb5;}
.cc-cell.r2{border-color:#8a44b5;}
.cc-cell.r3{border-color:#c07a1e;box-shadow:0 0 8px rgba(200,140,40,.4);}
.cc-empty{opacity:.6;font-style:italic;color:#5e2f17;padding:14px;text-align:center;}
.cc-dossier{flex:1;min-height:0;overflow-y:auto;color:#3d2f26;}
.cc-art{height:170px;display:flex;align-items:center;justify-content:center;
  border:1px solid rgba(94,47,23,.3);border-radius:8px;background:rgba(0,0,0,.06);margin-bottom:8px;}
.cc-art img{max-width:100%;max-height:100%;object-fit:contain;}
.cc-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;text-align:center;margin-bottom:8px;}
.cc-stats div{border:1px solid rgba(94,47,23,.3);border-radius:5px;padding:2px 0;font-size:.66rem;color:#5e2f17;}
.cc-stats b{display:block;font-size:1.05rem;color:#58180D;}
.cc-lore{font-style:italic;font-size:.8rem;line-height:1.35;margin-bottom:8px;}
.cc-deck{border-top:1px dashed rgba(94,47,23,.4);padding-top:6px;font-size:.8rem;color:#3d2f26;}
.cc-decklist{max-height:150px;overflow-y:auto;margin:4px 0;}
.cc-deckrow{display:flex;justify-content:space-between;padding:1px 4px;border-radius:3px;cursor:pointer;}
.cc-deckrow:hover{background:rgba(94,47,23,.12);}
.cc-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px;}
.cc-btn{cursor:pointer;padding:3px 10px;border:1.5px solid #5e2f17;border-radius:5px;
  background:rgba(244,232,208,.6);color:#58180D;font-family:inherit;font-size:.76rem;font-weight:bold;}
.cc-btn:hover{background:rgba(201,162,39,.3);}
.cc-btn.focus{box-shadow:0 0 0 2px rgba(94,47,23,.55);}
.cc-legal{font-size:.76rem;font-weight:bold;}
.cc-legal.ok{color:#2c6e37;}
.cc-legal.bad{color:#9b2226;}

/* ---- booster pack ---- */
#cardpack-container{position:fixed;left:0;top:0;width:100%;height:100%;z-index:70;
  font-family:'Lora',serif;color:#f4e8cf;overflow:hidden;user-select:none;
  background:radial-gradient(ellipse at 50% 45%,rgba(60,40,90,.92),rgba(6,4,14,.97));}
#cardpack-container *{box-sizing:border-box;}
.cp-title{position:absolute;left:0;top:18px;width:100%;text-align:center;font-size:1.3rem;
  letter-spacing:.1em;text-shadow:0 2px 6px #000;}
.cp-hint{position:absolute;left:0;bottom:18px;width:100%;text-align:center;font-size:.85rem;opacity:.75;}
.cp-pack{position:absolute;left:50%;top:50%;width:180px;height:250px;margin:-125px 0 0 -90px;
  border-radius:14px;border:3px solid #ffd469;cursor:pointer;
  background:linear-gradient(150deg,#5a2b7a,#1d1030 60%,#3a1358);
  box-shadow:0 0 46px rgba(190,120,255,.55),inset 0 0 30px rgba(0,0,0,.6);
  display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;
  animation:cp-idle 2.4s ease-in-out infinite;}
@keyframes cp-idle{0%,100%{transform:rotate(-2deg) scale(1)}50%{transform:rotate(2deg) scale(1.035)}}
.cp-pack.cp-rip{animation:cp-rip .42s ease-in forwards;}
@keyframes cp-rip{0%{transform:scale(1)}35%{transform:scale(1.25) rotate(-5deg)}
  100%{transform:scale(2.4) rotate(9deg);opacity:0;filter:brightness(3)}}
.cp-flash{position:absolute;left:0;top:0;width:100%;height:100%;background:#fff;
  opacity:0;pointer-events:none;}
.cp-flash.on{animation:cp-flash .5s ease-out forwards;}
@keyframes cp-flash{0%{opacity:.85}100%{opacity:0}}
.cp-row{position:absolute;left:0;top:50%;width:100%;transform:translateY(-50%);
  display:flex;align-items:center;justify-content:center;gap:10px;}
.cp-card{position:relative;width:132px;height:190px;border-radius:11px;border:2px solid #d8c08a;
  background:linear-gradient(160deg,#2a2118,#150e07);box-shadow:0 10px 22px rgba(0,0,0,.7);
  transform-style:preserve-3d;transition:transform .34s cubic-bezier(.3,1.2,.4,1);
  display:flex;flex-direction:column;padding:6px;}
.cp-card.cp-fly{animation:cp-fly .46s cubic-bezier(.2,1.2,.35,1) both;}
@keyframes cp-fly{0%{transform:translate(var(--fx),var(--fy)) rotate(var(--fr)) scale(.35);opacity:0}
  100%{opacity:1}}
.cp-card.cp-back .cp-front{display:none;}
.cp-card.cp-flip{animation:cp-flip .42s ease-out both;}
@keyframes cp-flip{0%{transform:rotateY(0) scale(1)}50%{transform:rotateY(90deg) scale(1.12)}
  100%{transform:rotateY(0) scale(1)}}
.cp-seal{flex:1;display:flex;align-items:center;justify-content:center;border-radius:8px;
  background:repeating-linear-gradient(45deg,#3a2a58,#3a2a58 8px,#2a1c42 8px,#2a1c42 16px);
  font-size:2rem;color:rgba(255,212,105,.55);}
.cp-front{flex:1;display:flex;flex-direction:column;min-height:0;}
.cp-name{font-size:.66rem;font-weight:bold;text-align:center;height:2.1em;overflow:hidden;color:#ffeec4;}
.cp-art{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;
  background:rgba(0,0,0,.4);border-radius:6px;margin:3px 0;}
.cp-art img{max-width:100%;max-height:100%;object-fit:contain;}
.cp-stats{display:grid;grid-template-columns:repeat(5,1fr);font-size:.54rem;text-align:center;}
.cp-stats b{display:block;font-size:.72rem;color:#ffe486;}
.cp-card.rr1{border-color:#7fb4ff;box-shadow:0 10px 22px rgba(0,0,0,.7),0 0 14px rgba(90,150,255,.5);}
.cp-card.rr2{border-color:#cd8dff;box-shadow:0 10px 22px rgba(0,0,0,.7),0 0 20px rgba(180,90,255,.6);}
.cp-card.rr3{border-color:#ffb443;box-shadow:0 10px 22px rgba(0,0,0,.7),0 0 30px rgba(255,160,50,.8);
  animation:cp-legend 1.6s ease-in-out infinite;}
@keyframes cp-legend{0%,100%{filter:brightness(1)}50%{filter:brightness(1.25)}}
.cp-new{position:absolute;left:-6px;top:8px;background:#c0392b;color:#fff;font-size:.6rem;
  font-weight:bold;padding:1px 7px;border-radius:3px;transform:rotate(-9deg);
  box-shadow:0 2px 5px rgba(0,0,0,.6);}
.cp-burst{position:absolute;left:50%;top:50%;width:8px;height:8px;border-radius:50%;
  background:#ffd469;pointer-events:none;animation:cp-burst .6s ease-out forwards;}
@keyframes cp-burst{0%{transform:translate(-50%,-50%) scale(1);opacity:1}
  100%{transform:translate(calc(-50% + var(--bx)),calc(-50% + var(--by))) scale(0);opacity:0}}
`;
    document.head.appendChild(style);
  }

  //===========================================================================
  // Shared card art helper
  //===========================================================================
  // Draws a monster's snapshot (falling back to its walking sprite) or an
  // equipment glyph into a host element.

  function fillArt(host, key, seed, px) {
    if (!host) return;
    const CGx = CG();
    host.innerHTML = "";
    if (CGx.isEquip(key) || CGx.isEffect(key)) {
      const glyph = document.createElement("span");
      glyph.setAttribute("style", CGx.Art.iconStyle(key, px || 64));
      host.appendChild(glyph);
      return;
    }
    const fallback = CGx.Art.spriteArt(key, px || 96);
    if (fallback) host.appendChild(fallback);
    CGx.Art.face(key, seed, 192).then((url) => {
      if (!url || !host.isConnected) return;
      host.innerHTML = "";
      const img = document.createElement("img");
      img.src = url;
      host.appendChild(img);
    });
  }

  //===========================================================================
  // Scene_CardCollection
  //===========================================================================

  const FILTERS = ["all", "monsters", "weapons", "armor", "effects", "deck"];

  class Scene_CardCollection extends Scene_MenuBase {
    create() {
      super.create();
      if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
      injectStyle();

      const CGx = CG();
      this._filter = 0;
      this._index = 0;
      this._flourish = true;
      this._area = "grid";      // tabs | grid | actions
      this._actionIndex = 0;
      this._spriteFrame = 1;
      this._spriteTimer = 0;
      // A per-card art seed, stable while the menu is open and re-rollable, so
      // a stack shows ONE representative specimen rather than flickering.
      this._seeds = {};

      // The working deck: the active one when there is one, otherwise the best
      // hand the collection can make, so the builder never opens empty.
      this._deckIndex = CGx.decks().length ? CGx.activeDeckIndex() : -1;
      const active = CGx.decks()[this._deckIndex];
      this._working = active ? active.cards.slice() : CGx.autoDeck();

      this.buildDOM();
      this.render();
    }

    update() {
      super.update();
      this.updateSprites();
      this.updateInput();
    }

    terminate() {
      const container = document.getElementById("cardcol-container");
      if (container) container.remove();
      CG().Art.releaseRenderer();
      super.terminate();
    }

    //-------------------------------------------------------------------------
    // Data
    //-------------------------------------------------------------------------

    seedFor(key) {
      if (this._seeds[key] == null) this._seeds[key] = CG().hashString(key + ":look") >>> 0;
      return this._seeds[key];
    }

    rerollSeed(key) {
      this._seeds[key] = CG().rollSeed();
      return this._seeds[key];
    }

    // What the left page is showing: the collection under a filter, or the deck
    // being built.
    visibleKeys() {
      const CGx = CG();
      if (FILTERS[this._filter] === "deck") {
        const counts = {};
        this._working.forEach((key) => { counts[key] = (counts[key] || 0) + 1; });
        return Object.keys(counts);
      }
      const owned = CGx.ownedKeys().sort((a, b) => {
        const r = CGx.rarityOf(b) - CGx.rarityOf(a);
        return r || CGx.nameOf(a).localeCompare(CGx.nameOf(b));
      });
      const mode = FILTERS[this._filter];
      if (mode === "monsters") return owned.filter(CGx.isMonster);
      if (mode === "weapons") return owned.filter(CGx.isWeapon);
      if (mode === "armor") return owned.filter(CGx.isArmor);
      if (mode === "effects") return owned.filter(CGx.isEffect);
      return owned;
    }

    selectedKey() {
      const keys = this.visibleKeys();
      return keys[Math.min(this._index, keys.length - 1)] || null;
    }

    inDeck(key) {
      return this._working.filter((k) => k === key).length;
    }

    // How many copies of this key are still on the shelf, unspent by the deck.
    spare(key) {
      return CG().countOf(key) - this.inDeck(key);
    }

    addToDeck(key) {
      const CGx = CG();
      if (!key) return;
      if (this._working.length >= CGx.DECK_MAX) { SoundManager.playBuzzer(); return; }
      if (this.spare(key) <= 0) { SoundManager.playBuzzer(); return; }
      this._working.push(key);
      playSe("Casino/card_place_2", 65, 115);
      this.render();
    }

    removeFromDeck(key) {
      const at = this._working.lastIndexOf(key);
      if (at < 0) { SoundManager.playBuzzer(); return; }
      this._working.splice(at, 1);
      playSe("Casino/card_slide_3", 55, 100);
      this.render();
    }

    //-------------------------------------------------------------------------
    // Actions
    //-------------------------------------------------------------------------

    actions() {
      const CGx = CG();
      const legal = CGx.deckLegality(this._working);
      return [
        { id: "save", label: T("CardGame.col.saveDeck"), enabled: legal.ok },
        { id: "newDeck", label: T("CardGame.col.newDeck"), enabled: true },
        { id: "prevDeck", label: T("CardGame.col.prevDeck"), enabled: CGx.decks().length > 1 },
        { id: "nextDeck", label: T("CardGame.col.nextDeck"), enabled: CGx.decks().length > 1 },
        { id: "auto", label: T("CardGame.col.autoDeck"), enabled: true },
        { id: "shuffle", label: T("CardGame.col.shuffleDeck"), enabled: CGx.ownedKeys().length > 0 },
        { id: "reroll", label: T("CardGame.col.reroll"), enabled: !!this.selectedKey() },
        { id: "practice", label: T("CardGame.col.practice"), enabled: !!window.CardDuel && CGx.canDuel() },
        { id: "close", label: T("CardGame.col.close"), enabled: true }
      ];
    }

    runAction(id) {
      const CGx = CG();
      switch (id) {
        case "save": {
          const legal = CGx.deckLegality(this._working);
          if (!legal.ok) { SoundManager.playBuzzer(); return; }
          const name = T("CardGame.col.deckName", { n: (this._deckIndex >= 0 ? this._deckIndex : CGx.decks().length) + 1 });
          const deck = { name, cards: this._working.slice() };
          if (this._deckIndex >= 0) CGx.saveDeck(this._deckIndex, deck);
          else { CGx.saveDeck(null, deck); this._deckIndex = CGx.decks().length - 1; }
          CGx.setActiveDeck(this._deckIndex);
          SoundManager.playSave();
          break;
        }
        case "newDeck":
          this._deckIndex = -1;
          this._working = [];
          SoundManager.playOk();
          break;
        case "prevDeck":
        case "nextDeck": {
          const list = CGx.decks();
          if (!list.length) { SoundManager.playBuzzer(); return; }
          const step = id === "nextDeck" ? 1 : -1;
          this._deckIndex = ((this._deckIndex < 0 ? 0 : this._deckIndex) + step + list.length) % list.length;
          this._working = list[this._deckIndex].cards.slice();
          CGx.setActiveDeck(this._deckIndex);
          SoundManager.playCursor();
          break;
        }
        case "auto":
          this._working = CGx.autoDeck();
          playSe("Casino/card_shuffle", 70, 100);
          break;
        case "shuffle":
          // Dealt at random out of the whole collection and filled to the brim,
          // for a player who would rather be handed a deck than build one.
          this._working = CGx.shuffledDeck();
          this._filter = FILTERS.indexOf("deck");
          this._index = 0;
          playSe("Casino/card_fan_2", 80, 100);
          this.flourish();
          break;
        case "reroll": {
          const key = this.selectedKey();
          if (key) { this.rerollSeed(key); playSe("Casino/card_fan_1", 60, 110); }
          break;
        }
        case "practice":
          if (window.CardDuel) { SoundManager.playOk(); window.CardDuel.startPractice(); return; }
          break;
        case "close":
          SoundManager.playCancel();
          this.popScene();
          return;
      }
      this.render();
    }

    //-------------------------------------------------------------------------
    // Input
    //-------------------------------------------------------------------------

    updateInput() {
      if (Input.isTriggered("cancel")) {
        if (this._area !== "grid") { this._area = "grid"; SoundManager.playCancel(); this.render(); return; }
        SoundManager.playCancel();
        this.popScene();
        return;
      }
      if (Input.isTriggered("pageup") || Input.isTriggered("pagedown")) {
        const step = Input.isTriggered("pagedown") ? 1 : -1;
        this._filter = (this._filter + step + FILTERS.length) % FILTERS.length;
        this._index = 0;
        this.flourish();
        SoundManager.playCursor();
        this.render();
        return;
      }

      if (this._area === "actions") {
        const list = this.actions();
        if (Input.isRepeated("right")) { this._actionIndex = (this._actionIndex + 1) % list.length; SoundManager.playCursor(); this.render(); }
        else if (Input.isRepeated("left")) { this._actionIndex = (this._actionIndex - 1 + list.length) % list.length; SoundManager.playCursor(); this.render(); }
        else if (Input.isRepeated("up")) { this._area = "grid"; SoundManager.playCursor(); this.render(); }
        else if (Input.isTriggered("ok")) {
          const item = list[this._actionIndex];
          if (item && item.enabled) this.runAction(item.id); else SoundManager.playBuzzer();
        }
        return;
      }

      const keys = this.visibleKeys();
      const cols = this._cols || 5;
      if (Input.isRepeated("right")) { this.moveIndex(1, keys.length); }
      else if (Input.isRepeated("left")) { this.moveIndex(-1, keys.length); }
      else if (Input.isRepeated("down")) {
        if (this._index + cols >= keys.length) { this._area = "actions"; SoundManager.playCursor(); this.render(); }
        else this.moveIndex(cols, keys.length);
      } else if (Input.isRepeated("up")) { this.moveIndex(-cols, keys.length); }
      else if (Input.isTriggered("ok")) {
        const key = this.selectedKey();
        if (!key) { SoundManager.playBuzzer(); return; }
        if (FILTERS[this._filter] === "deck") this.removeFromDeck(key); else this.addToDeck(key);
      } else if (Input.isTriggered("shift")) {
        const key = this.selectedKey();
        if (key) this.removeFromDeck(key);
      }
    }

    // Riffle the shelf on the next render.
    flourish() {
      this._flourish = true;
    }

    moveIndex(delta, length) {
      if (!length) return;
      this._index = Math.max(0, Math.min(length - 1, this._index + delta));
      SoundManager.playCursor();
      this.render();
      const cell = document.querySelector("#cardcol-container .cc-cell.sel");
      if (cell) cell.scrollIntoView({ block: "nearest" });
    }

    //-------------------------------------------------------------------------
    // Rendering
    //-------------------------------------------------------------------------

    buildDOM() {
      let container = document.getElementById("cardcol-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "cardcol-container";
        document.body.appendChild(container);
      }
      container.innerHTML = `
        <div class="book-spread">
          <div class="left-page" style="display:flex;flex-direction:column;">
            <div class="cc-head">
              <h2>${escapeHtml(T("CardGame.col.title"))}</h2>
              <span class="cc-sub" id="cc-count"></span>
            </div>
            <div class="cc-tabs" id="cc-tabs"></div>
            <div class="cc-grid" id="cc-grid"></div>
          </div>
          <div class="right-page" style="display:flex;flex-direction:column;">
            <div class="cc-dossier" id="cc-dossier"></div>
            <div class="cc-deck" id="cc-deck"></div>
            <div class="cc-actions" id="cc-actions"></div>
          </div>
        </div>`;
    }

    render() {
      const container = document.getElementById("cardcol-container");
      if (!container) return;
      this.renderTabs(container);
      this.renderGrid(container);
      this.renderDossier(container);
      this.renderDeck(container);
      this.renderActions(container);
    }

    renderTabs(container) {
      const CGx = CG();
      const tabs = container.querySelector("#cc-tabs");
      tabs.innerHTML = FILTERS.map((id, i) => {
        const label = id === "deck"
          ? T("CardGame.col.tabDeck", { n: this._working.length })
          : T("CardGame.col.tab." + id);
        return `<div class="cc-tab ${i === this._filter ? "on" : ""}" data-i="${i}">${escapeHtml(label)}</div>`;
      }).join("");
      tabs.querySelectorAll(".cc-tab").forEach((el) => {
        el.addEventListener("click", () => {
          this._filter = parseInt(el.dataset.i, 10);
          this._index = 0;
          this.flourish();
          SoundManager.playCursor();
          this.render();
        });
      });
      container.querySelector("#cc-count").textContent = T("CardGame.col.owned", {
        cards: CGx.totalOwned(),
        distinct: CGx.ownedKeys().length,
        pct: CGx.completion().toFixed(1)
      });
    }

    renderGrid(container) {
      const CGx = CG();
      const grid = container.querySelector("#cc-grid");
      const keys = this.visibleKeys();
      this._index = Math.max(0, Math.min(this._index, Math.max(0, keys.length - 1)));

      if (!keys.length) {
        grid.innerHTML = `<div class="cc-empty">${escapeHtml(T("CardGame.col.empty"))}</div>`;
        return;
      }

      const isDeckTab = FILTERS[this._filter] === "deck";
      grid.innerHTML = keys.map((key, i) => {
        const qty = isDeckTab ? this.inDeck(key) : CGx.countOf(key);
        const dim = !isDeckTab && this.spare(key) <= 0 ? "opacity:.45;" : "";
        return `<div class="cc-cell r${CGx.rarityOf(key)} ${i === this._index ? "sel" : ""}" data-i="${i}" style="--d:${Math.min(i, 40)};${dim}">
            <div class="cc-artcell" style="height:56px;display:flex;align-items:center;justify-content:center;"></div>
            <div class="cc-lbl">${escapeHtml(CGx.nameOf(key))}</div>
            <span class="cc-qty">x${qty}</span>
          </div>`;
      }).join("");

      // The riffle only plays when the shelf actually changed, never on every
      // cursor move.
      grid.classList.toggle("cc-dealing", !!this._flourish);
      if (this._flourish) {
        this._flourish = false;
        setTimeout(() => grid.classList.remove("cc-dealing"), 900);
      }

      grid.querySelectorAll(".cc-cell").forEach((el, i) => {
        const key = keys[i];
        const host = el.querySelector(".cc-artcell");
        if (CGx.isEquip(key) || CGx.isEffect(key)) {
          const glyph = document.createElement("span");
          glyph.setAttribute("style", CGx.Art.iconStyle(key, 40));
          host.appendChild(glyph);
        } else {
          const canvas = document.createElement("canvas");
          canvas.width = 40; canvas.height = 40;
          canvas.style.width = "48px"; canvas.style.height = "48px";
          // Keyed, not positional: gear and effect cells carry a glyph rather
          // than a canvas, so the nth canvas is not the nth card.
          canvas.dataset.k = key;
          host.appendChild(canvas);
          CGx.Art.drawTileSprite(canvas, key, this._spriteFrame);
        }
        el.addEventListener("click", () => {
          this._index = i;
          this._area = "grid";
          if (isDeckTab) this.removeFromDeck(key); else this.addToDeck(key);
        });
      });

      // The real column count, so up/down walks the grid the player sees.
      const first = grid.querySelector(".cc-cell");
      if (first) {
        const width = grid.clientWidth || 1;
        this._cols = Math.max(1, Math.floor(width / (first.offsetWidth + 6)));
      }
    }

    renderDossier(container) {
      const CGx = CG();
      const host = container.querySelector("#cc-dossier");
      const key = this.selectedKey();
      if (!key) { host.innerHTML = `<div class="cc-empty">${escapeHtml(T("CardGame.col.pickACard"))}</div>`; return; }
      const stats = CGx.statsFor(key);
      const seed = this.seedFor(key);
      const effect = CGx.isEffect(key);
      const type = effect ? T("CardGame.type.effect")
        : CGx.isMonster(key) ? T("CardGame.type.monster")
          : CGx.isWeapon(key) ? T("CardGame.type.weapon") : T("CardGame.type.armor");
      host.innerHTML = `
        <h3 style="margin:0 0 2px;color:#58180D;">${escapeHtml(CGx.nameOf(key))}</h3>
        <div class="cc-sub" style="margin-bottom:6px;">${escapeHtml(type)} &middot; ${escapeHtml(CGx.rarityName(CGx.rarityOf(key)))}${
          effect ? "" : ` &middot; ${escapeHtml(T("CardGame.col.power", { n: CGx.statTotal(stats) }))}`}</div>
        <div class="cc-art" id="cc-art"></div>
        ${effect ? "" : `<div class="cc-stats">
          ${CGx.STATS.map((id) => `<div>${escapeHtml(CGx.statLabel(id))}<b>${stats[id]}</b></div>`).join("")}
        </div>`}
        <div class="cc-lore">${escapeHtml(CGx.cardText(key, seed))}</div>`;
      fillArt(host.querySelector("#cc-art"), key, seed, 96);
    }

    renderDeck(container) {
      const CGx = CG();
      const host = container.querySelector("#cc-deck");
      const legal = CGx.deckLegality(this._working);
      const name = this._deckIndex >= 0 && CGx.decks()[this._deckIndex]
        ? CGx.decks()[this._deckIndex].name
        : T("CardGame.col.unsavedDeck");
      const reason = legal.ok ? T("CardGame.col.deckLegal")
        : legal.reason === "tooFew" ? T("CardGame.col.deckTooFew", { min: CGx.DECK_MIN })
          : legal.reason === "tooMany" ? T("CardGame.col.deckTooMany", { max: CGx.DECK_MAX })
            : T("CardGame.col.deckNotOwned");

      const counts = {};
      this._working.forEach((key) => { counts[key] = (counts[key] || 0) + 1; });
      const rows = Object.keys(counts).sort((a, b) => CGx.nameOf(a).localeCompare(CGx.nameOf(b)))
        .map((key) => `<div class="cc-deckrow" data-k="${escapeHtml(key)}">
            <span>${escapeHtml(CGx.nameOf(key))}</span><span>x${counts[key]}</span></div>`).join("");

      host.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <b>${escapeHtml(name)}</b>
          <span>${this._working.length} / ${CGx.DECK_MAX}</span>
        </div>
        <div class="cc-legal ${legal.ok ? "ok" : "bad"}">${escapeHtml(reason)}</div>
        <div class="cc-decklist">${rows || `<div class="cc-empty">${escapeHtml(T("CardGame.col.deckEmpty"))}</div>`}</div>`;

      host.querySelectorAll(".cc-deckrow").forEach((el) => {
        el.addEventListener("click", () => this.removeFromDeck(el.dataset.k));
      });
    }

    renderActions(container) {
      const host = container.querySelector("#cc-actions");
      const list = this.actions();
      host.innerHTML = list.map((item, i) => {
        const cls = "cc-btn" + (this._area === "actions" && i === this._actionIndex ? " focus" : "");
        const dim = item.enabled ? "" : "opacity:.4;";
        return `<button class="${cls}" data-i="${i}" style="${dim}">${escapeHtml(item.label)}</button>`;
      }).join("");
      host.querySelectorAll(".cc-btn").forEach((el) => {
        el.addEventListener("click", () => {
          const item = list[parseInt(el.dataset.i, 10)];
          this._area = "actions";
          this._actionIndex = parseInt(el.dataset.i, 10);
          if (item && item.enabled) this.runAction(item.id); else SoundManager.playBuzzer();
        });
      });
    }

    updateSprites() {
      this._spriteTimer++;
      if (this._spriteTimer < 16) return;
      this._spriteTimer = 0;
      this._spriteFrame = (this._spriteFrame + 1) % 3;
      const container = document.getElementById("cardcol-container");
      if (!container) return;
      container.querySelectorAll("#cc-grid .cc-cell canvas").forEach((canvas) => {
        const key = canvas.dataset.k;
        if (key) CG().Art.drawTileSprite(canvas, key, this._spriteFrame);
      });
    }
  }

  window.Scene_CardCollection = Scene_CardCollection;

  //===========================================================================
  // Scene_CardBooster
  //===========================================================================
  // The pack sits there wobbling until it is torn open; the cards fly out in an
  // arc face down and turn over one at a time, brighter the rarer they are.

  class Scene_CardBooster extends Scene_MenuBase {
    prepare(keys) {
      this._keys = keys || [];
    }

    create() {
      super.create();
      if (this._helpWindow) { this._helpWindow.deactivate(); this._helpWindow.hide(); }
      injectStyle();
      const CGx = CG();
      if (!this._keys || !this._keys.length) this._keys = CGx.rollBooster(CGx.PACK_SIZE, { luck: CGx.streakLuck() });
      // Banked the moment the pack is opened, so closing the scene early never
      // costs the player the cards.
      this._rows = CGx.openBooster(this._keys);
      this._stage = "sealed";   // sealed | dealing | revealing | done
      this._revealed = 0;
      this.buildDOM();
      playSe("Casino/cards_pack_take_out_1", 85, 100);
    }

    update() {
      super.update();
      if (Input.isTriggered("ok") || TouchInput.isTriggered()) this.advance();
      else if (Input.isTriggered("cancel")) {
        if (this._stage === "sealed") this.advance(); else this.finish();
      }
    }

    terminate() {
      const container = document.getElementById("cardpack-container");
      if (container) container.remove();
      CG().Art.releaseRenderer();
      super.terminate();
    }

    finish() {
      if (this._leaving) return;
      this._leaving = true;
      SoundManager.playCancel();
      this.popScene();
    }

    advance() {
      if (this._stage === "sealed") { this.rip(); return; }
      if (this._stage === "revealing") { this.revealAll(); return; }
      if (this._stage === "done") this.finish();
    }

    buildDOM() {
      let container = document.getElementById("cardpack-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "cardpack-container";
        document.body.appendChild(container);
      }
      container.innerHTML = `
        <div class="cp-title">${escapeHtml(T("CardGame.pack.title"))}</div>
        <div class="cp-flash" id="cp-flash"></div>
        <div class="cp-pack" id="cp-pack">${escapeHtml(T("CardGame.pack.sealed"))}</div>
        <div class="cp-row" id="cp-row" style="display:none;"></div>
        <div class="cp-hint" id="cp-hint"></div>`;
      container.querySelector("#cp-pack").addEventListener("click", () => this.advance());
    }

    rip() {
      const container = document.getElementById("cardpack-container");
      if (!container) return;
      this._stage = "dealing";
      const pack = container.querySelector("#cp-pack");
      pack.classList.add("cp-rip");
      container.querySelector("#cp-flash").classList.add("on");
      playSe("Casino/cards_pack_open_1", 90, 100);
      container.querySelector("#cp-hint").textContent = "";

      setTimeout(() => {
        if (!container.isConnected) return;
        pack.style.display = "none";
        this.dealCards();
      }, 380);
    }

    dealCards() {
      const container = document.getElementById("cardpack-container");
      if (!container) return;
      const row = container.querySelector("#cp-row");
      row.style.display = "flex";
      row.innerHTML = "";

      this._rows.forEach((entry, i) => {
        const el = document.createElement("div");
        el.className = "cp-card cp-back rr" + entry.rarity;
        el.dataset.i = String(i);
        // Out of the middle of the pack and into its place in the row.
        const spread = i - (this._rows.length - 1) / 2;
        el.style.setProperty("--fx", (-spread * 150) + "px");
        el.style.setProperty("--fy", "40px");
        el.style.setProperty("--fr", (-spread * 12) + "deg");
        el.innerHTML = `<div class="cp-seal">&#9670;</div><div class="cp-front"></div>`;
        el.addEventListener("click", () => this.advance());
        row.appendChild(el);
        setTimeout(() => {
          if (!el.isConnected) return;
          el.classList.add("cp-fly");
          playSe("Casino/card_slide_" + (1 + (i % 8)), 55, 120 + i * 6);
        }, i * 70);
      });

      setTimeout(() => {
        if (!container.isConnected) return;
        this._stage = "revealing";
        this.revealNext();
      }, this._rows.length * 70 + 420);
    }

    revealNext() {
      if (this._stage !== "revealing") return;
      if (this._revealed >= this._rows.length) { this.done(); return; }
      this.reveal(this._revealed++);
      this._revealTimer = setTimeout(() => this.revealNext(), 340);
    }

    revealAll() {
      clearTimeout(this._revealTimer);
      while (this._revealed < this._rows.length) this.reveal(this._revealed++);
      this.done();
    }

    reveal(index) {
      const container = document.getElementById("cardpack-container");
      if (!container) return;
      const CGx = CG();
      const entry = this._rows[index];
      const el = container.querySelector(`.cp-card[data-i="${index}"]`);
      if (!el || !entry) return;

      const seed = CGx.rollSeed();
      const stats = CGx.statsFor(entry.key);
      const front = el.querySelector(".cp-front");
      front.innerHTML = `
        <div class="cp-name">${escapeHtml(CGx.nameOf(entry.key))}</div>
        <div class="cp-art"></div>
        <div class="cp-stats">
          ${CGx.STATS.map((id) => `<div>${escapeHtml(CGx.statLabel(id))}<b>${stats[id]}</b></div>`).join("")}
        </div>`;
      fillArt(front.querySelector(".cp-art"), entry.key, seed, 56);
      el.classList.remove("cp-back");
      el.classList.add("cp-flip");
      if (entry.isNew) {
        const ribbon = document.createElement("div");
        ribbon.className = "cp-new";
        ribbon.textContent = T("CardGame.pack.newCard");
        el.appendChild(ribbon);
      }

      // Anything above common comes out of the pack with a burst; a legendary
      // brings the fanfare with it.
      if (entry.rarity >= CGx.RARITY.RARE) {
        for (let i = 0; i < 8 + entry.rarity * 4; i++) {
          const spark = document.createElement("div");
          spark.className = "cp-burst";
          const angle = Math.random() * Math.PI * 2;
          const dist = 40 + Math.random() * 70;
          spark.style.setProperty("--bx", Math.cos(angle) * dist + "px");
          spark.style.setProperty("--by", Math.sin(angle) * dist + "px");
          el.appendChild(spark);
          setTimeout(() => spark.remove(), 640);
        }
      }
      playSe(
        entry.rarity >= CGx.RARITY.LEGENDARY ? "Saint5"
          : entry.rarity >= CGx.RARITY.EPIC ? "Chime1"
            : entry.rarity >= CGx.RARITY.RARE ? "Bell1" : "Casino/card_place_1",
        entry.rarity >= CGx.RARITY.RARE ? 85 : 60,
        100 + index * 4
      );
    }

    done() {
      if (this._stage === "done") return;
      this._stage = "done";
      const container = document.getElementById("cardpack-container");
      if (!container) return;
      const best = this._rows.reduce((r, e) => Math.max(r, e.rarity), 0);
      const fresh = this._rows.filter((e) => e.isNew).length;
      container.querySelector("#cp-hint").textContent = T("CardGame.pack.summary", {
        best: CG().rarityName(best), fresh
      });
    }
  }

  window.Scene_CardBooster = Scene_CardBooster;

  //===========================================================================
  // Entry points
  //===========================================================================

  //===========================================================================
  // Binding a monster into a card, mid-battle
  //===========================================================================
  // The weakest thing still standing is the one that can be bound: a creature
  // at full strength shrugs it off, and one far above the party's weight class
  // cannot be held at all. The caster's PSI is what does the holding.
  //
  // A bound creature still DIES: full damage, the ordinary collapse, the
  // ordinary corpse and the ordinary spoils. The card is what is left of it.

  const CAPTURE_LEVEL_MARGIN = 10;  // levels above the party median before it is hopeless
  const CAPTURE_BASE = 12;          // floor, against a creature at full health
  const CAPTURE_FROM_WOUNDS = 62;   // how much a nearly-dead creature adds
  const CAPTURE_FROM_PSI = 30;      // how much the caster's PSI adds at best

  function partyMedianLevel() {
    const levels = $gameParty.members().map((m) => m.level || 1).sort((a, b) => a - b);
    if (!levels.length) return 1;
    const mid = levels.length >> 1;
    return levels.length % 2 ? levels[mid] : Math.round((levels[mid - 1] + levels[mid]) / 2);
  }

  function enemyLevelOf(enemy) {
    const data = enemy.enemy();
    const m = String(data && data.note || "").match(/<Level:\s*(\d+)>/i);
    return m ? parseInt(m[1], 10) : partyMedianLevel();
  }

  // Whoever is acting when the command fires, falling back to the leader for a
  // capture triggered outside anyone's turn (an event, a debug call).
  function captureCaster() {
    const subject = BattleManager._subject;
    if (subject && subject.isActor && subject.isActor()) return subject;
    return $gameParty.leader();
  }

  // The odds, and everything the caller needs to explain them.
  function captureOdds(enemy, caster, bonus) {
    const CGx = window.CardGame;
    const key = CGx.monsterKey(enemy.enemyId());
    const level = enemyLevelOf(enemy);
    const median = partyMedianLevel();
    const over = level - median;

    if (!CGx.catalogue().monsters.includes(key)) return { chance: 0, reason: "noCard", key, level, median };
    if (over > CAPTURE_LEVEL_MARGIN) return { chance: 0, reason: "tooStrong", key, level, median };

    // Wounds are most of it: a creature is bound when it can no longer resist.
    const wounded = Math.pow(1 - enemy.hpRate(), 1.5);
    // PSI is measured against the creature's own, so the figure means the same
    // thing at level 3 and at level 90.
    const psi = caster ? (caster.mat || 0) : 0;
    const resist = Math.max(1, enemy.mat || 1);
    const psiShare = psi / (psi + resist);

    let chance = CAPTURE_BASE + CAPTURE_FROM_WOUNDS * wounded + CAPTURE_FROM_PSI * psiShare;
    // Still costly inside the margin: every level over the party's median bites.
    if (over > 0) chance -= over * 3;
    chance += Number(bonus) || 0;
    return {
      chance: Math.max(1, Math.min(95, Math.round(chance))),
      reason: null, key, level, median,
      wounded: Math.round(wounded * 100), psiShare: Math.round(psiShare * 100)
    };
  }

  // The weakest creature left on the field, by remaining hit points and then
  // by how little it had to begin with.
  function weakestEnemy() {
    const alive = $gameTroop.aliveMembers().filter((e) => !e.isHidden || !e.isHidden());
    if (!alive.length) return null;
    return alive.reduce((best, e) => {
      if (!best) return e;
      if (e.hp !== best.hp) return e.hp < best.hp ? e : best;
      return e.mhp < best.mhp ? e : best;
    }, null);
  }

  function battleSay(text) {
    const log = BattleManager._logWindow;
    if (log && log.addText) { log.addText(text); log.wait && log.wait(); return; }
    try { window.ParchmentToast && window.ParchmentToast.show(text, { severity: "info", duration: 150 }); }
    catch (e) { /* a popup never breaks a battle */ }
  }

  window.CardCapture = {
    odds: captureOdds,
    target: weakestEnemy,

    // Returns { ok, chance, key, reason } and does everything a success means.
    attempt(bonus) {
      const CGx = window.CardGame;
      if (!CGx || typeof $gameTroop === "undefined" || !$gameParty.inBattle()) {
        return { ok: false, reason: "notInBattle" };
      }
      const enemy = weakestEnemy();
      if (!enemy) return { ok: false, reason: "noTarget" };

      const caster = captureCaster();
      const odds = captureOdds(enemy, caster, bonus);
      const name = enemy.name();

      if (odds.reason === "tooStrong") {
        battleSay(T("CardGame.capture.tooStrong", { name, level: odds.level, median: odds.median }));
        playSe("Buzzer1", 70, 100);
        return { ok: false, reason: odds.reason, chance: 0 };
      }
      if (odds.reason === "noCard") {
        battleSay(T("CardGame.capture.noCard", { name }));
        playSe("Buzzer1", 70, 100);
        return { ok: false, reason: odds.reason, chance: 0 };
      }

      if (Math.randomInt(100) >= odds.chance) {
        battleSay(T("CardGame.capture.failed", { name, chance: odds.chance }));
        playSe("Casino/card_shove_2", 70, 90);
        return { ok: false, reason: "roll", chance: odds.chance };
      }

      const isNew = CGx.countOf(odds.key) === 0;
      CGx.addCard(odds.key, 1);

      // Bound, and then killed the ordinary way: full damage, the engine's own
      // collapse, and every drop and corpse that death normally leaves.
      enemy.gainHp(-Math.max(enemy.hp, enemy.mhp));
      enemy.refresh();
      if (enemy.isDead()) enemy.performCollapse();

      battleSay(T(isNew ? "CardGame.capture.boundNew" : "CardGame.capture.bound", { name }));
      playSe("Casino/cards_pack_take_out_2", 90, 105);
      try {
        window.ParchmentToast && window.ParchmentToast.show(
          T(isNew ? "CardGame.capture.boundNew" : "CardGame.capture.bound", { name }),
          { severity: "good", duration: 170 }
        );
      } catch (e) { /* cosmetic */ }
      return { ok: true, chance: odds.chance, key: odds.key, isNew };
    }
  };

  window.CardBooster = {
    // Open a specific set of cards (a duel reward), or roll a fresh pack.
    open(keys) {
      SceneManager.push(Scene_CardBooster);
      SceneManager.prepareNextScene(keys || null);
    },
    roll(size, opts) {
      this.open(window.CardGame.rollBooster(size, opts));
    }
  };

  const openCollection = () => { SceneManager.push(Scene_CardCollection); };
  const openPack = (args) => {
    const CGx = window.CardGame;
    if (!CGx) return;
    const size = CGx.clamp(Number(args && args.size) || CGx.PACK_SIZE, 1, 12);
    window.CardBooster.roll(size, { luck: CGx.streakLuck() });
  };

  const captureCard = (args) => { window.CardCapture.attempt(Number(args && args.bonus) || 0); };

  PluginManager.registerCommand(PLUGIN, "OpenCardCollection", openCollection);
  PluginManager.registerCommand("CardGameCollection", "OpenCardCollection", openCollection);
  PluginManager.registerCommand(PLUGIN, "OpenBoosterPack", openPack);
  PluginManager.registerCommand("CardGameCollection", "OpenBoosterPack", openPack);
  PluginManager.registerCommand(PLUGIN, "CaptureEnemyAsCard", captureCard);
  PluginManager.registerCommand("CardGameCollection", "CaptureEnemyAsCard", captureCard);
})();
