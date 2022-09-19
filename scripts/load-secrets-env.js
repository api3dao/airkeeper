const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// eslint-disable-next-line functional/immutable-data
module.exports = async ({ _options, _resolveConfigurationProperty }) => {
  const secretsPath = path.resolve(__dirname, '..', 'config', 'secrets.env');
  return fs.existsSync(secretsPath)
    ? dotenv.config({
        // Load env vars into Serverless environment
        path: secretsPath,
      }).parsed
    : {};
};
