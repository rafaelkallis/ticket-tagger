#!/usr/bin/env node

/**
 * @license Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018,2019,2020  Rafael Kallis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * @file cli.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const yargs = require("yargs");
const { Classifier } = require("fasttext");
const chalk = require("chalk");
const ConfusionMatrix = require("ml-confusion-matrix");
const { DatasetManager } = require("../src/dataset-manager");

const MODEL_DIR = path.join(os.tmpdir(), "ticket-tagger", "models");
const DATASET_DIR = path.join(os.tmpdir(), "ticket-tagger", "datasets");

fs.mkdirSync(MODEL_DIR, { recursive: true });
fs.mkdirSync(DATASET_DIR, { recursive: true });

const datasetManager = new DatasetManager({ DATASET_DIR });
const labels = ["__label__bug", "__label__enhancement", "__label__question"];
const datasetTable = {
  balanced:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues.txt",
  unbalanced:
    "https://tickettagger.blob.core.windows.net/datasets/github-labels-top3-30493-real.csv",
  english:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues_english.txt",
  ["english:baseline"]:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues_english_baseline.txt",
  nosnippet:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/544aabae57eaacc1fe817fa622ca49e785bc873a/issues_nosnippet_baseline.txt",
  ["nosnippet:baseline"]:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/544aabae57eaacc1fe817fa622ca49e785bc873a/issues_nosnippet_baseline.txt",
  vscode:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues_vscode.txt",
  ["vscode:baseline"]:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues_vscode_baseline.txt",
};

const datasetOption = (opts) =>
  Object.assign(
    {
      type: "string",
      description: "A dataset key or URL.",
      demandOption: true,
      coerce: (dataset) => datasetTable[dataset] || dataset,
    },
    opts
  );

const withHyperparameterOptions = (yargs) =>
  yargs
    .option("minCount", { type: "number" })
    .option("wordNgrams", { type: "number" })
    .option("bucket", { type: "number" })
    .option("minn", { type: "number" })
    .option("maxn", { type: "number" })
    .option("t", { type: "number" })
    .option("lr", { type: "number" })
    .option("lrUpdateRate", { type: "number" })
    .option("dim", { type: "number" })
    .option("ws", { type: "number" })
    .option("epoch", { type: "number" })
    .option("neg", { type: "number" })
    .option("loss", { type: "string" })
    .option("thread", { type: "number" });

const hyperparameterWhitelist = [
  "minCount",
  "wordNgrams",
  "bucket",
  "minn",
  "maxn",
  "t",
  "lr",
  "lrUpdateRate",
  "dim",
  "ws",
  "epoch",
  "neg",
  "loss",
  "thread",
];

const filterHyperparameters = (opts) =>
  Object.fromEntries(
    Object.entries(opts).filter(([key]) =>
      hyperparameterWhitelist.includes(key)
    )
  );

yargs(process.argv.slice(2))
  .scriptName("tickettagger")
  .command({
    command: "benchmark <mode>",
    description: "Run benchmarks on Ticket-Tagger.",
    builder: (yargs) =>
      yargs
        .command({
          command: "trivial <trainingset> <testset>",
          description: "Perform a trivial validation.",
          builder: (yargs) =>
            withHyperparameterOptions(yargs)
              .positional(
                "trainingset",
                datasetOption({
                  description:
                    "The dataset (key or URL) to train the model with.",
                })
              )
              .positional(
                "testset",
                datasetOption({
                  description:
                    "The dataset (key or URL) to be evaluated by the model.",
                })
              )
              .option("force", {
                type: "boolean",
                default: false,
                description:
                  "Force a new download even if the data is present locally.",
              })
              .example([
                [
                  "$0 benchmark trivial balanced unbalanced",
                  "Train the model with the balanced dataset and evaluate it's performance on the unbalanced dataset.",
                ],
                [
                  "$0 benchmark trivial unbalanced https://example.com/yourdataset.txt",
                  "Train the model with the unbalanced dataset and evaluate it's performance on a dataset identified by a URL.",
                ],
              ]),
          handler: trivialHandler,
        })
        .command({
          command: "cross <dataset>",
          description: "Perform a cross validation.",
          builder: (yargs) =>
            withHyperparameterOptions(yargs)
              .positional(
                "dataset",
                datasetOption({
                  description:
                    "The dataset (key or URL) to be used in the k-fold cross validation.",
                })
              )
              .option("folds", {
                type: "number",
                default: 10,
              })
              .option("force", {
                type: "boolean",
                default: false,
                description:
                  "Force a new download even if the data is present locally.",
              })
              .example([
                [
                  "$0 benchmark cross balanced",
                  "Perform a 10-fold cross-validation on the balanced dataset.",
                ],
                [
                  "$0 benchmark cross https://example.com/yourdataset.txt",
                  "Perform a 10-fold cross-validation on a dataset identified by a URL.",
                ],
              ]),
          handler: crossHandler,
        }),
  })
  .demandCommand()
  .help()
  .parse();

/**
 * trivial validation handler
 */
