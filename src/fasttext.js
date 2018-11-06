/**
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const path = require('path');
const {Classifier} = require('fasttext');
const Reader = require('./dataset-reader');
const fs = require('fs');
const {magenta, bgMagenta} = require('chalk');
const Liner = require('n-readlines');
const hash = require('object-hash');
const Table = require('cli-table');
const ConfusionMatrix = require('ml-confusion-matrix');
const franc = require('franc');

const datasetPath = path.resolve(__dirname, '../dataset.csv');
const testPath = path.resolve(__dirname, '../test.txt');
const trainPath = path.resolve(__dirname, '../train.txt');

const classifier = new Classifier(path.resolve(__dirname, '../model.bin'));
 
/* https://fasttext.cc/docs/en/options.html */
const defaultOptions = {
  
  // lr: 0.08,
  // dim: 250,
  // ws: 10,
  // loss: 'softmax',
}
 
async function predict(text) {
  // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
  const [prediction] = await classifier.predict(text);
  if (!prediction) { return [null, 0]; }
  const {label, value} = prediction;
  return [label.substring(9), value];
}
exports.predict = predict;

exports.train = async function({split = 1/3} = {}) {
  console.log(magenta('preprocessing...'));
  fs.writeFileSync(testPath, '',);
  fs.writeFileSync(trainPath, '',);
  const reader = new Reader(datasetPath);
  let row;
  while (row = reader.next()) {
    const [label, text] = row;
    const line = `__label__${label} ${text}\n`;
    fs.appendFileSync(Math.random() < split ? testPath : trainPath, line);
  }
  console.log(magenta('preprocessing finished!'));

  console.log(magenta('training model...'));
  await classifier.train('supervised', {
    input: trainPath,
    output: path.resolve(__dirname, '../model'),
    minCount: 25,
  });
  console.log(magenta('finished training!'));
}

/**
 * Trains the model with all available data
 */
async function trainAll() {
  console.log(magenta('preprocessing...'));
  fs.writeFileSync(trainPath, '',);
  const reader = new Reader(datasetPath);
  let row;
  while (row = reader.next()) {
    const [label, text] = row;
    const line = `__label__${label} ${text}\n`;
    fs.appendFileSync(trainPath, line);
  }
  console.log(magenta('preprocessing finished!'));

  console.log(magenta('training model...'));
  await classifier.train('supervised', {
    input: trainPath,
    output: path.resolve(__dirname, '../model'),
    minCount: 25,
  });
  console.log(magenta('finished training!'));
}
exports.trainAll = trainAll;

/**
 * Benchmarks the trained model against the test dataset
 */
async function test() {
  console.log(magenta('benchmarking model...'));
  const liner = new Liner(testPath);
  let line;
  const actualLabels = [];
  const predictedLabels = [];
  let failures = 0;
  while (line = liner.next()) {
    try {
      line = line.toString();
      let [actual] = line.match(/^__label__[a-z]+/);
      actual = actual.substring(9);
      const text = line.substring(actual.length + 10);
      const [prediction, similarity] = await predict(text);
      actualLabels.push(actual);
      predictedLabels.push(prediction);
    } catch (e) {
      failures++;
    }
  }
  console.log(predictedLabels.length);
  console.log(failures);
  const cm = ConfusionMatrix.fromLabels(actualLabels, predictedLabels);
  const results = ['bug','enhancement', 'question'].reduce((o, label) => ({...o, [label]: {
    precision: cm.getPositivePredictiveValue(label).toFixed(3),
    recall: cm.getTruePositiveRate(label).toFixed(3),
    f1: cm.getF1Score(label).toFixed(3),
  }}), {
    accuracy: cm.getAccuracy().toFixed(3),
  });
  // console.log(bgMagenta('  stats  '));
  // console.log(magenta('accuracy: '), results.accuracy);
  // for (const label of ['bug','enhancement','question']) {
  //   console.log(bgMagenta(`   ${label}   `));
  //   console.log(magenta('precision: '), results[label].precision);
  //   console.log(magenta('recall: '), results[label].recall);
  //   console.log(magenta('f1 score: '), results[label].f1);
  // }
  return results;
}
exports.test = test;

async function benchmark() {
  console.log(magenta('starting 10 fold validation...'));
  const accuracies = [];
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(testPath, '',);
    fs.writeFileSync(trainPath, '',);
    const reader = new Reader(datasetPath);
    let row;
    let bins = [0,0,0,0,0,0,0,0,0,0];
    while (row = reader.next()) {
      const [label, text] = row;
      const line = `__label__${label} ${text}\n`;
      fs.appendFileSync(parseInt(hash(line), 16) % 10 === i ? testPath : trainPath, line);
      bins[parseInt(hash(line), 16) % 10]++;
    }
    console.log(bins);

    await classifier.train('supervised', {
      input: trainPath,
      output: path.resolve(__dirname, '../model'),
      minCount: 25,
    });
    accuracies.push((await test()).accuracy);
    console.log(magenta(`run ${i} finished`));
  }
  console.log(accuracies);
}
exports.benchmark = benchmark;
