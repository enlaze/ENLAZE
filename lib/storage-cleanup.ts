interface StorageEntry {
  id?: string | null;
  name: string;
  metadata?: unknown;
}

interface StorageOperationError {
  message: string;
  status?: number;
  statusCode?: number | string;
}

export interface StorageBucketLike {
  list(
    path: string,
    options: { limit: number; offset: number }
  ): PromiseLike<{ data: StorageEntry[] | null; error: StorageOperationError | null }>;
  remove(
    paths: string[]
  ): PromiseLike<{ data: unknown; error: StorageOperationError | null }>;
}

function joinStoragePath(prefix: string, name: string): string {
  return prefix ? `${prefix}/${name}` : name;
}

function isMissingBucket(error: StorageOperationError): boolean {
  const status = Number(error.status ?? error.statusCode);
  return status === 404 || /bucket.+not found/i.test(error.message);
}

/** Recursively enumerate actual objects; Storage list() returns folders too. */
export async function listStorageFilesRecursively(
  bucket: StorageBucketLike,
  prefix: string,
  pageSize = 100
): Promise<string[]> {
  const files: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await bucket.list(prefix, { limit: pageSize, offset });
    if (error) {
      if (isMissingBucket(error)) return [];
      throw new Error(error.message);
    }

    const entries = data || [];
    for (const entry of entries) {
      if (!entry.name || entry.name === "." || entry.name === "..") continue;
      const path = joinStoragePath(prefix, entry.name);
      const isFolder = entry.id == null && entry.metadata == null;
      if (isFolder) {
        files.push(...await listStorageFilesRecursively(bucket, path, pageSize));
      } else {
        files.push(path);
      }
    }

    if (entries.length < pageSize) break;
    offset += entries.length;
  }

  return files;
}

export async function deleteStorageTree(
  bucket: StorageBucketLike,
  prefix: string,
  batchSize = 100,
  excludedPaths: ReadonlySet<string> = new Set()
): Promise<number> {
  const files = (await listStorageFilesRecursively(bucket, prefix, batchSize))
    .filter((path) => !excludedPaths.has(path));
  let removed = 0;

  for (let index = 0; index < files.length; index += batchSize) {
    const paths = files.slice(index, index + batchSize);
    const { error } = await bucket.remove(paths);
    if (error) throw new Error(error.message);
    removed += paths.length;
  }

  return removed;
}
