// Operator entry point for the same cleanup POST /api/cron/sweep runs.
// It is not on a timer. A scheduler, or a person, starts it.
import { sweepOrphans } from '../lib/object-retention';

const result = await sweepOrphans();

console.log(result);
process.exit(0);
