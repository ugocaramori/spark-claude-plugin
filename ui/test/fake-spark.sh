#!/bin/sh
D="$(cd "$(dirname "$0")" && pwd)"
exec "$D/../node_modules/.bin/tsx" "$D/fake-spark.ts"
