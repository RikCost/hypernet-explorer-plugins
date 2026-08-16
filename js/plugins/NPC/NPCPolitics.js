/*:
 * @target MZ
 * @plugindesc NPC Politics v1.0.0, Hyperpower governments, elections, parties & DF-grade social politics
 * @author Omni-Lex
 * @help
 * ============================================================================
 * NPCPolitics, Dwarf-Fortress-grade political & social simulation
 * ============================================================================
 * Builds a living political world on top of the NPC life simulation:
 *
 *   - Every hyperpower defined in WorldGen/Countries.json (every non-Neutral
 *     "faction"/"controller") gets a full government: an archetype (theocracy,
 *     single-party state, parliamentary monarchy, technocracy, sultanate,
 *     divine pantheon, serene republic, corporatocracy, warband confederacy),
 *     political parties / orders / blocs / clans, a generated political class
 *     with charisma / integrity / cunning / ambition, a head of state, and
 *     running meters: legitimacy, stability, unrest, economy mood, treasury.
 *
 *   - Elections, each in the hyperpower's own idiom: parliamentary general
 *     elections, papal conclaves with multiple ballots, politburo plenums
 *     with official 99% results, wealth-weighted shareholder meetings,
 *     goblin moots where the runner-up risks being eaten, divine ascension
 *     tournaments, palace successions, and the Archive's Great Examination.
 *     Every result is recorded in a permanent political history.
 *
 *   - Ongoing political life resolved through time skips: scandals, policy
 *     edicts, protests, riots, coups, revolutions, assassinations,
 *     referendums, festivals, rumors that spread through the population,
 *     party momentum, approval drift, and mortality of aging rulers.
 *
 *   - Every map-group NPC gets a political identity: a five-axis ideology
 *     (economy, authority, tradition, militarism, mysticism), a party
 *     affiliation within their settlement's hyperpower, an engagement level
 *     (apathetic → voter → activist → organizer), a voting record, and
 *     grudges against parties that beat theirs.
 *
 *   - Local DF-style settlement politics: each map group elects a mayor from
 *     its real NPC population every year; the mayor appoints a captain of
 *     the guard, a tax collector and a high priest from ideological allies.
 *
 * State lives in $gameSystem._npcPolitics, which WorldManager maps to the
 * "politics" section of the world's npcs.json, shared by every savegame of
 * the world, flushed after big time skips. All generation and event sampling
 * is seeded (world seed + names + minutes), so two worlds with the same seed
 * produce the same political history.
 *
 * Delta processing is O(powers + NPCs) per ~30-day chunk regardless of how
 * much time passed; event counts are sampled from per-day rates.
 *
 * Load order:
 *   Core/WorldManager → Core/TimeDateSystem → NPC/NPCSystem
 *   → NPC/NPCSociety → NPC/NPCSimulationCore → NPC/NPCLifeSimulator
 *   → NPC/NPCConversation → NPC/NPCPolitics  ← this file
 *
 * Public API (window.NPCPolitics):
 *   catchUp(nowMinute)            , resolve all political time up to now
 *   getPower(name)                , a hyperpower's full political state
 *   listPowers()                  , names of all registered hyperpowers
 *   getIdentity(npcName)          , an NPC's political identity
 *   getSettlement(groupName)      , local offices of a map group
 *   opinionModifier(a, b)         , -12..+12 political chemistry of two NPCs
 *   getConversationContext(name)  , fodder for NPCConversation's
 *                                    PoliticsProvider dialogue templates
 *   buildPowerReport(powerName)   , readable multi-line state-of-the-nation
 *   buildElectionReport(powerName), readable election history + next date
 *   buildNPCProfile(npcName)      , readable political biography of an NPC
 *
 * @command PoliticsReport
 * @desc Show the state-of-the-nation report for a hyperpower.
 *
 * @arg power
 * @text Hyperpower name
 * @type string
 * @default
 *
 * @command PoliticsElections
 * @desc Show the election history and next scheduled election of a hyperpower.
 *
 * @arg power
 * @text Hyperpower name
 * @type string
 * @default
 *
 * @command PoliticsNPC
 * @desc Show the political profile of a named NPC.
 *
 * @arg eventName
 * @text NPC Event Name
 * @type string
 * @default
 *
 * @command PoliticsDebug
 * @desc Print the full political state of a hyperpower (or everything) to the console.
 *
 * @arg power
 * @text Hyperpower name (blank = all)
 * @type string
 * @default
 *
 * @command PoliticsCatchUp
 * @desc Force the political simulation to resolve all pending time.
 */

