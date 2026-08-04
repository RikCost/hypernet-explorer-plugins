//=============================================================================
// Crime System Plugin - Enhanced Version with Italian Translation
// Version: 1.2.0
// Author: Assistant
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Crime System v1.2.0
 * @author Assistant
 * @version 1.2.0
 * @description A comprehensive crime system with extensive preset crimes and bounty tracking
 *
 * @param bountyVariable
 * @text Bounty Variable ID
 * @desc Variable ID to store bounty (default: 66)
 * @type variable
 * @default 66
 *
 * @param displayDuration
 * @text Crime Display Duration
 * @desc Duration in frames to show crime notification (60 = 1 second)
 * @type number
 * @default 300
 *
 * @help CrimeSystem.js
 * 
 * This plugin adds a crime system to your game with the following features:
 * - Commit crimes with bounty values
 * - Extensive preset crime list with categories
 * - View crime history and total bounty
 * - Clear bounty and crime records
 * - Crime notification window
 * - Gold to Euro conversion (1000 gold = 10.00 euros)
 * - Italian language support
 * - Crime IDs stored in window.playerCrimes array
 * 
 * Plugin Commands:
 * - Add Crime: Add a new crime with specified bounty
 * - Add Preset Crime: Add a crime from the preset list
 * - Show Preset Crimes: Display all available preset crimes
 * - Show Crime List: Display all committed crimes and total bounty
 * - Clear Bounty: Reset bounty and crime history
 * 
 * Script Calls:
 * - CrimeSystem.addCrime("Crime Name", bounty)
 * - CrimeSystem.addPresetCrime("crimeKey")
 * - CrimeSystem.showPresetCrimes()
 * - CrimeSystem.showCrimeList()
 * - CrimeSystem.clearBounty()
 * 
 * @command addCrime
 * @text Add Crime
 * @desc Add a new crime to the player's record
 *
 * @arg crimeName
 * @text Crime Name
 * @desc Name of the crime committed
 * @type string
 * @default Theft
 *
 * @arg bountyAmount
 * @text Bounty Amount
 * @desc Bounty amount in gold for this crime
 * @type number
 * @default 100
 *
 * @command addPresetCrime
 * @text Add Preset Crime
 * @desc Add a crime from the preset list
 *
 * @arg crimeType
 * @text Crime Type
 * @desc Select a preset crime type
 * @type select
 * @option Petty Theft
 * @value pettyTheft
 * @option Pickpocketing
 * @value pickpocketing
 * @option Shoplifting
 * @value shoplifting
 * @option Burglary
 * @value burglary
 * @option Robbery
 * @value robbery
 * @option Armed Robbery
 * @value armedRobbery
 * @option Bank Robbery
 * @value bankRobbery
 * @option Grand Theft
 * @value grandTheft
 * @option Assault
 * @value assault
 * @option Battery
 * @value battery
 * @option Aggravated Assault
 * @value aggravatedAssault
 * @option Murder
 * @value murder
 * @option Manslaughter
 * @value manslaughter
 * @option Serial Killing
 * @value serialKilling
 * @option Vandalism
 * @value vandalism
 * @option Graffiti
 * @value graffiti
 * @option Arson
 * @value arson
 * @option Property Destruction
 * @value propertyDestruction
 * @option Illegal Construction
 * @value illegalConstruction
 * @option Public Disturbance
 * @value publicDisturbance
 * @option Disorderly Conduct
 * @value disorderlyConduct
 * @option Trespassing
 * @value trespassing
 * @option Breaking and Entering
 * @value breakingAndEntering
 * @option Unlawful Entry
 * @value unlawfulEntry
 * @option Drug Possession
 * @value drugPossession
 * @option Drug Dealing
 * @value drugDealing
 * @option Drug Trafficking
 * @value drugTrafficking
 * @option Smuggling
 * @value smuggling
 * @option Contraband Possession
 * @value contraband
 * @option Fraud
 * @value fraud
 * @option Embezzlement
 * @value embezzlement
 * @option Bribery
 * @value bribery
 * @option Corruption
 * @value corruption
 * @option Tax Evasion
 * @value taxEvasion
 * @option Money Laundering
 * @value moneyLaundering
 * @option Forgery
 * @value forgery
 * @option Counterfeiting
 * @value counterfeiting
 * @option Identity Theft
 * @value identityTheft
 * @option Cybercrime
 * @value cybercrime
 * @option Computer Hacking
 * @value hacking
 * @option Data Theft
 * @value dataTheft
 * @option Digital Piracy
 * @value piracy
 * @option Extortion
 * @value extortion
 * @option Blackmail
 * @value blackmail
 * @option Kidnapping
 * @value kidnapping
 * @option Hostage Taking
 * @value hostage
 * @option Human Trafficking
 * @value humanTrafficking
 * @option Slavery
 * @value slavery
 * @option Poaching
 * @value poaching
 * @option Illegal Hunting
 * @value illegalHunting
 * @option Animal Cruelty
 * @value animalCruelty
 * @option Environmental Crime
 * @value environmentalCrime
 * @option Pollution Violation
 * @value pollutionViolation
 * @option Illegal Dumping
 * @value illegalDumping
 * @option Minor Speeding
 * @value speedingMinor
 * @option Major Speeding
 * @value speedingMajor
 * @option Reckless Driving
 * @value recklessDriving
 * @option Driving Under Influence
 * @value dui
 * @option Hit and Run
 * @value hitAndRun
 * @option Vehicle Theft
 * @value vehicleTheft
 * @option Carjacking
 * @value carjacking
 * @option Illegal Street Racing
 * @value illegalRacing
 * @option Public Intoxication
 * @value publicIntoxication
 * @option Underage Drinking
 * @value underageDrinking
 * @option Disturbing the Peace
 * @value disturbing
 * @option Loitering
 * @value loitering
 * @option Jaywalking
 * @value jaywalking
 * @option Littering
 * @value littering
 * @option Noise Pollution
 * @value noisePollution
 * @option Perjury
 * @value perjury
 * @option Contempt of Court
 * @value contemptOfCourt
 * @option Obstructing Justice
 * @value obstructingJustice
 * @option Resisting Arrest
 * @value resistingArrest
 * @option Escaping Custody
 * @value escapingCustody
 * @option Prison Break
 * @value prisonBreak
 * @option Illegal Weapons Possession
 * @value weaponsPossession
 * @option Illegal Weapons Manufacturing
 * @value illegalWeapons
 * @option Weapons Trafficking
 * @value weaponsTrafficking
 * @option Terrorism
 * @value terrorism
 * @option Treason
 * @value treason
 * @option Espionage
 * @value espionage
 * @option War Crimes
 * @value warCrimes
 * @option Genocide
 * @value genocide
 * @option Crimes Against Humanity
 * @value crimesAgainstHumanity
 * @default pettyTheft
 *
 * @command showPresetCrimes
 * @text Show Preset Crimes
 * @desc Display all available preset crimes organized by category
 *
 * @command showCrimeList
 * @text Show Crime List
 * @desc Display the list of all crimes and total bounty
 *
 * @command clearBounty
 * @text Clear Bounty
 * @desc Clear all crimes and reset bounty to 0
 * 
    * @command addCrimeFromVariable
 * @text Add Crime (Bounty from Variable)
 * @desc Add a new crime with bounty amount read from Variable 79
 *
 * @arg crimeName
 * @text Crime Name
 * @desc Name of the crime committed
 * @type string
 * @default Theft
 */

