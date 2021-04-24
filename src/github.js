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
const _ = require("lodash");
const jwt = require("jsonwebtoken");
const fetch = require("node-fetch");
const YAML = require("yaml");
const { detailedDiff } = require("deep-object-diff");
const Joi = require("joi");
const { cloneDeep, defaultsDeep } = require("lodash");
const { CacheRecord } = require("./entities/CacheRecord");

const repositoryConfigSchema = Joi.object({
  version: Joi.number().allow(3),
  enabled: Joi.boolean(),
  labels: Joi.object().pattern(
    Joi.string().valid("bug", "enhancement", "question"),
    {
      enabled: Joi.boolean(),
      text: Joi.string().max(50),
    }
  ),
});

const repositoryConfigDefaults = {
  version: 3,
  enabled: true,
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

const repositoryConfigYamlDefaults = YAML.stringify(repositoryConfigDefaults);

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
      "User-Agent": this.config.USER_AGENT,
      Accept: "application/vnd.github.v3+json",
      ...headers,
    };
  }

  _assertSuccess(response) {
    if (!response.ok && response.status !== 304) {
      throw new Error(
        `github api request failed for "${response.url}", got "${response.status}: ${response.statusText}".`
      );
    }
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
    await cacheRecord.save();
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

  /**
   * Get the authenticated app.
   * @see https://docs.github.com/en/rest/reference/apps#get-the-authenticated-app
   */
  async getApp() {
    const url = this._url("/app");
    return await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });
  }

  /**
   * Get meta.
   * @see https://docs.github.com/en/rest/reference/meta
   */
  async getMeta() {
    const url = this._url("/meta");
    const response = await fetch(url, {
      headers: _.omit(this._headers(), ["Authorization"]),
    });
    this._assertSuccess(response);
    return await response.json();
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
      accessToken,
      installation,
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
    this._assertSuccess(response);
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
    accessToken,
    installation,
    permissions,
  }) {
    super({ config, cacheKeyComputer });
    this.accessToken = accessToken;
    this.installation = installation;
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
    const response = await fetch(url, {
      method: "DELETE",
      headers: this._headers(),
    });
    this._assertSuccess(response);
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
  constructor({ config, cacheKeyComputer, accessToken, repository }) {
    super({ config, cacheKeyComputer });
    this.accessToken = accessToken;
    this.repository = repository;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setIssueLabels({ issue, labels }) {
    const url = this._url(`/issues/${issue}/labels`);
    const response = await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ labels }),
    });
    this._assertSuccess(response);
  }

  /**
   * Get the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#get-repository-content
   */
  async getConfig() {
    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    const body = await this._fetchJsonConditional(url, {
      headers: this._headers(),
    });

    if (!body) {
      return {
        yaml: "",
        json: cloneDeep(repositoryConfigDefaults),
        sha: "",
        exists: false,
      };
    }
    if (body.type !== "file") throw new Error("expected file");
    if (body.encoding !== "base64") throw new Error("expected base64 encoding");

    const yaml = Buffer.from(body.content, "base64").toString("utf8");
    let json = {};
    if (yaml) {
      json = YAML.parse(yaml);
    }
    if (repositoryConfigSchema.validate(json).error) {
      json = {};
    }
    json = defaultsDeep(json, repositoryConfigDefaults);
    return { yaml, json, sha: body.sha, exists: true };
  }

  /**
   * Creates the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
   */
  async createConfig() {
    const json = cloneDeep(repositoryConfigDefaults);
    const yaml = YAML.stringify(json);

    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    const response = await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `Created ${this.config.CONFIG_FILE_PATH}`,
        content: Buffer.from(yaml, "utf8").toString("base64"),
      }),
    });
    this._assertSuccess(response);
    const body = await response.json();

    return { json, yaml, sha: body.content.sha, exists: true };
  }

  /**
   * Updates the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
   */
  async mergeConfig({
    repositoryConfig,
    repositoryConfigYaml,
    sha,
    updatedRepositoryConfig,
  }) {
    if (repositoryConfigSchema.validate(updatedRepositoryConfig).error) {
      throw new Error("schema validation error");
    }
    updatedRepositoryConfig = defaultsDeep(
      cloneDeep(updatedRepositoryConfig),
      repositoryConfigDefaults
    );

    const { added, deleted, updated } = detailedDiff(
      repositoryConfig,
      updatedRepositoryConfig
    );
    if (
      !!sha &&
      ![added, deleted, updated].some((o) => !!Object.keys(o).length)
    ) {
      /* no change detected */
      return {
        json: repositoryConfig,
        yaml: repositoryConfigYaml,
        sha,
        exists: true,
      };
    }
    const yamlDoc = YAML.parseDocument(repositoryConfigYaml);

    traverse(added).forEach(([path, value]) => yamlDoc.setIn(path, value));
    traverse(deleted).forEach(([path, value]) => yamlDoc.deleteIn(path, value));
    traverse(updated).forEach(([path, value]) => yamlDoc.setIn(path, value));

    const updatedYaml = yamlDoc.toString();

    const url = this._url(`/contents/${this.config.CONFIG_FILE_PATH}`);
    const response = await fetch(url, {
      method: "PUT",
      headers: this._headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        message: `Updated ${this.config.CONFIG_FILE_PATH}`,
        content: Buffer.from(updatedYaml, "utf8").toString("base64"),
        sha,
      }),
    });
    this._assertSuccess(response);
    const body = await response.json();

    return {
      json: updatedRepositoryConfig,
      yaml: updatedYaml,
      sha: body.content.sha,
      exists: true,
    };

    function traverse(value) {
      return Array.from(traverseInner([], value));
      function* traverseInner(path, value) {
        if (typeof value !== "object") {
          yield [path, value];
          return;
        }
        for (let [childKey, childValue] of Object.entries(value)) {
          yield* traverseInner([...path, childKey], childValue);
        }
      }
    }
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
  repositoryConfigSchema,
  repositoryConfigDefaults,
  GitHubOAuthClient,
  GitHubAppClient,
};
