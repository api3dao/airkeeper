const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

module.exports = async ({ options, resolveConfigurationProperty }) => {
  const secretsPath = path.resolve(__dirname, "config", "secrets.env");
  const envVars = fs.existsSync(secretsPath)
    ? dotenv.config({
        // Load env vars into Serverless environment
        path: secretsPath,
      }).parsed
    : {};
  // Return all env vars that don't start with "AWS_"
  return Object.keys(envVars)
    .filter((key) => !key.startsWith("AWS_"))
    .reduce((obj, key) => {
      obj[key] = envVars[key];
      return obj;
    }, {});
};