async function trivialHandler({
  testset: testsetUri,
  trainingset: trainingsetUri,
  force,
  ...opts
}) {
  const trainingset = await datasetManager.fetch(trainingsetUri, force);
  const testset = await datasetManager.fetch(testsetUri, force);
  const classifier = new Classifier();
  if (trainingset.id === testset.id) {
    console.warn(
      chalk.bgRed(
        "Attempting to use the same dataset for training and testing!"
      )
    );
  }
  const modelPath = path.join(MODEL_DIR, `${trainingset.id}.bin`);
  await classifier.train("supervised", {
    input: trainingset.path,
    output: modelPath,
    ...filterHyperparameters(opts),
  });
  await classifier.loadModel(modelPath);
  const { actual, predicted } = await evaluate(testset.path, classifier);
  printStats({ actual, predicted });
}

/**
 * cross validation handler
 */
async function crossHandler({ dataset: datasetUri, folds, force, ...opts }) {
  console.log(chalk.magenta(`running ${folds}-fold cross validation`));
  const classifier = new Classifier();
  const actual = [];
  const predicted = [];
  for (let run = 0; run < folds; run++) {
    const { id, trainPath, testPath } = await datasetManager.fetchFold({
      datasetUri,
      folds,
      run,
      force,
    });
    const modelPath = path.join(MODEL_DIR, `${id}.bin`);
    await classifier.train("supervised", {
      input: trainPath,
      output: modelPath,
      ...filterHyperparameters(opts),
    });
    await classifier.loadModel(modelPath);
    const { actual: runActual, predicted: runPredicted } = await evaluate(
      testPath,
      classifier
    );
    actual.push(...runActual);
    predicted.push(...runPredicted);
    console.log(chalk.magenta(`run ${run + 1}/${folds} finished`));
  }
  printStats({ actual, predicted });
}

async function evaluate(datasetPath, classifier) {
  const lines = readline.createInterface({
    input: fs.createReadStream(datasetPath),
  });
  const actualList = [];
  const predictedList = [];
  for await (const line of lines) {
    const [actual] = line.match(/__label__[a-zA-Z0-9]+/);
    const text = line.substring(actual.length);
    const [prediction = { label: null }] = await classifier.predict(text, 1);
    actualList.push(actual);
    predictedList.push(prediction.label);
  }
  return { actual: actualList, predicted: predictedList };
}

function printStats({ actual, predicted }) {
  const cm = ConfusionMatrix.fromLabels(actual, predicted);
  console.log(chalk.bgMagenta("  stats  "));
  console.log(chalk.magenta("accuracy: "), cm.getAccuracy().toFixed(3));

  for (const label of labels) {
    console.log(chalk.bgMagenta(`   ${label.substring(9)}   `));
    console.log(
      chalk.magenta("precision: "),
      cm.getPositivePredictiveValue(label).toFixed(3)
    );
    console.log(
      chalk.magenta("recall: "),
      cm.getTruePositiveRate(label).toFixed(3)
    );
    console.log(chalk.magenta("f1 score: "), cm.getF1Score(label).toFixed(3));
  }
}
