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
 * @file config.js
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const envalid = require("envalid");

module.exports = envalid.cleanEnv(process.env, {
  NODE_ENV: envalid.str({ choices: ['production', 'test', 'development'] }),
  PORT: envalid.port({ devDefault: 3000 }),
  GITHUB_SECRET: envalid.str(),
  GITHUB_CERT: envalid.str(),
  GITHUB_APP_ID: envalid.str(),
});