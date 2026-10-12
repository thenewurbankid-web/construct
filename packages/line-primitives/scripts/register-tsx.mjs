// Register the .tsx module hooks (tsx-hooks.mjs) for this process; import it before importing any .tsx module.
import { register } from 'node:module';

register('./tsx-hooks.mjs', import.meta.url);
