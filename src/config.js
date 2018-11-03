/**
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

exports.githubAccessToken = process.env.GITHUB_ACCESS_TOKEN;
exports.githubSecret = process.env.GITHUB_SECRET;
exports.githubCert = process.env.GITHUB_CERT;
exports.githubAppId = process.env.GITHUB_APP_ID;
exports.port = process.env.PORT;
