import { writeFileSync } from 'node:fs';
import { compareTeamIntegrationBoss } from '../src/prototypes/teamIntegrationBoss.ts';

writeFileSync(
  new URL('../docs/prototypes/team-integration-comparison.json', import.meta.url),
  `${JSON.stringify(compareTeamIntegrationBoss(), null, 2)}\n`,
);
