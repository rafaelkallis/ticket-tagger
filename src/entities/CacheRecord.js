/**
 * @license Ticket Tagger automatically predicts and labels issue types.
 * Copyright (C) 2018-2021  Rafael Kallis
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
 * @file cache record
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const mongoose = require("mongoose");

const cacheRecordSchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  etag: { type: String, required: true },
  payload: { type: Object, required: true }, // TODO encrypt
  _ts: { type: Date, expires: 60 * 60 }, // cosmos db ttl
});

const CacheRecord = mongoose.model("CacheRecord", cacheRecordSchema);

module.exports = { CacheRecord };
