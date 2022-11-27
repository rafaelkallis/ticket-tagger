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
 * @file telemetry
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const EventEmitter = require("events");
const appInsights = require("applicationinsights");

class Telemetry {
  constructor() {
    this.emitter = new EventEmitter();
  }

  event(name) {
    this.emitter.emit("event", name);
  }

  onEvent(handler) {
    this.emitter.on("event", handler);
  }

  attachConsole() {
    this.onEvent((name) => console.info(`Event emitted: ${name}`));
  }

  attachAppInsights() {
    if (!appInsights.defaultClient) {
      return;
    }
    this.onEvent((name) => appInsights.defaultClient.trackEvent({ name }));
  }
}

module.exports = new Telemetry();
