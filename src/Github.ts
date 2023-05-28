/**
 * @license AGPL-3.0
 * Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2023  Rafael Kallis
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


import crypto from "crypto";
import _ from "lodash";
import jwt from "jsonwebtoken";
import fetch, { Headers, RequestInit, Response } from "node-fetch";
import YAML from "yaml";
import { detailedDiff } from "deep-object-diff";
import Joi from "joi";
import { Config } from "./Config";
import { Entities } from "./entities";

export interface RepositoryConfig {
  version: number;
  enabled: boolean;
  labels: {
    [key: string]: {
      enabled: boolean;
      text: string;
    };
  };
}

interface Installation {
  id: number;
}

interface Repository {
  id: number;
  url: string;
}

export const repositoryConfigSchema = Joi.object<RepositoryConfig>({
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

export const repositoryConfigDefaults: RepositoryConfig = {
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

interface ComputeCacheKeyOptions {
  url: string;
  options: RequestInit;
}

export class CacheKeyComputer {
  
  public computeCacheKey({ url, options }: ComputeCacheKeyOptions) {
    const hash = crypto.createHash("md5");
    for (const c of this._getCacheKeyComponents({ url, options })) {
      hash.update(c);
    }
    return hash.digest("hex");
  }

  protected *_getCacheKeyComponents({ url }: ComputeCacheKeyOptions): Generator<string> {
    yield "github";
    yield url;
  }
}

class AuthorizationCacheKeyComputer extends CacheKeyComputer {
  
  protected *_getCacheKeyComponents({ url, options }: ComputeCacheKeyOptions): Generator<string> {
    yield* super._getCacheKeyComponents({ url, options });
    if (!options.headers) throw new Error("headers is null");
    let authorizationValue: string | null = null;
    if (Array.isArray(options.headers)) {
      const authorizationHeader = options.headers.find(h => h[0].toLocaleLowerCase() === "authorization");
      if (authorizationHeader) {
        const [, ...authorizationValues] = authorizationHeader;
        authorizationValue = authorizationValues.join("|");
      }
    }
    else if (options.headers instanceof Headers) {
      authorizationValue = options.headers.get("Authorization");
    } else {
      authorizationValue = options.headers.Authorization ?? options.headers.authorization;
    }
    if (!authorizationValue) throw new Error("no authorization header found");
    yield authorizationValue;
  }
}

interface GitHubClientOptions {
  config: Config;
  cacheKeyComputer: CacheKeyComputer;
  entities: Entities;
}

abstract class GitHubClient {

  protected readonly config: Config;
  protected readonly cacheKeyComputer: CacheKeyComputer;
  protected readonly entities: Entities;
  protected readonly baseUrl: string;

  constructor({ config, cacheKeyComputer, entities }: GitHubClientOptions) {
    this.config = config;
    this.cacheKeyComputer = cacheKeyComputer;
    this.entities = entities;
    this.baseUrl = "https://api.github.com";
  }

  protected _url(path: string) {
    return this.baseUrl + path;
  }

  protected _headers(headers = {}) {
    return {
      "User-Agent": this.config.USER_AGENT,
      Accept: "application/vnd.github.v3+json",
      ...headers,
    };
  }

  protected _assertSuccess(response: Response) {
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
  protected async _fetch(url: string, options: RequestInit) {
    const cacheKey = this.cacheKeyComputer.computeCacheKey({ url, options });
    let cacheRecord = await this.entities.CacheRecord.findOne({
      key: cacheKey,
    });
    if (cacheRecord) {
      options.headers ??= {};
      options.headers = { ...options.headers, ["If-None-Match"]: cacheRecord.etag };
    }
    const response = await fetch(url, options);
    /* cache hit */
    if (response.status === 304) {
      if (!cacheRecord) throw new Error("cache record is null");
      return cacheRecord.payload;
    }

    /* bad */
    if (!response.ok) return null;

    /* cache miss */
    const etag = response.headers.get("ETag");
    const payload = await response.json();
    if (!etag) return payload;
    if (!cacheRecord) {
      cacheRecord = new this.entities.CacheRecord({ key: cacheKey });
    }
    cacheRecord.etag = etag;
    cacheRecord.payload = payload;
    await cacheRecord.save();
    return payload;
  }
}

interface GitHubOAuthClientOptions {
  config: Config;
  entities: Entities;
  accessToken: string;
}

export class GitHubOAuthClient extends GitHubClient {
  readonly accessToken: string;

