/**
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const envalid = require("envalid");

module.exports = envalid.cleanEnv(process.env, {
  NODE_ENV: envalid.str({ choices: ['production', 'test', 'development'] }),
  PORT: envalid.port({ devDefault: 3000 }),
  GITHUB_SECRET: envalid.str(),
  GITHUB_CERT: envalid.str(),
  GITHUB_APP_ID: envalid.str(),
});