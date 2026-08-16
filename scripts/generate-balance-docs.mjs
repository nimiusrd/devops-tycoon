import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createServer } from 'vite';

const OUTPUT_PATH = resolve('plan/generated/balance-parameters.md');

async function main() {
  const server = await createServer({ appType: 'custom' });
  try {
    const balance = await server.ssrLoadModule('/src/data/balance/index.ts');
    const documentation = await server.ssrLoadModule('/src/data/balance/documentation.ts');
    const errors = balance.validateBalanceRegistry(balance.BALANCE_REGISTRY);

    if (errors.length > 0) {
      console.error('バランスレジストリの検証に失敗しました。');
      for (const error of errors) {
        console.error(`- [${error.code}] ${error.id}: ${error.message}`);
      }
      process.exitCode = 1;
      return;
    }

    const markdown = documentation.renderBalanceParametersMarkdown(balance.BALANCE_REGISTRY);
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, markdown, 'utf8');
    console.log(`バランスパラメータ表を生成しました: ${relative(process.cwd(), OUTPUT_PATH)}`);
  } finally {
    await server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
