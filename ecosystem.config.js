// eslint-disable-next-line functional/immutable-data
module.exports = {
  apps: [
    {
      name: 'web-api',
      script: 'ts-node test/server/server.ts',
    },
    {
      name: 'ethereum-node',
      script: 'hardhat node --config hardhat.config.ts',
    },
  ],
};
