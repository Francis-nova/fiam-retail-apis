// One-off, idempotent copy of every object from one S3-compatible store to
// another (MinIO -> Hetzner Object Storage), then a verification pass. Safe to
// re-run: objects already present with the same size are skipped. Nothing is
// ever deleted from the source.
//
// Configure with env (names are deliberately explicit so source and destination
// can't be mixed up):
//   SRC_ENDPOINT SRC_PORT SRC_USE_SSL SRC_ACCESS_KEY SRC_SECRET_KEY SRC_BUCKET [SRC_REGION] [SRC_PREFIX]
//   DST_ENDPOINT DST_PORT DST_USE_SSL DST_ACCESS_KEY DST_SECRET_KEY DST_BUCKET [DST_REGION] [DST_PREFIX]
// *_PREFIX is a folder inside the bucket (e.g. "fiam-staging/"); object names
// are compared and copied relative to it.
//
// Run it from the app image on the swarm's internal network (the MinIO source
// is not reachable from outside); see docker/README.md "Object storage".
import * as Minio from 'minio';

const normalize = (p: string) => {
  const t = p.trim().replace(/^\/+|\/+$/g, '');
  return t ? `${t}/` : '';
};

function client(prefix: 'SRC' | 'DST') {
  const env = (k: string, d = '') => process.env[`${prefix}_${k}`] ?? d;
  const need = (k: string) => {
    const v = env(k);
    if (!v) throw new Error(`${prefix}_${k} is required`);
    return v;
  };
  return {
    bucket: need('BUCKET'),
    prefix: normalize(env('PREFIX')),
    c: new Minio.Client({
      endPoint: need('ENDPOINT'),
      port: parseInt(
        env('PORT', env('USE_SSL') === 'true' ? '443' : '9000'),
        10,
      ),
      useSSL: env('USE_SSL') === 'true',
      accessKey: need('ACCESS_KEY'),
      secretKey: need('SECRET_KEY'),
      ...(env('REGION') ? { region: env('REGION') } : {}),
    }),
  };
}

// Names come back relative to the folder, so a source with no prefix and a
// destination inside "fiam-staging/" compare like for like.
async function list(c: Minio.Client, bucket: string, prefix: string) {
  const out = new Map<string, number>();
  const stream = c.listObjectsV2(bucket, prefix, true);
  for await (const o of stream as AsyncIterable<{
    name?: string;
    size: number;
  }>) {
    if (o.name) out.set(o.name.slice(prefix.length), o.size);
  }
  return out;
}

async function main() {
  const src = client('SRC');
  const dst = client('DST');
  if (
    process.env.SRC_ENDPOINT === process.env.DST_ENDPOINT &&
    src.bucket === dst.bucket &&
    src.prefix === dst.prefix
  ) {
    throw new Error('source and destination are the same location');
  }

  const [from, to] = await Promise.all([
    list(src.c, src.bucket, src.prefix),
    list(dst.c, dst.bucket, dst.prefix),
  ]);
  console.log(`source: ${from.size} objects, destination: ${to.size} objects`);

  let copied = 0;
  let skipped = 0;
  for (const [name, size] of from) {
    if (to.get(name) === size) {
      skipped++;
      continue;
    }
    const stat = await src.c.statObject(src.bucket, src.prefix + name);
    const meta = stat.metaData as Record<string, string> | undefined;
    const body = await src.c.getObject(src.bucket, src.prefix + name);
    await dst.c.putObject(dst.bucket, dst.prefix + name, body, size, {
      'Content-Type': meta?.['content-type'] ?? 'application/octet-stream',
    });
    copied++;
    console.log(`copied ${name} (${size} bytes)`);
  }

  // Verify against a fresh listing: every source object must now exist at the
  // destination with an identical size.
  const after = await list(dst.c, dst.bucket, dst.prefix);
  const bad = [...from].filter(([name, size]) => after.get(name) !== size);
  console.log(`copied ${copied}, already present ${skipped}`);
  if (bad.length > 0) {
    console.error(`VERIFY FAILED for ${bad.length} object(s):`);
    for (const [name] of bad) console.error(`  ${name}`);
    process.exit(1);
  }
  console.log(`VERIFIED: all ${from.size} objects present with matching sizes`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
