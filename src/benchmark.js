/**
 * @file benchmark.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const classifier = require('./fasttext');

classifier.train().then(() => classifier.test());