(() => {
  "use strict";

  const pluginName = "NPCPolitics";

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  const MINUTES_PER_DAY    = 1440;
  const MINUTES_PER_YEAR   = 525600;          // 365-day simulation year
  const EPOCH_YEAR         = 2001;            // minute 0 = Jan 1 2001 10:00
  const SKIP_FLUSH_MINUTES = 360;             // deltas >= 6h flush npcs.json
  const CHUNK_DAYS         = 30;              // simulation granularity
  const MAX_NEW_IDENTITIES_PER_PASS = 400;    // bound identity creation
  const ELECTION_LOG_CAP   = 40;              // per-power election records
  const EVENT_LOG_CAP      = 80;              // per-power political events
  const RUMOR_CAP          = 12;              // live rumors per power
  const IDENTITY_LOG_CAP   = 20;              // per-NPC political event log
  const SETTLEMENT_LOG_CAP = 20;              // per-settlement office history
  const LOCAL_TERM_DAYS    = 365;             // settlement mayoral term

  // The five ideological axes, each -100..+100.
  //   econ: -100 collectivist  … +100 free-market
  //   auth: -100 libertarian   … +100 authoritarian
  //   trad: -100 progressive   … +100 traditionalist
  //   mil:  -100 pacifist      … +100 militarist
  //   myst: -100 rationalist   … +100 mystic
  const AXES = ["econ", "auth", "trad", "mil", "myst"];

  // How much of a person's political identity is the creed their society
  // profile names (Ideology.json `axes`) against the cultural baseline of the
  // power they live under, and how far their own opinions wander from it. A
  // creed is most of what somebody is, so it leads; without one the identity
  // falls back to the baseline and the old, wider spread.
  const CREED_WEIGHT = 0.62;
  const CREED_SPREAD = 30;

  // Per-day national event rates (scaled by power state at runtime)
  const RATES = {
    scandal:       1 / 120,
    edict:         1 / 90,
    protest:       1 / 60,     // × unrest/100
    riot:          1 / 200,    // × unrest/100, only past unrest 70
    coup:          1 / 600,    // × (100-stability)/100 × coupSusceptibility
    revolution:    1 / 50,     // only at unrest>=90 && legitimacy<=25
    assassination: 1 / 4000,   // × unrest/50
    festival:      1 / 180,    // × festivals policy / 50
    referendum:    1 / 700,    // democratic systems only
    rumor:         1 / 45,
  };

  // Per-day NPC identity rates
  const NPC_RATES = {
    partySwitch:   1 / 900,
    radicalize:    1 / 400,    // × unrest/100
    grudgeFade:    1 / 500,
  };

  // ==========================================================================
  // GOVERNMENT ARCHETYPES, one per known hyperpower, plus a fallback
  // ==========================================================================
  // system:    election idiom (see ElectionEngines)
  // baseline:  the power's cultural center of ideological gravity
  // partyKind: what "parties" are called in reports
  // rigging:   how much official results favor the incumbent (0..1)
  // coupSusceptibility / scandalSensitivity: event multipliers

  // i18n-ignore-start: hyperpower keys are joined against Countries.json and
  // the history simulation; govType / system / partyKind / nameFlavor are ids
  // the code branches on; the party word banks compose party names that are
  // written into the saved world state, so they are proper nouns like any
  // other. Every one of these that reaches the screen is resolved through
  // powerLabel() below, from js/i18n/<lang>/plugins/Politics.json.

  // ==========================================================================
  // ROSTER_PARTIES, period party rosters for the seven hyperpowers that hold
  // real European ground (Countries.json `faction`/`controller`). Every entry
  // is a *fictionalized analogue* of a party that was standing somewhere
  // between 1984 and 2005: the name is deliberately distorted off the real one
  // (a swapped noun, a shifted adjective, an invented banner) so nothing here
  // reproduces an actual party's name or trademark, while the shape, language
  // and political slot stay recognisable enough to read as that country's
  // politics. Treat every name below as this setting's own invention.
  // `ideologyId` points at js/db/WorldGen/Ideology.json; makeParty() reads the
  // creed's own axes for the platform instead of jittering blindly off the
  // power's baseline, so a party's politics follow its creed. `founded` is a
  // plausible in-world founding year; a handful sit at 2001+ on purpose, so a
  // fresh world can seat a movement that did not exist yet.
  //
  // At most `arch.partyCount` of a hyperpower's list is ever live on any one
  // world (bootstrapPower shuffles the list per world seed and takes the
  // first partyCount), so a big roster like Italy's is a pool a world draws
  // from, not a claim that all of them govern at once.
  const ROSTER_PARTIES = {
    "Holy Vatican Empire": [
      // Italy, First Republic (closed parties, still played)
      { name: "Concordia Cristiana", country: "Italy", ideologyId: "christian_democratic", founded: 1943 },
      { name: "Partito Comunista della Penisola", country: "Italy", ideologyId: "reform_communist", founded: 1921 },
      { name: "Partito Socialista Italico", country: "Italy", ideologyId: "social_democrat", founded: 1892 },
      { name: "Moto Sociale d'Italia", country: "Italy", ideologyId: "post_fascist_revivalist", founded: 1946 },
      { name: "Partito Liberale Peninsulare", country: "Italy", ideologyId: "classical_liberal", founded: 1922 },
      { name: "Partito Repubblicano d'Italia", country: "Italy", ideologyId: "civic_republican", founded: 1895 },
      { name: "Partito Socialdemocratico Peninsulare", country: "Italy", ideologyId: "pragmatic_social_democrat", founded: 1947 },
      { name: "Partito Radicalista", country: "Italy", ideologyId: "classical_liberal", founded: 1955 },
      { name: "Democrazia dei Proletari", country: "Italy", ideologyId: "orthodox_communist", founded: 1978 },
      { name: "Partito Comunista degli Operai", country: "Italy", ideologyId: "orthodox_communist" },
      // Italy, Second Republic and new-in-2001 arrivals
      { name: "Alleanza della Nazione", country: "Italy", ideologyId: "post_fascist_revivalist", founded: 1995 },
      { name: "Lega Settentrionale", country: "Italy", ideologyId: "regionalist_separatist", founded: 1991 },
      { name: "Rifondazione dei Comunisti", country: "Italy", ideologyId: "orthodox_communist", founded: 1991 },
      { name: "Fronte Democratico della Sinistra", country: "Italy", ideologyId: "pragmatic_social_democrat", founded: 1991 },
      { name: "Sinistra Democratica Unita", country: "Italy", ideologyId: "pragmatic_social_democrat", founded: 1998 },
      { name: "Partito Popolare Peninsulare", country: "Italy", ideologyId: "christian_democratic", founded: 1994 },
      { name: "La Trama", country: "Italy", ideologyId: "civic_republican", founded: 1991 },
      { name: "Democrazia e Libertà - Il Fiordaliso", country: "Italy", ideologyId: "christian_democratic", founded: 2001 },
      { name: "Italia dei Giusti", country: "Italy", ideologyId: "law_and_order_populist", founded: 1998 },
      { name: "Partito dei Comunisti Italici", country: "Italy", ideologyId: "orthodox_communist", founded: 1998 },
      { name: "Centro Cristiano Popolare", country: "Italy", ideologyId: "christian_democratic", founded: 1994 },
      { name: "Cristiani Democratici Riuniti", country: "Italy", ideologyId: "christian_democratic", founded: 1995 },
      { name: "Unione dei Democratici Europei", country: "Italy", ideologyId: "pragmatic_social_democrat", founded: 1999 },
      { name: "Rinnovamento Peninsulare", country: "Italy", ideologyId: "technocratic_liberal", founded: 1996 },
      { name: "Moto Sociale - Fiaccola Tricolore", country: "Italy", ideologyId: "post_fascist_revivalist", founded: 1995 },
      { name: "Vigore Nuovo", country: "Italy", ideologyId: "post_fascist_revivalist", founded: 1997 },
      { name: "Radicali Peninsulari", country: "Italy", ideologyId: "classical_liberal", founded: 2001 },
      { name: "Democrazia Continentale", country: "Italy", ideologyId: "christian_democratic", founded: 2001 },
      { name: "Nuovo PSP", country: "Italy", ideologyId: "social_democrat", founded: 2001 },
      { name: "Forza Nazione", country: "Italy", ideologyId: "media_theocrat", founded: 1994 },
      { name: "Federazione Verde", country: "Italy", ideologyId: "green_ecologist", founded: 1990 },
      { name: "Südtiroler Landespartei", country: "Italy", ideologyId: "regionalist_separatist", founded: 1945 },
      // Germany
      { name: "Christlich Demokratische Sammlung", country: "Germany", ideologyId: "christian_democrat", founded: 1945 },
      { name: "Christlich-Soziale Sammlung", country: "Germany", ideologyId: "christian_democrat", founded: 1945 },
      { name: "Sozialdemokratische Partei der Lande", country: "Germany", ideologyId: "social_democrat", founded: 1863 },
      { name: "Freiheitlich Demokratische Partei", country: "Germany", ideologyId: "classical_liberal", founded: 1948 },
      { name: "Bündnis 91/Die Grünen", country: "Germany", ideologyId: "green_ecologist", founded: 1993 },
      { name: "Partei des Demokratischen Sozialstaats", country: "Germany", ideologyId: "reform_communist", founded: 1990 },
      { name: "Die Republikanische Liste", country: "Germany", ideologyId: "post_fascist_revivalist", founded: 1983 },
      // Malta
      { name: "Partit tan-Nazzjon", country: "Malta", ideologyId: "christian_democrat", founded: 1880 },
      { name: "Maltese Workers' Party", country: "Malta", ideologyId: "social_democrat", founded: 1920 },
      // Portugal
      { name: "Partido Social Democrático", country: "Portugal", ideologyId: "liberal_conservative", founded: 1974 },
      { name: "Partido dos Socialistas", country: "Portugal", ideologyId: "social_democrat", founded: 1973 },
      { name: "Centro Democrático Social - Partido do Povo", country: "Portugal", ideologyId: "christian_democrat", founded: 1974 },
      { name: "Partido Comunista Lusitano", country: "Portugal", ideologyId: "orthodox_communist", founded: 1921 },
      // Spain
      { name: "Partido del Pueblo", country: "Spain", ideologyId: "liberal_conservative", founded: 1989 },
      { name: "Partido Socialista Obrero Ibérico", country: "Spain", ideologyId: "social_democrat", founded: 1879 },
      { name: "Izquierda Reunida", country: "Spain", ideologyId: "orthodox_communist", founded: 1986 },
      { name: "Convergència i Concòrdia", country: "Spain", ideologyId: "regionalist_separatist", founded: 1978 },
      { name: "Partido Nacionalista Vascón", country: "Spain", ideologyId: "regionalist_separatist", founded: 1895 },
    ],
    "USSR": [
      // Russia
      { name: "Коммунистическая партия Российских Земель", country: "Russia", ideologyId: "orthodox_communist", founded: 1993 },
      { name: "Либерально-демократический союз России", country: "Russia", ideologyId: "post_fascist_revivalist", founded: 1989 },
      { name: "Единение России", country: "Russia", ideologyId: "managed_democrat", founded: 2001 },
      { name: "Яблоня", country: "Russia", ideologyId: "social_liberal", founded: 1993 },
      { name: "Союз правых течений", country: "Russia", ideologyId: "classical_liberal", founded: 1999 },
      { name: "Наш край - Россия", country: "Russia", ideologyId: "liberal_clientelist", founded: 1995 },
      { name: "Коммунистическая партия Советских Земель", country: "Russia", ideologyId: "totalitarian_communist", founded: 1898 },
      // Serbia
      { name: "Socijalistička stranka Srbije", country: "Serbia", ideologyId: "welfare_chauvinist", founded: 1990 },
      { name: "Srpska radikalna liga", country: "Serbia", ideologyId: "post_fascist_revivalist", founded: 1991 },
      { name: "Demokratska liga", country: "Serbia", ideologyId: "civic_republican", founded: 1990 },
      { name: "Demokratska zajednica Srbije", country: "Serbia", ideologyId: "conservative_democrat", founded: 1992 },
      { name: "Srpski pokret preporoda", country: "Serbia", ideologyId: "conservative_democrat", founded: 1990 },
      // Slovakia
      { name: "Hnutie za suverénne Slovensko", country: "Slovakia", ideologyId: "welfare_chauvinist", founded: 1991 },
      { name: "Strana demokratickej roboty", country: "Slovakia", ideologyId: "reform_socialist", founded: 1991 },
      { name: "Slovenská vlastenecká strana", country: "Slovakia", ideologyId: "post_fascist_revivalist", founded: 1989 },
      { name: "Smer - sociálna obroda", country: "Slovakia", ideologyId: "social_democrat", founded: 1999 },
      { name: "Komunistická strana Slovenskej zeme", country: "Slovakia", ideologyId: "orthodox_communist", founded: 1992 },
      // Slovenia
      { name: "Liberalna zveza Slovenije", country: "Slovenia", ideologyId: "social_liberal", founded: 1994 },
      { name: "Združena lista socialnih delavcev", country: "Slovenia", ideologyId: "reform_socialist", founded: 1993 },
      { name: "Slovenska demokratska zveza", country: "Slovenia", ideologyId: "conservative_democrat", founded: 1989 },
      { name: "Slovenska kmečka stranka", country: "Slovenia", ideologyId: "agrarian_centrist", founded: 1988 },
      // Ukraine
      { name: "Комуністична партія українських земель", country: "Ukraine", ideologyId: "orthodox_communist", founded: 1993 },
      { name: "Народний поступ України", country: "Ukraine", ideologyId: "civic_republican", founded: 1989 },
      { name: "Партія країв", country: "Ukraine", ideologyId: "liberal_clientelist", founded: 2001 },
      { name: "Рідна Україна", country: "Ukraine", ideologyId: "classical_liberal", founded: 2001 },
      { name: "Соціалістичний союз України", country: "Ukraine", ideologyId: "reform_socialist", founded: 1991 },
    ],
    "Britannia": [
      // United Kingdom / Scotland
      { name: "Conservative Union", country: "UK", ideologyId: "conservative", founded: 1834 },
      { name: "Labourist Party", country: "UK", ideologyId: "new_labour", founded: 1900 },
      { name: "Liberal Democratic Alliance", country: "UK", ideologyId: "social_liberal", founded: 1988 },
      { name: "Isles Independence Party", country: "UK", ideologyId: "liberal_conservative", founded: 1993 },
      { name: "Scots National Party", country: "Scotland", ideologyId: "regionalist_separatist", founded: 1934 },
      { name: "Britannic Nationalist Party", country: "UK", ideologyId: "post_fascist_revivalist", founded: 1982 },
      { name: "Plaid y Werin", country: "UK", ideologyId: "regionalist_separatist", founded: 1925 },
      { name: "Plebiscite Party", country: "UK", ideologyId: "constitutionalist", founded: 1994 },
      { name: "Official Monstrous Raving Loon Party", country: "UK", ideologyId: "civic_republican", founded: 1983 },
      { name: "Scots Socialist Party", country: "Scotland", ideologyId: "trade_unionist", founded: 1998 },
      { name: "Green Alliance (England and Wales)", country: "UK", ideologyId: "green_ecologist", founded: 1990 },
      // France
      { name: "Rassemblement pour la Nation", country: "France", ideologyId: "conservative_democrat", founded: 1976 },
      { name: "Union pour la Démocratie Républicaine", country: "France", ideologyId: "liberal_conservative", founded: 1978 },
      { name: "Parti des Socialistes", country: "France", ideologyId: "social_democrat", founded: 1969 },
      { name: "Parti Communiste Ouvrier Français", country: "France", ideologyId: "reform_communist", founded: 1920 },
      { name: "Front de la Nation", country: "France", ideologyId: "welfare_chauvinist", founded: 1972 },
      { name: "Les Verdoyants", country: "France", ideologyId: "green_ecologist", founded: 1984 },
      { name: "Union pour un Mouvement du Peuple", country: "France", ideologyId: "liberal_conservative", founded: 2002 },
      { name: "Mouvement Citoyen", country: "France", ideologyId: "civic_republican", founded: 1993 },
    ],
    "Archive Foundation": [
      // Luxembourg
      { name: "Chrëschtlech Sozial Vollekslëscht", country: "Luxembourg", ideologyId: "christian_democrat", founded: 1944 },
      { name: "Lëtzebuerger Sozialistesch Schafferpartei", country: "Luxembourg", ideologyId: "social_democrat", founded: 1902 },
      { name: "Demokratesch Lëscht", country: "Luxembourg", ideologyId: "classical_liberal", founded: 1945 },
      { name: "Déi Grénglëscht", country: "Luxembourg", ideologyId: "green_ecologist", founded: 1983 },
      { name: "Kommunistesch Liga Lëtzebuerg", country: "Luxembourg", ideologyId: "orthodox_communist", founded: 1921 },
      { name: "Alternativ Demokratesch Reformlëscht", country: "Luxembourg", ideologyId: "agrarian_centrist", founded: 1987 },
    ],
    "Ottoman Empire": [
      // Turkey
      { name: "Anayurt Partisi", country: "Turkey", ideologyId: "liberal_conservative", founded: 1983 },
      { name: "Doğru İz Partisi", country: "Turkey", ideologyId: "liberal_conservative", founded: 1983 },
      { name: "Bereket Partisi", country: "Turkey", ideologyId: "islamist", founded: 1983 },
      { name: "Erdem Partisi", country: "Turkey", ideologyId: "moderate_islamist", founded: 1997 },
      { name: "Adalet ve Yükseliş Partisi", country: "Turkey", ideologyId: "moderate_islamist", founded: 2001 },
      { name: "Huzur Partisi", country: "Turkey", ideologyId: "islamist", founded: 2001 },
      { name: "Milliyetçi Atılım Partisi", country: "Turkey", ideologyId: "young_turk_nationalist", founded: 1985 },
      { name: "Cumhuriyetçi Ulus Partisi", country: "Turkey", ideologyId: "kemalist", founded: 1923 },
      { name: "Demokratik Sol Hareket", country: "Turkey", ideologyId: "kemalist", founded: 1985 },
      // Morocco
      { name: "Hizb al-Siyada", country: "Morocco", ideologyId: "conservative_democrat", founded: 1944 },
      { name: "Union Socialiste des Forces du Peuple", country: "Morocco", ideologyId: "social_democrat", founded: 1975 },
      { name: "Parti de la Justice et du Renouveau", country: "Morocco", ideologyId: "moderate_islamist", founded: 1998 },
      { name: "Rassemblement National des Autonomes", country: "Morocco", ideologyId: "liberal_conservative", founded: 1978 },
      { name: "Mouvement du Peuple", country: "Morocco", ideologyId: "agrarian_centrist", founded: 1957 },
      // Tunisia
      { name: "Rassemblement Constitutionnel Républicain", country: "Tunisia", ideologyId: "managed_democrat", founded: 1988 },
      { name: "Mouvement des Socialistes Démocrates", country: "Tunisia", ideologyId: "social_democrat", founded: 1978 },
      { name: "Mouvement Es-Sahwa", country: "Tunisia", ideologyId: "islamist", founded: 1981 },
      { name: "Union Démocratique Unitaire", country: "Tunisia", ideologyId: "civic_republican", founded: 1988 },
    ],
    "San Marino Republic": [
      { name: "Partito Democratico Cristiano del Titano", country: "San Marino", ideologyId: "christian_democratic", founded: 1948 },
      { name: "Partito Socialista del Titano", country: "San Marino", ideologyId: "social_democrat", founded: 1892 },
      { name: "Partito Progressista Democratico del Titano", country: "San Marino", ideologyId: "reform_communist", founded: 1990 },
      { name: "Alleanza Popolare del Monte", country: "San Marino", ideologyId: "liberal_conservative", founded: 1993 },
      { name: "Sinistra Riunita Sammarinese", country: "San Marino", ideologyId: "reform_socialist", founded: 1993 },
      { name: "Rifondazione Comunista del Titano", country: "San Marino", ideologyId: "orthodox_communist", founded: 1992 },
    ],
    "Hypercapitalist Collective": [
      // Netherlands
      { name: "Volkspartij voor Vrijheid en Welvaart", country: "Netherlands", ideologyId: "classical_liberal", founded: 1948 },
      { name: "Democraten 67", country: "Netherlands", ideologyId: "social_liberal", founded: 1966 },
      { name: "Christen-Democratisch Verbond", country: "Netherlands", ideologyId: "christian_democrat", founded: 1980 },
      { name: "Partij van het Werk", country: "Netherlands", ideologyId: "social_democrat", founded: 1946 },
      { name: "Lijst Vermeulen", country: "Netherlands", ideologyId: "welfare_chauvinist", founded: 2002 },
      { name: "Socialistische Volkspartij", country: "Netherlands", ideologyId: "trade_unionist", founded: 1971 },
      { name: "GroenVerbond", country: "Netherlands", ideologyId: "green_ecologist", founded: 1990 },
    ],
  };

  const ARCHETYPES = {
    "Holy Vatican Empire": {
      govType: "theocracy", system: "conclave", headTitle: "Supreme Pontifex",
      legislature: "Holy Curia", partyKind: "order", seats: 120, termDays: 2920,
      electorCount: 21, electorTitle: "Cardinal",
      baseline: { econ: 10, auth: 55, trad: 85, mil: 20, myst: 90 },
      partyCount: 4, rigging: 0.2, coupSusceptibility: 0.4, scandalSensitivity: 1.4,
      nameFlavor: "clerical",
      partyBank: { real: ROSTER_PARTIES["Holy Vatican Empire"] },
    },
    "USSR": {
      govType: "single-party state", system: "plenum", headTitle: "General Secretary",
      legislature: "Supreme Soviet", partyKind: "faction", seats: 1500, termDays: 1825,
      electorCount: 12, electorTitle: "Politburo Member",
      baseline: { econ: -85, auth: 70, trad: -20, mil: 55, myst: -80 },
      partyCount: 3, rigging: 0.85, coupSusceptibility: 1.2, scandalSensitivity: 0.5,
      nameFlavor: "soviet",
      partyBank: { real: ROSTER_PARTIES["USSR"] },
    },
    "Britannia": {
      govType: "parliamentary monarchy", system: "parliamentary", headTitle: "Prime Minister",
      legislature: "Parliament", partyKind: "party", seats: 650, termDays: 1460,
      baseline: { econ: 35, auth: 10, trad: 40, mil: 25, myst: -30 },
      partyCount: 4, rigging: 0, coupSusceptibility: 0.2, scandalSensitivity: 1.2,
      nameFlavor: "british",
      partyBank: { real: ROSTER_PARTIES["Britannia"] },
    },
    "Archive Foundation": {
      govType: "technocracy", system: "examination", headTitle: "First Archivist",
      legislature: "Index Council", partyKind: "school", seats: 88, termDays: 2190,
      baseline: { econ: 0, auth: 35, trad: -40, mil: -20, myst: 25 },
      partyCount: 3, rigging: 0.1, coupSusceptibility: 0.3, scandalSensitivity: 1.0,
      nameFlavor: "archivist",
      partyBank: { real: ROSTER_PARTIES["Archive Foundation"] },
    },
    "Ottoman Empire": {
      govType: "sultanate", system: "succession", headTitle: "Sultan",
      legislature: "Divan", partyKind: "court faction", seats: 40, termDays: 3650,
      baseline: { econ: 20, auth: 65, trad: 70, mil: 50, myst: 45 },
      partyCount: 3, rigging: 0.6, coupSusceptibility: 0.9, scandalSensitivity: 0.7,
      nameFlavor: "ottoman",
      partyBank: { real: ROSTER_PARTIES["Ottoman Empire"] },
    },
    "The Gods": {
      govType: "divine pantheon", system: "tournament", headTitle: "Prime Deity",
      legislature: "Celestial Court", partyKind: "house", seats: 12, termDays: 4380,
      baseline: { econ: 0, auth: 40, trad: 60, mil: 40, myst: 100 },
      partyCount: 4, rigging: 0, coupSusceptibility: 0.6, scandalSensitivity: 0.9,
      nameFlavor: "divine",
      partyBank: { pre: ["House of", "Choir of", "Court of", "Host of"],
                   post: ["Thunder", "the Veiled Moon", "Embers", "the Deep Tide", "Whispered Fates", "the Iron Sky"] },
    },
    "San Marino Republic": {
      govType: "serene republic", system: "parliamentary", headTitle: "Captain Regent",
      legislature: "Grand Council", partyKind: "party", seats: 60, termDays: 182, // two Captains Regent, six-month terms
      baseline: { econ: 25, auth: -25, trad: 30, mil: -40, myst: 0 },
      partyCount: 5, rigging: 0, coupSusceptibility: 0.1, scandalSensitivity: 1.1,
      nameFlavor: "sammarinese",
      partyBank: { real: ROSTER_PARTIES["San Marino Republic"] },
    },
    "Hypercapitalist Collective": {
      govType: "corporatocracy", system: "shareholder", headTitle: "Chief Executive Sovereign",
      legislature: "The Board", partyKind: "bloc", seats: 100, termDays: 365, // annual general meeting
      baseline: { econ: 95, auth: 30, trad: -30, mil: 10, myst: -60 },
      partyCount: 4, rigging: 0.15, coupSusceptibility: 0.5, scandalSensitivity: 0.8,
      nameFlavor: "corporate",
      partyBank: { real: ROSTER_PARTIES["Hypercapitalist Collective"] },
    },
    "The Tourists": {
      govType: "caste hierarchy", system: "conclave", headTitle: "Tour Director",
      legislature: "The Itinerary", partyKind: "caste", seats: 33, termDays: 730,
      electorCount: 15, electorTitle: "Overseer",
      baseline: { econ: 20, auth: 45, trad: -60, mil: 30, myst: 40 },
      partyCount: 3, rigging: 0.35, coupSusceptibility: 0.3, scandalSensitivity: 0.6,
      nameFlavor: "zeta",
      partyBank: { pre: ["Caste of the", "Excursion of the", "Delegation of the", "Party of the"],
                   post: ["Open Shutter", "Red Scalpel", "Folded Mind", "Long Weekend", "Kind Regard", "Quiet Probe"] },
    },
    "The Dargos": {
      govType: "practical joke", system: "moot", headTitle: "First Dargos",
      legislature: "The Bit", partyKind: "routine", seats: 9, termDays: 400,
      baseline: { econ: 0, auth: -20, trad: -40, mil: 10, myst: 70 },
      partyCount: 3, rigging: 0.5, coupSusceptibility: 1.1, scandalSensitivity: 0.1,
      nameFlavor: "dargos",
      partyBank: { pre: ["The", "The Very", "The Alleged", "The Second"],
                   post: ["Long Con", "Straight Face", "Callback", "Slow Burn", "Running Gag", "Punchline"] },
    },
    "Goblin Horde": {
      govType: "warband confederacy", system: "moot", headTitle: "Big Boss",
      legislature: "Da Moot", partyKind: "clan", seats: 30, termDays: 300, // until someone bigger shows up
      baseline: { econ: -30, auth: 50, trad: 20, mil: 90, myst: 35 },
      partyCount: 4, rigging: 0, coupSusceptibility: 1.6, scandalSensitivity: 0.2,
      nameFlavor: "goblin",
      partyBank: { pre: ["Skull", "Rot", "Mud", "Fang", "Grub"],
                   post: ["splitta Clan", "gut Clan", "stompa Clan", "biter Clan", "chewa Clan", "smasha Clan"] },
    },
  };

  // Unknown hyperpowers (modded Countries.json) get a seeded generic republic.
  const FALLBACK_ARCHETYPE = {
    govType: "republic", system: "parliamentary", headTitle: "President",
    legislature: "Assembly", partyKind: "party", seats: 200, termDays: 1460,
    baseline: { econ: 0, auth: 0, trad: 0, mil: 0, myst: 0 },
    partyCount: 3, rigging: 0, coupSusceptibility: 0.5, scandalSensitivity: 1.0,
    nameFlavor: "generic",
    partyBank: { pre: ["United", "Free", "National", "Popular"],
                 post: ["Front", "Alliance", "League", "Union", "Movement"] },
  };

  // Some Countries.json entries spell the same power differently.
  const FACTION_ALIASES = { "Soviet Union": "USSR" };

  // Powers that hold no ground on this planet. Every other hyperpower is
  // discovered from Countries.json, which is a map of Earth and can therefore
  // never name one of these: they are registered here instead, with the worlds
  // they hold standing in for member countries, so a government, an electorate,
  // a run of elections and a wiki article are built for them exactly as for
  // Britannia. The names are the keys of js/db/WorldGen/Hyperpowers.json.
  const OFFWORLD_POWERS = {
    "The Tourists": ["Zeta Reticuli A", "Zeta Reticuli B"],
    "The Dargos":   ["Titania"],
  };
  // i18n-ignore-end

  // ==========================================================================
  // NAME BANKS, politicians per flavor
  // ==========================================================================

  // i18n-ignore-start: politician names are composed once and stored on the
  // saved record, so they are proper nouns and never translated, exactly like
  // the NPCPools rosters.
  const NAME_BANKS = {
    clerical: {
      title: ["Cardinal", "Monsignor", "Abbot", "Prioress", "Vicar"],
      first: ["Anselm", "Benedicta", "Clemens", "Dominika", "Egidio", "Fulgenzio", "Gregoria", "Hyacinth", "Innocenzo", "Lucilla", "Pius", "Severina"],
      last:  ["di Castello", "Vetrari", "Santangelo", "Beneventi", "del Rosario", "Calvino", "Aldobrandi", "Fioravanti"],
    },
    soviet: {
      title: ["Comrade", "Commissar", "Marshal", "Director"],
      first: ["Anatoli", "Bohdana", "Dmitri", "Galina", "Iosif", "Katarina", "Lev", "Mira", "Nikolai", "Oksana", "Pavel", "Svetlana", "Vasili", "Yelena"],
      last:  ["Stalvik", "Orlov", "Kuznetsova", "Brezhko", "Malenkov", "Tereshkova", "Ferrum", "Zhdanova", "Petrenko", "Volkov"],
    },
    british: {
      title: ["Lord", "Lady", "Sir", "Dame", "The Rt. Hon."],
      first: ["Alistair", "Beatrice", "Clive", "Dorothea", "Edmund", "Felicity", "Gerald", "Harriet", "Ignatius", "Josephine", "Mortimer", "Penelope"],
      last:  ["Ashworth", "Blackwood", "Carmichael", "Davenport", "Featherstone", "Greystoke", "Hollingsworth", "Pemberton", "Sinclair", "Thistlewood"],
    },
    archivist: {
      title: ["Archivist", "Indexer", "Curator", "Lector", "Registrar"],
      first: ["Aleph", "Brevia", "Codex", "Delia", "Errat", "Folio", "Glossa", "Hilbert", "Iota", "Lemma", "Margin", "Quarto", "Vellum"],
      last:  ["of Stack Nine", "of the Cold Shelf", "of Reading Room IV", "of the Locked Annex", "of Acquisitions", "of the Long Index", "of Preservation", "of Catalogue Zero"],
    },
    ottoman: {
      title: ["Pasha", "Vizier", "Bey", "Hanim", "Agha"],
      first: ["Aydin", "Belkis", "Cem", "Dilara", "Emre", "Feride", "Halil", "Iskender", "Leyla", "Murad", "Nilufer", "Orhan", "Selim", "Zeynep"],
      last:  ["of the Golden Horn", "the Magnificent", "the Quiet", "of the Tulip Court", "the Mapmaker", "of Smyrna", "the Falconer", "of the Velvet Divan"],
    },
    divine: {
      title: ["", "", "", ""],
      first: ["Aurvang", "Belisaria", "Cthonis", "Dawnmaker", "Erebh", "Fulmina", "Ghorvad", "Hyalith", "Ilmarra", "Khoros", "Lethiel", "Morvandra", "Nyxion", "Ophira", "Pyrrhast", "Selunara", "Thandros", "Umbriel", "Vorthane", "Zephyrelle"],
      last:  ["the Thrice-Crowned", "of the Last Door", "Stormtender", "the Unblinking", "of Forgotten Rivers", "Worldcarver", "the Patient Flame", "of the Hollow Star", "Oathkeeper", "the Many-Handed"],
    },
    sammarinese: {
      title: ["Don", "Donna", "Maestro", "Dottore", "Dottoressa"],
      first: ["Arianna", "Bartolomeo", "Cesare", "Delfina", "Ercole", "Fiorella", "Gianmarco", "Isotta", "Lorenzo", "Marinella", "Ottavio", "Speranza"],
      last:  ["Titano", "Balestrieri", "Montale", "Serravalle", "Faetano", "Borgomaggiore", "Acquaviva", "Chiesanuova"],
    },
    corporate: {
      title: ["CEO", "CFO", "Director", "VP", "Chairperson"],
      first: ["Aria", "Blake", "Cassius", "Delphine", "Everett", "Fallon", "Grayson", "Harlow", "Indra", "Jaxon", "Kendall", "Lennox", "Marlowe", "Sterling"],
      last:  ["Vance-Holdings", "Quarterly", "Margin", "Blackrock", "Ledgerman", "Synergy", "Acquira", "Dividenda", "Mercer-Yield", "Optimasse"],
    },
    goblin: {
      title: ["Boss", "Warboss", "Shaman", "Chief", "Loota"],
      first: ["Grik", "Snaga", "Zog", "Mok", "Urgha", "Skab", "Nazgit", "Throk", "Grubna", "Wort", "Izzik", "Bogrot"],
      last:  ["Skullsplitta", "da Biter", "Three-Teef", "Wolfpig-Rida", "da Sneaky", "Ironchewa", "Mudfist", "da Loud", "Squigbreff", "Stabba"],
    },
    zeta: {
      title: ["Overseer", "Analyzer", "Warper", "Guide", "Ambassador"],
      first: ["Zyx-7", "Qel-9", "Vrax-3", "Klix-5", "Hlee-2", "Omm-4", "Vess-1", "Thruun-8", "Iisha-6", "Nuu-11", "Sset-13", "Ilka-17", "Praa-19", "Oxx-23"],
      last:  ["of the Open Shutter", "of the Red Scalpel", "of the Folded Mind", "of the Long Weekend", "of the Quiet Probe", "of the Kind Regard", "of the Second Landing", "of the Third Reticulum"],
    },
    dargos: {
      title: ["Regent", "Clerk", "Marshal", "Envoy", ""],
      first: ["Obb", "Wodwod", "Ssein", "Grunnu", "Habb", "Ilfo", "Nnok", "Purr", "Tebbe", "Ulgu"],
      last:  ["the Unserious", "of the Long Con", "who Waits", "the Straight-Faced", "of Titania", "the Callback", "who Means It", "of the Acid Shore"],
    },
    generic: {
      title: ["Hon.", "Senator", "Deputy", "Minister"],
      first: ["Adrian", "Bianca", "Casimir", "Daria", "Emil", "Franka", "Gustave", "Helena", "Ivo", "Jana", "Karl", "Lena"],
      last:  ["Varga", "Novak", "Lindqvist", "Moreau", "Keller", "Sokolov", "Brandt", "Costa", "Vidal", "Hoffmann"],
    },
  };

  // i18n-ignore-end

  // ==========================================================================
  // SHARED UTILITIES (see NPCShared.js)
  // ==========================================================================

  const { nameHash, Rng: PolRng, worldSeed, sampleCount, clamp, ideologyById, seededShuffle } = window.NPCShared;

  // ==========================================================================
  // DISPLAY TEXT
  // ==========================================================================
  // Every archetype field above is an id AND a label. The id stays in the
  // record (other systems match on it and old saves carry it); the label is
  // resolved here, per power, at the moment it is drawn.

  const powerSlug = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  function powerLabel(power, field) {
    if (!power) return "";
    const key = "Politics.power." + powerSlug(power.name) + "." + field;
    if (T.has(key)) return T(key);
    const generic = "Politics.power.default." + field;
    if (T.has(generic)) return T(generic);
    return power[field] || "";
  }

  // A line the simulation wrote into the world state. Newer records hold
  // { key, params, count }; anything written before this file was localized
  // holds a finished English string, which is returned as it stands.
  function textOf(entry) {
    if (!entry) return "";
    if (typeof entry === "string") return entry;
    if (!entry.key) return entry.desc || "";
    if (!T.has(entry.key)) return entry.desc || "";
    return entry.count != null
      ? T.n(entry.key, entry.count, entry.params || {})
      : T(entry.key, entry.params || {});
  }

  const officeLabel = (office) => {
    const key = "Politics.office." + office;
    return T.has(key) ? T(key) : String(office || "");
  };

  // A politician's `office` field holds whichever of the power's own titles
  // they answer to, or a plain state like "deposed". All of them are ids.
  function politicianOffice(power, pol) {
    if (!pol || !pol.office) return "";
    if (power && pol.office === power.headTitle) return powerLabel(power, "headTitle");
    if (power && pol.office === power.electorTitle) return powerLabel(power, "electorTitle");
    const key = "Politics.officeState." + pol.office;
    return T.has(key) ? T(key) : String(pol.office);
  }

  // How a head of state came to the office, as stored on the reign pocket.
  const accessionLabel = (how) => {
    const key = "Politics.accession." + how;
    return T.has(key) ? T(key) : String(how || "?");
  };

  // ==========================================================================
  // TIME HELPERS
  // ==========================================================================

  const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

  function yearFloatOf(minute) { return EPOCH_YEAR + minute / MINUTES_PER_YEAR; }
  function yearOf(minute) { return Math.floor(yearFloatOf(minute)); }

  function dateStrOf(minute) {
    const d = new Date(EPOCH_YEAR, 0, 1, 10, 0, 0);
    d.setMinutes(d.getMinutes() + minute);
    return `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function nowMinuteVar() {
    return $gameVariables ? ($gameVariables.value(114) || 0) : 0;
  }

  // ==========================================================================
  // DATA ACCESS
  // ==========================================================================

  function getCountries() {
    const c = window.WorldGen?.Countries;
    return Array.isArray(c) ? c : [];
  }

  function getState() {
    if (!$gameSystem) return null;
    if (!$gameSystem._npcPolitics) {
      $gameSystem._npcPolitics = {
        version: 1,
        lastSimMinute: null,
        powers: {},        // powerName → power state
        identities: {},    // npcName  → political identity
        settlements: {},   // groupName → local offices
      };
    }
    return $gameSystem._npcPolitics;
  }

  function getProfile(name) {
    return $gameSystem?._npcSociety?.[name] ?? null;
  }

  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function canonicalFaction(name) {
    const n = String(name || "").trim();
    return FACTION_ALIASES[n] || n;
  }

  // name → home group, harvested from each group's NPC template pool
  // (same approach as NPCLifeSimulator.collectPopulation).
  let _populationCache = null;
  let _populationCacheKey = "";

  function collectPopulation() {
    const groups = $gameSystem?._npcMapGroups || {};
    const society = $gameSystem?._npcSociety || {};
    const groupNames = Object.keys(groups);
    const cacheKey = groupNames.join("|") + "::" + Object.keys(society).length;
    if (_populationCache && _populationCacheKey === cacheKey) return _populationCache;

    const population = {}; // name → groupName
    for (const groupName of groupNames) {
      let pool = [];
      try { pool = window.NPCSystem?.getNPCPool?.(groupName) || []; } catch (_) { pool = []; }
      for (const tpl of pool) {
        const evName = tpl?.eventData?.name;
        if (evName && population[evName] === undefined) population[evName] = groupName;
      }
    }
    for (const [name, profile] of Object.entries(society)) {
      if (profile?._homeGroupName) population[name] = profile._homeGroupName;
      else if (population[name] === undefined) population[name] = null;
    }

    _populationCache = population;
    _populationCacheKey = cacheKey;
    return population;
  }

  // ==========================================================================
  // IDEOLOGY HELPERS
  // ==========================================================================

  function ideologyDistance(a, b) {
    let d = 0;
    for (const ax of AXES) d += Math.abs((a?.[ax] ?? 0) - (b?.[ax] ?? 0));
    return d / AXES.length; // 0..200, typically < 80
  }

  function jitterIdeology(base, rng, spread) {
    const out = {};
    for (const ax of AXES) out[ax] = clamp(Math.round((base?.[ax] ?? 0) + (rng.next() * 2 - 1) * spread), -100, 100);
    return out;
  }

  // ==========================================================================
  // POLITICIAN / PARTY FACTORIES
  // ==========================================================================

  function makePolitician(power, rng, nowMinute, opts = {}) {
    const bank = NAME_BANKS[power.nameFlavor] || NAME_BANKS.generic;
    const title = rng.pick(bank.title);
    const name = `${title ? title + " " : ""}${rng.pick(bank.first)} ${rng.pick(bank.last)}`;
    const id = `pol_${power.name.replace(/[^A-Za-z0-9]/g, "")}_${++power.politicianCounter}`; // i18n-ignore: record id
    const age = opts.age ?? rng.int(34, 72);
    power.politicians[id] = {
      id, name,
      birthYearFloat: yearFloatOf(nowMinute) - age - rng.next(),
      charisma:  rng.int(15, 95),
      integrity: rng.int(5, 95),
      cunning:   rng.int(10, 95),
      ambition:  rng.int(20, 100),
      strength:  rng.int(10, 95),   // moots
      intellect: rng.int(10, 95),   // examinations
      divinity:  rng.int(10, 95),   // ascension tournaments
      ideology:  jitterIdeology(opts.ideology || power.baseline, rng, opts.spread ?? 35),
      partyId:   opts.partyId ?? null,
      approval:  rng.int(35, 65),
      scandals:  0,
      alive:     true,
      office:    null,
    };
    return power.politicians[id];
  }

  // `realEntry`, when given, is one of ROSTER_PARTIES' curated { name, country,
  // ideologyId, founded } records: a named roster party stands in place of the
  // old procedurally-composed name, and its platform is read off the creed it
  // carries (Ideology.json) rather than jittered blindly off the power's own
  // baseline, so an opposition party can genuinely oppose.
  function makeParty(power, rng, nowMinute, index, realEntry) {
    if (realEntry) {
      const creed = ideologyById(realEntry.ideologyId);
      const platform = jitterIdeology(creed ? creed.axes : power.baseline, rng, 12);
      const id = `party_${power.name.replace(/[^A-Za-z0-9]/g, "")}_${index}`; // i18n-ignore: record id
      const foundedYear = realEntry.founded != null
        ? Math.min(realEntry.founded, yearOf(nowMinute))
        : yearOf(nowMinute) - rng.int(3, 60);
      const party = {
        id, name: realEntry.name, platform,
        country: realEntry.country || null,
        ideologyId: realEntry.ideologyId || null,
        leaderId: null,
        foundedYear,
        momentum: 0,
        seats: 0,
        lastShare: 0,
        funds: rng.int(100_000_000, 5_000_000_000),
      };
      party.leaderId = makePolitician(power, rng, nowMinute, { ideology: platform, spread: 15, partyId: id }).id;
      return party;
    }

    const bank = power.partyBank;
    const name = `${bank.pre[index % bank.pre.length]} ${rng.pick(bank.post)}`;
    const id = `party_${power.name.replace(/[^A-Za-z0-9]/g, "")}_${index}`; // i18n-ignore: record id
    const platform = jitterIdeology(power.baseline, rng, 45);
    const party = {
      id, name, platform,
      leaderId: null,
      foundedYear: yearOf(nowMinute) - rng.int(3, 60),
      momentum: 0,        // -50..+50, election swing carry-over
      seats: 0,
      lastShare: 0,
      funds: rng.int(100_000_000, 5_000_000_000),
    };
    party.leaderId = makePolitician(power, rng, nowMinute, { ideology: platform, spread: 15, partyId: id }).id;
    return party;
  }

  function politicianAge(pol, nowMinute) {
    return Math.max(0, Math.floor(yearFloatOf(nowMinute) - pol.birthYearFloat));
  }

  // A political class is never only its parties: some of the sharpest players
  // in every one of these systems answer to no faction at all. Rolled once
  // per election, at INDEPENDENT_CHANCE, into whichever engine below draws its
  // candidates from `power.parties`; `partyId: null` is already what a real
  // party-affiliated candidate holds the moment the game classes them as one,
  // so nothing downstream needs to special-case an independent (partyById,
  // the wiki, the coalition math all already read a null partyId as "none").
  const INDEPENDENT_CHANCE = 0.22;

  function spawnIndependent(power, rng, minute, spread = 45) {
    return makePolitician(power, rng, minute, { spread, partyId: null });
  }

  // Single place every politician death goes through, so the wiki can always
  // show a date (and cause) of death.
  function killPolitician(power, pol, minute, cause) {
    pol.alive = false;
    pol.deathMinute = minute;
    pol.deathDate = dateStrOf(minute);
    pol.deathCause = cause || null;
    if (pol.office === power.headTitle) pol.office = null;
  }

  // Permanent head-of-state pockets: every transfer of the top office (election,
  // coup, succession...) closes the previous reign and opens a new one.
  function recordHead(power, minute, head, how) {
    power.headHistory = power.headHistory || [];
    const prev = power.headHistory[0];
    if (prev && prev.toMinute == null) {
      prev.toMinute = minute;
      prev.endDate = dateStrOf(minute);
    }
    if (!head) return;
    if (prev && prev.polId === head.id) {
      // Same ruler confirmed in office, reopen the reign instead of stacking terms.
      prev.toMinute = null;
      prev.endDate = null;
      return;
    }
    power.headHistory.unshift({
      polId: head.id, name: head.name, title: power.headTitle,
      fromMinute: minute, date: dateStrOf(minute), how,
      toMinute: null, endDate: null,
    });
    if (power.headHistory.length > 60) power.headHistory.pop();
  }

  // ==========================================================================
  // POWER BOOTSTRAP
  // ==========================================================================

  function discoverHyperpowers() {
    const found = new Set();
    for (const c of getCountries()) {
      for (const field of ["faction", "controller"]) {
        const f = canonicalFaction(c[field]);
        if (f && f !== "Neutral") found.add(f);
      }
    }
    for (const name of Object.keys(OFFWORLD_POWERS)) found.add(name);
    return [...found].sort();
  }

  function memberCountriesOf(powerName) {
    // An offworld power's "countries" are its worlds, and no conquest on Earth
    // moves them, so they are answered before the map is consulted at all.
    if (OFFWORLD_POWERS[powerName]) return OFFWORLD_POWERS[powerName].slice();
    // Prefer the history simulation's final map: conquests/liberations during
    // world generation reassign nations between hyperpowers.
    const simStates = window.HistoryManager?.getNationsState?.() || null;
    if (simStates && Object.keys(simStates).length) {
      const owned = Object.keys(simStates)
        .filter(n => canonicalFaction(simStates[n]?.controller) === powerName);
      if (owned.length) return owned;
    }
    return getCountries()
      .filter(c => canonicalFaction(c.faction) === powerName || canonicalFaction(c.controller) === powerName)
      .map(c => c.country);
  }

  function pushPowerEvent(power, minute, type, key, params) {
    power.events.unshift({ minute, date: dateStrOf(minute), type, key, params });
    if (power.events.length > EVENT_LOG_CAP) power.events.pop();
  }

  function bootstrapPower(state, powerName, nowMinute) {
    const arch = ARCHETYPES[powerName] || FALLBACK_ARCHETYPE;
    const rng = new PolRng(worldSeed() ^ nameHash("power:" + powerName));
    const power = {
      name: powerName,
      govType: arch.govType, system: arch.system,
      headTitle: arch.headTitle, legislature: arch.legislature,
      partyKind: arch.partyKind, seats: arch.seats, termDays: arch.termDays,
      electorCount: arch.electorCount || 0, electorTitle: arch.electorTitle || "Elector", // i18n-ignore: id, drawn through powerLabel
      rigging: arch.rigging, coupSusceptibility: arch.coupSusceptibility,
      scandalSensitivity: arch.scandalSensitivity, nameFlavor: arch.nameFlavor,
      partyBank: arch.partyBank,
      baseline: jitterIdeology(arch.baseline, rng, 8),
      memberCountries: memberCountriesOf(powerName),
      politicianCounter: 0,
      politicians: {},
      parties: [],
      electors: [],          // politician ids, conclaves / plenums
      headId: null,
      rulingPartyId: null,
      coalition: [],
      state: {
        legitimacy: rng.int(40, 70), stability: rng.int(45, 75),
        unrest: rng.int(5, 30), economyMood: rng.int(40, 65),
        treasury: rng.int(100_000_000_000, 2_000_000_000_000),
      },
      policies: {
        taxRate: rng.int(8, 30), censorship: 0, conscription: 0,
        welfare: rng.int(20, 60), festivals: rng.int(20, 60), curfew: false,
      },
      electionCounter: 0,
      nextElectionMinute: null,
      termStartMinute: null,
      elections: [],
      events: [],
      rumors: [],
      headHistory: [],
    };

    // A real-party archetype is dealt a shuffle of its own historical roster
    // (seeded per world, so two worlds can seat different governing parties),
    // and only the first partyCount are ever live at once.
    const realPool = arch.partyBank && Array.isArray(arch.partyBank.real) && arch.partyBank.real.length
      ? seededShuffle(arch.partyBank.real, rng)
      : null;
    for (let i = 0; i < arch.partyCount; i++) {
      power.parties.push(makeParty(power, rng, nowMinute, i, realPool ? realPool[i % realPool.length] : null));
    }

    // Elite electorate for conclave/plenum systems
    for (let i = 0; i < power.electorCount; i++) {
      const elector = makePolitician(power, rng, nowMinute, { spread: 25 });
      elector.office = power.electorTitle;
      power.electors.push(elector.id);
    }

    // Policies start aligned with the seeded ruling platform (set below).
    const termMinutes = power.termDays * MINUTES_PER_DAY;

    // Seed two past elections so the world starts with political history,
    // then schedule the next one, possibly already due, which the catch-up
    // loop will resolve naturally.
    let electionMinute = nowMinute - 2 * termMinutes;
    for (let i = 0; i < 2; i++) {
      resolveElection(state, power, electionMinute, rng, { historical: true });
      electionMinute += termMinutes;
    }
    power.nextElectionMinute = electionMinute;

    pushPowerEvent(power, nowMinute, "founding", "Politics.event.founding", {
      power: powerName,
      govType: powerLabel(power, "govType"),
      n: power.memberCountries.length,
    });
    state.powers[powerName] = power;
    return power;
  }

  function ensurePowers(state, nowMinute) {
    for (const powerName of discoverHyperpowers()) {
      if (!state.powers[powerName]) bootstrapPower(state, powerName, nowMinute);
    }
  }

  // ==========================================================================
  // ELECTION ENGINES
  // ==========================================================================

  function pushElection(power, record) {
    power.elections.unshift(record);
    if (power.elections.length > ELECTION_LOG_CAP) power.elections.pop();
  }

  function partyById(power, id) {
    return power.parties.find(p => p.id === id) || null;
  }

  function scandalPenalty(pol) {
    return 1 / (1 + 0.25 * (pol?.scandals ?? 0));
  }

  // Local NPC ballots: every identity sworn to this power may turn out and
  // vote for the platform nearest their own ideology. Returns partyId → votes
  // and stamps votedLast on each voter.
  function collectNpcBallots(state, power, minute, electionIdx) {
    const ballots = {};
    let voters = 0;
    for (const [npcName, identity] of Object.entries(state.identities)) {
      if (identity.power !== power.name) continue;
      const rng = new PolRng(worldSeed() ^ nameHash(npcName) ^ (minute >>> 0));
      const turnoutChance = clamp(identity.engagement / 100 + 0.15, 0.05, 0.95);
      if (rng.next() > turnoutChance) continue;
      let best = null, bestD = Infinity;
      for (const party of power.parties) {
        const d = ideologyDistance(identity.ideology, party.platform)
          - (power.politicians[party.leaderId]?.charisma ?? 50) * 0.05
          - (identity.partyId === party.id ? 6 : 0);
        if (d < bestD) { bestD = d; best = party; }
      }
      if (!best) continue;
      ballots[best.id] = (ballots[best.id] || 0) + 1;
      voters++;
      identity.votedLast = { minute, electionIdx, partyId: best.id, power: power.name };
    }
    return { ballots, voters };
  }

  // Largest-remainder seat allocation (share is in percent).
  function allocateSeats(results, totalSeats) {
    let assigned = 0;
    const remainders = [];
    for (const r of results) {
      const exact = (r.share / 100) * totalSeats;
      r.seats = Math.floor(exact);
      assigned += r.seats;
      remainders.push([exact - r.seats, r]);
    }
    remainders.sort((a, b) => b[0] - a[0]);
    for (let i = 0; assigned < totalSeats && i < remainders.length; i++, assigned++) remainders[i][1].seats++;
  }

  const ElectionEngines = {
    // --- Popular vote with seats, coalitions, NPC ballots -------------------
    parliamentary(state, power, minute, rng, record) {
      const incumbent = power.rulingPartyId;
      const scores = power.parties.map(party => {
        const leader = power.politicians[party.leaderId];
        let s = Math.exp(-ideologyDistance(power.baseline, party.platform) / 40);
        s *= 1 + (leader?.charisma ?? 50) / 200;
        s *= 1 + party.momentum / 120;
        s *= scandalPenalty(leader);
        if (party.id === incumbent) {
          s *= power.state.legitimacy > 55 ? 1.18 : power.state.legitimacy < 40 ? 0.78 : 1;
        }
        s *= 0.8 + rng.next() * 0.4;
        return { party, s };
      });

      const { ballots, voters } = collectNpcBallots(state, power, minute, record.idx);
      const synthTotal = 2000;
      const sSum = scores.reduce((a, x) => a + x.s, 0) || 1;
      const tally = {};
      for (const { party, s } of scores) tally[party.id] = (s / sSum) * synthTotal;
      for (const [pid, v] of Object.entries(ballots)) tally[pid] = (tally[pid] || 0) + v * 3;
      const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;

      record.results = power.parties
        .map(p => ({ partyId: p.id, name: p.name, share: +(100 * (tally[p.id] || 0) / total).toFixed(1), seats: 0 }))
        .sort((a, b) => b.share - a.share);
      allocateSeats(record.results, power.seats);

      record.turnout = clamp(Math.round(45 + power.state.unrest * 0.25 + rng.int(-5, 10)), 30, 95);
      record.npcVoters = voters;

      const winner = record.results[0];
      const winnerParty = partyById(power, winner.partyId);
      power.coalition = [winner.partyId];
      let seatSum = winner.seats;
      if (seatSum <= power.seats / 2) {
        const others = record.results.slice(1)
          .sort((a, b) => ideologyDistance(winnerParty.platform, partyById(power, a.partyId).platform)
                        - ideologyDistance(winnerParty.platform, partyById(power, b.partyId).platform));
        for (const o of others) {
          if (seatSum > power.seats / 2) break;
          power.coalition.push(o.partyId);
          seatSum += o.seats;
          record.notes.push({ key: "Politics.note.coalition", params: { party: o.name } });
        }
      }
      this._installWinner(power, minute, winnerParty, record);
      for (const r of record.results) {
        const p = partyById(power, r.partyId);
        p.seats = r.seats; p.lastShare = r.share;
        p.momentum = clamp(p.momentum * 0.5 + (r.partyId === winner.partyId ? 12 : -6), -50, 50);
      }
    },

    // --- Elite electors, multiple ballots, life-flavored term ---------------
    conclave(state, power, minute, rng, record) {
      let candidates = power.parties.map(p => power.politicians[p.leaderId]).filter(p => p && p.alive);
      const electors = power.electors.map(id => power.politicians[id]).filter(p => p && p.alive);
      // Electors are already independent (no order/brotherhood behind them,
      // see bootstrapPower); one may stand as papabile in their own right
      // rather than behind a party's own nominee. An elector's ideology
      // clusters close to every other elector's by construction, which is
      // exactly the compromise-candidate advantage a real conclave gives an
      // outsider, so this is deliberately a real chance and not a token one.
      if (electors.length && rng.next() < INDEPENDENT_CHANCE) {
        const outsider = rng.pick(electors);
        if (!candidates.includes(outsider)) candidates = candidates.concat([outsider]);
      }
      const support = {};
      for (const c of candidates) support[c.id] = 0;
      let ballotCount = 0, winnerPol = null;
      for (ballotCount = 1; ballotCount <= 7; ballotCount++) {
        for (const c of candidates) support[c.id] = 0;
        for (const elector of electors) {
          let best = null, bestS = -Infinity;
          for (const c of candidates) {
            const s = -ideologyDistance(elector.ideology, c.ideology)
              + c.cunning * 0.3 + c.ambition * 0.1
              + ballotCount * (support[c.id] || 0) * 0.4   // bandwagon over ballots
              + rng.next() * 14;
            if (s > bestS) { bestS = s; best = c; }
          }
          if (best) support[best.id]++;
        }
        const sorted = candidates.slice().sort((a, b) => support[b.id] - support[a.id]);
        if (support[sorted[0].id] >= Math.ceil(electors.length * 2 / 3)) { winnerPol = sorted[0]; break; }
        winnerPol = sorted[0]; // plurality fallback if no supermajority by ballot 7
      }
      record.notes.push({
        key: "Politics.note.conclaveBallots",
        count: Math.min(ballotCount, 7),
        params: { electors: powerLabel(power, "electorTitlePlural") },
      });
      const totalVotes = electors.length || 1;
      record.results = candidates
        .map(c => ({ candidateId: c.id, name: c.name, partyId: c.partyId, share: +(100 * (support[c.id] || 0) / totalVotes).toFixed(1) }))
        .sort((a, b) => b.share - a.share);
      this._installWinner(power, minute, partyById(power, winnerPol.partyId), record, winnerPol);
    },

    // --- Rigged plenum: incumbent usually survives; purges otherwise --------
    plenum(state, power, minute, rng, record) {
      const incumbentParty = partyById(power, power.rulingPartyId) || power.parties[0];
      const incumbentHoldChance = power.rigging * clamp(power.state.legitimacy / 60, 0.3, 1.2);
      let winnerParty = incumbentParty;
      if (rng.next() > incumbentHoldChance) {
        const rivals = power.parties.filter(p => p !== incumbentParty);
        winnerParty = rivals.length ? rng.pick(rivals) : incumbentParty;
        if (winnerParty !== incumbentParty) {
          record.notes.push({
            key: "Politics.note.purged",
            params: { party: incumbentParty.name, legislature: powerLabel(power, "legislature") },
          });
          const oldLeader = power.politicians[incumbentParty.leaderId];
          if (oldLeader) { oldLeader.approval = clamp(oldLeader.approval - 30, 0, 100); oldLeader.office = "disgraced"; }
        }
      }
      const officialShare = 96 + rng.next() * 3.9;
      record.results = power.parties
        .map(p => ({ partyId: p.id, name: p.name, share: p === winnerParty ? +officialShare.toFixed(1) : +((100 - officialShare) / Math.max(1, power.parties.length - 1)).toFixed(1) }))
        .sort((a, b) => b.share - a.share);
      record.turnout = 99;
      record.notes.push({ key: "Politics.note.officialResults" });
      // Attendance is mandatory and the ballot arrives pre-filled.
      for (const identity of Object.values(state.identities)) {
        if (identity.power !== power.name) continue;
        identity.votedLast = { minute, electionIdx: record.idx, partyId: winnerParty.id, power: power.name };
      }
      this._installWinner(power, minute, winnerParty, record);
    },

    // --- Wealth-weighted shareholder meeting ---------------------------------
    shareholder(state, power, minute, rng, record) {
      const tally = {};
      for (const party of power.parties) {
        const leader = power.politicians[party.leaderId];
        tally[party.id] = party.funds * (1 + (leader?.cunning ?? 50) / 150) * scandalPenalty(leader) * (0.8 + rng.next() * 0.4);
      }
      // NPC shareholders vote their wallets
      let voters = 0;
      for (const [npcName, identity] of Object.entries(state.identities)) {
        if (identity.power !== power.name) continue;
        const money = getProfile(npcName)?.money ?? 100;
        let best = null, bestD = Infinity;
        for (const party of power.parties) {
          const d = ideologyDistance(identity.ideology, party.platform);
          if (d < bestD) { bestD = d; best = party; }
        }
        if (best) { tally[best.id] += Math.sqrt(Math.max(1, money)); voters++; }
        identity.votedLast = { minute, electionIdx: record.idx, partyId: best?.id ?? null, power: power.name };
      }
      const total = Object.values(tally).reduce((a, b) => a + b, 0) || 1;
      record.results = power.parties
        .map(p => ({ partyId: p.id, name: p.name, share: +(100 * tally[p.id] / total).toFixed(1) }))
        .sort((a, b) => b.share - a.share);
      record.turnout = clamp(rng.int(55, 90), 0, 100);
      record.npcVoters = voters;
      record.notes.push({ key: "Politics.note.oneCreditOneVote" });
      const winnerParty = partyById(power, record.results[0].partyId);
      winnerParty.funds += Math.round(power.state.treasury * 0.05);
      this._installWinner(power, minute, winnerParty, record);
    },

    // --- Strength contest; losing finalist may be eaten ----------------------
    moot(state, power, minute, rng, record) {
      const champions = power.parties.map(p => power.politicians[p.leaderId]).filter(p => p && p.alive);
      // A lone challenger who answers to no clan at all: strength speaks for
      // itself at a moot, so nobody needs a banner behind them to enter.
      if (rng.next() < INDEPENDENT_CHANCE) champions.push(spawnIndependent(power, rng, minute, 40));
      const scored = champions
        .map(c => ({ c, s: c.strength * 1.2 + c.cunning * 0.6 + rng.next() * 30 }))
        .sort((a, b) => b.s - a.s);
      const total = scored.reduce((a, x) => a + x.s, 0) || 1;
      record.results = scored.map(x => ({ candidateId: x.c.id, name: x.c.name, partyId: x.c.partyId, share: +(100 * x.s / total).toFixed(1) }));
      const winner = scored[0].c;
      const runnerUp = scored[1]?.c;
      if (runnerUp && rng.next() < 0.4) {
        killPolitician(power, runnerUp, minute, { key: "Politics.death.wolfpigs" });
        record.notes.push({ key: "Politics.note.mootLoser", params: { name: runnerUp.name } });
        const party = partyById(power, runnerUp.partyId);
        if (party) party.leaderId = makePolitician(power, rng, minute, { ideology: party.platform, spread: 20, partyId: party.id }).id;
      }
      record.notes.push({ key: "Politics.note.biggestWins" });
      this._installWinner(power, minute, partyById(power, winner.partyId), record, winner);
    },

    // --- Divine ascension tournament -----------------------------------------
    tournament(state, power, minute, rng, record) {
      const aspirants = power.parties.map(p => power.politicians[p.leaderId]).filter(p => p && p.alive);
      // A godling with no house behind them, ascending on raw divinity alone.
      if (rng.next() < INDEPENDENT_CHANCE) aspirants.push(spawnIndependent(power, rng, minute, 40));
      const scored = aspirants
        .map(c => ({ c, s: c.divinity * 1.3 + c.charisma * 0.5 + rng.next() * 25 }))
        .sort((a, b) => b.s - a.s);
      const total = scored.reduce((a, x) => a + x.s, 0) || 1;
      record.results = scored.map(x => ({ candidateId: x.c.id, name: x.c.name, partyId: x.c.partyId, share: +(100 * x.s / total).toFixed(1) }));
      record.notes.push({ key: "Politics.note.ascension" });
      this._installWinner(power, minute, partyById(power, scored[0].c.partyId), record, scored[0].c);
    },

    // --- Palace succession by intrigue ----------------------------------------
    succession(state, power, minute, rng, record) {
      const heirs = [];
      const heirCount = rng.int(3, 5);
      for (let i = 0; i < heirCount; i++) {
        // A claimant born outside every faction's patronage, backed by
        // nothing but their own blood claim.
        const partyId = rng.next() < INDEPENDENT_CHANCE ? null : rng.pick(power.parties).id;
        heirs.push(makePolitician(power, rng, minute, { age: rng.int(19, 45), spread: 30, partyId }));
      }
      const scored = heirs
        .map(c => ({ c, s: c.cunning * 1.1 + c.ambition * 0.6 + c.charisma * 0.4 + rng.next() * 25 }))
        .sort((a, b) => b.s - a.s);
      const total = scored.reduce((a, x) => a + x.s, 0) || 1;
      record.results = scored.map(x => ({ candidateId: x.c.id, name: x.c.name, partyId: x.c.partyId, share: +(100 * x.s / total).toFixed(1) }));
      if (power.state.stability < 40) {
        record.notes.push({ key: "Politics.note.successionWar" });
        power.state.unrest = clamp(power.state.unrest + 20, 0, 100);
        const casualty = scored[scored.length - 1].c;
        killPolitician(power, casualty, minute, { key: "Politics.death.succession" });
        record.notes.push({ key: "Politics.note.successionCasualty", params: { name: casualty.name } });
      } else {
        record.notes.push({ key: "Politics.note.palaceIntrigue" });
      }
      this._installWinner(power, minute, partyById(power, scored[0].c.partyId), record, scored[0].c);
    },

    // --- The Great Examination -------------------------------------------------
    examination(state, power, minute, rng, record) {
      const candidates = power.parties.map(p => power.politicians[p.leaderId]).filter(p => p && p.alive);
      // An independent scholar, sponsored by no school, sitting the paper on
      // their own reading alone.
      if (rng.next() < INDEPENDENT_CHANCE) candidates.push(spawnIndependent(power, rng, minute, 40));
      const scored = candidates
        .map(c => ({ c, s: c.intellect * 1.5 + c.integrity * 0.5 + rng.next() * 10 }))
        .sort((a, b) => b.s - a.s);
      const total = scored.reduce((a, x) => a + x.s, 0) || 1;
      record.results = scored.map(x => ({ candidateId: x.c.id, name: x.c.name, partyId: x.c.partyId, share: +(100 * x.s / total).toFixed(1) }));
      record.notes.push({ key: "Politics.note.examinationScore", params: { score: Math.round(scored[0].s) } });
      this._installWinner(power, minute, partyById(power, scored[0].c.partyId), record, scored[0].c);
    },

    // Shared: seat the winner, refresh meters, log the changeover.
    _installWinner(power, minute, winnerParty, record, headPolOverride) {
      const head = headPolOverride || (winnerParty ? power.politicians[winnerParty.leaderId] : null);
      const previousHead = power.politicians[power.headId];
      if (previousHead && previousHead !== head && previousHead.office === power.headTitle) {
        previousHead.office = null;
      }
      power.rulingPartyId = winnerParty?.id ?? null;
      if (!power.coalition.length || power.coalition[0] !== winnerParty?.id) power.coalition = winnerParty ? [winnerParty.id] : [];
      power.headId = head?.id ?? null;
      if (head) { head.office = power.headTitle; head.approval = clamp(head.approval + 10, 0, 100); }
      recordHead(power, minute, head, "elected");
      power.termStartMinute = minute;
      record.winnerPartyId = winnerParty?.id ?? null;
      record.winner = winnerParty?.name ?? "—";
      record.head = head?.name ?? "—";
      power.state.legitimacy = clamp(Math.round(40 + (record.results?.[0]?.share ?? 50) * 0.45), 0, 100);
      power.state.unrest = clamp(power.state.unrest - 12, 0, 100);
    },
  };

  // resolveElection, builds the record, dispatches to the engine, applies
  // aftermath (grudges among losing voters), and logs the event.
  function resolveElection(state, power, minute, rngOuter, opts = {}) {
    const rng = new PolRng(worldSeed() ^ nameHash("election:" + power.name) ^ ((minute >>> 0) || 1));
    const record = {
      idx: ++power.electionCounter,
      minute, date: dateStrOf(minute),
      system: power.system,
      label: opts.label || null,
      results: [], notes: [],
      winner: null, winnerPartyId: null, head: null,
      turnout: null, npcVoters: 0,
    };
    const engine = ElectionEngines[power.system] || ElectionEngines.parliamentary;
    engine.call(ElectionEngines, state, power, minute, rng, record);
    pushElection(power, record);
    if (!opts.historical) {
      pushPowerEvent(power, minute, "election",
        record.head !== "—" ? "Politics.event.electionWithHead" : "Politics.event.election",
        { election: labelOf(power), winner: record.winner, head: record.head, title: powerLabel(power, "headTitle") });
      // Losing voters may carry a grudge against the winner.
      for (const [npcName, identity] of Object.entries(state.identities)) {
        if (identity.power !== power.name) continue;
        const v = identity.votedLast;
        if (!v || v.electionIdx !== record.idx || v.partyId === record.winnerPartyId) continue;
        const gr = new PolRng(worldSeed() ^ nameHash("grudge" + npcName) ^ (minute >>> 0));
        if (gr.next() < 0.5) {
          identity.grudgePartyId = record.winnerPartyId;
          pushIdentityEvent(identity, minute, "grudge", "Politics.identity.grudge",
            { winner: record.winner, election: labelOf(power).toLowerCase() });
        }
      }
    }
    return record;
  }

  // The election idiom's name. `system` is the id; only the label moves.
  function labelOf(power) {
    const key = "Politics.election." + (power && power.system);
    return T.has(key) ? T(key) : T("Politics.election.parliamentary");
  }

  // ==========================================================================
  // NATIONAL SIMULATION, one chunk of days per power
  // ==========================================================================

  function rulingPlatform(power) {
    return partyById(power, power.rulingPartyId)?.platform || power.baseline;
  }

  // Policy keys are ids; only the word an edict or referendum uses is display.
  const policyLabel = (key) => {
    const k = "Politics.policy." + key;
    return T.has(k) ? T(k) : String(key || "");
  };

  const rumorKindLabel = (kind) => {
    const k = "Politics.rumorKind." + kind;
    return T.has(k) ? T(k) : String(kind || "");
  };

  // Each platform implies policy targets; edicts move policy toward them.
  function policyTargets(platform) {
    return {
      taxRate:      clamp(Math.round(22 - platform.econ * 0.12), 2, 45),
      censorship:   clamp(Math.round(platform.auth * 0.8), 0, 100),
      conscription: clamp(Math.round(platform.mil * 0.7), 0, 100),
      welfare:      clamp(Math.round(50 - platform.econ * 0.4), 0, 100),
      festivals:    clamp(Math.round(40 + platform.trad * 0.2 + platform.myst * 0.2), 0, 100),
    };
  }

  function pushRumor(power, minute, rng) {
    const pols = Object.values(power.politicians).filter(p => p.alive);
    if (!pols.length) return;
    const subject = rng.pick(pols);
    // i18n-ignore-start: rumour ids, stored on the record and named through
    // Politics.rumorKind at the moment a conversation quotes one
    const kinds = ["affair", "embezzlement", "secretPact", "forgedCredentials", "midnightRitual", "doubleLife", "hiddenFortune", "blackmail"];
    // i18n-ignore-end
    power.rumors.unshift({
      minute, date: dateStrOf(minute),
      subjectId: subject.id, subjectName: subject.name,
      kind: rng.pick(kinds),
      veracity: rng.next() < 0.45,
      spread: rng.int(5, 30),
    });
    if (power.rumors.length > RUMOR_CAP) power.rumors.pop();
  }

  function simulatePowerChunk(state, power, chunkStart, days, nowChunkEnd) {
    const rng = new PolRng(worldSeed() ^ nameHash("chunk:" + power.name) ^ ((chunkStart >>> 0) || 1));
    const s = power.state;
    const head = power.politicians[power.headId];

    // ---- meter drift -------------------------------------------------------
    // Settlement-level conditions leak upward (NPCWorldWeb.powerPressure):
    // local booms feed national legitimacy and economy mood, local crime
    // waves, busts and epidemics feed national unrest, which in turn shapes
    // policy, which flows back down into every settlement's pulse.
    const web = window.NPCWorldWeb?.powerPressure?.(power.name) ?? { economy: 0, unrest: 0, legitimacy: 0 };
    s.economyMood = clamp(s.economyMood + ((rng.next() * 2 - 1) * 0.25 + web.economy) * days, 0, 100);
    s.legitimacy = clamp(s.legitimacy + ((s.economyMood - 50) * 0.01 - power.policies.taxRate * 0.004 + web.legitimacy) * days, 0, 100);
    s.unrest = clamp(s.unrest
      + ((60 - s.legitimacy) * 0.01 + power.policies.taxRate * 0.006 + power.policies.censorship * 0.004
         - power.policies.welfare * 0.006 - power.policies.festivals * 0.003 + web.unrest) * days, 0, 100);
    s.stability = clamp(s.stability + ((s.legitimacy - s.unrest) * 0.005) * days, 0, 100);
    s.treasury = Math.max(0, Math.round(s.treasury + (power.policies.taxRate * 120_000_000 - power.policies.welfare * 40_000_000 - power.policies.festivals * 20_000_000 - power.policies.conscription * 30_000_000) * days * (s.economyMood / 50)));
    if (head) head.approval = clamp(head.approval + ((s.legitimacy - 50) * 0.01 - head.scandals * 0.02) * days, 0, 100);
    for (const party of power.parties) party.momentum *= Math.pow(0.995, days);

    // ---- rumor spread ------------------------------------------------------
    for (const rumor of power.rumors) rumor.spread = clamp(rumor.spread + days * (rumor.veracity ? 0.8 : 0.5), 0, 100);

    // ---- sampled events ----------------------------------------------------
    const evMinute = () => chunkStart + rng.int(0, Math.max(0, days - 1)) * MINUTES_PER_DAY;

    for (let i = sampleCount(rng, RATES.scandal * power.scandalSensitivity * days); i > 0; i--) {
      const pols = Object.values(power.politicians).filter(p => p.alive);
      if (!pols.length) break;
      const pol = rng.pick(pols.filter(p => p.integrity < 70).length ? pols.filter(p => p.integrity < 70) : pols);
      pol.scandals++;
      pol.approval = clamp(pol.approval - rng.int(8, 20), 0, 100);
      if (pol.id === power.headId) s.legitimacy = clamp(s.legitimacy - 8, 0, 100);
      const party = partyById(power, pol.partyId);
      if (party) party.momentum = clamp(party.momentum - 6, -50, 50);
      pushPowerEvent(power, evMinute(), "scandal", "Politics.event.scandal", { name: pol.name, n: pol.scandals });
    }

    for (let i = sampleCount(rng, RATES.edict * days); i > 0; i--) {
      const targets = policyTargets(rulingPlatform(power));
      const keys = Object.keys(targets).filter(k => Math.abs(power.policies[k] - targets[k]) > 2);
      if (!keys.length) break;
      const key = rng.pick(keys);
      const before = power.policies[key];
      power.policies[key] = Math.round(before + Math.sign(targets[key] - before) * Math.min(Math.abs(targets[key] - before), rng.int(3, 10)));
      pushPowerEvent(power, evMinute(), "edict", "Politics.event.edict",
        { title: powerLabel(power, "headTitle"), policy: policyLabel(key), before: before, after: power.policies[key] });
    }
    power.policies.curfew = power.policies.censorship > 60 && s.unrest > 50;

    for (let i = sampleCount(rng, RATES.protest * (s.unrest / 100) * days); i > 0; i--) {
      s.unrest = clamp(s.unrest + rng.int(-2, 4), 0, 100);
      pushPowerEvent(power, evMinute(), "protest", "Politics.event.protest",
        { govType: powerLabel(power, "govType"), place: rng.pick(power.memberCountries.length ? power.memberCountries : [power.name]) });
    }

    if (s.unrest > 70) {
      for (let i = sampleCount(rng, RATES.riot * (s.unrest / 100) * days); i > 0; i--) {
        s.stability = clamp(s.stability - 5, 0, 100);
        s.treasury = Math.max(0, s.treasury - rng.int(2_000_000_000, 20_000_000_000));
        pushPowerEvent(power, evMinute(), "riot", "Politics.event.riot", { legislature: powerLabel(power, "legislature") });
      }
    }

    if (power.policies.festivals > 0) {
      for (let i = sampleCount(rng, RATES.festival * (power.policies.festivals / 50) * days); i > 0; i--) {
        s.unrest = clamp(s.unrest - 5, 0, 100);
        s.treasury = Math.max(0, s.treasury - 5_000_000_000);
        pushPowerEvent(power, evMinute(), "festival", "Politics.event.festival", { power: power.name });
      }
    }

    if (power.system === "parliamentary") {
      for (let i = sampleCount(rng, RATES.referendum * days); i > 0; i--) {
        const key = rng.pick(["taxRate", "welfare", "festivals", "censorship"]);
        const delta = rng.int(-8, 8);
        power.policies[key] = clamp(power.policies[key] + delta, 0, key === "taxRate" ? 45 : 100);
        s.legitimacy = clamp(s.legitimacy + 3, 0, 100);
        pushPowerEvent(power, evMinute(), "referendum", "Politics.event.referendum",
          { policy: policyLabel(key), delta: (delta > 0 ? "+" : "") + delta });
      }
    }

    for (let i = sampleCount(rng, RATES.rumor * days); i > 0; i--) pushRumor(power, evMinute(), rng);

    // ---- violent power transfers --------------------------------------------
    let snapElection = false;

    for (let i = sampleCount(rng, RATES.coup * ((100 - s.stability) / 100) * power.coupSusceptibility * days); i > 0; i--) {
      if (rng.next() < (100 - s.legitimacy) / 150) {
        const at = evMinute();
        const strongman = makePolitician(power, rng, nowChunkEnd, { age: rng.int(38, 60), spread: 20 });
        strongman.ideology.auth = clamp(strongman.ideology.auth + 40, -100, 100);
        strongman.ideology.mil = clamp(strongman.ideology.mil + 40, -100, 100);
        if (head && head.alive) head.office = "deposed";
        power.headId = strongman.id;
        strongman.office = power.headTitle;
        recordHead(power, at, strongman, "coup");
        power.nextElectionMinute = nowChunkEnd + 730 * MINUTES_PER_DAY;
        s.legitimacy = 30; s.stability = clamp(s.stability + 10, 0, 100);
        pushPowerEvent(power, at, "coup", "Politics.event.coup",
          { name: strongman.name, power: power.name, elections: labelOf(power).toLowerCase() });
      } else {
        s.stability = clamp(s.stability - 8, 0, 100);
        pushPowerEvent(power, evMinute(), "coup_failed", "Politics.event.coupFailed", { title: powerLabel(power, "headTitle") });
      }
      break; // at most one attempt per chunk
    }

    if (s.unrest >= 90 && s.legitimacy <= 25 && sampleCount(rng, RATES.revolution * days) > 0) {
      pushPowerEvent(power, evMinute(), "revolution", "Politics.event.revolution",
        { govType: powerLabel(power, "govType"), power: power.name, election: labelOf(power).toLowerCase() });
      s.unrest = 35; s.legitimacy = 40; s.stability = 40;
      snapElection = true;
    }

    for (let i = sampleCount(rng, RATES.assassination * (s.unrest / 50) * days); i > 0; i--) {
      if (head && head.alive) {
        const at = evMinute();
        killPolitician(power, head, at, { key: "Politics.death.assassinated" });
        pushPowerEvent(power, at, "assassination", "Politics.event.assassination",
          { name: head.name, title: powerLabel(power, "headTitle"), power: power.name });
        s.stability = clamp(s.stability - 15, 0, 100);
        snapElection = true;
      }
      break;
    }

    // ---- mortality of the political class ------------------------------------
    for (const pol of Object.values(power.politicians)) {
      if (!pol.alive) continue;
      const age = politicianAge(pol, nowChunkEnd);
      const pDay = 0.00002 * Math.exp(Math.max(0, age - 50) / 12);
      if (sampleCount(rng, pDay * days) > 0) {
        const at = evMinute();
        killPolitician(power, pol, at, { key: "Politics.death.naturalCauses", params: { age: age } });
        const wasHead = pol.id === power.headId;
        pushPowerEvent(power, at, "death",
          wasHead ? "Politics.event.headDies" : "Politics.event.politicianDies",
          { name: pol.name, age: age, power: power.name, title: powerLabel(power, "headTitle") });
        const party = partyById(power, pol.partyId);
        if (party && party.leaderId === pol.id) {
          party.leaderId = makePolitician(power, rng, nowChunkEnd, { ideology: party.platform, spread: 20, partyId: party.id }).id;
        }
        const electorIdx = power.electors.indexOf(pol.id);
        if (electorIdx >= 0) {
          const successor = makePolitician(power, rng, nowChunkEnd, { spread: 25 });
          successor.office = power.electorTitle;
          power.electors[electorIdx] = successor.id;
        }
        if (wasHead) { pol.office = null; snapElection = true; }
      }
    }

    if (snapElection) {
      resolveElection(state, power, nowChunkEnd, rng, { label: "snap" });
      power.nextElectionMinute = nowChunkEnd + power.termDays * MINUTES_PER_DAY;
    }
  }

  // ==========================================================================
  // NPC POLITICAL IDENTITIES
  // ==========================================================================

  function pushIdentityEvent(identity, minute, type, key, params) {
    identity.log.unshift({ minute, date: dateStrOf(minute), type, key, params });
    if (identity.log.length > IDENTITY_LOG_CAP) identity.log.pop();
  }

  // Map group → country → hyperpower. Group names are matched against
  // Countries.json; unmatched groups get a seeded country. Neutral countries
  // lean toward a seeded "sympathy" hyperpower so every NPC has politics.
  // The history simulation can have moved a nation under a different
  // hyperpower than Countries.json ships with, the world's simulated
  // controller (HistoryManager.getNationState) always wins.
  function resolveGroupPolity(state, groupName) {
    const countries = getCountries();
    const powers = Object.keys(state.powers);
    const rng = new PolRng(worldSeed() ^ nameHash("polity:" + (groupName || "drifters")));
    let country = countries.find(c => norm(c.country) === norm(groupName)) || null;
    // Procedural settlements are keyed "Proc:x,y" and never match a country by
    // name, but they carry the nation id of the world tile they were generated
    // on (NPCSystem ensureProcSettlement). Anchor them to that real nation
    // instead of a random one so every procedural citizen belongs to the nation
    // of their home map.
    if (!country) {
      const nationId = $gameSystem?._npcMapGroups?.[groupName]?.nationId;
      if (nationId != null) country = countries.find(c => c.id === nationId) || null;
    }
    if (!country && countries.length) country = countries[rng.int(0, countries.length - 1)];
    let controller = country?.controller ?? "Neutral";
    let faction = country?.faction ?? "Neutral";
    if (country) {
      const simState = window.HistoryManager?.getNationState?.(country.country);
      if (simState) {
        if (simState.controller) controller = simState.controller;
        if (simState.faction) faction = simState.faction;
      }
    }
    let powerName = country ? canonicalFaction(controller !== "Neutral" ? controller : faction) : "Neutral";
    if (powerName === "Neutral" || !state.powers[powerName]) {
      // Sympathy allegiance, drawn from the powers of this world only: nobody
      // living in a neutral country drifts into a caste on another star.
      const earthly = powers.filter(n => !OFFWORLD_POWERS[n]);
      const pool = earthly.length ? earthly : powers;
      if (pool.length) powerName = pool[rng.int(0, pool.length - 1)];
    }
    return { country: country?.country ?? null, power: powerName };
  }

  function ensureIdentity(state, npcName, groupName, nowMinute) {
    if (state.identities[npcName]) return state.identities[npcName];
    const rng = new PolRng(worldSeed() ^ nameHash("identity:" + npcName));
    const profile = getProfile(npcName);
    // A non-sentient creature (NPCCreature) holds no allegiance. Nothing is
    // written for it at all, rather than a blank identity: every reader here
    // walks the identities map, so an absent one simply never votes, never
    // stands, never radicalizes and never appears in a citizen roll, and
    // getIdentity() answers null the way it always did for a stranger.
    const NC = window.NPCCreature;
    if (NC && NC.isNonSentientByName(npcName)) return null;
    // Somebody who is not from this world answers to the power that sent them,
    // not to whichever nation the town they are standing in belongs to. They
    // hold no citizenship here, so the country stays null.
    const alien = window.AlienOrigins?.identify?.(profile?.spriteKey, npcName) || null;
    const polity = (alien && state.powers[alien.power])
      ? { country: null, power: alien.power }
      : resolveGroupPolity(state, groupName);
    const power = state.powers[polity.power];

    // Personal ideology: what they BELIEVE first, where they LIVE second. The
    // creed on the society profile (Ideology.json) carries its own position on
    // these five axes, so a Trade Unionist reads as one wherever they were
    // born; the power's cultural baseline is what is left over, and pulls them
    // toward the local consensus without erasing the creed. Somebody with no
    // creed on file is still the baseline plus a wide personal spread, which is
    // all this used to be. Then nudges from the rest of the profile.
    const creed = window.NPCShared.ideologyFor(profile);
    const baseline = power ? power.baseline : { econ: 0, auth: 0, trad: 0, mil: 0, myst: 0 };
    let center = baseline, spread = 50;
    if (creed && creed.axes) {
      const creedAxes = window.NPCShared.ideologyAxes(creed);
      center = {};
      for (const ax of AXES) {
        center[ax] = creedAxes[ax] * CREED_WEIGHT + (baseline[ax] ?? 0) * (1 - CREED_WEIGHT);
      }
      spread = CREED_SPREAD;
    }
    const ideology = jitterIdeology(center, rng, spread);
    if (profile) {
      if (typeof profile.moralityScore === "number") ideology.auth = clamp(Math.round(ideology.auth - profile.moralityScore * 0.15), -100, 100);
      if (typeof profile.wealthTierBase === "number") ideology.econ = clamp(Math.round(ideology.econ + (profile.wealthTierBase - 2) * 12), -100, 100);
    }

    let partyId = null;
    if (power) {
      let bestD = Infinity;
      for (const party of power.parties) {
        const d = ideologyDistance(ideology, party.platform);
        if (d < bestD) { bestD = d; partyId = party.id; }
      }
    }

    const identity = {
      power: polity.power, country: polity.country, group: groupName ?? null,
      ideology, partyId, creedId: creed?.id ?? null,
      engagement: Math.round(Math.pow(rng.next(), 1.6) * 100), // most people are mostly apathetic
      charisma: rng.int(5, 95),
      votedLast: null,
      grudgePartyId: null,
      localOffice: null,
      log: [],
    };
    pushIdentityEvent(identity, nowMinute, "awakening",
      partyId && power ? "Politics.identity.sympathized" : "Politics.identity.awakened",
      partyId && power ? { party: partyById(power, partyId)?.name } : undefined);
    state.identities[npcName] = identity;
    return identity;
  }

  function ensureIdentities(state, nowMinute) {
    const population = collectPopulation();
    let created = 0;
    for (const [npcName, groupName] of Object.entries(population)) {
      if (state.identities[npcName]) continue;
      if (created >= MAX_NEW_IDENTITIES_PER_PASS) break;
      // Only a real identity counts against the per-pass budget. A creature
      // that will never have one is refused every pass, and must not spend a
      // slot a citizen behind it in the walk is waiting for.
      if (ensureIdentity(state, npcName, groupName, nowMinute)) created++;
    }
    return created;
  }

  function simulateIdentitiesChunk(state, chunkStart, days) {
    for (const [npcName, identity] of Object.entries(state.identities)) {
      const power = state.powers[identity.power];
      if (!power) continue;
      const rng = new PolRng(worldSeed() ^ nameHash("idchunk:" + npcName) ^ ((chunkStart >>> 0) || 1));

      // engagement drifts with national unrest (politics gets harder to ignore)
      identity.engagement = clamp(Math.round(identity.engagement + ((power.state.unrest - 40) * 0.005 + (rng.next() * 2 - 1) * 0.3) * days), 0, 100);

      if (sampleCount(rng, NPC_RATES.partySwitch * days) > 0) {
        let best = null, bestD = Infinity;
        for (const party of power.parties) {
          const d = ideologyDistance(identity.ideology, party.platform);
          if (d < bestD) { bestD = d; best = party; }
        }
        if (best && best.id !== identity.partyId) {
          const old = partyById(power, identity.partyId);
          identity.partyId = best.id;
          pushIdentityEvent(identity, chunkStart, "conversion", "Politics.identity.conversion",
            { from: old?.name ?? T("Politics.fallback.oldGuard"), to: best.name });
        }
      }

      if (sampleCount(rng, NPC_RATES.radicalize * (power.state.unrest / 100) * days) > 0) {
        for (const ax of AXES) identity.ideology[ax] = clamp(Math.round(identity.ideology[ax] * 1.2), -100, 100);
        identity.engagement = clamp(identity.engagement + 15, 0, 100);
        pushIdentityEvent(identity, chunkStart, "radicalized", "Politics.identity.radicalized");
      }

      if (identity.grudgePartyId && sampleCount(rng, NPC_RATES.grudgeFade * days) > 0) {
        identity.grudgePartyId = null;
      }
    }
  }

  // ==========================================================================
  // LOCAL SETTLEMENT POLITICS (DF-style noble screen)
  // ==========================================================================

  const LOCAL_OFFICES = ["mayor", "guardCaptain", "taxCollector", "highPriest"];
  // Labels come from Politics.office.<id>; the map is kept for callers that ask
  // for the whole thing, and reads live so a language switch reaches it.
  const LOCAL_OFFICE_LABELS = {};
  for (const _office of LOCAL_OFFICES) {
    Object.defineProperty(LOCAL_OFFICE_LABELS, _office, {
      get: () => officeLabel(_office), enumerable: true,
    });
  }

  function ensureSettlements(state, nowMinute) {
    const groups = Object.keys($gameSystem?._npcMapGroups || {});
    for (const groupName of groups) {
      if (state.settlements[groupName]) continue;
      const polity = resolveGroupPolity(state, groupName);
      const rng = new PolRng(worldSeed() ^ nameHash("settlement:" + groupName));
      state.settlements[groupName] = {
        group: groupName, country: polity.country, power: polity.power,
        offices: { mayor: null, guardCaptain: null, taxCollector: null, highPriest: null },
        nextLocalElectionMinute: nowMinute - rng.int(0, LOCAL_TERM_DAYS - 1) * MINUTES_PER_DAY, // due immediately, staggered
        history: [],
      };
    }
  }

  function localResidents(state, groupName) {
    const population = collectPopulation();
    return Object.entries(population)
      .filter(([, g]) => g === groupName)
      .map(([name]) => name)
      .filter(name => state.identities[name]);
  }

  function resolveLocalElection(state, settlement, minute) {
    const rng = new PolRng(worldSeed() ^ nameHash("local:" + settlement.group) ^ ((minute >>> 0) || 1));
    const residents = localResidents(state, settlement.group);
    if (residents.length < 2) {
      settlement.nextLocalElectionMinute = minute + LOCAL_TERM_DAYS * MINUTES_PER_DAY;
      return;
    }

    // Candidates: the three most plausible local politicians.
    const ranked = residents
      .map(name => {
        const id = state.identities[name];
        return { name, score: id.engagement * 0.7 + id.charisma * 0.5 + rng.next() * 25 };
      })
      .sort((a, b) => b.score - a.score);
    const candidates = ranked.slice(0, Math.min(3, ranked.length));

    // Every resident votes for the candidate ideologically closest to them.
    const votes = {};
    for (const voter of residents) {
      const vid = state.identities[voter];
      let best = null, bestD = Infinity;
      for (const cand of candidates) {
        if (cand.name === voter) { best = cand; break; } // you always vote for yourself
        const d = ideologyDistance(vid.ideology, state.identities[cand.name].ideology);
        if (d < bestD) { bestD = d; best = cand; }
      }
      if (best) votes[best.name] = (votes[best.name] || 0) + 1;
    }
    const winnerName = candidates.slice().sort((a, b) => (votes[b.name] || 0) - (votes[a.name] || 0))[0].name;

    // Clear old officeholders.
    for (const office of LOCAL_OFFICES) {
      const prev = settlement.offices[office];
      if (prev && state.identities[prev]) state.identities[prev].localOffice = null;
      settlement.offices[office] = null;
    }

    // Seat the mayor; the mayor appoints allies to the remaining offices.
    settlement.offices.mayor = winnerName;
    state.identities[winnerName].localOffice = "mayor";
    pushIdentityEvent(state.identities[winnerName], minute, "office", "Politics.identity.electedMayor",
      { group: settlement.group, votes: votes[winnerName] || 0, total: residents.length });
    window.NPCSim?.StoryLogger?.record?.(winnerName, "politics",
      "Politics.story.electedMayor", { group: settlement.group });

    const mayorIdeology = state.identities[winnerName].ideology;
    const pool = residents.filter(n => n !== winnerName)
      .sort((a, b) => ideologyDistance(mayorIdeology, state.identities[a].ideology)
                    - ideologyDistance(mayorIdeology, state.identities[b].ideology));
    for (const office of LOCAL_OFFICES.slice(1)) {
      const appointee = pool.shift();
      if (!appointee) break;
      settlement.offices[office] = appointee;
      state.identities[appointee].localOffice = office;
      pushIdentityEvent(state.identities[appointee], minute, "office", "Politics.identity.appointed",
        { office: officeLabel(office), group: settlement.group });
      window.NPCSim?.StoryLogger?.record?.(appointee, "politics",
        "Politics.story.appointed", { office: officeLabel(office), group: settlement.group });
    }

    settlement.history.unshift({
      minute, date: dateStrOf(minute), mayor: winnerName,
      votes: residents.length, offices: { ...settlement.offices },
    });
    if (settlement.history.length > SETTLEMENT_LOG_CAP) settlement.history.pop();
    settlement.nextLocalElectionMinute = minute + LOCAL_TERM_DAYS * MINUTES_PER_DAY;
  }

  // ==========================================================================
  // CATCH-UP, the delta engine
  // ==========================================================================

  let _catchUpRunning = false;


  // True in a world created with populationMode "empty" (WorldManager).
  function isEmptyWorld() {
    const WM = window.WorldManager;
    return !!(WM && typeof WM.isEmptyWorld === "function" && WM.isEmptyWorld());
  }

  function catchUp(nowMinute) {
    if (_catchUpRunning) return;
    // No electorate, no candidates, no coups: political time does not pass in
    // an empty world. See WorldManager.populationMode.
    if (isEmptyWorld()) return;
    const state = getState();
    if (!state) return;
    _catchUpRunning = true;
    try {
      ensurePowers(state, nowMinute);
      ensureIdentities(state, nowMinute);
      ensureSettlements(state, nowMinute);

      if (state.lastSimMinute === null || state.lastSimMinute === undefined) {
        state.lastSimMinute = nowMinute;
        // Resolve any elections the bootstrap already made due (incl. local).
        runDueElections(state, nowMinute, nowMinute);
        return;
      }
      if (nowMinute < state.lastSimMinute) { state.lastSimMinute = nowMinute; return; } // time rewound
      const deltaMinutes = nowMinute - state.lastSimMinute;
      if (deltaMinutes < MINUTES_PER_DAY) return; // accumulate sub-day deltas

      const totalDays = Math.floor(deltaMinutes / MINUTES_PER_DAY);
      let cursor = state.lastSimMinute;
      let remaining = totalDays;
      while (remaining > 0) {
        const chunkDays = Math.min(CHUNK_DAYS, remaining);
        const chunkEnd = cursor + chunkDays * MINUTES_PER_DAY;
        runDueElections(state, cursor, chunkEnd);
        for (const power of Object.values(state.powers)) {
          simulatePowerChunk(state, power, cursor, chunkDays, chunkEnd);
        }
        simulateIdentitiesChunk(state, cursor, chunkDays);
        cursor = chunkEnd;
        remaining -= chunkDays;
      }
      state.lastSimMinute = cursor;

      if (deltaMinutes >= SKIP_FLUSH_MINUTES) {
        try { window.WorldManager?.flush?.(); } catch (_) { /* flush is best-effort */ }
      }
    } finally {
      _catchUpRunning = false;
    }
  }

  function runDueElections(state, fromMinute, toMinute) {
    for (const power of Object.values(state.powers)) {
      let guard = 0;
      while (power.nextElectionMinute !== null && power.nextElectionMinute <= toMinute && guard++ < 200) {
        const at = Math.max(power.nextElectionMinute, fromMinute);
        resolveElection(state, power, at, null);
        power.nextElectionMinute = power.nextElectionMinute + power.termDays * MINUTES_PER_DAY;
      }
    }
    for (const settlement of Object.values(state.settlements)) {
      let guard = 0;
      while (settlement.nextLocalElectionMinute <= toMinute && guard++ < 100) {
        resolveLocalElection(state, settlement, Math.max(settlement.nextLocalElectionMinute, fromMinute));
      }
    }
  }

  // ==========================================================================
  // SOCIAL INTEGRATION, opinions & conversation context
  // ==========================================================================

  // Political chemistry between two NPCs, -12..+12. Same party bonds;
  // ideological distance estranges; grudges curdle.
  function opinionModifier(nameA, nameB) {
    const state = $gameSystem?._npcPolitics;
    const a = state?.identities?.[nameA], b = state?.identities?.[nameB];
    if (!a || !b) return 0;
    let mod = clamp(Math.round(10 - ideologyDistance(a.ideology, b.ideology) * 0.15), -12, 10);
    if (a.partyId && a.partyId === b.partyId) mod += 4;
    if (a.grudgePartyId && a.grudgePartyId === b.partyId) mod -= 6;
    return clamp(mod, -12, 12);
  }

  // Everything NPCConversation's PoliticsProvider needs to phrase a thought.
  function getConversationContext(npcName) {
    const state = $gameSystem?._npcPolitics;
    const identity = state?.identities?.[npcName];
    if (!identity) return null;
    const power = state.powers[identity.power];
    if (!power) return null;
    const party = partyById(power, identity.partyId);
    const head = power.politicians[power.headId];
    const lastElection = power.elections[0] || null;
    const nowMinute = nowMinuteVar();

    let stance = "apathetic"; // i18n-ignore: keys ConvPolitics.stance in NPCConversation
    if (identity.engagement >= 25) {
      const supports = identity.partyId === power.rulingPartyId || power.coalition.includes(identity.partyId);
      const extreme = AXES.some(ax => Math.abs(identity.ideology[ax]) >= 85);
      stance = extreme && identity.engagement >= 60 ? "radical" : supports ? "support" : "oppose";
    }

    let gripe = null;
    if (power.policies.curfew) gripe = T("Politics.gripe.curfew");
    else if (power.policies.taxRate >= 28) gripe = T("Politics.gripe.taxes");
    else if (power.policies.censorship >= 55) gripe = T("Politics.gripe.censors");
    else if (power.policies.conscription >= 55) gripe = T("Politics.gripe.draft");

    const hotRumor = power.rumors.find(r => r.spread >= 40) || null;

    return {
      stance,
      powerName: power.name,
      govType: powerLabel(power, "govType"),
      headTitle: powerLabel(power, "headTitle"),
      headName: head?.name ?? T("Politics.fallback.nobody"),
      partyName: party?.name ?? T("Politics.fallback.noOne"),
      partyKind: powerLabel(power, "partyKind"),
      electionLabel: labelOf(power),
      daysToElection: power.nextElectionMinute != null ? Math.max(0, Math.round((power.nextElectionMinute - nowMinute) / MINUTES_PER_DAY)) : null,
      lastElectionWon: !!(lastElection && identity.votedLast && identity.votedLast.partyId === lastElection.winnerPartyId),
      lastWinnerName: lastElection?.winner ?? null,
      rumorSubject: hotRumor?.subjectName ?? null,
      rumorKind: hotRumor ? rumorKindLabel(hotRumor.kind) : null,
      gripe,
      unrest: Math.round(power.state.unrest),
      engagement: identity.engagement,
      localOffice: identity.localOffice ? officeLabel(identity.localOffice) : null,
      group: identity.group,
    };
  }

  // ==========================================================================
  // REPORT BUILDERS
  // ==========================================================================

  function meterBar(v) {
    const filled = Math.round(clamp(v, 0, 100) / 10);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  }

  function buildPowerReport(powerName) {
    const state = $gameSystem?._npcPolitics;
    const power = state?.powers?.[canonicalFaction(powerName)];
    if (!power) return T("Politics.report.noPower", { power: powerName });
    const head = power.politicians[power.headId];
    const ruling = partyById(power, power.rulingPartyId);
    const lines = [];
    lines.push(T("Politics.report.header", { power: power.name, govType: powerLabel(power, "govType") }));
    lines.push(T("Politics.report.head", {
      title: powerLabel(power, "headTitle"),
      value: head
        ? T("Politics.report.headValue", { name: head.name, approval: Math.round(head.approval) })
        : T("Politics.report.vacant"),
    }));
    lines.push(T("Politics.report.ruling", {
      partyKind: powerLabel(power, "partyKind"),
      party: ruling?.name ?? "—",
      partners: power.coalition.length > 1
        ? " " + T.n("Politics.report.coalitionPartners", power.coalition.length - 1, { n: power.coalition.length - 1 })
        : "",
    }));
    lines.push(T("Politics.report.meters1", { legitimacy: meterBar(power.state.legitimacy), stability: meterBar(power.state.stability) }));
    lines.push(T("Politics.report.meters2", { unrest: meterBar(power.state.unrest), economy: meterBar(power.state.economyMood) }));
    lines.push(T("Politics.report.policies", {
      tax: power.policies.taxRate, censorship: power.policies.censorship,
      conscription: power.policies.conscription, welfare: power.policies.welfare,
      curfew: power.policies.curfew ? " · " + T("Politics.report.curfew") : "",
    }));
    const last = power.elections[0];
    if (last) lines.push(T("Politics.report.lastElection", {
      election: labelOf(power).toLowerCase(), date: last.date,
      winner: last.winner, share: last.results?.[0]?.share ?? "?",
    }));
    if (power.nextElectionMinute != null) lines.push(T("Politics.report.nextElection", {
      election: labelOf(power).toLowerCase(), date: dateStrOf(power.nextElectionMinute),
    }));
    const recent = power.events.slice(0, 4);
    if (recent.length) {
      lines.push(T("Politics.report.recentEvents"));
      for (const e of recent) lines.push(`  ${e.date}, ${textOf(e)}`);
    }
    return lines.join("\n");
  }

  function buildElectionReport(powerName) {
    const state = $gameSystem?._npcPolitics;
    const power = state?.powers?.[canonicalFaction(powerName)];
    if (!power) return T("Politics.report.noPower", { power: powerName });
    const lines = [T("Politics.report.electionHeader", { power: power.name, election: labelOf(power) })];
    if (power.nextElectionMinute != null) lines.push(T("Politics.report.next", { date: dateStrOf(power.nextElectionMinute) }));
    for (const e of power.elections.slice(0, 6)) {
      lines.push(T("Politics.report.electionRow", {
        date: e.date,
        snap: e.label === "snap" ? " " + T("Politics.report.snap") : "",
        winner: e.winner,
        turnout: e.turnout != null ? T("Politics.report.turnout", { turnout: e.turnout }) : "",
      }));
      for (const r of (e.results || []).slice(0, 4)) {
        lines.push(T("Politics.report.resultRow", {
          share: r.share,
          seats: r.seats != null ? " " + T.n("Politics.report.seats", r.seats, { n: r.seats }) : "",
          name: r.name,
        }));
      }
      for (const n of e.notes || []) lines.push(`   * ${textOf(n)}`);
    }
    return lines.join("\n");
  }

  function buildNPCProfile(npcName) {
    const state = $gameSystem?._npcPolitics;
    const identity = state?.identities?.[npcName];
    if (!identity) return T("Politics.report.noIdentity", { name: npcName });
    const power = state.powers[identity.power];
    const party = power ? partyById(power, identity.partyId) : null;
    const lines = [];
    lines.push(T("Politics.report.citizen", {
      name: npcName, country: identity.country ?? T("Politics.fallback.partsUnknown"), power: identity.power,
    }));
    if (party) lines.push(T("Politics.report.sympathizes", { party: party.name }));
    const tag = (k) => T("Politics.tag." + k);
    const tags = [];
    if (identity.ideology.econ <= -40) tags.push(tag("collectivist")); else if (identity.ideology.econ >= 40) tags.push(tag("freeMarketeer"));
    if (identity.ideology.auth <= -40) tags.push(tag("libertarian")); else if (identity.ideology.auth >= 40) tags.push(tag("authoritarian"));
    if (identity.ideology.trad <= -40) tags.push(tag("progressive")); else if (identity.ideology.trad >= 40) tags.push(tag("traditionalist"));
    if (identity.ideology.mil <= -40) tags.push(tag("pacifist")); else if (identity.ideology.mil >= 40) tags.push(tag("militarist"));
    if (identity.ideology.myst <= -40) tags.push(tag("rationalist")); else if (identity.ideology.myst >= 40) tags.push(tag("mystic"));
    lines.push(T("Politics.report.leanings", { tags: tags.length ? tags.join(", ") : tag("moderate") }));
    lines.push(T("Politics.report.engagement", {
      engagement: identity.engagement,
      note: identity.engagement < 25 ? " " + T("Politics.report.apathetic")
          : identity.engagement >= 60 ? " " + T("Politics.report.activist") : "",
    }));
    if (identity.localOffice) lines.push(T("Politics.report.holdsOffice", {
      office: officeLabel(identity.localOffice), group: identity.group,
    }));
    if (identity.votedLast && power) {
      const voted = partyById(power, identity.votedLast.partyId);
      lines.push(T("Politics.report.lastVote", {
        party: voted?.name ?? T("Politics.fallback.spoiledBallot"),
        date: dateStrOf(identity.votedLast.minute),
      }));
    }
    if (identity.grudgePartyId && power) {
      lines.push(T("Politics.report.grudge", {
        party: partyById(power, identity.grudgePartyId)?.name ?? T("Politics.fallback.establishment"),
      }));
    }
    for (const e of identity.log.slice(0, 3)) lines.push(`${e.date}, ${textOf(e)}`);
    return lines.join("\n");
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  window.NPCPolitics = {
    catchUp,
    listPowers() { return Object.keys($gameSystem?._npcPolitics?.powers || {}); },
    getPower(name) { return $gameSystem?._npcPolitics?.powers?.[canonicalFaction(name)] ?? null; },
    getIdentity(npcName) { return $gameSystem?._npcPolitics?.identities?.[npcName] ?? null; },
    // Country name an NPC's home map-group belongs to, resolvable even before a
    // full political identity has been simulated for that NPC. Map-pool groups
    // match Countries.json by name; procedural "Proc:x,y" settlements resolve
    // via the nation id stored on the group (the world tile's current nation).
    nationOfGroup(groupName) {
      const state = getState();
      if (!state || !groupName) return null;
      try { return resolveGroupPolity(state, groupName).country || null; }
      catch (_) { return null; }
    },
    getSettlement(groupName) { return $gameSystem?._npcPolitics?.settlements?.[groupName] ?? null; },
    opinionModifier,
    getConversationContext,
    buildPowerReport,
    buildElectionReport,
    buildNPCProfile,
    // --- wiki lookup API ---------------------------------------------------
    // Exact-name (case-insensitive) search across every power's political class.
    findPolitician(name) {
      const state = $gameSystem?._npcPolitics;
      if (!state) return null;
      const target = String(name || "").trim().toLowerCase();
      if (!target) return null;
      for (const power of Object.values(state.powers || {})) {
        for (const pol of Object.values(power.politicians || {})) {
          if (String(pol.name).toLowerCase() === target) return { power, pol };
        }
      }
      return null;
    },
    getPolitician(powerName, polId) {
      return this.getPower(powerName)?.politicians?.[polId] ?? null;
    },
    getHeadHistory(powerName) {
      return this.getPower(powerName)?.headHistory ?? [];
    },
    getPartyOf(powerName, partyId) {
      const power = this.getPower(powerName);
      return power ? (power.parties.find(p => p.id === partyId) || null) : null;
    },
    // Exact-id search across every power's parties, for the wiki's party page
    // (a party id already carries its own power, but the wiki only has the id).
    findParty(partyId) {
      const state = $gameSystem?._npcPolitics;
      if (!state || !partyId) return null;
      for (const power of Object.values(state.powers || {})) {
        const party = power.parties.find(p => p.id === partyId);
        if (party) return { power, party };
      }
      return null;
    },
    // Every party currently seated anywhere, power attached, for the wiki's
    // party index and the ideology page's "held by" list.
    listAllParties() {
      const state = $gameSystem?._npcPolitics;
      const out = [];
      for (const power of Object.values(state?.powers || {})) {
        for (const party of power.parties) out.push({ party, powerName: power.name });
      }
      return out;
    },
    listSettlements() { return $gameSystem?._npcPolitics?.settlements || {}; },
    listIdentities() { return $gameSystem?._npcPolitics?.identities || {}; },
    citizensOf(powerName, limit = 30) {
      const out = [];
      const target = canonicalFaction(powerName);
      for (const [npcName, identity] of Object.entries($gameSystem?._npcPolitics?.identities || {})) {
        if (identity.power === target) {
          out.push(npcName);
          if (out.length >= limit) break;
        }
      }
      return out;
    },
    politicianAgeOf(pol) { return politicianAge(pol, nowMinuteVar()); },
    electionLabelOf(powerName) {
      const power = this.getPower(powerName);
      return power ? labelOf(power) : T("Politics.election.parliamentary");
    },
    // Resolve a { key, params } pocket the simulation stored on a record.
    textOf,
    // Localized label for one of a power's own archetype fields.
    powerLabel,
    officeLabel,
    politicianOffice,
    accessionLabel,
    dateOf: dateStrOf,
    LOCAL_OFFICE_LABELS,
    // test/inspection hooks
    _internals: {
      PolRng, nameHash, sampleCount, dateStrOf, yearOf, clamp,
      AXES, ARCHETYPES, FALLBACK_ARCHETYPE, FACTION_ALIASES, RATES, NPC_RATES,
      ideologyDistance, jitterIdeology, discoverHyperpowers, collectPopulation,
      resolveElection, resolveGroupPolity, policyTargets, labelOf,
      LOCAL_OFFICES, LOCAL_OFFICE_LABELS,
    },
  };

  // ==========================================================================
  // ENGINE HOOKS (guarded so the module stays loadable outside RMMZ for tests)
  // ==========================================================================

  // World initialization: the powers, their political classes and every
  // settlement's local politics are bootstrapped when the world is made, so a
  // brand new world already has somebody in office everywhere rather than
  // electing them the first time the player walks into a town.
  if (typeof window !== "undefined" && window.WorldManager?.registerWorldInitializer) {
    window.WorldManager.registerWorldInitializer("politics", 50, () => {
      catchUp($gameVariables?.value(114) || 0);
    });
  }

  if (typeof Game_Map !== "undefined") {
    const _Game_Map_update = Game_Map.prototype.update;
    Game_Map.prototype.update = function (sceneActive) {
      _Game_Map_update.call(this, sceneActive);
      if (!sceneActive || !$gameVariables) return;
      const minute = $gameVariables.value(114) || 0;
      if (minute !== this._lastPoliticsSimMinute) {
        this._lastPoliticsSimMinute = minute;
        const last = $gameSystem?._npcPolitics?.lastSimMinute;
        if (last === undefined || last === null || minute - last >= MINUTES_PER_DAY || minute < last) {
          catchUp(minute);
        }
      }
    };
  }

  if (typeof Scene_Map !== "undefined") {
    const _Scene_Map_onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function () {
      _Scene_Map_onMapLoaded.call(this);
      if ($gameVariables) catchUp($gameVariables.value(114) || 0);
    };
  }

  if (typeof PluginManager !== "undefined") {
    PluginManager.registerCommand(pluginName, "PoliticsReport", args => {
      const power = String(args.power || "").trim();
      if (power) $gameMessage.add(buildPowerReport(power));
    });

    PluginManager.registerCommand(pluginName, "PoliticsElections", args => {
      const power = String(args.power || "").trim();
      if (power) $gameMessage.add(buildElectionReport(power));
    });

    PluginManager.registerCommand(pluginName, "PoliticsNPC", args => {
      const name = String(args.eventName || "").trim();
      if (name) $gameMessage.add(buildNPCProfile(name));
    });

    PluginManager.registerCommand(pluginName, "PoliticsDebug", args => {
      const state = $gameSystem?._npcPolitics;
      if (!state) return;
      const power = String(args.power || "").trim();
      const dump = power ? state.powers[canonicalFaction(power)] : state;
      console.groupCollapsed(`[NPCPolitics] ${power || "full state"}`);
      console.log(JSON.parse(JSON.stringify(dump || {})));
      console.groupEnd();
    });

    PluginManager.registerCommand(pluginName, "PoliticsCatchUp", () => {
      catchUp($gameVariables.value(114) || 0);
    });

    console.log("[NPCPolitics] Loaded, hyperpower politics & elections active.");
  }

})();
