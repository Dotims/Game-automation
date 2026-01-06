module.exports = {
  apps : [
    {
      name: "Bot_Friz",
      script: "./src/index.js",
      instances: 1,
      autorestart: false,
      watch: false,
      env: {
        CDP_PORT: 9222,
        CHARACTER_NICK: "siema_jestem_friz" // Nick postacie w grze
      }
    },
    {
      name: "Bot_Czarek",
      script: "./src/index.js",
      instances: 1,
      autorestart: false,
      watch: false,
      env: {
        CDP_PORT: 9222, // TEN SAM PORT (bo to jeden proces przeglądarki)
        CHARACTER_NICK: "Czarek_Kirk_prawdziwy" // Nick postacie w grze
      }
    }
  ]
};
