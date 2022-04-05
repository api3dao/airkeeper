import { HardhatUserConfig } from 'hardhat/types';

const config: HardhatUserConfig = {
  networks: {
    localhost: {
      url: 'http://127.0.0.1:8545/',
    },
  },
};

export default config;
