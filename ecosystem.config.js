// eslint-disable-next-line functional/immutable-data
module.exports = {
  apps: [
    {
      name: 'web-api',
      script: 'ts-node src/test/server/server.ts',
    },
    {
      name: 'ethereum-node',
      script: 'hardhat node --config src/test/hardhat.config.ts',
    },
  ],
};
