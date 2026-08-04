/*:
 * @target MZ
 * @plugindesc Complex Apiary System v1.0.0
 * @author Omni-Lex
 * @help
 * ============================================================================
 * Complex Apiary Plugin for RPG Maker MZ
 * ============================================================================
 * 
 * This plugin simulates a complex bee colony with:
 * - Multiple bee castes (Queen, Workers, Nurses, Guards, Foragers, Drones)
 * - Full lifecycle simulation (Egg -> Larva -> Pupa -> Adult -> Death)
 * - Hexagonal comb display
 * - Resource management (honey, pollen, royal jelly, wax)
 * - Seasonal effects and weather impacts
 * - Disease and pest management
 * - Colony moods and efficiency factors
 *
 * @command openApiary
 * @text Open Apiary
 * @desc Opens the apiary interface
 * 
 * @command simulateTime
 * @text Simulate Time
 * @desc Simulates time passage for the apiary
 * 
 */

(() => {
    'use strict';
    
    const HONEY_ITEM_ID = 149;

    // Colony sim runs on in-game minutes (Variable 114), not wall-clock time, so it
    // stays in sync with the other farming systems and never injects a huge step on load.
    const APIARY_TIME_VAR = 114;
    // Safety cap (in hours) on a single catch-up simulation to avoid a frame-freezing loop.
    const APIARY_MAX_CATCHUP_HOURS = 168;
    // Hard ceiling on the serialized bee population so saves don't bloat.
    const MAX_COLONY_BEES = 2000;

    // What the party's Beekeeping is worth at the hive: more brought in by the
    // foragers and more taken off at the harvest, and fewer frames lost to moth
    // and robbing. The colony's own 30% keep-back is never touched by it, since
    // a better keeper does not starve the bees to fill a jar.
    const beekeepingBonus = () => window.SpecializationXP
        ? window.SpecializationXP.multiplier('Beekeeping', 0.10) : 1;
    const beekeepingLossGuard = () => window.SpecializationXP
        ? window.SpecializationXP.discount('Beekeeping', 0.08, 0.6) : 1;
    const currentGameMinutes = () => {
        return (typeof $gameVariables !== 'undefined' && $gameVariables)
            ? ($gameVariables.value(APIARY_TIME_VAR) || 0)
            : 0;
    };
    
    // Bee lifecycle stages
    const LifeStage = {
        EGG: 'egg',
        LARVA: 'larva',
        PUPA: 'pupa',
        ADULT: 'adult'
    };
    
    // Bee castes
    const BeeType = {
        QUEEN: 'queen',
        WORKER: 'worker',
        NURSE: 'nurse',
        GUARD: 'guard',
        FORAGER: 'forager',
        DRONE: 'drone',
        BUILDER: 'builder',
        SCOUT: 'scout'
    };
    
    // Colony states
    const ColonyState = {
        THRIVING: 'thriving',
        STABLE: 'stable',
        STRUGGLING: 'struggling',
        SWARMING: 'swarming',
        SUPERSEDURE: 'supersedure',
        DORMANT: 'dormant'
    };
    
    // Diseases and pests
    const Threats = {
        VARROA: 'varroa',
        NOSEMA: 'nosema',
        FOULBROOD: 'foulbrood',
        WAXMOTH: 'waxmoth',
        WASPS: 'wasps',
        BEARS: 'bears'
    };
    
    class ApiaryBee {
        constructor(type, age = 0) {
            // (No per-bee id: bees are compared by reference, and an id only
            // added save weight to the serialized colony.)
            this.type = type;
            this.age = age;
            this.stage = LifeStage.EGG;
            this.health = 100;
            this.productivity = Math.random() * 50 + 50;
            this.experience = 0;
            this.genetics = this.generateGenetics();
            this.tasks = [];
            this.infections = [];
            this.mated = false;
            this.eggsLaid = 0;
            this.pollenCarrying = 0;
            this.nectarCarrying = 0;
        }
        
        generateGenetics() {
            return {
                productivity: Math.random() * 0.4 + 0.8,
                disease_resistance: Math.random() * 0.4 + 0.8,
                longevity: Math.random() * 0.4 + 0.8,
                foraging: Math.random() * 0.4 + 0.8,
                aggression: Math.random() * 0.4 + 0.8,
                cold_tolerance: Math.random() * 0.4 + 0.8
            };
        }
        
        getLifespan() {
            const baseLifespan = {
                [BeeType.QUEEN]: 1460,
                [BeeType.WORKER]: 42,
                [BeeType.DRONE]: 55,
                [BeeType.NURSE]: 42,
                [BeeType.GUARD]: 42,
                [BeeType.FORAGER]: 35,
                [BeeType.BUILDER]: 45,
                [BeeType.SCOUT]: 38
            };
            return baseLifespan[this.type] * this.genetics.longevity;
        }
        
    }
    
    class ApiaryHexCell {
        constructor(q, r) {
            this.q = q;
            this.r = r;
            this.s = -q - r;
            this.content = null;
            this.waxAge = 0;
            this.honey = 0;
            this.pollen = 0;
            this.royalJelly = 0;
            this.capped = false;
            this.temperature = 35;
        }
    }
    
    class ApiaryComplex {
        constructor() {
            this.initialized = false;
            this.lastUpdate = currentGameMinutes();
            this.colony = {
                queen: null,
                bees: [],
                // Plain object (not a Map) so the comb/cell state survives JsonEx save/load
                cells: {},
                resources: {
                    honey: 100,
                    pollen: 50,
                    royalJelly: 10,
                    wax: 30,
                    propolis: 5,
                    water: 100
                },
                population: {
                    eggs: 0,
                    larvae: 0,
                    pupae: 0,
                    workers: 0,
                    nurses: 0,
                    guards: 0,
                    foragers: 0,
                    drones: 0,
                    builders: 0,
                    scouts: 0
                },
                stats: {
                    totalBees: 0,
                    births: 0,
                    deaths: 0,
                    honeyProduced: 0,
                    honeyConsumed: 0,
                    pollenCollected: 0,
                    enemiesRepelled: 0,
                    diseasesOvercome: 0,
                    swarms: 0,
                    age: 0
                },
                environment: {
                    temperature: 20,
                    humidity: 60,
                    season: 'spring',
                    weather: 'sunny',
                    flowers: 100,
                    threats: []
                },
                state: ColonyState.STABLE,
                mood: 50,
                efficiency: 1.0,
                genetics: {
                    strain: 'italian',
                    traits: {
                        productivity: 1.0,
                        gentleness: 0.8,
                        disease_resistance: 0.7,
                        swarming_tendency: 0.5
                    }
                }
            };
            
            this.hexRadius = 5;
            this.initializeColony();
        }
        
        initializeColony() {
            // Create hexagonal comb structure
            for (let q = -this.hexRadius; q <= this.hexRadius; q++) {
                for (let r = Math.max(-this.hexRadius, -q - this.hexRadius); 
                     r <= Math.min(this.hexRadius, -q + this.hexRadius); r++) {
                    const cell = new ApiaryHexCell(q, r);
                    this.colony.cells[`${q},${r}`] = cell;
                }
            }
            
            // Create initial queen
            this.colony.queen = new ApiaryBee(BeeType.QUEEN, 100);
            this.colony.queen.stage = LifeStage.ADULT;
            this.colony.queen.mated = true;
            this.colony.queen.health = 100;
            
            // Create initial worker population
            for (let i = 0; i < 20; i++) {
                const worker = new ApiaryBee(BeeType.WORKER, 20);
                worker.stage = LifeStage.ADULT;
                this.colony.bees.push(worker);
            }
            
            // Create initial nurses
            for (let i = 0; i < 10; i++) {
                const nurse = new ApiaryBee(BeeType.NURSE, 15);
                nurse.stage = LifeStage.ADULT;
                this.colony.bees.push(nurse);
            }
            
            // Create initial guards
            for (let i = 0; i < 5; i++) {
                const guard = new ApiaryBee(BeeType.GUARD, 25);
                guard.stage = LifeStage.ADULT;
                this.colony.bees.push(guard);
            }
            
            this.updatePopulationCount();
            this.initialized = true;
        }
        
        simulateTimeStep(hours = 1) {
            const steps = Math.floor(hours);
            
            for (let i = 0; i < steps; i++) {
                this.updateEnvironment();
                this.queenActivity();
                this.beeDevelopment();
                this.beeActivities();
                this.resourceManagement();
                this.threatManagement();
                this.colonyDynamics();
                this.updateColonyState();
                
                this.colony.stats.age++;
            }
            
            this.updatePopulationCount();
            return this.generateReport(hours);
        }
        
        updateEnvironment() {
            // Simulate day/night cycle
            const hour = this.colony.stats.age % 24;
            const isDay = hour >= 6 && hour <= 18;
            
            // Temperature fluctuation
            if (isDay) {
                this.colony.environment.temperature = 20 + Math.random() * 10;
            } else {
                this.colony.environment.temperature = 10 + Math.random() * 5;
            }
            
            // Seasonal changes
            const day = Math.floor(this.colony.stats.age / 24);
            if (day % 90 === 0) {
                const seasons = ['spring', 'summer', 'autumn', 'winter'];
                const currentIndex = seasons.indexOf(this.colony.environment.season);
                this.colony.environment.season = seasons[(currentIndex + 1) % 4];
            }
            
            // Weather changes
            if (Math.random() < 0.1) {
                const weatherTypes = ['sunny', 'cloudy', 'rainy', 'stormy', 'windy'];
                this.colony.environment.weather = weatherTypes[Math.floor(Math.random() * weatherTypes.length)];
            }
            
            // Flower availability
            const seasonModifier = {
                spring: 1.2,
                summer: 1.5,
                autumn: 0.8,
                winter: 0.1
            };
            this.colony.environment.flowers = 100 * seasonModifier[this.colony.environment.season] * 
                                              (this.colony.environment.weather === 'sunny' ? 1.2 : 0.8);
        }
        
        queenActivity() {
            if (!this.colony.queen || this.colony.queen.health <= 0) {
                this.raiseNewQueen();
                return;
            }
            
            const queen = this.colony.queen;
            queen.age++;
            
            // Queen egg laying
            if (queen.mated && queen.health > 30) {
                const season = this.colony.environment.season;
                const baseEggRate = {
                    spring: 2000,
                    summer: 1500,
                    autumn: 500,
                    winter: 50
                };
                
                const dailyEggs = baseEggRate[season] * 
                                 (queen.health / 100) * 
                                 queen.genetics.productivity *
                                 this.colony.efficiency;
                
                const eggsThisHour = Math.floor(dailyEggs / 24);

                for (let i = 0; i < eggsThisHour; i++) {
                    // Hard population ceiling: colony.bees is serialized into the
                    // save, so without a cap the hourly egg-laying bloats saves
                    // with thousands of ApiaryBee objects.
                    if (this.colony.bees.length >= MAX_COLONY_BEES) break;
                    if (this.colony.resources.royalJelly > 0.1) {
                        const newBee = new ApiaryBee(this.decideBeeType(), 0);
                        this.colony.bees.push(newBee);
                        queen.eggsLaid++;
                        this.colony.stats.births++;
                        this.colony.resources.royalJelly -= 0.05;
                    }
                }
            }
            
            // Queen health management
            if (queen.age > queen.getLifespan() * 0.8) {
                queen.health -= 0.5;
            }
            
            // Pheromone production
            this.colony.mood = Math.min(100, this.colony.mood + (queen.health / 100) * 2);
        }
        
        decideBeeType() {
            const needs = this.analyzeColonyNeeds();
            const rand = Math.random();
            
            if (needs.needDrones && rand < 0.05) return BeeType.DRONE;
            if (needs.needNurses && rand < 0.3) return BeeType.NURSE;
            if (needs.needGuards && rand < 0.1) return BeeType.GUARD;
            if (needs.needBuilders && rand < 0.15) return BeeType.BUILDER;
            if (needs.needScouts && rand < 0.05) return BeeType.SCOUT;
            if (needs.needForagers && rand < 0.3) return BeeType.FORAGER;
            
            return BeeType.WORKER;
        }
        
        analyzeColonyNeeds() {
            const total = this.colony.stats.totalBees;
            const ratios = {
                nurses: this.colony.population.nurses / total,
                guards: this.colony.population.guards / total,
                foragers: this.colony.population.foragers / total,
                builders: this.colony.population.builders / total,
                scouts: this.colony.population.scouts / total,
                drones: this.colony.population.drones / total
            };
            
            return {
                needNurses: ratios.nurses < 0.2,
                needGuards: ratios.guards < 0.05,
                needForagers: ratios.foragers < 0.3,
                needBuilders: ratios.builders < 0.1,
                needScouts: ratios.scouts < 0.02,
                needDrones: this.colony.environment.season === 'spring' && ratios.drones < 0.05
            };
        }
        
        beeDevelopment() {
            // Set membership makes the final removal O(n) instead of O(n^2)
            // (Array.includes per surviving bee).
            const beesToRemove = new Set();
            
            for (let bee of this.colony.bees) {
                bee.age++;
                
                // Stage progression
                if (bee.stage === LifeStage.EGG && bee.age >= 3) {
                    bee.stage = LifeStage.LARVA;
                } else if (bee.stage === LifeStage.LARVA && bee.age >= 9) {
                    bee.stage = LifeStage.PUPA;
                } else if (bee.stage === LifeStage.PUPA && bee.age >= 21) {
                    bee.stage = LifeStage.ADULT;
                    bee.experience = 0;
                }
                
                // Adult bee role transitions
                if (bee.stage === LifeStage.ADULT && bee.type === BeeType.WORKER) {
                    if (bee.age < 25) {
                        bee.type = BeeType.NURSE;
                    } else if (bee.age < 35) {
                        bee.type = BeeType.BUILDER;
                    } else if (bee.age < 40) {
                        bee.type = BeeType.GUARD;
                    } else {
                        bee.type = BeeType.FORAGER;
                    }
                }
                
                // Health decay
                if (bee.stage === LifeStage.ADULT) {
                    const ageRatio = bee.age / bee.getLifespan();
                    if (ageRatio > 0.8) {
                        bee.health -= 2 + Math.random() * 3;
                    } else if (ageRatio > 0.5) {
                        bee.health -= 0.5 + Math.random();
                    }
                    
                    // Environmental stress
                    if (this.colony.environment.temperature < 10) {
                        bee.health -= (10 - this.colony.environment.temperature) * 0.1;
                    }
                    if (this.colony.environment.temperature > 35) {
                        bee.health -= (this.colony.environment.temperature - 35) * 0.2;
                    }
                }
                
                // Death
                if (bee.health <= 0 || bee.age > bee.getLifespan()) {
                    beesToRemove.add(bee);
                    this.colony.stats.deaths++;
                }
            }

            // Remove dead bees
            if (beesToRemove.size) {
                this.colony.bees = this.colony.bees.filter(bee => !beesToRemove.has(bee));
            }
        }
        
        beeActivities() {
            for (let bee of this.colony.bees) {
                if (bee.stage !== LifeStage.ADULT) continue;
                
                switch (bee.type) {
                    case BeeType.FORAGER:
                        this.forageActivity(bee);
                        break;
                    case BeeType.NURSE:
                        this.nurseActivity(bee);
                        break;
                    case BeeType.GUARD:
                        this.guardActivity(bee);
                        break;
                    case BeeType.BUILDER:
                        this.builderActivity(bee);
                        break;
                    case BeeType.SCOUT:
                        this.scoutActivity(bee);
                        break;
                    case BeeType.DRONE:
                        this.droneActivity(bee);
                        break;
                }
                
                bee.experience += 0.1;
            }
        }
        
        forageActivity(bee) {
            if (this.colony.environment.weather === 'rainy' || 
                this.colony.environment.weather === 'stormy') return;
            
            const forageSuccess = Math.random() * bee.genetics.foraging * 
                                 (this.colony.environment.flowers / 100);
            
            if (forageSuccess > 0.5) {
                // A keeper who knows the craft sites the hive better and keeps
                // the frames in order, so the same foragers bring back more
                // (Beekeeping, specialization 36).
                const keeper = beekeepingBonus();
                const nectarCollected = Math.random() * 5 * bee.genetics.productivity * keeper;
                const pollenCollected = Math.random() * 3 * bee.genetics.productivity * keeper;
                
                this.colony.resources.honey += nectarCollected * 0.3; // Nectar to honey conversion
                this.colony.resources.pollen += pollenCollected;
                this.colony.stats.honeyProduced += nectarCollected * 0.3;
                this.colony.stats.pollenCollected += pollenCollected;
                
                bee.nectarCarrying = nectarCollected;
                bee.pollenCarrying = pollenCollected;
            }
            
            // Risk of getting lost or eaten
            if (Math.random() < 0.001) {
                bee.health = 0;
            }
        }
        
        nurseActivity(bee) {
            // Feed larvae
            const larvae = this.colony.bees.filter(b => b.stage === LifeStage.LARVA);
            if (larvae.length > 0 && this.colony.resources.honey > 0) {
                const fedLarvae = Math.min(5, larvae.length);
                this.colony.resources.honey -= fedLarvae * 0.1;
                this.colony.resources.royalJelly += 0.01 * bee.genetics.productivity;
                
                for (let i = 0; i < fedLarvae; i++) {
                    larvae[i].health = Math.min(100, larvae[i].health + 5);
                }
            }
            
            // Temperature regulation
            Object.values(this.colony.cells).forEach(cell => {
                if (cell.content && cell.content.stage === LifeStage.LARVA) {
                    cell.temperature = 35; // Optimal brood temperature
                }
            });
        }
        
        guardActivity(bee) {
            // Check for threats
            if (this.colony.environment.threats.length > 0) {
                const threat = this.colony.environment.threats[0];
                const defenseSuccess = Math.random() * bee.genetics.aggression;
                
                if (defenseSuccess > 0.6) {
                    this.colony.environment.threats.shift();
                    this.colony.stats.enemiesRepelled++;
                    bee.health -= 10; // Combat damage
                }
            }
            
            // Patrol behavior increases colony security
            this.colony.mood = Math.min(100, this.colony.mood + 0.1);
        }
        
        builderActivity(bee) {
            // Build new comb
            if (this.colony.resources.wax > 1) {
                this.colony.resources.wax -= 0.1;
                
                // Find empty cell to build
                Object.values(this.colony.cells).forEach(cell => {
                    if (!cell.content && Math.random() < 0.01) {
                        cell.waxAge = 0;
                        cell.content = 'empty';
                    }
                });
            }
            
            // Produce wax
            if (this.colony.resources.honey > 1) {
                this.colony.resources.honey -= 0.05;
                this.colony.resources.wax += 0.01 * bee.genetics.productivity;
            }
        }
        
        scoutActivity(bee) {
            // Scout for new flower sources
            const scoutSuccess = Math.random() * bee.experience / 10;
            if (scoutSuccess > 0.8) {
                this.colony.environment.flowers += 10;
            }
            
            // Check for swarming conditions
            if (this.colony.stats.totalBees > 60000 && 
                this.colony.environment.season === 'spring') {
                this.colony.state = ColonyState.SWARMING;
            }
        }
        
        droneActivity(bee) {
            // Drones mainly consume resources
            this.colony.resources.honey -= 0.02;
            
            // Mating flights
            if (this.colony.environment.season === 'spring' && 
                this.colony.environment.weather === 'sunny' &&
                !bee.mated) {
                if (Math.random() < 0.01) {
                    bee.mated = true;
                    bee.health = 0; // Drones die after mating
                }
            }
        }
        
        resourceManagement() {
            // Resource consumption
            const totalBees = this.colony.stats.totalBees;
            const baseConsumption = totalBees * 0.001;
            
            this.colony.resources.honey -= baseConsumption;
            this.colony.resources.pollen -= baseConsumption * 0.5;
            this.colony.stats.honeyConsumed += baseConsumption;
            
            // Water collection (automatic)
            if (this.colony.environment.weather === 'rainy') {
                this.colony.resources.water = 100;
            } else {
                this.colony.resources.water -= totalBees * 0.0001;
                this.colony.resources.water = Math.max(0, this.colony.resources.water);
            }
            
            // Propolis production
            if (Math.random() < 0.1) {
                this.colony.resources.propolis += 0.1;
            }
            
            // Resource caps
            this.colony.resources.honey = Math.max(0, this.colony.resources.honey);
            this.colony.resources.pollen = Math.max(0, this.colony.resources.pollen);
            this.colony.resources.royalJelly = Math.max(0, this.colony.resources.royalJelly);
            this.colony.resources.wax = Math.max(0, this.colony.resources.wax);
        }
        
        threatManagement() {
            // Random threat generation
            if (Math.random() < 0.01) {
                const threatTypes = Object.values(Threats);
                const newThreat = threatTypes[Math.floor(Math.random() * threatTypes.length)];
                this.colony.environment.threats.push(newThreat);
            }
            
            // Process existing threats. A trained keeper spots moth and robbing
            // early, so the same threat costs the colony less comb and honey.
            const guard = beekeepingLossGuard();
            for (let threat of this.colony.environment.threats) {
                switch (threat) {
                    case Threats.VARROA:
                        // Infect random bees
                        const targetBee = this.colony.bees[Math.floor(Math.random() * this.colony.bees.length)];
                        if (targetBee) {
                            targetBee.health -= 5 * guard;
                            targetBee.infections.push(Threats.VARROA);
                        }
                        break;

                    case Threats.WAXMOTH:
                        // Damage comb
                        this.colony.resources.wax -= 1 * guard;
                        break;

                    case Threats.WASPS:
                        // Kill bees and steal honey
                        if (this.colony.bees.length > 0) {
                            const victim = Math.floor(Math.random() * this.colony.bees.length);
                            this.colony.bees[victim].health -= 50 * guard;
                        }
                        this.colony.resources.honey -= 5 * guard;
                        break;
                }
            }
            
            // Natural threat resolution
            this.colony.environment.threats = this.colony.environment.threats.filter(() => Math.random() > 0.1);
        }
        
        colonyDynamics() {
            // Calculate colony efficiency
            const factors = {
                queenHealth: this.colony.queen ? this.colony.queen.health / 100 : 0,
                resources: Math.min(1, this.colony.resources.honey / 100),
                temperature: 1 - Math.abs(this.colony.environment.temperature - 25) / 25,
                threats: Math.max(0.5, 1 - this.colony.environment.threats.length * 0.1),
                mood: this.colony.mood / 100
            };
            
            this.colony.efficiency = Object.values(factors).reduce((a, b) => a * b, 1);
            
            // Swarming behavior
            if (this.colony.state === ColonyState.SWARMING) {
                this.performSwarm();
            }
            
            // Supersedure (replace failing queen)
            if (this.colony.queen && this.colony.queen.health < 20) {
                this.colony.state = ColonyState.SUPERSEDURE;
                this.raiseNewQueen();
            }
        }
        
        performSwarm() {
            // Half the colony leaves with the old queen
            const leavingBees = Math.floor(this.colony.bees.length / 2);
            this.colony.bees = this.colony.bees.slice(leavingBees);
            
            // Resources are split
            this.colony.resources.honey /= 2;
            this.colony.resources.pollen /= 2;
            
            // Raise new queen
            this.raiseNewQueen();
            
            this.colony.stats.swarms++;
            this.colony.state = ColonyState.STABLE;
        }
        
        raiseNewQueen() {
            // Find suitable larvae
            const larvae = this.colony.bees.filter(b => 
                b.stage === LifeStage.LARVA && b.age < 3
            );
            
            if (larvae.length > 0) {
                // Convert larva to queen
                const chosenLarva = larvae[0];
                chosenLarva.type = BeeType.QUEEN;
                chosenLarva.genetics.productivity *= 1.5;
                chosenLarva.genetics.longevity *= 2;
                
                // Remove old queen if superseding
                if (this.colony.queen && this.colony.state === ColonyState.SUPERSEDURE) {
                    this.colony.queen = null;
                }
                
                // Wait for new queen to mature
                // (This is simplified - in reality would take time)
                if (chosenLarva.stage === LifeStage.ADULT) {
                    this.colony.queen = chosenLarva;
                    this.colony.bees = this.colony.bees.filter(b => b !== chosenLarva);
                }
            }
        }
        
        updateColonyState() {
            const totalBees = this.colony.stats.totalBees;
            
            if (totalBees < 1000) {
                this.colony.state = ColonyState.STRUGGLING;
            } else if (totalBees < 10000) {
                this.colony.state = ColonyState.STABLE;
            } else if (totalBees > 50000) {
                this.colony.state = ColonyState.THRIVING;
            }
            
            if (this.colony.environment.season === 'winter') {
                this.colony.state = ColonyState.DORMANT;
            }
        }
        
        updatePopulationCount() {
            // Reset counts
            Object.keys(this.colony.population).forEach(key => {
                this.colony.population[key] = 0;
            });
            
            // Count bees by type and stage
            for (let bee of this.colony.bees) {
                if (bee.stage === LifeStage.EGG) {
                    this.colony.population.eggs++;
                } else if (bee.stage === LifeStage.LARVA) {
                    this.colony.population.larvae++;
                } else if (bee.stage === LifeStage.PUPA) {
                    this.colony.population.pupae++;
                } else if (bee.stage === LifeStage.ADULT) {
                    switch (bee.type) {
                        case BeeType.WORKER:
                            this.colony.population.workers++;
                            break;
                        case BeeType.NURSE:
                            this.colony.population.nurses++;
                            break;
                        case BeeType.GUARD:
                            this.colony.population.guards++;
                            break;
                        case BeeType.FORAGER:
                            this.colony.population.foragers++;
                            break;
                        case BeeType.DRONE:
                            this.colony.population.drones++;
                            break;
                        case BeeType.BUILDER:
                            this.colony.population.builders++;
                            break;
                        case BeeType.SCOUT:
                            this.colony.population.scouts++;
                            break;
                    }
                }
            }
            
            this.colony.stats.totalBees = this.colony.bees.length + 
                                          (this.colony.queen ? 1 : 0);
        }
        
        generateReport(hours) {
            const report = {
                timeElapsed: hours,
                colony: {
                    state: this.colony.state,
                    mood: Math.floor(this.colony.mood),
                    efficiency: Math.floor(this.colony.efficiency * 100),
                    age: this.colony.stats.age
                },
                queen: {
                    alive: !!this.colony.queen,
                    health: this.colony.queen ? Math.floor(this.colony.queen.health) : 0,
                    age: this.colony.queen ? this.colony.queen.age : 0,
                    eggsLaid: this.colony.queen ? this.colony.queen.eggsLaid : 0
                },
                population: {
                    total: this.colony.stats.totalBees,
                    eggs: this.colony.population.eggs,
                    larvae: this.colony.population.larvae,
                    pupae: this.colony.population.pupae,
                    adults: {
                        workers: this.colony.population.workers,
                        nurses: this.colony.population.nurses,
                        guards: this.colony.population.guards,
                        foragers: this.colony.population.foragers,
                        drones: this.colony.population.drones,
                        builders: this.colony.population.builders,
                        scouts: this.colony.population.scouts
                    }
                },
                resources: {
                    honey: Math.floor(this.colony.resources.honey),
                    pollen: Math.floor(this.colony.resources.pollen),
                    royalJelly: Math.floor(this.colony.resources.royalJelly * 10) / 10,
                    wax: Math.floor(this.colony.resources.wax),
                    propolis: Math.floor(this.colony.resources.propolis * 10) / 10,
                    water: Math.floor(this.colony.resources.water)
                },
                environment: {
                    season: this.colony.environment.season,
                    weather: this.colony.environment.weather,
                    temperature: Math.floor(this.colony.environment.temperature),
                    flowers: Math.floor(this.colony.environment.flowers),
                    threats: this.colony.environment.threats
                },
                statistics: {
                    births: this.colony.stats.births,
                    deaths: this.colony.stats.deaths,
                    honeyProduced: Math.floor(this.colony.stats.honeyProduced),
                    honeyConsumed: Math.floor(this.colony.stats.honeyConsumed),
                    pollenCollected: Math.floor(this.colony.stats.pollenCollected),
                    enemiesRepelled: this.colony.stats.enemiesRepelled,
                    swarms: this.colony.stats.swarms
                }
            };
            
            return report;
        }
        
        harvestHoney() {
            const harvestable = Math.floor(this.colony.resources.honey * 0.7); // Keep 30% for bees
            if (harvestable > 0) {
                this.colony.resources.honey -= harvestable;
                // The colony only ever loses the 70%; the keeper's skill shows
                // in how much of it survives extraction into actual jars.
                const jars = Math.floor(harvestable * beekeepingBonus() / 10);
                $gameParty.gainItem($dataItems[HONEY_ITEM_ID], jars);
                return harvestable;
            }
            return 0;
        }
    }
    
    // Expose the colony classes globally so JsonEx can restore their prototypes when a
    // save is loaded (the instance graph is stored inside $gameSystem.apiaryComplex).
    window.ApiaryComplex = ApiaryComplex;
    window.ApiaryBee = ApiaryBee;
    window.ApiaryHexCell = ApiaryHexCell;

    class Scene_Apiary extends Scene_MenuBase {
        create() {
            super.create();
            if (this._helpWindow) this._helpWindow.hide();

            if (!$gameSystem.apiaryComplex) {
                $gameSystem.apiaryComplex = new ApiaryComplex();
            }

            this._actionIndex = 0;
            this._feedbackMsg = '';
            this._feedbackTimer = 0;
            this._simTimer = 0;

            this._container = document.createElement('div');
            this._container.id = 'apiary-container';
            this._container.style.opacity = '0';
            this._container.style.transition = 'opacity 0.22s ease-out';
            document.body.appendChild(this._container);

            this.refreshUIApiary();

            setTimeout(() => {
                if (this._container) this._container.style.opacity = '1';
            }, 16);
        }

        terminate() {
            if (this._container) {
                this._container.remove();
                this._container = null;
            }
            super.terminate();
        }

        refreshUIApiary() {
            if (!this._container) return;
            const apiary = $gameSystem.apiaryComplex;
            if (!apiary) return;

            const report = apiary.generateReport(0);

            // Icon helper ,  scales the 512×384 IconSet to target size
            const ic = (idx, sz = 20) => {
                const scale = sz / 32;
                const bw = Math.round(512 * scale), bh = Math.round(384 * scale);
                const x = (idx % 16) * sz, y = Math.floor(idx / 16) * sz;
                return `<span style="display:inline-block;width:${sz}px;height:${sz}px;background:url('img/system/IconSet.png') -${x}px -${y}px no-repeat;background-size:${bw}px ${bh}px;vertical-align:middle;margin-right:3px;image-rendering:pixelated;flex-shrink:0;"></span>`;
            };

            const stateColors = {
                thriving: '#27ae60', stable: '#2980b9', struggling: '#e67e22',
                swarming: '#8e44ad', supersedure: '#c0392b', dormant: '#7f8c8d'
            };
            const stateColor = stateColors[report.colony.state] || '#8b5a2b';

            // Simulate Day visibility: only for Test player or Sandbox mode
            const leaderName = ($gameParty.leader && $gameParty.leader()) ? $gameParty.leader().name() : '';
            const isSandbox = $gameSystem && $gameSystem._isSandboxMode;
            this._showSimulate = leaderName === 'Test' || !!isSandbox;  // i18n-ignore  debug account name  // i18n-ignore  debug account name

            // Build visible actions list
            const actionDefs = [
                { key: 'harvest',  icon: 340, label: T('Apiary.action.harvest') },
                ...(this._showSimulate ? [{ key: 'simulate', icon: 310, label: T('Apiary.action.simulate') }] : []),
                { key: 'exit',     icon: null, label: T('Apiary.action.exit') },
            ];
            this._maxActionIndex = actionDefs.length - 1;
            if (this._actionIndex > this._maxActionIndex) this._actionIndex = this._maxActionIndex;

            const actionsHTML = actionDefs.map(({ icon: iconIdx, label }, i) => `
                <div class="apiary-action-btn ${i === this._actionIndex ? 'focused' : ''}" data-idx="${i}">
                    ${iconIdx !== null ? ic(iconIdx, 18) : ''} ${label}
                </div>
            `).join('');

            // Population
            const popEntries = [
                [42,  T('Apiary.caste.eggs'),     report.population.eggs],
                [32,  T('Apiary.caste.larvae'),   report.population.larvae],
                [53,  T('Apiary.caste.pupae'),    report.population.pupae],
                [83,  T('Apiary.caste.workers'),  report.population.adults.workers],
                [84,  T('Apiary.caste.nurses'),   report.population.adults.nurses],
                [334, T('Apiary.caste.guards'),   report.population.adults.guards],
                [105, T('Apiary.caste.foragers'), report.population.adults.foragers],
                [188, T('Apiary.caste.builders'), report.population.adults.builders],
                [130, T('Apiary.caste.scouts'),   report.population.adults.scouts],
                [245, T('Apiary.caste.drones'),   report.population.adults.drones],
            ];
            const popHTML = popEntries
                .filter(([, , v]) => v > 0)
                .map(([iconIdx, label, value]) => `
                    <div class="apiary-pop-row">
                        <span class="apiary-pop-label">${ic(iconIdx, 18)} ${label}</span>
                        <span class="apiary-pop-value">${value.toLocaleString()}</span>
                    </div>
                `).join('');

            // Resources
            const resources = [
                [340, T('Apiary.resource.honey'),      report.resources.honey,      500],
                [80,  T('Apiary.resource.pollen'),     report.resources.pollen,     200],
                [73,  T('Apiary.resource.royalJelly'), report.resources.royalJelly,  50],
                [303, T('Apiary.resource.wax'),        report.resources.wax,        100],
                [269, T('Apiary.resource.propolis'),   report.resources.propolis,    50],
                [67,  T('Apiary.resource.water'),      report.resources.water,      100],
            ];
            const resourceHTML = resources.map(([iconIdx, label, value, max]) => {
                const pct = Math.min(100, (value / max) * 100).toFixed(1);
                return `
                    <div class="apiary-resource">
                        <div class="apiary-resource-header">
                            <span>${ic(iconIdx, 20)} ${label}</span>
                            <span>${value}</span>
                        </div>
                        <div class="apiary-resource-bar">
                            <div class="apiary-resource-fill" style="width:${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');

            const queenHTML = report.queen.alive
                ? `<div class="apiary-stat-row"><span>${ic(257, 16)} ${T('Apiary.queenHealth')}</span><span>${report.queen.health}%</span></div>
                   <div class="apiary-stat-row"><span>${ic(42, 16)} ${T('Apiary.eggsLaid')}</span><span>${report.queen.eggsLaid.toLocaleString()}</span></div>`
                : `<div class="apiary-warning">${ic(12, 16)} ${T('Apiary.noQueen')}</div>`;

            const threatsHTML = report.environment.threats.length > 0
                ? `<div class="apiary-threats">${ic(12, 16)} ${T('Apiary.threats', { list: report.environment.threats.join(', ') })}</div>`
                : `<div class="apiary-threats safe">${ic(87, 16)} ${T('Apiary.secure')}</div>`;

            const feedbackHTML = this._feedbackMsg
                ? `<div class="apiary-feedback">${this._feedbackMsg}</div>` : '';

            this._container.innerHTML = `
                <div class="book-spread">
                    <div class="left-page">
                        <div style="position:relative;display:flex;align-items:center;justify-content:center;border-bottom:2px dashed #bba16d;padding-bottom:8px;margin-bottom:18px;min-height:40px;width:100%;">
                            <div class="back-button" onclick="SceneManager._scene.popScene()" style="position:absolute;left:0;background:#8b5a2b;color:#ecdcb9;padding:4px 14px;border-radius:4px;font-weight:bold;cursor:pointer;border:1.5px solid #4a2711;text-transform:uppercase;font-size:0.8rem;font-family:'Lora',serif;user-select:none;">${T('Apiary.ui.back')}</div>
                            <h2 class="title" style="border:none;margin:0;padding:0;text-align:center;">${T('Apiary.ui.apiary')}</h2>
                        </div>

                        <div class="apiary-content-grid">
                            <div>
                                <div class="apiary-section">
                                    <div class="apiary-section-title">${ic(41, 14)} ${T('Apiary.ui.colony')}</div>
                                    <div class="apiary-stat-row"><span>${T('Apiary.ui.state')}</span><span style="color:${stateColor};text-transform:capitalize;">${report.colony.state}</span></div>
                                    <div class="apiary-stat-row"><span>${T('Apiary.ui.mood')}</span><span>${report.colony.mood}%</span></div>
                                    <div class="apiary-stat-row"><span>${T('Apiary.ui.efficiency')}</span><span>${report.colony.efficiency}%</span></div>
                                </div>
                                <div class="apiary-section">
                                    <div class="apiary-section-title">${ic(257, 14)} ${T('Apiary.ui.queen')}</div>
                                    ${queenHTML}
                                </div>
                                <div class="apiary-section">
                                    <div class="apiary-section-title">${ic(231, 14)} ${T('Apiary.ui.environment')}</div>
                                    <div class="apiary-stat-row"><span>${ic(103, 16)} ${T('Apiary.ui.season')}</span><span style="text-transform:capitalize;">${report.environment.season}</span></div>
                                    <div class="apiary-stat-row"><span>${ic(232, 16)} ${T('Apiary.ui.weather')}</span><span style="text-transform:capitalize;">${report.environment.weather}</span></div>
                                    <div class="apiary-stat-row"><span>${ic(224, 16)} ${T('Apiary.ui.temp')}</span><span>${report.environment.temperature}°C</span></div>
                                    <div class="apiary-stat-row"><span>${ic(105, 16)} ${T('Apiary.ui.flowers')}</span><span>${report.environment.flowers}%</span></div>
                                </div>
                            </div>

                            <div>
                                <div class="apiary-section">
                                    <div class="apiary-section-title">${ic(125, 14)} ${T('Apiary.ui.population')}</div>
                                    <div class="apiary-stat-row" style="opacity:0.65;margin-bottom:5px;"><span>${T('Apiary.ui.total')}</span><span>${report.population.total.toLocaleString()}</span></div>
                                    <div class="apiary-pop-list">${popHTML}</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="right-page">
                        <h2 class="title" style="border:none;margin:0 0 14px 0;padding:0;text-align:center;">${T('Apiary.ui.resources')}</h2>

                        <div class="apiary-resources">${resourceHTML}</div>

                        <div class="apiary-section">
                            <div class="apiary-section-title">${ic(210, 14)} ${T('Apiary.ui.statistics')}</div>
                            <div class="apiary-stat-row"><span>${T('Apiary.ui.births')}</span><span>${report.statistics.births.toLocaleString()}</span></div>
                            <div class="apiary-stat-row"><span>${T('Apiary.ui.deaths')}</span><span>${report.statistics.deaths.toLocaleString()}</span></div>
                            <div class="apiary-stat-row"><span>${T('Apiary.ui.honeyProduced')}</span><span>${report.statistics.honeyProduced.toLocaleString()}</span></div>
                            <div class="apiary-stat-row"><span>${T('Apiary.ui.enemiesRepelled')}</span><span>${report.statistics.enemiesRepelled}</span></div>
                            <div class="apiary-stat-row"><span>${T('Apiary.ui.swarms')}</span><span>${report.statistics.swarms}</span></div>
                        </div>

                        ${threatsHTML}
                        ${feedbackHTML}

                        <div class="apiary-actions">${actionsHTML}</div>
                    </div>
                </div>
            `;

            this._container.querySelectorAll('.apiary-action-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-idx'));
                    this._actionIndex = idx;
                    this.executeApiaryAction(idx);
                });
            });
        }

        executeApiaryAction(idx) {
            const apiary = $gameSystem.apiaryComplex;
            if (!apiary) return;

            const actionMap = [
                'harvest',
                ...(this._showSimulate ? ['simulate'] : []),
                'exit',
            ];
            const action = actionMap[idx];

            if (action === 'harvest') {
                const harvested = apiary.harvestHoney();
                if (harvested > 0) {
                    this._feedbackMsg = T('Apiary.harvested', { amount: Math.floor(harvested / 10) });
                    SoundManager.playUseItem();
                    // Taking a crop off without losing the colony is the whole
                    // craft, so it is worth more than merely tending.
                    if (window.SpecializationXP) {
                        window.SpecializationXP.awardCapped('Beekeeping', 2);
                    }
                } else {
                    this._feedbackMsg = T('Apiary.notEnoughHoney');
                    SoundManager.playBuzzer();
                }
                this._feedbackTimer = 120;
            } else if (action === 'simulate') {
                apiary.simulateTimeStep(24);
                this._feedbackMsg = T('Apiary.simulatedDay');
                this._feedbackTimer = 90;
                SoundManager.playOk();
                if (window.SpecializationXP) {
                    window.SpecializationXP.awardCapped('Beekeeping', 1);
                }
            } else {
                SoundManager.playCancel();
                this.popScene();
                return;
            }
            this.refreshUIApiary();
        }

        update() {
            super.update();

            if (this._feedbackTimer > 0) {
                this._feedbackTimer--;
                if (this._feedbackTimer === 0) {
                    this._feedbackMsg = '';
                    this.refreshUIApiary();
                }
            }

            // Advance the colony by elapsed in-game hours (Variable 114), not by
            // real seconds, and move lastUpdate forward so the open scene and the
            // load-time catch-up share one clock (keeping the whole-hour remainder).
            const apiary = $gameSystem.apiaryComplex;
            if (apiary) {
                const now = currentGameMinutes();
                const hoursPassed = Math.floor((now - apiary.lastUpdate) / 60);
                if (hoursPassed >= 1) {
                    const hours = Math.min(hoursPassed, APIARY_MAX_CATCHUP_HOURS);
                    apiary.simulateTimeStep(hours);
                    apiary.lastUpdate += hours * 60;
                    this.refreshUIApiary();
                }
            }

            this.updateApiaryInput();
        }

        updateApiaryInput() {
            const count = (this._maxActionIndex || 1) + 1;
            if (Input.isTriggered('cancel')) {
                SoundManager.playCancel();
                this.popScene();
            } else if (Input.isRepeated('up')) {
                this._actionIndex = (this._actionIndex - 1 + count) % count;
                SoundManager.playCursor();
                this.refreshUIApiary();
            } else if (Input.isRepeated('down')) {
                this._actionIndex = (this._actionIndex + 1) % count;
                SoundManager.playCursor();
                this.refreshUIApiary();
            } else if (Input.isTriggered('ok')) {
                this.executeApiaryAction(this._actionIndex);
            }
        }
    }
    
    window.Scene_Apiary = Scene_Apiary;

    const openApiaryCommand = args => {
        if (!$gameSystem.apiaryComplex) {
            $gameSystem.apiaryComplex = new ApiaryComplex();
        }
        const now = currentGameMinutes();
        const timePassed = (now - $gameSystem.apiaryComplex.lastUpdate) / 60; // minutes -> hours
        if (timePassed >= 1) {
            const hours = Math.min(Math.floor(timePassed), APIARY_MAX_CATCHUP_HOURS);
            $gameSystem.apiaryComplex.simulateTimeStep(hours);
        }
        $gameSystem.apiaryComplex.lastUpdate = now;
        SceneManager.push(Scene_Apiary);
    };

    const simulateTimeCommand = args => {
        if (!$gameSystem.apiaryComplex) {
            $gameSystem.apiaryComplex = new ApiaryComplex();
        }
        const hours = 24;
        const report = $gameSystem.apiaryComplex.simulateTimeStep(hours);
        window.skipLocalization = true;
        $gameMessage.add(T('Apiary.simulatedHours', { hours: hours }));
        $gameMessage.add(T('Apiary.honeyProduced', { amount: Math.floor(report.statistics.honeyProduced) }));
        $gameMessage.add(T('Apiary.currentPopulation', { total: report.population.total }));
        window.skipLocalization = false;
    };

    // Register under both names to handle file rename (ApiaryComplex.js → ApiarySystem.js)
    PluginManager.registerCommand('ApiarySystem', 'openApiary', openApiaryCommand);
    PluginManager.registerCommand('ApiarySystem', 'simulateTime', simulateTimeCommand);
    PluginManager.registerCommand('ApiaryComplex', 'openApiary', openApiaryCommand);
    PluginManager.registerCommand('ApiaryComplex', 'simulateTime', simulateTimeCommand);
})();
