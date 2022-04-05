import { HardhatUserConfig } from 'hardhat/types';

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1337,
    },
    // localhost: {
    //   url: 'http://127.0.0.1:8545/',
    // },
  },
  solidity: '0.8.9',
};

export default config;
