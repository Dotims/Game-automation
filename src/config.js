const config = {
    DEFAULT_CONFIG: {
        minLvl: 24,
        maxLvl: 35,
        maps: [
             "Siedlisko Nietoperzy p.3 - sala 1",
             "Siedlisko Nietoperzy p.4",
             "Siedlisko Nietoperzy p.5",
             "Siedlisko Nietoperzy p.4",
             "Siedlisko Nietoperzy p.3 - sala 1",
             "Siedlisko Nietoperzy p.2",
             "Siedlisko Nietoperzy p.1",
             "Siedlisko Nietoperzy p.2",

             "Pieczara Szaleńców - sala 1",
             "Pieczara Szaleńców - sala 2",
             "Pieczara Szaleńców - sala 3",
             "Pieczara Szaleńców - sala 4",
             "Pieczara Szaleńców - sala 3",
             "Pieczara Szaleńców - sala 2",
             "Pieczara Szaleńców - sala 1"
        ],
        ranges: {
            "Siedlisko Nietoperzy p.3 - sala 1": { maxLvl: 35 },
            "Pieczara Szaleńców - sala 2": { maxLvl: 40 }
        },
        autoHeal: true,
        skippedMobIds: [] // Initialize empty
    },
    CONSTANTS: {
        GAME_URL: "https://www.margonem.pl/",
        ATTACK_COOLDOWN: 800,
        MOVEMENT_SPEED: 100, // ms between steps in burst
        BURST_STEPS: 7,
        STUCK_LIMIT: 5,
        PATHFIND_FAIL_LIMIT: 5,
        SKIP_TIMEOUT: 30000 
    }
};

module.exports = config;
