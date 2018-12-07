/**
 * @file index
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const App = require("./app");
const config = require("./config");

const app = App();

app.listen(config.port, () => {
  console.info(`ticket-tagger listening on port ${config.port}`);
});
