/**
 * @file preprocess
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

const stemmer = require('natural').PorterStemmer;
const Analyzer = require('natural').SentimentAnalyzer;
const analyzer = new Analyzer("English", null, "afinn");

module.exports = function(text) { 
  // const stem = stemmer.tokenizeAndStem(text);
  // const sentimentScore = analyzer.getSentiment(stem);
  // const sentiment = !sentimentScore ? 'neutral' : sentimentScore > 0 ? 'positive' : 'negative';
  // return `${text} ${sentiment}`;
  return text;
}
