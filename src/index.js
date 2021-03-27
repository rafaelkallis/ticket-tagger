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
 * @file index
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const appInsights = require("applicationinsights");
const config = require("./config");

if (config.APPINSIGHTS_INSTRUMENTATIONKEY) {
  appInsights
    .setup(config.APP_INSIGHTS_INSTRUMENTATIONKEY)
    .setSendLiveMetrics(true)
    .start();
}

const App = require("./app");

async function main() {
  const app = await App();

  app.listen(config.PORT, () => {
    console.info(`ticket-tagger listening on port ${config.PORT}`);
  });
}

main();
