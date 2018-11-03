# ticket-tagger

### Development

#### get started:

```sh
git clone https://github.com/rafaelkallis/ticket-tagger ticket-tagger
cd ticket-tacker
npm install

# run benchmark
npm run benchmark

# run server
npm start
```

#### customize preprocessing:

```js
/* src/preprocess.js */

const stemmer = require('natural').PorterStemmer;

/* example preprocessing method */
module.exports = function(text) { 
  const stem = stemmer.tokenizeAndStem(text);
  return stem.join(' ');
}
```

#### generate dataset:

a dataset (with 10k bugs, 10k enhancements and 10k questions) is already included in the repository, or can be found [here](https://gist.github.com/rafaelkallis/707743843fa0337277ab36b42607c46d).
the dataset was generated using github archive's which can be accessed through google [BigQuery](https://bigquery.cloud.google.com).

add the query below to your BigQuery console and adjust if needed.

```sql
SELECT
  label, CONCAT(title, ' ', REGEXP_REPLACE(body, '(\r|\n|\r\n)',' '))
FROM (
  SELECT
    LOWER(JSON_EXTRACT_SCALAR(payload, '$.issue.labels[0].name')) AS label,
    JSON_EXTRACT_SCALAR(payload, '$.issue.title') AS title,
    JSON_EXTRACT_SCALAR(payload, '$.issue.body') AS body
  FROM
    [githubarchive:day.20180201],
    [githubarchive:day.20180202],
    [githubarchive:day.20180203],
    [githubarchive:day.20180204],
    [githubarchive:day.20180205]
  WHERE
    type = 'IssuesEvent'
    AND JSON_EXTRACT_SCALAR(payload, '$.action') = 'closed' )
WHERE 
  (label = 'bug' OR label = 'enhancement' OR label = 'question')
  AND body != 'null';
```

#### run serverless app:

you need a `.env` file in order to run the marketplace app.
The file should look like this:

```
GITHUB_CERT=/path/to/cert.private-key.pem
GITHUB_SECRET=123456
GITHUB_APP_ID=123
PORT=3000
```

#### references:

- [Building GitHub Apps](https://developer.github.com/apps/building-github-apps/)
- [Fasttext](https://fasttext.cc)
