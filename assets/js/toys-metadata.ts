import toysData from './toys-data.js';
import { validateToyMetadata, type ValidatedToyEntry } from './utils/toy-schema.ts';

const validatedToys: ValidatedToyEntry[] = validateToyMetadata(toysData);

export type { ValidatedToyEntry };
export default validatedToys;
