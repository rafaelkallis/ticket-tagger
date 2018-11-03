/**
 * @file github utils
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const crypto = require('crypto');
const request = require('superagent');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const config = require('./config');

const cert = fs.readFileSync(config.githubCert);

exports.verifySignature = ({payload, secret, signature}) => {
  const digest = crypto.createHmac('sha1', secret)
    .update(payload)
    .digest('hex');
  return `sha1=${digest}` === signature;
}

exports.setLabels = async ({labels, issue, accessToken}) => {
  await request.patch(issue)
    .set('Authorization', `token ${accessToken}`)
    .send({labels});
}

exports.getAccessToken = async ({installationId}) => {
  const response = await request
    .post(`https://api.github.com/app/installations/${installationId}/access_tokens`)
    .set('Authorization', `Bearer ${makeJwt()}`)
    .set('Accept', 'application/vnd.github.machine-man-preview+json')

  const {token, expires_at: expiresAt} = response.body;
  return token;
}

function makeJwt() {
  const iat = Date.now() / 1000 | 0;
  const exp = iat + 30;
  const iss = config.githubAppId;
  return jwt.sign({iat, exp, iss}, cert, {algorithm: 'RS256'});
}