(() => {
    'use strict';

    const pluginName = 'CrimeSystem';
    const parameters = PluginManager.parameters(pluginName);
    const bountyVariableId = parseInt(parameters['bountyVariable'] || 66);
    const displayDuration = parseInt(parameters['displayDuration'] || 300);

    // Language check
    const useTranslation = ConfigManager.language === 'it';
    const PresetCrimes = (window.Messages && window.Messages.PresetCrimes) || {};

    // Helper function to get game date from variable 113
    function getGameDateFromVariable() {
        const dateStr = $gameVariables.value(113) || '01 JAN 2001 12:00';
        // Format: "01 JAN 2001 12:00"
        const parts = dateStr.split(' ').filter(Boolean);
        if (parts.length < 4) {
            return { day: 1, month: 0, year: 2001, hours: 8, minutes: 0 };
        }

        const day = parseInt(parts[0]) || 1;
        const monthStr = (parts[1] || '').toUpperCase();
        const year = parseInt(parts[2]) || 2001;
        const timeStr = (parts[3] || '12:00').split(':');
        const hours = parseInt(timeStr[0]) || 0;
        const minutes = parseInt(timeStr[1]) || 0;

        const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        let month = months.indexOf(monthStr);
        if (month === -1) {
            const itMonths = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
            month = itMonths.indexOf(monthStr);
        }
        if (month === -1) {
            month = 0;
        }

        return { day, month, year, hours, minutes };
    }

    // Format game date as readable string
    function getGameDateTimeString() {
        const gameDate = getGameDateFromVariable();
        const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
        const monthStr = monthNames[gameDate.month];
        const dayStr = String(gameDate.day).padStart(2, '0');
        const yearStr = gameDate.year;
        const hoursStr = String(gameDate.hours).padStart(2, '0');
        const minutesStr = String(gameDate.minutes).padStart(2, '0');
        return `${dayStr} ${monthStr} ${yearStr} ${hoursStr}:${minutesStr}`;
    }

    // The copy lives in js/i18n/<lang>/plugins/Crime.json.
    // Get localized text
    const gettext = (key) => T('Crime.text.' + String(key || ''));

    // Crime System Class
    // ======================================================================
    // What a crime teaches
    // ======================================================================
    // Crime is a trade, and doing it is how it is learned. Every preset crime
    // funnels through addCrime with its key, so this one table covers all of
    // them. Points ride the bounty through awardForValue: the game already
    // uses the bounty to say how serious the act was, so a shoplifting teaches
    // a fraction of a point and a bank job teaches several.
    // i18n-ignore-start  Specialization.json names, matched not shown
    const CRIME_SPECS = {
    // Pickpocketing
    pettyTheft: "Pickpocketing",
    pickpocketing: "Pickpocketing",
    shoplifting: "Pickpocketing",
    // Lockpicking
    burglary: "Lockpicking",
    breakingAndEntering: "Lockpicking",
    unlawfulEntry: "Lockpicking",
    trespassing: "Lockpicking",
    // Safecracking
    bankRobbery: "Safecracking",
    // Intimidation
    robbery: "Intimidation",
    armedRobbery: "Intimidation",
    grandTheft: "Intimidation",
    extortion: "Intimidation",
    blackmail: "Intimidation",
    humanTrafficking: "Intimidation",
    slavery: "Intimidation",
    // Car Driving
    vehicleTheft: "Car Driving",
    carjacking: "Car Driving",
    speedingMinor: "Car Driving",
    speedingMajor: "Car Driving",
    recklessDriving: "Car Driving",
    dui: "Car Driving",
    hitAndRun: "Car Driving",
    illegalRacing: "Car Driving",
    // Escape Artistry
    escapingCustody: "Escape Artistry",
    prisonBreak: "Escape Artistry",
    resistingArrest: "Escape Artistry",
    // Streetwise
    loitering: "Streetwise",
    jaywalking: "Streetwise",
    littering: "Streetwise",
    noisePollution: "Streetwise",
    disturbing: "Streetwise",
    publicDisturbance: "Streetwise",
    disorderlyConduct: "Streetwise",
    graffiti: "Streetwise",
    vandalism: "Streetwise",
    illegalConstruction: "Streetwise",
    drugDealing: "Streetwise",
    drugTrafficking: "Streetwise",
    // Alcohol Tolerance
    publicIntoxication: "Alcohol Tolerance",
    underageDrinking: "Alcohol Tolerance",
    // Demolitions
    arson: "Demolitions",
    propertyDestruction: "Demolitions",
    terrorism: "Demolitions",
    // Boxing
    assault: "Boxing",
    battery: "Boxing",
    aggravatedAssault: "Boxing",
    // Ambush Tactics
    murder: "Ambush Tactics",
    manslaughter: "Ambush Tactics",
    serialKilling: "Ambush Tactics",
    // Chemistry
    drugPossession: "Chemistry",
    environmentalCrime: "Chemistry",
    pollutionViolation: "Chemistry",
    illegalDumping: "Chemistry",
    // Shipping
    smuggling: "Shipping",
    contraband: "Shipping",
    weaponsTrafficking: "Shipping",
    // Deception
    fraud: "Deception",
    embezzlement: "Deception",
    taxEvasion: "Deception",
    bribery: "Deception",
    corruption: "Deception",
    perjury: "Deception",
    // Money Laundering
    moneyLaundering: "Money Laundering",
    // Counterfeiting
    forgery: "Counterfeiting",
    counterfeiting: "Counterfeiting",
    identityTheft: "Counterfeiting",
    // Hacking
    cybercrime: "Hacking",
    hacking: "Hacking",
    dataTheft: "Hacking",
    piracy: "Hacking",
    // Interrogation
    kidnapping: "Interrogation",
    hostage: "Interrogation",
    // Hunting
    poaching: "Hunting",
    illegalHunting: "Hunting",
    animalCruelty: "Hunting",
    // Law
    contemptOfCourt: "Law",
    obstructingJustice: "Law",
    // Ammunition Handloading
    weaponsPossession: "Ammunition Handloading",
    illegalWeapons: "Ammunition Handloading",
    // Espionage
    treason: "Espionage",
    espionage: "Espionage",
    // Guerilla Warfare
    warCrimes: "Guerilla Warfare",
    genocide: "Guerilla Warfare",
    crimesAgainstHumanity: "Guerilla Warfare",
    };

    // Somebody who knows the work leaves less behind for the nEuroPolice to
    // find, so the same act attracts a smaller bounty (Streetwise, 6304 band).
    // Floored at 70%: getting good at crime never makes it free.
    function bountyAfterStreetwise(amount) {
        if (!(amount > 0) || !window.SpecializationXP) return amount;
        return Math.round(amount * window.SpecializationXP.discount("Streetwise", 0.06, 0.7));
    }

    class CrimeSystem {
        static initialize() {
            if (!$dataSystem.switches) return;

            // Initialize crime data if not exists
            if (!$gameSystem._crimeData) {
                $gameSystem._crimeData = {
                    crimes: [],
                    totalBounty: 0
                };
            }

            // Initialize window.playerCrimes array
            if (!window.playerCrimes) {
                window.playerCrimes = [];
            }
        }

        static addCrime(crimeName, bountyAmount, crimeId = null) {
            this.initialize();

            // Sandbox mode: the player self-pardons on the spot, no bounty added.
            const isSandbox = !!($gameSystem && $gameSystem._isSandboxMode);
            if (isSandbox) {
                bountyAmount = 0;
            }

            // After defeating Eris in her challenge, the bounty system no longer
            // grows: new crimes are still recorded, but they add nothing.
            if ($gameSystem && $gameSystem._erisBountyImmunity) {
                bountyAmount = 0;
            }

            // A professional attracts less attention. Applied after the two
            // early-outs above, so a pardoned or immune crime stays at zero.
            bountyAmount = bountyAfterStreetwise(bountyAmount);

            // Doing it is the lesson. The leader is the one who did it, so no
            // onlooker share, and nothing is learned from a crime the game has
            // decided did not happen (sandbox self-pardon / Eris immunity).
            if (crimeId && CRIME_SPECS[crimeId] && bountyAmount > 0 && window.SpecializationXP) {
                window.SpecializationXP.awardForValue(CRIME_SPECS[crimeId], bountyAmount, { soloist: true });
            }

            const crime = {
                name: crimeName,
                bounty: bountyAmount,
                id: crimeId,
                timestamp: getGameDateTimeString()
            };

            $gameSystem._crimeData.crimes.push(crime);
            $gameSystem._crimeData.totalBounty += bountyAmount;

            // Add crime ID to window.playerCrimes if provided
            if (crimeId) {
                window.playerCrimes.push(crimeId);
            }

            // Update bounty variable
            if ($gameVariables) $gameVariables.setValue(bountyVariableId, $gameSystem._crimeData.totalBounty);

            // Show crime notification
            if (isSandbox) {
                this.showSelfPardonNotification(crimeName);
            } else {
                this.showCrimeNotification(crimeName, bountyAmount);
            }
        }

        static showSelfPardonNotification(crimeName) {
            if (!(SceneManager._scene instanceof Scene_Map)) return;
            if (!window.ParchmentToast) return;
            window.ParchmentToast.show(
                `<div class="crime-notif-row">` +
                    `<span class="crime-notif-name">${crimeName}</span>` +
                    `<span class="crime-notif-bounty">${gettext('selfPardon')}</span>` +
                `</div>`,
                {
                    severity: 'info',
                    duration: displayDuration,
                    html: true,
                    // Two pardons for the same offence are two events, so the
                    // second must not simply refresh the first one's timer.
                    key: `pardon:${crimeName}:${Date.now()}`
                }
            );
        }

        static addPresetCrime(crimeKey) {
            const crime = PresetCrimes[crimeKey];
            if (crime) {
                // Pass the crimeKey as the ID
                this.addCrime(crime.name, crime.bounty, crimeKey);
            } else {
                window.skipLocalization = true;
                $gameMessage.add(`\\C[2]${gettext('errorUnknown')}\\C[0] ${crimeKey}`);
                window.skipLocalization = false;

            }
        }

        static showPresetCrimes() {
            // Group crimes by category
            const categories = {};
            for (const [key, crime] of Object.entries(PresetCrimes)) {
                if (!categories[crime.category]) {
                    categories[crime.category] = [];
                }
                categories[crime.category].push({ key, ...crime });
            }

            let message = `\\C[3]${gettext('availableCrimes')}\\C[0]\n\n`;

            for (const [category, crimes] of Object.entries(categories)) {
                message += `\\C[1]${category}:\\C[0]\n`;
                crimes.forEach(crime => {
                    message += `• ${crime.name} - ${this.goldToEuros(crime.bounty)}\n`;
                });
                message += "\n";
            }
            window.skipLocalization = true;

            $gameMessage.add(message);
            window.skipLocalization = false;

        }

        static showCrimeNotification(crimeName, bountyAmount) {
            if (bountyAmount <= 0 || !Number.isFinite(bountyAmount)) return;
            if (!(SceneManager._scene instanceof Scene_Map)) return;
            if (!window.ParchmentToast) return;
            const totalBounty = this.getTotalBounty();
            window.ParchmentToast.show(
                `<div class="crime-notif-row">` +
                    `<span class="crime-notif-name">${crimeName}</span>` +
                    `<span class="crime-notif-bounty">${this.goldToEuros(bountyAmount)}</span>` +
                `</div>` +
                `<div class="crime-notif-total">${gettext('total')}: ${this.goldToEuros(totalBounty)}</div>`,
                {
                    severity: 'danger',
                    duration: displayDuration,
                    html: true,
                    // Committing the same crime twice is two charges: each one
                    // gets its own popup instead of refreshing the last.
                    key: `crime:${crimeName}:${totalBounty}`
                }
            );
        }

        static showCrimeList() {
            this.initialize();

            const crimeData = $gameSystem._crimeData;
            let message = `\\C[2]${gettext('crimeRecord')}\\C[0]\n\n`;

            if (crimeData.crimes.length === 0) {
                message += gettext('noCrimes');
            } else {
                message += `${gettext('totalBounty')}: \\C[3]${this.goldToEuros(crimeData.totalBounty)}\\C[0]\n\n`;
                message += `\\C[1]${gettext('crimesCommitted')}\\C[0]\n`;

                crimeData.crimes.forEach((crime, index) => {
                    const timeStr = crime.timestamp ? ` [${crime.timestamp}]` : '';
                    message += `${index + 1}. ${crime.name} - ${this.goldToEuros(crime.bounty)}${timeStr}\n`;
                });
            }
            window.skipLocalization = true;

            $gameMessage.add(message);
            window.skipLocalization = false;

        }

        static clearBounty() {
            this.initialize();

            $gameSystem._crimeData = {
                crimes: [],
                totalBounty: 0
            };

            // Clear window.playerCrimes array
            window.playerCrimes = [];

            // Reset bounty variable
            if ($gameVariables) $gameVariables.setValue(bountyVariableId, 0);
            window.skipLocalization = true;

            $gameMessage.add(`\\C[3]${gettext('bountyCleared')}\\C[0]\n${gettext('allCrimesForgi')}`);
            window.skipLocalization = false;

        }

        static goldToEuros(goldAmount) {
            const euros = (goldAmount / 1000) * 10;
            return euros.toFixed(2) + "€";
        }

        static getTotalBounty() {
            this.initialize();
            return $gameSystem._crimeData.totalBounty || 0;
        }

        static getPresetCrime(crimeKey) {
            return PresetCrimes[crimeKey] || null;
        }

        static getAllPresetCrimes() {
            return PresetCrimes;
        }

        static getPlayerCrimes() {
            this.initialize();
            return window.playerCrimes || [];
        }

        static getCrimes() {
            this.initialize();
            return ($gameSystem._crimeData && $gameSystem._crimeData.crimes) || [];
        }

        // Drop a single charge from the record (a settled fine, a dismissed
        // count) and re-total the bounty from what is left.
        static removeCrime(index) {
            this.initialize();
            const crimes = this.getCrimes();
            if (index < 0 || index >= crimes.length) return null;
            const removed = crimes.splice(index, 1)[0];

            if (removed.id && window.playerCrimes) {
                const at = window.playerCrimes.indexOf(removed.id);
                if (at > -1) window.playerCrimes.splice(at, 1);
            }
            this.recalculateBounty();
            return removed;
        }

        static recalculateBounty() {
            this.initialize();
            const total = this.getCrimes().reduce((sum, c) => sum + (c.bounty || 0), 0);
            if ($gameSystem._crimeData) $gameSystem._crimeData.totalBounty = total;
            if ($gameVariables) $gameVariables.setValue(bountyVariableId, total);
            return total;
        }
    }

    // Plugin Commands
    PluginManager.registerCommand(pluginName, "addCrime", args => {
        const crimeName = String(args.crimeName);
        const bountyAmount = Number(args.bountyAmount) || 0;
        CrimeSystem.addCrime(crimeName, bountyAmount);
    });

    PluginManager.registerCommand(pluginName, "addPresetCrime", args => {
        const crimeType = String(args.crimeType);
        CrimeSystem.addPresetCrime(crimeType);
    });

    PluginManager.registerCommand(pluginName, "showPresetCrimes", args => {
        CrimeSystem.showPresetCrimes();
    });

    PluginManager.registerCommand(pluginName, "showCrimeList", args => {
        CrimeSystem.showCrimeList();
    });

    PluginManager.registerCommand(pluginName, "clearBounty", args => {
        CrimeSystem.clearBounty();
    });
    PluginManager.registerCommand(pluginName, "addCrimeFromVariable", args => {
        const crimeName = String(args.crimeName);
        const bountyAmount = $gameVariables.value(79);
        if (bountyAmount > 0) CrimeSystem.addCrime(crimeName, bountyAmount);
    });
    // Global access for script calls
    window.CrimeSystem = CrimeSystem;
    window.PresetCrimes = PresetCrimes;

    // Initialize on new game or load game
    const _DataManager_createGameObjects = DataManager.createGameObjects;
    DataManager.createGameObjects = function () {
        _DataManager_createGameObjects.call(this);
        CrimeSystem.initialize();
    };

    const _DataManager_makeSaveContents = DataManager.makeSaveContents;
    DataManager.makeSaveContents = function () {
        const contents = _DataManager_makeSaveContents.call(this);
        CrimeSystem.initialize();
        return contents;
    };
})();