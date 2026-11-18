import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { ResourceKindSchema } from '../../shared/contracts.ts';
import { resourceManifestName } from '../platform.ts';

const ResourceEntrySchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  kind: ResourceKindSchema,
  relativePath: z
    .string()
    .refine(
      (value) =>
        !value.includes('\\') &&
        !value.includes(':') &&
        value
          .split('/')
          .every((part) => part !== '' && part !== '.' && part !== '..'),
      'Resource paths must stay inside the resource directory.',
    ),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sourceUrl: z.url(),
  license: z.string().min(1),
});

export const ResourceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  resources: z
    .array(ResourceEntrySchema)
    .refine(
      (resources) =>
        new Set(resources.map((entry) => entry.id)).size === resources.length,
      'Resource IDs must be unique.',
    ),
});
export type ResourceEntry = z.infer<typeof ResourceEntrySchema>;

export async function readManifest(directory: string) {
  const json: unknown = JSON.parse(
    await readFile(join(directory, resourceManifestName()), 'utf8'),
  );
  return ResourceManifestSchema.parse(json);
}
