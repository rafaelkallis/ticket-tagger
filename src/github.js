/**
 * @file github.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const crypto = require("crypto");
const request = require("superagent");
const jwt = require("jsonwebtoken");
const config = require("./config");

/**
 * Signs the payload using the secret.
 * Used for github payload verification.
 *
 * @param {String} opts.payload - The payload to sign.
 * @param {String} opts.secret - The secret used for signing.
 * @returns {String} The payload signature
 */
function sign({ payload, secret }) {
  const digest = crypto
    .createHmac("sha1", secret)
    .update(payload)
    .digest("hex");
  return `sha1=${digest}`;
}

exports.sign = sign;

exports.verifySignature = ({ payload, secret, signature }) =>
  sign({ payload, secret }) === signature;

exports.setLabels = async ({ labels, issue, accessToken }) => {
  await request
    .patch(issue)
    .set("Authorization", `token ${accessToken}`)
    .send({ labels });
};

exports.getAccessToken = async ({ installationId }) => {
  const response = await request
    .post(
      `https://api.github.com/app/installations/${installationId}/access_tokens`
    )
    .set("Authorization", `Bearer ${makeJwt()}`)
    .set("Accept", "application/vnd.github.machine-man-preview+json");

  const { token } = response.body;
  return token;
};

/**
 * Creates a new JWT for authorizing ticket-tagger.
 * Used for requesting installation specific access tokens.
 *
 * @returns {String} A ticket-tagger JWT
 */
function makeJwt() {
  const iat = (Date.now() / 1000) | 0;
  const exp = iat + 30;
  const iss = config.GITHUB_APP_ID;
  return jwt.sign({ iat, exp, iss }, config.GITHUB_CERT, { algorithm: "RS256" });
}
