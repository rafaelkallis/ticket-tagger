# Ticket Tagger
Machine learning driven issue classification bot.
[Add to your repository now!](https://github.com/apps/ticket-tagger/installations/new)

![](https://thumbs.gfycat.com/GreedyBrownHochstettersfrog-size_restricted.gif)

### Development

#### get started:

```sh
git clone https://github.com/rafaelkallis/ticket-tagger ticket-tagger
cd ticket-tacker
npm install
npm run dataset

# run benchmark
npm run benchmark

# run server
npm start
```

#### experiments:

For each experiment, we need a dataset that allows to test the stated hypothesis,
as well as a baseline dataset which contains the same amount of labelled issues.

> Does a repository specific dataset affect the model's performance?

```sh
# run baseline-issues benchmark
npm run dataset:vscode:baseline
npm run benchmark

# run vscode-issues benchmark
npm run dataset:vscode
npm run benchmark
```

> Does a (spoken) language specific dataset affect the models perfomrnace?

```sh
# run baseline-issues benchmark
npm run dataset:english:baseline
npm run benchmark

# run english-issues benchmark
npm run dataset:english
npm run benchmark
```

#### generate dataset:

A dataset (with 10k bugs, 10k enhancements and 10k questions) can be downloaded using `npm run dataset`.
The dataset was generated using github archive's which can be accessed through google [BigQuery](https://bigquery.cloud.google.com).

Add the query below to your BigQuery console and adjust if needed (e.g., add `__label__` prefix to labels, etc.).

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

You need a `.env` file in order to run the github app.
The file should look like this:

```
GITHUB_CERT=/path/to/cert.private-key.pem
GITHUB_SECRET=123456
GITHUB_APP_ID=123
PORT=3000
```

Note: When running app in production, environment variables should be provided by host.

#### references:

- [Building GitHub Apps](https://developer.github.com/apps/building-github-apps/)
- [Fasttext](https://fasttext.cc)
