/*:
 * @target MZ
 * @plugindesc Rivela una porta segreta con dissolvenza, effetto sonoro e self switch.
 * @author Fedep
 *
 * @help
 * Aggiungi <PortaSegreta>, <SecretDoor> o <HiddenDoor> nelle note
 * dell'evento porta/muro.
 *
 * Quando il giocatore attiva l'evento, il plugin esegue una dissolvenza,
 * accende il self switch scelto e mostra la pagina successiva dell'evento.
 *
 * Crea quindi una seconda pagina evento con condizione Self Switch A/B/C/D
 * e grafica della porta rivelata.
 *
 * Comando plugin:
 * - Rivela Porta: rivela l'evento indicato, oppure l'evento corrente con ID 0.
 *
 * @param selfSwitch
 * @text Self Switch
 * @desc Self switch attivato quando la porta viene rivelata.
 * @type select
 * @option A
 * @option B
 * @option C
 * @option D
 * @default A
 *
 * @param fadeDuration
 * @text Durata dissolvenza (frame)
 * @desc Durata totale dell'effetto di dissolvenza (uscita + entrata).
 * @type number
 * @min 8
 * @max 240
 * @default 48
 *
 * @param seName
 * @text Effetto sonoro
 * @desc SE riprodotto alla rivelazione (cartella audio/se, senza estensione).
 * @type file
 * @dir audio/se
 * @default Push
 *
 * @param seVolume
 * @text Volume SE
 * @type number
 * @min 0
 * @max 100
 * @default 90
 *
 * @param sePitch
 * @text Pitch SE
 * @type number
 * @min 50
 * @max 150
 * @default 100
 *
 * @param screenShake
 * @text Scossa schermo
 * @desc Attiva una piccola scossa dello schermo alla rivelazione.
 * @type boolean
 * @on Si
 * @off No
 * @default true
 *
 * @command reveal
 * @text Rivela Porta
 * @desc Trasforma il muro nella porta (dissolvenza + self switch).
 *
 * @arg eventId
 * @text ID Evento
 * @desc ID dell'evento porta da rivelare. 0 = l'evento corrente.
 * @type number
 * @min 0
 * @default 0
 */

(() => {
    "use strict";

    const PLUGIN_NAME = (() => {
        const script = document.currentScript;
        if (script && script.src) {
            return decodeURIComponent(script.src.split("/").pop().replace(/\.js$/i, ""));
        }
        return "SecretDoor";
    })();
    const params = PluginManager.parameters(PLUGIN_NAME);

    const SELF_SWITCH = String(params.selfSwitch || "A");
    const FADE_DURATION = Math.max(8, Number(params.fadeDuration || 48));
    const SE_NAME = String(params.seName || "Push");  // i18n-ignore  audio/se filename
    const SE_VOLUME = Number(params.seVolume || 90);
    const SE_PITCH = Number(params.sePitch || 100);
    const SCREEN_SHAKE = String(params.screenShake || "true") === "true";

    const NOTE_REGEX = /<(?:PortaSegreta|SecretDoor|HiddenDoor)>/i;

    if (PluginManager.registerCommand) {
        PluginManager.registerCommand(PLUGIN_NAME, "reveal", function(args) {
            const id = Number(args.eventId) || this.eventId();
            const event = $gameMap.event(id);
            if (event && event.isSecretDoor() && !event.isSecretDoorRevealed()) {
                event.startSecretReveal();
            }
        });
    }

    Game_Event.prototype.isSecretDoor = function() {
        const data = this.event();
        if (!data) {
            return false;
        }
        if (data.note && NOTE_REGEX.test(data.note)) {
            return true;
        }
        return data.pages.some(page => page.note && NOTE_REGEX.test(page.note));
    };

    Game_Event.prototype.secretDoorKey = function() {
        return [this._mapId, this._eventId, SELF_SWITCH];
    };

    Game_Event.prototype.isSecretDoorRevealed = function() {
        return $gameSelfSwitches.value(this.secretDoorKey());
    };

    Game_Event.prototype.startSecretReveal = function() {
        if (this._secretRevealPhase) {
            return;
        }

        this._secretRevealPhase = "out";
        this._secretRevealCount = Math.max(1, Math.floor(FADE_DURATION / 2));
        this._secretRevealStep = 255 / this._secretRevealCount;

        if (SE_NAME) {
            AudioManager.playSe({
                name: SE_NAME,
                volume: SE_VOLUME,
                pitch: SE_PITCH,
                pan: 0
            });
        }

        if (SCREEN_SHAKE) {
            $gameScreen.startShake(3, 5, 20);
        }
    };

    const _Game_Event_start = Game_Event.prototype.start;
    Game_Event.prototype.start = function() {
        if (this.isSecretDoor() && !this.isSecretDoorRevealed()) {
            this.startSecretReveal();
            return;
        }
        _Game_Event_start.call(this);
    };

    const _Game_Event_update = Game_Event.prototype.update;
    Game_Event.prototype.update = function() {
        _Game_Event_update.call(this);
        this.updateSecretReveal();
    };

    Game_Event.prototype.updateSecretReveal = function() {
        if (!this._secretRevealPhase) {
            return;
        }

        if (this._secretRevealPhase === "out") {
            const next = this.opacity() - this._secretRevealStep;
            this.setOpacity(Math.max(0, next));
            if (this.opacity() <= 0) {
                $gameSelfSwitches.setValue(this.secretDoorKey(), true);
                this.refresh();
                this.setOpacity(0);
                this._secretRevealPhase = "in";
            }
        } else if (this._secretRevealPhase === "in") {
            const next = this.opacity() + this._secretRevealStep;
            this.setOpacity(Math.min(255, next));
            if (this.opacity() >= 255) {
                this.setOpacity(255);
                this._secretRevealPhase = null;
            }
        }
    };
})();
