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
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

import path from "path";
import { promisify } from "util";
import fs from "fs"
import { pipeline as _pipeline } from "stream";
const pipeline = promisify(_pipeline);
import { FastText } from "@rafaelkallis/fasttext";
import fetch from "node-fetch";
import { Config } from "./Config";

interface ClassifierOptions {
  modelPath: string | null;
}

interface RemoteClassifierOptions {
  config: Config;
  modelUri: string;
}

export class Classifier {

  protected _modelPath: string | null;
  protected _fasttext: FastText | null;

  constructor({ modelPath }: ClassifierOptions) {
    this._modelPath = modelPath;
    this._fasttext = null;
  }

  static createFromRemote({ config, modelUri }: RemoteClassifierOptions) {
    return new RemoteModelClassifier({ config, modelUri });
  }

  static createFromLocal({ modelPath }: ClassifierOptions) {
    return new Classifier({ modelPath });
  }

  /**
   * Predicts a label given an issue body.
   *
   * @param {string} text - The issue body.
   * @returns {[string, number]} A tuple containing the predicted label and a similarity score.
   */
  async predict(text: string): Promise<[string | null, number]> {
    if (!this._fasttext) throw new Error("not initialized");
    // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
    const [prediction] = await this._fasttext.predict(text);
    if (!prediction) {
      return [null, 0];
    }
    return prediction;
  }

  async initialize(): Promise<Classifier> {
    if (this._fasttext) throw new Error("already initialized");
    if (!this._modelPath) throw new Error("no model path");
    this._fasttext = await FastText.from(this._modelPath);
    return this;
  }
}

class RemoteModelClassifier extends Classifier {

  private readonly _config: Config;
  private readonly _modelUri: string;

  constructor({ config, modelUri }: RemoteClassifierOptions) {
    super({ modelPath: null });
    this._config = config;
    this._modelUri = modelUri;
  }

  async initialize(): Promise<Classifier> {
    if (this._fasttext) throw new Error("already initialized");
    console.info("checking latest model");
    const latestModelVersion = await this._fetchRemoteModelVersion();
    console.info(`latest model version: ${latestModelVersion}`);
    this._modelPath = path.join(
      this._config.MODEL_DIR,
      `${latestModelVersion}.bin`
    );
    if (await this._existsLocally()) {
      console.info("latest model found locally");
    } else {
      console.info("latest model not found locally");
      await this._fetchRemoteModel();
    }
    return super.initialize();
  }

  async _existsLocally(): Promise<boolean> {
    if (!this._modelPath) throw new Error("no model path");
    return fs.promises
      .access(this._modelPath, fs.constants.R_OK | fs.constants.W_OK)
      .then(() => true)
      .catch(() => false);
  }

  async _fetchRemoteModelVersion() {
    const response = await fetch(this._modelUri, { method: "HEAD" });
    const modelId = response.headers.get("ETag");
    if (!modelId) {
      throw new Error('no "ETag" header found');
    }
    return modelId;
  }

  async _fetchRemoteModel() {
    console.info("fetching latest model");
    if (!this._modelPath) throw new Error("no model path");
    const response = await fetch(this._modelUri, {});
    await pipeline(response.body, fs.createWriteStream(this._modelPath));
  }
}
