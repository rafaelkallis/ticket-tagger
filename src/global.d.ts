declare module "@rafaelkallis/fasttext" {
	export class FastText {
		static from(path: string): Promise<FastText>;
		predict(text: string): Promise<[string, number][]>;
	}
}

declare module "nunjucks-octicons-extension" {
	import { Extension } from "nunjucks";
	const nunjucksOcticonsExtension: Extension;
	export default nunjucksOcticonsExtension;
}