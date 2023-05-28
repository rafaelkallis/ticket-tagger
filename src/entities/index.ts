
import mongoose from "mongoose";
import { CacheRecordModel, cacheRecordSchema } from "./CacheRecord";
import { UserModel, userSchema } from "./User";

export type Entities = {
	CacheRecord: CacheRecordModel;
	User: UserModel;
};

export function Entities({ mongooseConnection }: { mongooseConnection: mongoose.Connection }): Entities {
	return {
    User: mongooseConnection.model("User", userSchema),
    CacheRecord: mongooseConnection.model("CacheRecord", cacheRecordSchema),
	};
}
