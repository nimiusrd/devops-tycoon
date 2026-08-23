import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createServer } from 'vite';

const OUTPUT_PATHS = [
  resolve('docs/generated/balance-parameters.md'),
  resolve('docs/generated/content-catalog.md'),
  resolve('docs/generated/balance-curves.svg'),
];

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

    const markdown = documentation.renderBalanceParametersMarkdown(balance.BALANCE_REGISTRY, {
      version: balance.BALANCE_RULESET_VERSION,
      fingerprint: balance.BALANCE_RULESET_FINGERPRINT,
      fingerprintScheme: balance.BALANCE_RULESET_FINGERPRINT_SCHEME,
      policy: balance.BALANCE_RULESET_VERSION_POLICY,
    });
    const catalog = await server.ssrLoadModule('/src/data/contentCatalog.ts');
    const catalogDocumentation = await server.ssrLoadModule(
      '/src/data/contentCatalogDocumentation.ts',
    );
    const catalogErrors = catalog.validateContentCatalog(catalog.CONTENT_CATALOG);
    if (catalogErrors.length > 0) {
      console.error(catalogErrors.map((error) => `${error.category}: ${error.message}`).join('\n'));
      process.exitCode = 1;
      return;
    }
    const catalogMarkdown = catalogDocumentation.renderContentCatalogMarkdown(
      catalog.CONTENT_CATALOG,
    );
    const curves = await server.ssrLoadModule('/src/data/balance/curves.ts');
    const curveSvg = curves.renderBalanceCurvesSvg();
    const modelPath = resolve('docs/probability-model.md');
    const modelMarkdown = curves.applyBalanceCurveEndpointsToMarkdown(
      readFileSync(modelPath, 'utf8'),
    );
    for (const [outputPath, output] of [
      [OUTPUT_PATHS[0], markdown],
      [OUTPUT_PATHS[1], catalogMarkdown],
      [OUTPUT_PATHS[2], curveSvg],
      [modelPath, modelMarkdown],
    ]) {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, output, 'utf8');
    }
    console.log(
      `バランス生成物を生成しました: ${[...OUTPUT_PATHS, modelPath]
        .map((path) => relative(process.cwd(), path))
        .join(', ')}`,
    );
  } finally {
    await server.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
