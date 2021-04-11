/**
 * @license Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2021  Rafael Kallis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * @file github.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const YAML = require("yaml");
const Joi = require("joi");
const { defaultsDeep } = require("lodash");
const { repositoryConfigSchema } = require("./schemata");
const { CacheRecord } = require("./entities/CacheRecord");

const repositoryConfigDefaults = {
  version: 3,
  labels: Object.fromEntries(
    ["bug", "enhancement", "question"].map((label) => [
      label,
      {
        enabled: true,
        text: label,
      },
    ])
  ),
};
Joi.assert(repositoryConfigDefaults, repositoryConfigSchema);

class CacheKeyComputer {
  computeCacheKey({ url, options }) {
    const hash = crypto.createHash("md5");
    for (const c of this._getCacheKeyComponents({ url, options })) {
      hash.update(c);
    }
    return hash.digest("hex");
  }

  *_getCacheKeyComponents({ url }) {
    yield "github";
    yield url;
  }
}

class AuthorizationCacheKeyComputer extends CacheKeyComputer {
  *_getCacheKeyComponents({ url, options }) {
    yield* super._getCacheKeyComponents({ url, options });
    yield options.headers.Authorization;
  }
}

class GitHubClient {
  constructor({ config, cacheKeyComputer }) {
    this.config = config;
    this.cacheKeyComputer = cacheKeyComputer;
    this.baseUrl = "https://api.github.com";
  }

  _url(path) {
    return this.baseUrl + path;
  }

  _headers(headers = {}) {
    return {
      "User-Agent": "Ticket-Tagger",
      Accept: "application/vnd.github.v3+json",
      ...headers,
    };
  }

  /**
   * Uses conditional requests for improved rate limits.
   * @see https://docs.github.com/en/rest/guides/getting-started-with-the-rest-api#conditional-requests
   */
  async _fetchJsonConditional(url, options) {
    const cacheKey = this.cacheKeyComputer.computeCacheKey({ url, options });
    let cacheRecord = await CacheRecord.findOne({ key: cacheKey });
    if (cacheRecord) {
      options.headers["If-None-Match"] = cacheRecord.etag;
    }
    const response = await fetch(url, options);
    /* cache hit */
    if (response.status === 304) return cacheRecord.payload;

    /* bad */
    if (!response.ok) return null;

    /* cache miss */
    const etag = response.headers.get("ETag");
    const payload = await response.json();
    if (!cacheRecord) {
      cacheRecord = new CacheRecord({ key: cacheKey });
    }
    cacheRecord.etag = etag;
    cacheRecord.payload = payload;
    try {
      await cacheRecord.save();
    } catch (e) {
      console.log(url, cacheRecord.etag, options.headers.Authorization, cacheRecord.key, cacheRecord.id, cacheRecord.isNew);
      throw e;
    }
    return payload;
  }
}

class GitHubOAuthClient extends GitHubClient {
  constructor({ config, accessToken }) {
    super({ config, cacheKeyComputer: new AuthorizationCacheKeyComputer() });
    this.accessToken = accessToken;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#check-a-token
   */
  async checkToken() {
    const url = this._url(
      `/applications/${this.config.GITHUB_CLIENT_ID}/token`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this._headersWithClientSecretBasicAuth({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ access_token: this.accessToken }),
    });
    if (!response.ok) {
      return false;
    }
    return await response.json();
  }

