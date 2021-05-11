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
 * @file mongoose encryption plugin
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

"use strict";

const assert = require("assert");
const crypto = require("crypto");
const mongoose = require("mongoose");

const encryptionSchema = new mongoose.Schema(
  {
    ve: { type: String, required: true },
    ek: { type: Buffer, required: true },
    iv: { type: Buffer, required: true },
    ac: { type: Buffer, required: true },
    ct: { type: Buffer, required: true },
  },
  { strict: "throw" }
);

function encryptionPlugin(schema, options = {}) {
  assert(options.key, "key is missing");
  const kekBytes = options.key;
  const keyByteLength = kekBytes.length;
  assert(
    [16, 24, 32].includes(keyByteLength),
    "invalid key length, must be one of [16, 24, 32] bytes"
  );
  const keyBitLength = kekBytes.length * 8;

  const encryptedPaths = [];

  schema.eachPath(function (path, schemaType) {
    if (schemaType.schema) {
      schemaType.schema.plugin(encryptionPlugin, options);
      return;
    }

    if (!schemaType.options.encrypted) {
      return;
    }

    const { String, Number, Mixed } = mongoose.Schema.Types;
    const allowedTypes = [String, Number, Mixed];
    assert(
      allowedTypes.some((t) => schemaType instanceof t),
      `Type ${schemaType.constructor.name} not supported`
    );

    const allowedOptions = ["type", "required", "encrypted"];
    const illegalOptions = Object.keys(schemaType.options).filter(
      (o) => !allowedOptions.includes(o)
    );
    assert(
      illegalOptions.length === 0,
      `illegal options detected: ${illegalOptions.join(", ")}`
    );

    const virtualPath = path;
    const lastPeriodIndex = path.lastIndexOf(".");
    const shadowPath = `${path.substring(
      0,
      lastPeriodIndex + 1
    )}_${path.substring(lastPeriodIndex + 1)}`;
    const symbol = Symbol(virtualPath);
    encryptedPaths.push({ virtualPath, shadowPath, symbol, schemaType });

    schema.remove(virtualPath);
    schema.add({ [shadowPath]: encryptionSchema });
    schema
      .virtual(virtualPath)
      .get(function () {
        return this[symbol] ? this[symbol].value : undefined;
      })
      .set(function (value) {
        if (!this[symbol]) {
          this[symbol] = { virtualPath, shadowPath };
        }
        this[symbol].value = value;
      });
  });

  schema.method({
    encrypt() {
      for (const { virtualPath, shadowPath } of encryptedPaths) {
        const virtualValue = this.get(virtualPath);
        if ([undefined, null].includes(virtualValue)) {
          this.set(shadowPath, plaintext);
          continue;
        }
        const plaintext = Buffer.from(JSON.stringify(virtualValue));
        const ve = "1";
        const cek = crypto.randomBytes(keyByteLength);
        const cekCipher = crypto.createCipheriv(
          `aes${keyBitLength}-wrap`,
          kekBytes,
          Buffer.alloc(8, 0xa6)
        );
        const ek = Buffer.concat([cekCipher.update(cek), cekCipher.final()]);
        /* aes is a 128-bit block algo, therefore iv is 128 bits */
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(
          `aes-${keyBitLength}-gcm`,
          cek,
          iv
        );
        const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const ac = cipher.getAuthTag();
        assert(ac.length === 16);
        const shadowValue = { ve, ek, iv, ac, ct };
        this.set(shadowPath, shadowValue);
      }
    },
    decrypt() {
      for (const { virtualPath, symbol, shadowPath } of encryptedPaths) {
        assert(!this[symbol], `${virtualPath} is already decrypted`);
        const shadowValue = this.get(shadowPath);
        if ([null, undefined].includes(shadowValue)) {
          this[symbol] = { value: shadowValue, virtualPath, shadowPath };
          continue;
        }
        assert(shadowValue.ve, "no version found in shadow value");
        let plaintext = null;
        switch (shadowValue.ve) {
          case "1": {
            /* aes256 keywrap + aes256 content */
            const { ek, iv, ac, ct } = shadowValue;
            const cekDecipher = crypto.createDecipheriv(
              `aes${keyBitLength}-wrap`,
              kekBytes,
              Buffer.alloc(8, 0xa6)
            );
            const cek = Buffer.concat([
              cekDecipher.update(ek),
              cekDecipher.final(),
            ]);
            assert(cek.length === keyByteLength);
            assert(iv.length === 16);
            const decipher = crypto.createDecipheriv(
              `aes-${keyBitLength}-gcm`,
              cek,
              iv
            );
            assert(ac.length === 16);
            decipher.setAuthTag(ac);
            plaintext = Buffer.concat([
              decipher.update(ct),
              decipher.final(),
            ]).toString();
            break;
          }
          default: {
            throw new Error(`version ${shadowValue.ve} not supported`);
          }
        }
        const virtualValue = JSON.parse(plaintext);
        this.set(virtualPath, virtualValue);
      }
    },
  });

  schema.post("init", function postInitDecrypt(doc) {
    doc.decrypt();
  });

  schema.pre("save", function preSaveEncrypt() {
    this.encrypt();
  });
}

module.exports = { encryptionPlugin };
