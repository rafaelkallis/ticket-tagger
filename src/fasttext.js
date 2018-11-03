/**
 * @file ticket classifier
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const path = require('path');
const {Classifier} = require('fasttext');
const Reader = require('./dataset-reader');
const preprocess = require('./preprocess');
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
  input: trainPath,
  output: path.resolve(__dirname, '../model'),
  minCount: 25,
  // lr: 0.08,
  // dim: 250,
  // ws: 10,
  // loss: 'softmax',
}
 
exports.predict = async function(text) {
  // return [['bug','enhancement','question'][(Math.random() * 2.9999999999999999)|0],0];
  const [{label, value}] = await classifier.predict(text);
  return [label.substring(9), value];
}

exports.train = async function({prep = true, split = 1/3, n = Infinity, ...options} = {}) {
  if (prep) {
    console.log(magenta('preprocessing...'));
    fs.writeFileSync(testPath, '',);
    fs.writeFileSync(trainPath, '',);
    const reader = new Reader(datasetPath);
    let row;
    let i = 0;
    while ((row = reader.next()) && (i++ < n)) {
      const [label, text] = row;
      // if (franc(text) === 'eng') {
        const line = `__label__${label} ${preprocess(text)}\n`;
        fs.appendFileSync(Math.random() < split ? testPath : trainPath, line);
      // }
    }
    console.log(magenta('preprocessing finished!'));
  }

  console.log(magenta('training model...'));
  await classifier.train('supervised', {...defaultOptions, ...options});
  console.log(magenta('finished training!'));
}

exports.test = async function ({} = {}) {
  console.log(magenta('benchmarking model...'));
  const liner = new Liner(testPath);
  let line;
  const actualLabels = [];
  const predictedLabels = [];
  while (line = liner.next()) {
    try {
      line = line.toString();
      let [actual] = line.match(/^__label__[a-z]+/);
      actual = actual.substring(9);
      const text = preprocess(line.substring(actual.length + 10));
      const [prediction, similarity] = await exports.predict(text);
      actualLabels.push(actual);
      predictedLabels.push(prediction);
    } catch (e) {}
  }
  const cm = ConfusionMatrix.fromLabels(actualLabels, predictedLabels);
  console.log(bgMagenta('  stats  '));
  console.log(magenta('accuracy: '), cm.getAccuracy().toFixed(3));
  for (const label of ['bug','enhancement','question']) {
    console.log(bgMagenta(`   ${label}   `));
    console.log(magenta('precision: '), cm.getPositivePredictiveValue(label).toFixed(3));
    console.log(magenta('recall: '), cm.getTruePositiveRate(label).toFixed(3));
    console.log(magenta('f1 score: '), cm.getF1Score(label).toFixed(3));
    console.log(magenta('matthews CC: '), cm.getMatthewsCorrelationCoefficient(label).toFixed(3));
  }
}
