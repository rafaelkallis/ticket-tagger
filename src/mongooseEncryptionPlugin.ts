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
 * @file mongoose encryption plugin
 * @author Rafael Kallis <rk@rafaelkallis.com>
 */

import assert from "assert";
import crypto from "crypto";
import mongoose from "mongoose";

interface EncryptionPluginOptions {
  key: Buffer;
}

interface EncryptedPath {
  virtualPath: string;
  shadowPath: string;
  symbol: symbol;
  schemaType: mongoose.SchemaType;
}

interface ShadowValue {
  ve: string;
  ek: Buffer;
  iv: Buffer;
  ac: Buffer;
  ct: Buffer;
}

interface SymbolValue {
  value: unknown;
  virtualPath: string;
  shadowPath: string;
}

const encryptionSchema = new mongoose.Schema<ShadowValue>(
  {
    ve: { type: String, required: true },
    ek: { type: Buffer, required: true },
    iv: { type: Buffer, required: true },
    ac: { type: Buffer, required: true },
    ct: { type: Buffer, required: true },
  },
  { strict: "throw" }
);

export function encryptionPlugin(schema: mongoose.Schema, options: EncryptionPluginOptions) {
  assert(options.key, "key is missing");
  const keyBytes = options.key;
  const keyByteLength = keyBytes.length as 16 | 24 | 32;
  assert(
    [16, 24, 32].includes(keyByteLength),
    "invalid key length, must be one of [16, 24, 32] bytes"
  );
  const keyBitLength = keyByteLength * 8 as 128 | 192 | 256;
  assert([128, 192, 256].includes(keyBitLength));

  const cipherAlgorithm: "aes-128-gcm" | "aes-192-gcm" | "aes-256-gcm" = `aes-${keyBitLength}-gcm`;

  const encryptedPaths: EncryptedPath[] = [];

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
      .get(function (this: mongoose.Document & Record<symbol, SymbolValue | undefined | null>) {
        return this[symbol] ? this[symbol].value : undefined;
      })
      .set(function (this: mongoose.Document & Record<symbol, SymbolValue | undefined | null>, value: unknown) {
        if (!this[symbol]) {
          this[symbol] = { value, virtualPath, shadowPath };
        }
        if (this[symbol] === null || this[symbol] === undefined) throw new Error("symbol is missing");
        this[symbol].value = value;
      });
  });

  schema.method({
    encrypt(this: mongoose.Document) {
      for (const { virtualPath, shadowPath } of encryptedPaths) {
        const virtualValue = this.get(virtualPath) as unknown;
        if (virtualValue === undefined || virtualValue === null) {
          this.set(shadowPath, virtualValue);
          continue;
        }
        const plaintext = Buffer.from(JSON.stringify(virtualValue));
        const ve = "1";
        const cek = crypto.randomBytes(keyByteLength);
        const cekCipher = crypto.createCipheriv(
          `aes${keyBitLength}-wrap`,
          keyBytes,
          Buffer.alloc(8, 0xa6)
        );
        const ek = Buffer.concat([cekCipher.update(cek), cekCipher.final()]);
        /* aes is a 128-bit block algo, therefore iv is 128 bits */
        const iv = crypto.randomBytes(16); // TODO check if we must use keyByteLength
        const cipher = crypto.createCipheriv(cipherAlgorithm, cek, iv);
        const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        const ac = cipher.getAuthTag();
        assert(ac.length === 16);
        const shadowValue: ShadowValue = { ve, ek, iv, ac, ct };
        this.set(shadowPath, shadowValue);
      }
    },
    decrypt(this: mongoose.Document & Record<symbol, unknown>) {
      for (const { virtualPath, symbol, shadowPath } of encryptedPaths) {
        assert(!this[symbol], `${virtualPath} is already decrypted`);
        const shadowValue = this.get(shadowPath) as ShadowValue | undefined | null;
        if (shadowValue === undefined || shadowValue === null) {
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
              keyBytes,
              Buffer.alloc(8, 0xa6)
            );
            const cek = Buffer.concat([
              cekDecipher.update(ek),
              cekDecipher.final(),
            ]);
            assert(cek.length === keyByteLength);
            assert(iv.length === 16);
            const decipher = crypto.createDecipheriv(cipherAlgorithm, cek, iv);
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
