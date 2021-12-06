const dotenv = require("dotenv");
const path = require("path");

module.exports = async ({ options, resolveConfigurationProperty }) => {
  const envVars = dotenv.config({
    // Load env vars into Serverless environment
    path: path.resolve(`${__dirname}/config/secrets.env`),
  }).parsed;
  // Return all env vars that don't start with "AWS_"
  return Object.keys(envVars)
    .filter((key) => !key.startsWith("AWS_"))
    .reduce((obj, key) => {
      obj[key] = envVars[key];
      return obj;
    }, {});
};
