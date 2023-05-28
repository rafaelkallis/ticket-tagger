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
 * @file cache record
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

import { Model, Schema } from "mongoose";

interface CacheRecordState {
  key: string;
  etag: string;
  payload: unknown;
  _ts: Date;
}

export type CacheRecordModel = Model<CacheRecordState>;

export const cacheRecordSchema = new Schema<CacheRecordState, CacheRecordModel>({
  key: { type: String, required: true, index: true },
  etag: { type: String, required: true },
  payload: { type: Object, required: true, encrypted: true },
  _ts: { type: Date, expires: 60 * 60 }, // cosmos db ttl
});
