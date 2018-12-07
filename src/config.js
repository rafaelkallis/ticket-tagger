/**
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

exports.githubSecret = process.env.GITHUB_SECRET;
exports.githubCert = process.env.GITHUB_CERT;
exports.githubAppId = process.env.GITHUB_APP_ID;
exports.port = process.env.PORT;
