#!/usr/bin/env node

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

const MODEL_DIR = path.join(os.homedir(), ".tickettagger/models");
const DATASET_DIR = path.join(os.homedir(), ".tickettagger/datasets");

fs.mkdirSync(MODEL_DIR, { recursive: true });
fs.mkdirSync(DATASET_DIR, { recursive: true });

const datasetManager = new DatasetManager({ DATASET_DIR });
const labels = ["__label__bug", "__label__enhancement", "__label__question"];
const datasetTable = {
  ["30k"]:
    "https://tickettagger.blob.core.windows.net/datasets/github-labels-top3-30493-real.csv",
  ["unbalanced"]:
    "https://tickettagger.blob.core.windows.net/datasets/github-labels-top3-30493-real.csv",
  ["127k"]:
    "https://tickettagger.blob.core.windows.net/datasets/github-labels-top3-real-127k.txt",
  ["397k"]:
    "https://tickettagger.blob.core.windows.net/datasets/github-labels-top3-real-397k.txt",
  ["30k-balanced"]:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues.txt",
  ["balanced"]:
    "https://gist.githubusercontent.com/rafaelkallis/6aa281b00d73d77fc843bd34f8184854/raw/8c10ebf2fd6f937f8667c660ea33d122bac739eb/issues.txt",
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

console.log(
  chalk.magenta(
    `tickettagger, Copyright (C) 2018-${new Date().getFullYear()} Rafael Kallis, AGPL-v3 license\n`
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
  .command({
    command: "train <dataset> <model>",
    description: "Train a model.",
    builder: (yargs) =>
      withHyperparameterOptions(yargs)
        .positional(
          "dataset",
          datasetOption({
            description: "The dataset (key or URL) to train the model with.",
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
            "$0 train 127k result",
            "Train a model using the 127k dataset and output to 'result.bin'.",
          ],
        ]),
    handler: trainHandler,
  })
  .command({
    command: "clean",
    description: "Clean the dataset + model cache.",
    handler: cleanHandler,
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
  const modelPath = path.join(MODEL_DIR, `${trainingset.id}`);
  await classifier.train("supervised", {
    input: trainingset.path,
    output: modelPath,
    ...filterHyperparameters(opts),
  });
  await classifier.loadModel(modelPath);
  const actual = [];
  const predicted = [];
  await evaluateInline(testset.path, classifier, actual, predicted);
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
    const modelPath = path.join(MODEL_DIR, `${id}`);
    await classifier.train("supervised", {
      input: trainPath,
      output: modelPath,
      ...filterHyperparameters(opts),
    });
    await classifier.loadModel(modelPath);
    await evaluateInline(testPath, classifier, actual, predicted);
    console.log(chalk.magenta(`run ${run + 1}/${folds} finished`));
  }
  printStats({ actual, predicted });
}

/**
 * Train a model.
 */
async function trainHandler({
  dataset: datasetUri,
  model: modelPath,
  force,
  ...opts
}) {
  const dataset = await datasetManager.fetch(datasetUri, force);
  const classifier = new Classifier();
  await classifier.train("supervised", {
    input: dataset.path,
    output: modelPath,
    ...filterHyperparameters(opts),
  });
}

function cleanHandler() {
  for (const datasetPath of fs.readdirSync(DATASET_DIR)) {
    fs.unlinkSync(path.join(DATASET_DIR, datasetPath));
  }
  for (const modelPath of fs.readdirSync(MODEL_DIR)) {
    fs.unlinkSync(path.join(MODEL_DIR, modelPath));
  }
}

async function* evaluateIter(datasetPath, classifier) {
  const lines = readline.createInterface({
    input: fs.createReadStream(datasetPath),
  });
  for await (const line of lines) {
    if (!/__label__[a-zA-Z0-9]+/.test(line)) {
      console.warn(chalk.yellow("found line with no label, skipping line"));
      continue;
    }
    const [actual] = line.match(/__label__[a-zA-Z0-9]+/);
    const text = line.substring(actual.length);
    const [predictionResult = { label: null }] = await classifier.predict(
      text,
      1
    );
    const predicted = predictionResult.label;
    yield { actual, predicted };
  }
}

async function evaluateInline(datasetPath, classifier, actual, predicted) {
  for await (const recordResult of evaluateIter(datasetPath, classifier)) {
    const { actual: recordActual, predicted: recordPredicted } = recordResult;
    actual.push(recordActual);
    predicted.push(recordPredicted);
  }
}

function printStats({ actual, predicted }) {
  const cm = ConfusionMatrix.fromLabels(actual, predicted);
  console.log(chalk.bgMagenta("  stats  "));
  const weights = Object.fromEntries(
    labels.map((l) => [l, actual.filter((a) => a === l).length / actual.length])
  );
  console.log(
    chalk.magenta("f1 weighted: "),
    sum(labels.map((l) => cm.getF1Score(l) * weights[l])).toFixed(3)
  );
  const TP = sum(labels.map((l) => cm.getTruePositiveCount(l)));
  const FP = sum(labels.map((l) => cm.getFalsePositiveCount(l)));
  const FN = sum(labels.map((l) => cm.getFalseNegativeCount(l)));
  const microF1 = (2 * TP) / (2 * TP + FP + FN);
  console.log(chalk.magenta("f1 micro: "), microF1.toFixed(3));
  console.log(
    chalk.magenta("f1 macro: "),
    sum(labels.map((l) => cm.getF1Score(l) / labels.length)).toFixed(3)
  );

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

function sum(values) {
  return values.reduce((acc, next) => acc + next, 0);
}