  /**
   * @see https://docs.github.com/en/rest/reference/users#get-the-authenticated-user
   */
  async getUser() {
    const url = this._url("/user");
    return await this._fetchJsonConditional(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/repos#get-a-repository
   */
  async getRepository({ owner, repo }) {
    const url = this._url(`/repos/${owner}/${repo}`);
    return await this._fetchJsonConditional(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-app-installations-accessible-to-the-user-access-token
   */
  async listInstallations() {
    const url = this._url("/user/installations");
    const { installations } = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
    return installations;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-repositories-accessible-to-the-user-access-token
   */
  async listRepositoriesByInstallationId({ installationId }) {
    const url = this._url(`/user/installations/${installationId}/repositories`);
    const { repositories } = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
    return repositories;
  }

  createRepositoryClient({ repository }) {
    return new GitHubRepositoryClient({ ...this, repository });
  }

  _headers(headers = {}) {
    return super._headers({
      Authorization: `token ${this.accessToken}`,
      ...headers,
    });
  }

  _headersWithClientSecretBasicAuth(headers = {}) {
    const basicAuthToken = Buffer.from(
      `${this.config.GITHUB_CLIENT_ID}:${this.config.GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    return this._headers({
      Authorization: `Basic ${basicAuthToken}`,
      ...headers,
    });
  }
}

/**
 * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-a-github-app
 */
class GitHubAppClient extends GitHubClient {
  constructor({ config }) {
    super({ config, cacheKeyComputer: new CacheKeyComputer() });
  }

  async createInstallationClient({ installation }) {
    const {
      accessToken,
      permissions,
    } = await this._createInstallationAccessToken({
      installation,
    });
    return new GitHubInstallationClient({
      ...this,
      installation,
      accessToken,
      permissions,
    });
  }

  /**
   * Create an installation access token for a repository.
   * @see https://docs.github.com/en/rest/reference/apps#create-an-installation-access-token-for-an-app
   */
  async _createInstallationAccessToken({ installation }) {
    const url = this._url(
      `/app/installations/${installation.id}/access_tokens`
    );
    const response = await fetch(url, {
      method: "POST",
      headers: this._headers(),
    });
    if (!response.ok) {
      throw new Error("was not able to create an installation access token");
    }
    const { token, permissions } = await response.json();
    return { accessToken: token, permissions };
  }

  _headers(headers = {}) {
    return super._headers({
      Authorization: `Bearer ${this._createAppAccessToken()}`,
      ...headers,
    });
  }

  /**
   * Creates a new JWT for authorizing ticket-tagger.
   * Used for requesting installation specific access tokens.
   * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-a-github-app
   *
   * @returns {String} A ticket-tagger JWT
   */
  _createAppAccessToken() {
    const iat = (Date.now() / 1000) | 0;
    const exp = iat + 30;
    const iss = this.config.GITHUB_APP_ID;
    return jwt.sign({ iat, exp, iss }, this.config.GITHUB_CERT, {
      algorithm: "RS256",
    });
  }
}

/**
 * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-an-installation
 */
class GitHubInstallationClient extends GitHubClient {
  constructor({
    config,
    cacheKeyComputer,
    installation,
    accessToken,
    permissions,
  }) {
    super({ config, cacheKeyComputer });
    this.installation = installation;
    this.accessToken = accessToken;
    this.permissions = permissions;
  }

  canRead(permission) {
    return ["read", "write"].includes(this.permissions[permission]);
  }
  canWrite(permission) {
    return ["write"].includes(this.permissions[permission]);
  }

  async revokeAccessToken() {
    const url = this._url("/app/installation/token");
    await fetch(url, { method: "DELETE", headers: this._headers() });
  }

  createRepositoryClient({ repository }) {
    return new GitHubRepositoryClient({ ...this, repository });
  }

  _headers(headers = {}) {
    return super._headers({
      ...headers,
      Authorization: `token ${this.accessToken}`,
    });
  }
}

class GitHubRepositoryClient extends GitHubClient {
  constructor({ config, cacheKeyComputer, repository, accessToken }) {
    super({ config, cacheKeyComputer });
    this.repository = repository;
    this.accessToken = accessToken;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setIssueLabels({ issue, labels }) {
    const url = this._url(`/issues/${issue}/labels`);
    return await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ labels }),
    });
  }

  /**
   * Get the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#get-repository-content
   */
  async getConfig() {
    const repositoryConfigYaml = await this.getConfigYaml();
    let repositoryConfig = YAML.parse(repositoryConfigYaml);
    if (!repositoryConfig) {
      repositoryConfig = {};
    }
    if (repositoryConfigSchema.validate(repositoryConfig).error) {
      repositoryConfig = {};
    }
    return defaultsDeep(repositoryConfig, repositoryConfigDefaults);
  }

  /**
   * Get the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#get-repository-content
   */
  async getConfigYaml() {
    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    const body = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
    if (!body) return "";
    return Buffer.from(body.content, "base64").toString("utf8");
  }

  /**
   * Updates the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
   */
  async setConfigYaml(content) {
    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `Updated ${this.config.CONFIG_FILE_PATH}`,
        content: Buffer.from(content, "utf8").toString("base64"),
        sha: "from getConfig() request?",
      }),
    });
  }

  _url(url) {
    return this.repository.url + url;
  }

  _headers(headers = {}) {
    return super._headers({
      ...headers,
      Authorization: `token ${this.accessToken}`,
    });
  }
}

module.exports = {
  repositoryConfigDefaults,
  GitHubOAuthClient,
  GitHubAppClient,
};
