import {validateReadiness} from './readiness.mjs';

try {
  const result = await validateReadiness();
  console.log(JSON.stringify(result));
} catch (error) {
  console.error('[Mindustry M1 preflight] ' + (error?.message ?? String(error)));
  process.exitCode = 1;
}
