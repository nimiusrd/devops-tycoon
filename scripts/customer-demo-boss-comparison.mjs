import { writeFileSync } from 'node:fs';
import { compareCustomerDemoBoss } from '../src/prototypes/customerDemoBoss.ts';

// Node 24 の型除去を使用。通常ゲームの実行・保存には接続しない。
const target = new URL('../docs/prototypes/customer-demo-boss-comparison.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(compareCustomerDemoBoss(), null, 2)}\n`);
