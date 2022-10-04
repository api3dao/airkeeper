import { writeFileSync } from 'fs';
import * as protocol from '@api3/airnode-protocol-v1';
import { format } from 'prettier';
import { ethers } from 'ethers';

const PRETTIER_CONFIG = {
  bracketSpacing: true,
  printWidth: 120,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  useTabs: false,
  overrides: [
    {
      files: '*.md',
      options: {
        parser: 'markdown',
        proseWrap: 'always',
      },
    },
  ],
} as any;

export const runAndHandleErrors = (fn: () => Promise<unknown>) => {
  try {
    fn()
      .then(() => process.exit(0))
      .catch((error) => {
        console.log(error.stack);
        process.exit(1);
      });
  } catch (error) {
    console.log((error as Error).stack);
    process.exit(1);
  }
};

export const writeJsonFile = (path: string, payload: any) => {
  if (payload.filename && payload.content) {
    const extension = payload.filename.split('.').pop();
    writeFileSync(`${path}.${extension}`, payload.content);
    return;
  }

  const extension = path.indexOf('.json') === -1 ? '.json' : '';

  const prettierJson = format(JSON.stringify(payload), { semi: false, parser: 'json', ...PRETTIER_CONFIG });
  writeFileSync(`${path}${extension}`, prettierJson);
};

export const sanitiseFilename = (filename: string) => {
  const illegalRe = /[\/?<>\\:*|"]/g;
  // eslint-disable-next-line no-control-regex
  const controlRe = /[\x00-\x1f\x80-\x9f]/g;
  const reservedRe = /^\.+$/;
  const windowsReservedRe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

  return filename
    .replace(illegalRe, '_')
    .replace(controlRe, '_')
    .replace(reservedRe, '_')
    .replace(windowsReservedRe, '_')
    .toLowerCase();
};

export const getDapiServerInterface = () => {
  return new ethers.utils.Interface(protocol.DapiServer__factory.abi);
};

export const getDapiServerContract = (dapiServerAddress: string, provider: ethers.providers.JsonRpcProvider) => {
  return new ethers.Contract(dapiServerAddress, protocol.DapiServer__factory.abi, provider);
};

export const getDapiNameHash = (dapiName: any) => {
  return ethers.utils.solidityKeccak256(['bytes32'], [ethers.utils.formatBytes32String(dapiName)]);
};
