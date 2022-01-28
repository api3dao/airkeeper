const path = require('path');
const dotenv = require('dotenv');

// eslint-disable-next-line functional/immutable-data
module.exports = async ({ _options, _resolveConfigurationProperty }) => {
  const envVars = dotenv.config({
    // Load env vars into Serverless environment
    path: path.resolve(`${__dirname}/config/secrets.env`),
  }).parsed;
  // Return all env vars that don't start with "AWS_"
  return Object.keys(envVars)
    .filter((key) => !key.startsWith('AWS_'))
    .reduce((obj, key) => {
      return { ...obj, [key]: envVars[key] };
    }, {});
};
