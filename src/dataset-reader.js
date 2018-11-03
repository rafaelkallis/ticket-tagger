/**
 * @file dataset reader
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */


const Liner = require('n-readlines');

class DatasetReader {
  
  constructor(path) {
    this.liner = new Liner(path);
  }

  next() {
    let line = this.liner.next();
    if (!line) {
      return;
    }
    line = line.toString();
    const [label] = line.match(/^[a-z]+/);
    const text = line.substring(label.length + 1);
    return [label, text];
  }
}

module.exports = DatasetReader;
