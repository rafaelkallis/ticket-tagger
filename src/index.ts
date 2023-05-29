/**
 * @license AGPL-3.0
 * Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2023  Rafael Kallis
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
 * @file index
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

import appInsights from "applicationinsights";
import { config } from "./Config";
import telemetry from "./telemetry";

if (config.NODE_ENV !== "production") {
  telemetry.attachConsole();
}

if (config.APPLICATIONINSIGHTS_CONNECTION_STRING !== "") {
  appInsights
    .setup(config.APPLICATIONINSIGHTS_CONNECTION_STRING)
    .setSendLiveMetrics(true)
    .start();
  telemetry.attachAppInsights();
}

import { App } from "./App";

const app = App({ config });

process.once("beforeExit", () => app.stop());

app.start();
