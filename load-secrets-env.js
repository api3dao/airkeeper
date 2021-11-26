const dotenv = require("dotenv");
const path = require("path");

module.exports = async ({ options, resolveConfigurationProperty }) => {
  return dotenv.config({
    // Load env vars into Serverless environment
    path: path.resolve(`${__dirname}/config/secrets.env`),
  }).parsed;
};
