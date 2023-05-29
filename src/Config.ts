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
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

import dotenv from "dotenv";
import envalid from "envalid";
import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/* parses .env file into process.env */
dotenv.config();

const hexKey = envalid.makeValidator((input) => {
  if (typeof input !== "string") {
    throw new Error("Expected a string");
  }
  if (!/^[0-9a-f]{64}$/i.test(input)) {
    throw new Error("key must be 64 hex digits long.");
  }
  return input;
});

const hexKeyList = envalid.makeValidator((input) => {
  if (typeof input !== "string") {
    throw new Error("Expected a string");
  }
  if (!/^([0-9a-f]{64},)*([0-9a-f]{64})$/i.test(input)) {
    throw new Error("keys must be comma separated 64 hex digits.");
  }
  return input;
});

export interface Config {
  NODE_ENV: "production" | "test" | "development";
  SERVER_BASE_URL: string;
  PORT: number;
  USER_AGENT: string;
  GITHUB_SECRET: string;
  GITHUB_CERT: string;
  GITHUB_APP_ID: string;
  FASTTEXT_MODEL_URI: string;
  APPLICATIONINSIGHTS_CONNECTION_STRING: string;
  SESSION_NAME: string;
  SESSION_KEYS: string;
  SESSION_STORE_ENCRYPTION_KEY: string;
  MONGO_URI: string;
  MONGO_ENCRYPTION_KEY: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  DATASET_DIR: string;
  MODEL_DIR: string;
  CONFIG_FILE_PATH: string;
  RATELIMIT_WINDOW_POINTS: number;
  RATELIMIT_WINDOW_SECONDS: number;
}

export const config: Config = envalid.cleanEnv(process.env, {
  NODE_ENV: envalid.str({ choices: ["production", "test", "development"] }),
  SERVER_BASE_URL: envalid.url({ devDefault: "http://localhost:3000" }),
  PORT: envalid.port({ devDefault: 3000 }),
  USER_AGENT: envalid.str({ default: "Ticket-Tagger" }),
  /* do not use the following GITHUB_SECRET in production! */
  GITHUB_SECRET: envalid.str({ devDefault: "123456" }),
  /* do not use the following GITHUB_CERT in production! */
  GITHUB_CERT: envalid.str({
    get devDefault() {
      return crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      }).privateKey;
    },
  }),
  /* do not use the following GITHUB_APP_ID in production! */
  GITHUB_APP_ID: envalid.str({ devDefault: "123" }),
  FASTTEXT_MODEL_URI: envalid.str({
    default: "https://tickettagger.blob.core.windows.net/models/model.bin",
  }),
  APPLICATIONINSIGHTS_CONNECTION_STRING: envalid.str({ devDefault: "" }),
  SESSION_NAME: envalid.str({ default: "tickettagger.session" }),
  SESSION_KEYS: hexKeyList({
    devDefault:
      "0000000000000000000000000000000000000000000000000000000000000000",
  }),
  SESSION_STORE_ENCRYPTION_KEY: hexKey({
    devDefault:
      "0000000000000000000000000000000000000000000000000000000000000000",
  }),
  MONGO_URI: envalid.url(),
  MONGO_ENCRYPTION_KEY: hexKey({
    devDefault:
      "0000000000000000000000000000000000000000000000000000000000000000",
  }),
  GITHUB_CLIENT_ID: envalid.str({ devDefault: "123456" }),
  GITHUB_CLIENT_SECRET: envalid.str({ devDefault: "123456" }),
  DATASET_DIR: envalid.str({
    default: path.join(os.homedir(), ".tickettagger/datasets"),
  }),
  MODEL_DIR: envalid.str({
    default: path.join(os.homedir(), ".tickettagger/models"),
  }),
  CONFIG_FILE_PATH: envalid.str({ default: ".github/tickettagger.yml" }),
  RATELIMIT_WINDOW_POINTS: envalid.num({ default: 120 }),
  RATELIMIT_WINDOW_SECONDS: envalid.num({ default: 60 * 10 }),
});

fs.mkdirSync(config.DATASET_DIR, { recursive: true });
fs.mkdirSync(config.MODEL_DIR, { recursive: true });