  constructor({ config, entities, accessToken }: GitHubOAuthClientOptions) {
    super({
      config,
      cacheKeyComputer: new AuthorizationCacheKeyComputer(),
      entities,
    });
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
    return await this._fetch(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/repos#get-a-repository
   */
  async getRepository({ owner, repo }: { owner: string; repo: string }) {
    const url = this._url(`/repos/${owner}/${repo}`);
    return await this._fetch(url, { headers: this._headers() });
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-app-installations-accessible-to-the-user-access-token
   */
  async listInstallations() {
    const url = this._url("/user/installations");
    const { installations } = await this._fetch(url, {
      headers: this._headers(),
    });
    return installations;
  }

  /**
   * @see https://docs.github.com/en/rest/reference/apps#list-repositories-accessible-to-the-user-access-token
   */
  async listRepositoriesByInstallationId({ installationId }: { installationId: number }) {
    const url = this._url(`/user/installations/${installationId}/repositories`);
    const { repositories } = await this._fetch(url, {
      headers: this._headers(),
    });
    return repositories;
  }

  createRepositoryClient({ repository }: { repository: Repository }) {
    return new GitHubRepositoryClient({ 
      config: this.config,
      cacheKeyComputer: this.cacheKeyComputer,
      entities: this.entities,
      accessToken: this.accessToken,
      repository,
    });
  }

  protected _headers(headers = {}) {
    return super._headers({
      Authorization: `token ${this.accessToken}`,
      ...headers,
    });
  }

  protected _headersWithClientSecretBasicAuth(headers = {}) {
    const basicAuthToken = Buffer.from(
      `${this.config.GITHUB_CLIENT_ID}:${this.config.GITHUB_CLIENT_SECRET}`
    ).toString("base64");
    return this._headers({
      Authorization: `Basic ${basicAuthToken}`,
      ...headers,
    });
  }
}

interface GitHubAppClientOptions {
  config: Config;
  entities: Entities;
}

/**
 * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-a-github-app
 */
export class GitHubAppClient extends GitHubClient {
  constructor({ config, entities }: GitHubAppClientOptions) {
    super({ config, cacheKeyComputer: new CacheKeyComputer(), entities });
  }

  /**
   * Get the authenticated app.
   * @see https://docs.github.com/en/rest/reference/apps#get-the-authenticated-app
   */
  async getApp() {
    const url = this._url("/app");
    return await this._fetch(url, {
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

  async createInstallationClient({ installation }: { installation: Installation }) {
    const { accessToken, permissions } = 
      await this._createInstallationAccessToken({ installation });
    return new GitHubInstallationClient({
      config: this.config,
      cacheKeyComputer: this.cacheKeyComputer,
      entities: this.entities,
      accessToken,
      installation,
      permissions,
    });
  }

  /**
   * Create an installation access token for a repository.
   * @see https://docs.github.com/en/rest/reference/apps#create-an-installation-access-token-for-an-app
   */
  async _createInstallationAccessToken({ installation }: { installation: Installation }) {
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

interface GitHubInstallationClientOptions extends GitHubClientOptions {
  accessToken: string;
  installation: Installation;
  permissions: { [key: string]: string };
}

/**
 * @see https://docs.github.com/en/developers/apps/authenticating-with-github-apps#authenticating-as-an-installation
 */
class GitHubInstallationClient extends GitHubClient {
  readonly accessToken: string;
  readonly installation: Installation;
  readonly permissions: { [key: string]: string };

  constructor({
    config,
    cacheKeyComputer,
    entities,
    accessToken,
    installation,
    permissions,
  }: GitHubInstallationClientOptions) {
    super({ config, cacheKeyComputer, entities });
    this.accessToken = accessToken;
    this.installation = installation;
    this.permissions = permissions;
  }

  canRead(permission: string) {
    return ["read", "write"].includes(this.permissions[permission]);
  }

  canWrite(permission: string) {
    return ["write"].includes(this.permissions[permission]);
  }

  async revokeAccessToken() {
    const url = this._url("/installation/token");
    const response = await fetch(url, {
      method: "DELETE",
      headers: this._headers(),
    });
    this._assertSuccess(response);
  }

  createRepositoryClient({ repository }: { repository: Repository }) {
    return new GitHubRepositoryClient({ 
      config: this.config,
      cacheKeyComputer: this.cacheKeyComputer,
      entities: this.entities,
      accessToken: this.accessToken,
      repository,
    });
  }

  _headers(headers = {}) {
    return super._headers({
      ...headers,
      Authorization: `token ${this.accessToken}`,
    });
  }
}

interface GitHubRepositoryClientOptions extends GitHubClientOptions {
  accessToken: string;
  repository: Repository;
}

export class GitHubRepositoryClient extends GitHubClient {

  private readonly accessToken: string;
  private readonly repository: Repository;

  constructor({ config, cacheKeyComputer, entities, accessToken, repository }: GitHubRepositoryClientOptions) {
    super({ config, cacheKeyComputer, entities });
    this.accessToken = accessToken;
    this.repository = repository;
  }

  /**
   * Set the issue's labels.
   * @see https://docs.github.com/en/rest/reference/issues#update-an-issue
   */
  async setIssueLabels({ issue, labels }: { issue: number; labels: string[] }) {
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
    const body = await this._fetch(url, {
      headers: this._headers(),
    });

    if (!body) {
      return {
        yaml: "",
        json: _.cloneDeep(repositoryConfigDefaults),
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
    json = _.defaultsDeep(json, repositoryConfigDefaults);
    return { yaml, json, sha: body.sha, exists: true };
  }

  /**
   * Creates the repository's tickettager config.
   * @see https://docs.github.com/en/rest/reference/repos#create-or-update-file-contents
   */
  async createConfig() {
    const json = _.cloneDeep(repositoryConfigDefaults);
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
  }: {
    repositoryConfig: RepositoryConfig;
    repositoryConfigYaml: string;
    sha: string;
    updatedRepositoryConfig: RepositoryConfig;
  }) {
    if (repositoryConfigSchema.validate(updatedRepositoryConfig).error) {
      throw new Error("schema validation error");
    }
    updatedRepositoryConfig = _.defaultsDeep(
      _.cloneDeep(updatedRepositoryConfig),
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
    traverse(deleted).forEach(([path]) => yamlDoc.deleteIn(path));
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

    function traverse(value: unknown): [string[], unknown][] {
      return Array.from(traverseInner([], value));
      function* traverseInner(path: string[], value: unknown): Generator<[string[], unknown]> {
        if (typeof value !== "object" || value === null) {
          yield [path, value];
          return;
        }
        for (let [childKey, childValue] of Object.entries(value) as [string, unknown][]) {
          yield* traverseInner([...path, childKey], childValue);
        }
      }
    }
  }

  _url(url: string) {
    return this.repository.url + url;
  }

  _headers(headers = {}) {
    return super._headers({
      ...headers,
      Authorization: `token ${this.accessToken}`,
    });
  }
}
